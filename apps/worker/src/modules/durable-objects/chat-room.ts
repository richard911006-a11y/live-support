import { DurableObject } from 'cloudflare:workers';

import {
  HEARTBEAT_INTERVAL_MS,
  SUPPORTED_IMAGE_MIME_TYPES,
  type ClientMessage,
  type MessageId,
  type ServerMessage,
  type ServerImageMessage,
} from '@live-support/types';
import { parseClientMessage, serializeProtocolMessage } from '@live-support/utils';

import { error, success } from '../../http/responses';
import { AutoReplyService } from '../kv';
import { TelegramService, type TelegramTopic } from '../telegram';
import type { SessionId, VisitorId } from '../../types';
import type { VisitorInfo } from '../../types';
import type { Env } from '../../types/env';
import { logger } from '../../utils/logger';
import { decodeVisitorInfo, VISITOR_INFO_HEADER } from '../../utils/visitor-info';
import {
  SESSION_TOKEN_HEADER,
  verifySessionToken,
  VISITOR_ID_HEADER,
} from '../../utils/session-identity';
import { InMemoryRateLimiter } from '../../utils/rate-limit';
import type { ChatSession } from './session-manager';
import { SessionManager } from './session-manager';

const HEARTBEAT_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 3;
const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const VISITOR_STATE_STORAGE_KEY = 'visitor-state';
const TELEGRAM_SENDER_ID = 'support' as VisitorId;

interface PersistedVisitorState {
  readonly visitorId: VisitorId;
  readonly visitorInfo: VisitorInfo;
  topics: TelegramTopic[];
  readonly createdAt: number;
  lastActivityAt: number;
  conversationStarted: boolean;
}

/** In-memory Durable Object session coordinator for connected visitors. */
export class ChatRoom extends DurableObject<Env> {
  private readonly sessions = new SessionManager<WebSocket>();
  private readonly heartbeatTimers = new Map<SessionId, ReturnType<typeof setTimeout>>();
  private readonly messageLimiter = new InMemoryRateLimiter(60, 60_000);
  private readonly imageLimiter = new InMemoryRateLimiter(10, 60_000);
  private readonly telegramService: TelegramService;
  private readonly autoReplyService: AutoReplyService;
  private readonly sessionIdleTimeoutMs: number;
  private visitorState: PersistedVisitorState | undefined;
  private visitorStatePromise: Promise<PersistedVisitorState> | undefined;

