import {
  HEARTBEAT_INTERVAL_MS,
  type ClientMessage,
  type ClientImageMessage,
  type ErrorMessage,
  type ServerMessage,
  type SessionId,
  type VisitorId,
} from '@live-support/types';
import {
  buildWebSocketUrl,
  getOrCreateVisitorId,
  parseServerMessage,
  serializeProtocolMessage,
} from '@live-support/utils';

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const SOCKET_CLOSED = 3;

export interface WebSocketClientOptions {
  endpoint?: string;
  baseUrl?: string;
  visitorId?: VisitorId;
  storage?: Storage;
  heartbeatIntervalMs?: number;
  reconnectInitialDelayMs?: number;
  reconnectMaxDelayMs?: number;
  websocketFactory?: (url: string) => WebSocket;
  autoConnect?: boolean;
}

export type ServerMessageListener = (message: ServerMessage) => void;
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
export type ConnectionStatusListener = (status: ConnectionStatus) => void;

function defaultBaseUrl(): string {
  return typeof location === 'undefined' ? 'http://localhost/' : location.href;
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

function connectionError(message: string): ErrorMessage {
  return {
    type: 'error',
    code: 'connection_failed',
    message,
    retryable: true,
  };
}

export class WebSocketClient {
  public readonly visitorId: VisitorId;

  private readonly endpoint: string;
  private readonly baseUrl: string;
  private readonly heartbeatIntervalMs: number;
  private readonly reconnectInitialDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly websocketFactory: (url: string) => WebSocket;
  private readonly listeners = new Set<ServerMessageListener>();
  private readonly statusListeners = new Set<ConnectionStatusListener>();
  private socket: WebSocket | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempt = 0;
  private shouldReconnect = true;
  private currentSessionId: SessionId | undefined;
  private lastPongAt = 0;
  private connectionStatus: ConnectionStatus = 'disconnected';

  public constructor(options: WebSocketClientOptions = {}) {
    this.visitorId = options.visitorId ?? getOrCreateVisitorId(options.storage ?? defaultStorage());
    this.endpoint = options.endpoint ?? '/ws';
    this.baseUrl = options.baseUrl ?? defaultBaseUrl();
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.reconnectInitialDelayMs = options.reconnectInitialDelayMs ?? 1_000;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30_000;
    this.websocketFactory = options.websocketFactory ?? ((url) => new WebSocket(url));

    const defaultAutoConnect =
      options.websocketFactory !== undefined || typeof WebSocket !== 'undefined';

    if (options.autoConnect ?? defaultAutoConnect) {
      this.connect();
    }
  }

  public get sessionId(): SessionId | undefined {
    return this.currentSessionId;
  }

  public get status(): ConnectionStatus {
    return this.connectionStatus;
  }

  public connect(): void {
    this.shouldReconnect = true;
    this.clearReconnectTimer();

    if (
      this.socket !== undefined &&
      (this.socket.readyState === SOCKET_CONNECTING || this.socket.readyState === SOCKET_OPEN)
    ) {
      return;
    }

    this.setStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

    const url = new URL(buildWebSocketUrl(this.endpoint, this.baseUrl));
    url.searchParams.set('visitorId', this.visitorId);

    try {
      const socket = this.websocketFactory(url.toString());
      this.socket = socket;
      socket.addEventListener('open', () => this.handleOpen(socket));
      socket.addEventListener('message', (event) => this.handleMessage(socket, event));
      socket.addEventListener('error', () => this.handleSocketError(socket));
      socket.addEventListener('close', () => this.handleClose(socket));
    } catch {
      this.emit(connectionError('Unable to create a WebSocket connection.'));
      this.setStatus('reconnecting');
      this.scheduleReconnect();
    }
  }

  public disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.setStatus('disconnected');

    const socket = this.socket;
    this.socket = undefined;

    if (socket === undefined) {
      return;
    }

    if (socket.readyState === SOCKET_OPEN) {
      try {
        socket.send(serializeProtocolMessage({ type: 'disconnect' }));
      } catch {
        // The close call below still completes local shutdown when send fails.
      }
    }

    socket.close(1000, 'Client disconnected');
  }

  public sendMessage(content: string): boolean {
    if (content.length === 0 || this.socket?.readyState !== SOCKET_OPEN) {
      return false;
    }

    return this.send({ type: 'message', content });
  }

  public sendImage(image: Omit<ClientImageMessage, 'type'>): boolean {
    return this.send({ type: 'image', ...image });
  }

  public subscribe(listener: ServerMessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public subscribeStatus(listener: ConnectionStatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.connectionStatus);
    return () => this.statusListeners.delete(listener);
  }

  private handleOpen(socket: WebSocket): void {
    if (this.socket !== socket) {
      return;
    }

    this.reconnectAttempt = 0;
    this.lastPongAt = Date.now();

    if (!this.send({ type: 'connect', visitorId: this.visitorId })) {
      socket.close(1011, 'Unable to initialize the session');
      return;
    }

    this.startHeartbeat();
  }

  private handleMessage(socket: WebSocket, event: MessageEvent): void {
    if (this.socket !== socket) {
      return;
    }

    const message = parseServerMessage(event.data);

    if (message === undefined) {
      this.emit({
        type: 'error',
        code: 'invalid_server_message',
        message: 'The server sent an invalid JSON protocol message.',
        retryable: false,
      });
      return;
    }

    if (message.type === 'connected') {
      this.currentSessionId = message.sessionId;
      this.setStatus('connected');
    }

    if (message.type === 'pong') {
      this.lastPongAt = Date.now();
    }

    this.emit(message);
  }

  private handleSocketError(socket: WebSocket): void {
    if (this.socket !== socket) {
      return;
    }

    this.emit(connectionError('The WebSocket connection reported an error.'));

    if (this.shouldReconnect) {
      this.setStatus('reconnecting');
    }

    if (socket.readyState !== SOCKET_CLOSED) {
      socket.close(1011, 'Socket error');
    }
  }

  private handleClose(socket: WebSocket): void {
    if (this.socket !== socket) {
      return;
    }

    this.socket = undefined;
    this.stopHeartbeat();
    this.currentSessionId = undefined;

    if (this.shouldReconnect) {
      this.setStatus('reconnecting');
      this.scheduleReconnect();
    } else {
      this.setStatus('disconnected');
    }
  }

  private send(message: ClientMessage): boolean {
    if (this.socket?.readyState !== SOCKET_OPEN) {
      return false;
    }

    try {
      this.socket.send(serializeProtocolMessage(message));
      return true;
    } catch {
      this.emit(connectionError('The WebSocket message could not be sent.'));
      return false;
    }
  }

  private emit(message: ServerMessage): void {
    this.listeners.forEach((listener) => listener(message));
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.connectionStatus === status) {
      return;
    }

    this.connectionStatus = status;
    this.statusListeners.forEach((listener) => listener(status));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastPongAt >= this.heartbeatIntervalMs * 3) {
        this.stopHeartbeat();
        this.socket?.close(1011, 'Heartbeat timeout');
        return;
      }

      if (!this.send({ type: 'heartbeat' })) {
        this.stopHeartbeat();
      }
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer !== undefined) {
      return;
    }

    this.reconnectAttempt += 1;
    const delay = Math.min(
      this.reconnectMaxDelayMs,
      this.reconnectInitialDelayMs * 2 ** (this.reconnectAttempt - 1),
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}

export function connectLiveSupport(options: WebSocketClientOptions = {}): WebSocketClient {
  return new WebSocketClient(options);
}
