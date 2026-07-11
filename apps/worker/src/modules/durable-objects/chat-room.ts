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
import { TelegramService } from '../telegram';
import type { SessionId, VisitorId } from '../../types';
import type { Env } from '../../types/env';
import { logger } from '../../utils/logger';
import { decodeVisitorInfo, VISITOR_INFO_HEADER } from '../../utils/visitor-info';
import type { ChatSession } from './session-manager';
import { SessionManager } from './session-manager';

const HEARTBEAT_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 3;
const TELEGRAM_SENDER_ID = 'support' as VisitorId;

/** In-memory Durable Object session coordinator for connected visitors. */
export class ChatRoom extends DurableObject<Env> {
  private readonly sessions = new SessionManager<WebSocket>();
  private readonly heartbeatTimers = new Map<SessionId, ReturnType<typeof setTimeout>>();
  private readonly telegramService: TelegramService;
  private readonly autoReplyService: AutoReplyService;

  public constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.telegramService = new TelegramService(env);
    this.autoReplyService = new AutoReplyService(env.CHAT_CONFIG);
  }

  public async fetch(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);

    if (request.method === 'POST' && requestUrl.pathname === '/internal/telegram/reply') {
      return this.handleTelegramReply(request);
    }

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return error('WebSocket upgrade required', 426);
    }

    const visitorIdValue = new URL(request.url).searchParams.get('visitorId');

    if (visitorIdValue === null || visitorIdValue.length === 0) {
      return error('visitorId is required', 400);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    const visitorId = visitorIdValue as VisitorId;
    const session = this.onConnect(
      visitorId,
      server,
      decodeVisitorInfo(request.headers.get(VISITOR_INFO_HEADER), visitorId),
    );

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
    visitorInfo?: ChatSession<WebSocket>['visitorInfo'],
  ): ChatSession<WebSocket> {
    const session = this.sessions.createSession(visitorId, websocket, visitorInfo);
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
      this.sendError(session, 'invalid_message', 'Messages must be valid JSON protocol messages.');
      return;
    }

    try {
      await this.handleClientMessage(session, clientMessage);
    } catch (cause) {
      logger.error('Unhandled WebSocket message exception', cause);
      this.sendError(session, 'internal_error', 'Unable to process the message.');
    }
  }

  public sendTelegramReply(visitorId: VisitorId, content: string): boolean {
    const session = this.sessions.getSessionByVisitor(visitorId);

    if (session === undefined) {
      return false;
    }

    return this.send(session, {
      type: 'message',
      messageId: crypto.randomUUID() as MessageId,
      visitorId: TELEGRAM_SENDER_ID,
      content,
      sentAt: Date.now(),
    });
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

    return this.send(session, caption === undefined ? image : { ...image, caption });
  }

  private async handleClientMessage(
    session: ChatSession<WebSocket>,
    message: ClientMessage,
  ): Promise<void> {
    switch (message.type) {
      case 'connect':
        if (message.visitorId !== session.visitorId) {
          this.sendError(session, 'visitor_mismatch', 'The visitorId does not match this session.');
          return;
        }

        this.send(session, {
          type: 'connected',
          visitorId: session.visitorId,
          sessionId: session.sessionId,
          connectedAt: session.connectedAt,
        });
        return;
      case 'heartbeat':
        session.lastHeartbeat = Date.now();
        this.scheduleHeartbeatTimeout(session);
        this.send(session, { type: 'pong', timestamp: session.lastHeartbeat });
        return;
      case 'message': {
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

        const includeVisitorInfo = !session.telegramConversationStarted;
        session.telegramConversationStarted = true;
        this.ctx.waitUntil(
          this.telegramService.notifyCustomerMessage(
            session.visitorId,
            message.content,
            includeVisitorInfo ? session.visitorInfo : undefined,
          ),
        );
        return;
      }
      case 'image': {
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
        const includeVisitorInfo = !session.telegramConversationStarted;
        session.telegramConversationStarted = true;
        this.ctx.waitUntil(
          this.telegramService.notifyCustomerImage(
            session.visitorId,
            message.url,
            message.caption,
            includeVisitorInfo ? session.visitorInfo : undefined,
          ),
        );
        return;
      }
      case 'disconnect':
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
          return error('Invalid Telegram image reply payload', 400);
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
        return error('Invalid Telegram reply payload', 400);
      }

      return success({
        delivered: this.sendTelegramReply(payload.visitorId as VisitorId, payload.content),
      });
    } catch {
      return error('Invalid Telegram reply payload', 400);
    }
  }

  private isHttpUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private sendError(session: ChatSession<WebSocket>, code: string, message: string): void {
    this.send(session, { type: 'error', code, message, retryable: false });
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
}