  public constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.telegramService = new TelegramService(env);
    this.autoReplyService = new AutoReplyService(env.CHAT_CONFIG);
    this.sessionIdleTimeoutMs = parseSessionIdleTimeout(env.SESSION_IDLE_TIMEOUT);
  }

  public override async fetch(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);

    if (request.method === 'POST' && requestUrl.pathname === '/internal/telegram/reply') {
      return this.handleTelegramReply(request);
    }

    if (request.method === 'POST' && requestUrl.pathname === '/internal/telegram/info') {
      return this.handleTelegramInfo();
    }

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return error('需要升级为 WebSocket 连接。', 426);
    }

    const visitorIdValue = request.headers.get(VISITOR_ID_HEADER);
    const sessionToken = request.headers.get(SESSION_TOKEN_HEADER);

    if (visitorIdValue === null || sessionToken === null) {
      return error('缺少访客标识。', 400);
    }

    const verifiedVisitorId = await verifySessionToken(
      sessionToken,
      this.env.TELEGRAM_WEBHOOK_SECRET,
    );

    if (verifiedVisitorId === undefined || verifiedVisitorId !== visitorIdValue) {
      return error('会话令牌无效。', 401);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    const visitorId = verifiedVisitorId;
    const wasConnected = this.sessions.getSessionByVisitor(visitorId) !== undefined;
    const session = this.onConnect(
      visitorId,
      server,
      sessionToken,
      decodeVisitorInfo(request.headers.get(VISITOR_INFO_HEADER), visitorId),
    );
    this.ctx.waitUntil(this.prepareVisitorState(visitorId, session.visitorInfo, !wasConnected));

    server.addEventListener('close', () => this.onDisconnect(session.sessionId, server));
    server.addEventListener('error', () => {
      this.onDisconnect(session.sessionId, server);
      this.closeSocket(server, 1011, 'Socket error');
    });
    server.addEventListener('message', (message) => {
      this.ctx.waitUntil(this.onMessage(session.sessionId, server, message));
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  public onConnect(
    visitorId: VisitorId,
    websocket: WebSocket,
    sessionToken: string,
    visitorInfo?: ChatSession<WebSocket>['visitorInfo'],
  ): ChatSession<WebSocket> {
    const session = this.sessions.createSession(visitorId, websocket, sessionToken, visitorInfo);
    this.scheduleHeartbeatTimeout(session);
    return session;
  }

  public onDisconnect(sessionId: SessionId, websocket?: WebSocket): void {
    const session = this.sessions.getSession(sessionId);

    if (session === undefined || (websocket !== undefined && session.websocket !== websocket)) {
      return;
    }

    this.sessions.removeSession(sessionId);
    this.clearHeartbeatTimeout(sessionId);
  }

  public async onMessage(
    sessionId: SessionId,
    websocket: WebSocket,
    message: MessageEvent,
  ): Promise<void> {
    const session = this.sessions.getSession(sessionId);

    if (session === undefined || session.websocket !== websocket) {
      return;
    }

    const clientMessage = parseClientMessage(message.data);

    if (clientMessage === undefined) {
      this.sendError(session, 'invalid_message', '消息必须是有效的 JSON 协议格式。');
      return;
    }

    try {
      await this.handleClientMessage(session, clientMessage);
    } catch (cause) {
      logger.error('Unhandled WebSocket message exception', cause);
      this.sendError(session, 'internal_error', '无法处理该消息。');
    }
  }

  public sendTelegramReply(visitorId: VisitorId, content: string): boolean {
    const session = this.sessions.getSessionByVisitor(visitorId);

    if (session === undefined) {
      return false;
    }

    const delivered = this.send(session, {
      type: 'message',
      messageId: crypto.randomUUID() as MessageId,
      visitorId: TELEGRAM_SENDER_ID,
      content,
      sentAt: Date.now(),
    });

    if (delivered) {
      this.ctx.waitUntil(this.touchVisitorActivity());
    }

    return delivered;
  }

  public sendTelegramImageReply(
    visitorId: VisitorId,
    imageId: string,
    url: string,
    contentType: ServerImageMessage['contentType'],
    caption?: string,
  ): boolean {
    const session = this.sessions.getSessionByVisitor(visitorId);

    if (session === undefined) {
      return false;
    }

    const image: ServerImageMessage = {
      type: 'image',
      imageId: imageId as ServerImageMessage['imageId'],
      visitorId: TELEGRAM_SENDER_ID,
      url,
      contentType,
      sentAt: Date.now(),
    };

    const delivered = this.send(session, caption === undefined ? image : { ...image, caption });

    if (delivered) {
      this.ctx.waitUntil(this.touchVisitorActivity());
    }

    return delivered;
  }

  private async handleClientMessage(
    session: ChatSession<WebSocket>,
    message: ClientMessage,
  ): Promise<void> {
    switch (message.type) {
      case 'connect':
        if (message.visitorId !== undefined && message.visitorId !== session.visitorId) {
          this.sendError(session, 'visitor_mismatch', '访客标识与当前会话不匹配。');
          return;
        }

        this.send(session, {
          type: 'connected',
          visitorId: session.visitorId,
          sessionId: session.sessionId,
          sessionToken: session.sessionToken,
          connectedAt: session.connectedAt,
        });
        return;
      case 'heartbeat':
        session.lastHeartbeat = Date.now();
        this.scheduleHeartbeatTimeout(session);
        this.send(session, { type: 'pong', timestamp: session.lastHeartbeat });
        return;
      case 'message': {
        if (!this.messageLimiter.consume(session.sessionId)) {
          this.sendError(session, 'rate_limited', '消息发送过于频繁，请稍后再试。', true);
          return;
        }

        const state = await this.prepareVisitorState(session.visitorId, session.visitorInfo, false);
        state.lastActivityAt = Date.now();
        await this.persistVisitorState(state);
        const autoReply = await this.autoReplyService.matchKeyword(message.content);
        const serverMessage: ServerMessage = {
          type: 'message',
          messageId: crypto.randomUUID() as MessageId,
          visitorId: session.visitorId,
          content: message.content,
          sentAt: Date.now(),
          ...(autoReply === undefined ? {} : { autoReplied: true }),
        };
        this.broadcast(serverMessage);
        this.send(session, { type: 'read', messageId: serverMessage.messageId });

        if (autoReply !== undefined) {
          this.send(session, {
            type: 'message',
            messageId: crypto.randomUUID() as MessageId,
            visitorId: TELEGRAM_SENDER_ID,
            content: autoReply,
            sentAt: Date.now(),
          });
          return;
        }

        const includeVisitorInfo = !state.conversationStarted;
        state.conversationStarted = true;
        await this.persistVisitorState(state);
        this.ctx.waitUntil(
          this.telegramService.notifyCustomerMessage(
            session.visitorId,
            message.content,
            includeVisitorInfo ? session.visitorInfo : undefined,
            state.topics,
          ),
        );
        return;
      }
      case 'image': {
        if (!this.imageLimiter.consume(session.sessionId)) {
          this.sendError(
            session,
            'rate_limited',
            'Too many images. Please try again shortly.',
            true,
          );
          return;
        }

        const state = await this.prepareVisitorState(session.visitorId, session.visitorInfo, false);
        state.lastActivityAt = Date.now();
        await this.persistVisitorState(state);

        const serverImageMessage: ServerImageMessage = {
          type: 'image',
          imageId: message.imageId,
          visitorId: session.visitorId,
          url: message.url,
          contentType: message.contentType,
          sentAt: Date.now(),
        };
        const image =
          message.caption === undefined
            ? serverImageMessage
            : { ...serverImageMessage, caption: message.caption };

        this.broadcast(image);
        this.send(session, {
          type: 'read',
          messageId: message.imageId as unknown as MessageId,
        });
        const includeVisitorInfo = !state.conversationStarted;
        state.conversationStarted = true;
        await this.persistVisitorState(state);
        this.ctx.waitUntil(
          this.telegramService.notifyCustomerImage(
            session.visitorId,
            message.url,
            message.caption,
            includeVisitorInfo ? session.visitorInfo : undefined,
            state.topics,
          ),
        );
        return;
      }
      case 'disconnect':
        await this.endVisitorSession();
        this.onDisconnect(session.sessionId, session.websocket);
        this.closeSocket(session.websocket, 1000, 'Client disconnected');
        return;
    }
  }

  private broadcast(message: ServerMessage): void {
    this.sessions.forEachSession((session) => this.send(session, message));
  }

  private send(session: ChatSession<WebSocket>, message: ServerMessage): boolean {
    try {
      session.websocket.send(serializeProtocolMessage(message));
      return true;
    } catch {
      this.onDisconnect(session.sessionId, session.websocket);
      this.closeSocket(session.websocket, 1011, 'Unable to deliver message');
      return false;
    }
  }

  private async handleTelegramReply(request: Request): Promise<Response> {
    try {
      const payload = (await request.json()) as {
        type?: unknown;
        visitorId?: unknown;
        content?: unknown;
        imageId?: unknown;
        url?: unknown;
        contentType?: unknown;
        caption?: unknown;
      };

      if (payload.type === 'image') {
        if (
          typeof payload.visitorId !== 'string' ||
          payload.visitorId.length === 0 ||
          typeof payload.imageId !== 'string' ||
          payload.imageId.length === 0 ||
          typeof payload.url !== 'string' ||
          !this.isHttpUrl(payload.url) ||
          typeof payload.contentType !== 'string' ||
          !SUPPORTED_IMAGE_MIME_TYPES.includes(
            payload.contentType as ServerImageMessage['contentType'],
          ) ||
          (payload.caption !== undefined && typeof payload.caption !== 'string')
        ) {
          return error('Telegram 图片回复数据无效。', 400);
        }

        return success({
          delivered: this.sendTelegramImageReply(
            payload.visitorId as VisitorId,
            payload.imageId,
            payload.url,
            payload.contentType as ServerImageMessage['contentType'],
            payload.caption,
          ),
        });
      }

      if (
        typeof payload.visitorId !== 'string' ||
        payload.visitorId.length === 0 ||
        typeof payload.content !== 'string' ||
        payload.content.length === 0
      ) {
        return error('Telegram 回复数据无效。', 400);
      }

      return success({
        delivered: this.sendTelegramReply(payload.visitorId as VisitorId, payload.content),
      });
    } catch {
      return error('Telegram 回复数据无效。', 400);
    }
  }

  private async handleTelegramInfo(): Promise<Response> {
    const state = await this.loadVisitorState();

    return success({ info: state?.visitorInfo });
  }

  public override async alarm(): Promise<void> {
    const state = await this.loadVisitorState();

    if (state === undefined) {
      return;
    }

    const remaining = state.lastActivityAt + this.sessionIdleTimeoutMs - Date.now();

    if (remaining > 0) {
      await this.ctx.storage.setAlarm(Date.now() + remaining);
      return;
    }

    if (state.topics.length > 0) {
      await this.telegramService.notifyTopicSystem(state.topics, '🔴 会话结束');
      await this.telegramService.closeTopics(state.topics);
    }

    state.topics = [];
    state.conversationStarted = false;
    state.lastActivityAt = Date.now();
    await this.persistVisitorState(state);
    await this.ctx.storage.deleteAlarm();
  }

  private isHttpUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private sendError(
    session: ChatSession<WebSocket>,
    code: string,
    message: string,
    retryable = false,
  ): void {
    this.send(session, { type: 'error', code, message, retryable });
  }

  private scheduleHeartbeatTimeout(session: ChatSession<WebSocket>): void {
    this.clearHeartbeatTimeout(session.sessionId);

    const timer = setTimeout(() => {
      const currentSession = this.sessions.getSession(session.sessionId);

      if (currentSession === undefined || currentSession.websocket !== session.websocket) {
        return;
      }

      if (Date.now() - currentSession.lastHeartbeat >= HEARTBEAT_TIMEOUT_MS) {
        this.onDisconnect(currentSession.sessionId, currentSession.websocket);
        this.closeSocket(currentSession.websocket, 1000, 'Heartbeat timeout');
        return;
      }

      this.scheduleHeartbeatTimeout(currentSession);
    }, HEARTBEAT_INTERVAL_MS);

    this.heartbeatTimers.set(session.sessionId, timer);
  }

  private clearHeartbeatTimeout(sessionId: SessionId): void {
    const timer = this.heartbeatTimers.get(sessionId);

    if (timer !== undefined) {
      clearTimeout(timer);
      this.heartbeatTimers.delete(sessionId);
    }
  }

  private closeSocket(socket: WebSocket, code: number, reason: string): void {
    try {
      socket.close(code, reason);
    } catch {
      // A concurrently closed socket is already disconnected.
    }
  }

  private prepareVisitorState(
    visitorId: VisitorId,
    visitorInfo: VisitorInfo,
    reconnect: boolean,
  ): Promise<PersistedVisitorState> {
    if (this.visitorState?.topics.length === 0) {
      this.visitorState = undefined;
    }

    if (this.visitorState !== undefined) {
      return reconnect
        ? this.notifyReconnect(this.visitorState)
        : Promise.resolve(this.visitorState);
    }

    if (this.visitorStatePromise !== undefined) {
      return this.visitorStatePromise;
    }

    const promise = this.loadAndPrepareVisitorState(visitorId, visitorInfo, reconnect);
    this.visitorStatePromise = promise;
    void promise.finally(() => {
      if (this.visitorStatePromise === promise) {
        this.visitorStatePromise = undefined;
      }
    });
    return promise;
  }

  private async notifyReconnect(state: PersistedVisitorState): Promise<PersistedVisitorState> {
    if (state.topics.length > 0) {
      await this.telegramService.notifyTopicSystem(state.topics, '🟡 已重新连接');
    }

    return state;
  }

  private async loadAndPrepareVisitorState(
    visitorId: VisitorId,
    visitorInfo: VisitorInfo,
    reconnect: boolean,
  ): Promise<PersistedVisitorState> {
    let state = await this.loadVisitorState();
    const expired =
      state !== undefined && Date.now() - state.lastActivityAt >= this.sessionIdleTimeoutMs;

    if (expired && state !== undefined) {
      if (state.topics.length > 0) {
        await this.telegramService.notifyTopicSystem(state.topics, '🔴 会话结束');
        await this.telegramService.closeTopics(state.topics);
      }
      state = undefined;
    }

    if (state === undefined || state.visitorId !== visitorId) {
      state = {
        visitorId,
        visitorInfo,
        topics: await this.telegramService.createVisitorTopics(visitorId, visitorInfo),
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        conversationStarted: false,
      };
      await this.persistVisitorState(state);
    } else if (state.topics.length === 0) {
      state.topics = await this.telegramService.createVisitorTopics(visitorId, state.visitorInfo);
      await this.persistVisitorState(state);
    } else if (reconnect) {
      await this.telegramService.notifyTopicSystem(state.topics, '🟡 已重新连接');
    }

    this.visitorState = state;
    await this.ctx.storage.setAlarm(state.lastActivityAt + this.sessionIdleTimeoutMs);
    return state;
  }

  private async loadVisitorState(): Promise<PersistedVisitorState | undefined> {
    if (this.visitorState !== undefined) {
      return this.visitorState;
    }

    const state = await this.ctx.storage.get<PersistedVisitorState>(VISITOR_STATE_STORAGE_KEY);
    this.visitorState = state;
    return state;
  }

  private async persistVisitorState(state: PersistedVisitorState): Promise<void> {
    this.visitorState = state;
    await this.ctx.storage.put(VISITOR_STATE_STORAGE_KEY, state);
    await this.ctx.storage.setAlarm(state.lastActivityAt + this.sessionIdleTimeoutMs);
  }

  private async touchVisitorActivity(): Promise<void> {
    const state = await this.loadVisitorState();

    if (state === undefined) {
      return;
    }

    state.lastActivityAt = Date.now();
    await this.persistVisitorState(state);
  }

  private async endVisitorSession(): Promise<void> {
    const state = await this.loadVisitorState();

    if (state === undefined) {
      return;
    }

    if (state.topics.length > 0) {
      await this.telegramService.notifyTopicSystem(state.topics, '🔴 会话结束');
      await this.telegramService.closeTopics(state.topics);
    }

    state.topics = [];
    state.conversationStarted = false;
    state.lastActivityAt = Date.now();
    await this.persistVisitorState(state);
  }
}

function parseSessionIdleTimeout(value: string | undefined): number {
  const normalized = value?.trim().toLowerCase();

  if (normalized === undefined || normalized.length === 0) {
    return DEFAULT_SESSION_IDLE_TIMEOUT_MS;
  }

  const match = normalized.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/u);

  if (match === null) {
    return DEFAULT_SESSION_IDLE_TIMEOUT_MS;
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const multiplier =
    unit === 'ms'
      ? 1
      : unit === 's'
        ? 1_000
        : unit === 'm'
          ? 60_000
          : unit === 'h'
            ? 3_600_000
            : 86_400_000;
  const timeout = amount * multiplier;

  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_SESSION_IDLE_TIMEOUT_MS;
}
