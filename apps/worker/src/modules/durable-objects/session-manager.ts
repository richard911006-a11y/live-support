import { createDefaultVisitorInfo } from '../../utils/visitor-info';
import type { SessionId, VisitorId, VisitorInfo } from '../../types';

/** Transport-only socket contract kept separate from the Session domain model. */
export interface SessionSocket {
  close(code?: number, reason?: string): void;
}

/**
 * Runtime projection for one connected visitor.
 *
 * This object owns connection and heartbeat state only. Durable Session
 * metadata is maintained separately by ChatRoom storage and domain contracts.
 */
export interface ChatSession<Socket extends SessionSocket = SessionSocket> {
  visitorId: VisitorId;
  sessionToken: string;
  sessionId: SessionId;
  websocket: Socket;
  connectedAt: number;
  lastHeartbeat: number;
  visitorInfo: VisitorInfo;
  /** @deprecated Kept for compatibility; domain conversation state is persisted by ChatRoom. */
  telegramConversationStarted: boolean;
}

type Clock = () => number;

export class SessionManager<Socket extends SessionSocket = SessionSocket> {
  private readonly sessions = new Map<SessionId, ChatSession<Socket>>();
  private readonly sessionIdsByVisitor = new Map<VisitorId, SessionId>();

  public constructor(private readonly clock: Clock = Date.now) {}

  public createSession(
    visitorId: VisitorId,
    websocket: Socket,
    sessionTokenOrVisitorInfo?: string | VisitorInfo,
    visitorInfo?: VisitorInfo,
  ): ChatSession<Socket> {
    const sessionToken =
      typeof sessionTokenOrVisitorInfo === 'string' ? sessionTokenOrVisitorInfo : '';
    const resolvedVisitorInfo =
      typeof sessionTokenOrVisitorInfo === 'string' ? visitorInfo : sessionTokenOrVisitorInfo;
    const existingSessionId = this.sessionIdsByVisitor.get(visitorId);

    if (existingSessionId !== undefined) {
      const existingSession = this.getSession(existingSessionId);

      if (existingSession !== undefined) {
        const previousWebsocket = existingSession.websocket;
        existingSession.websocket = websocket;
        existingSession.lastHeartbeat = this.clock();
        try {
          previousWebsocket.close(1000, 'Session resumed');
        } catch {
          // A socket that is already closed does not affect the resumed session.
        }
        return existingSession;
      }
    }

    const timestamp = this.clock();
    const session: ChatSession<Socket> = {
      visitorId,
      sessionToken,
      sessionId: crypto.randomUUID() as SessionId,
      websocket,
      connectedAt: timestamp,
      lastHeartbeat: timestamp,
      visitorInfo: resolvedVisitorInfo ?? createDefaultVisitorInfo(visitorId, timestamp),
      telegramConversationStarted: false,
    };

    this.sessions.set(session.sessionId, session);
    this.sessionIdsByVisitor.set(visitorId, session.sessionId);

    return session;
  }

  public removeSession(sessionId: SessionId): boolean {
    const session = this.sessions.get(sessionId);

    if (session === undefined) {
      return false;
    }

    this.sessions.delete(sessionId);

    if (this.sessionIdsByVisitor.get(session.visitorId) === sessionId) {
      this.sessionIdsByVisitor.delete(session.visitorId);
    }

    return true;
  }

  public getSession(sessionId: SessionId): ChatSession<Socket> | undefined {
    return this.sessions.get(sessionId);
  }

  public getSessionByVisitor(visitorId: VisitorId): ChatSession<Socket> | undefined {
    const sessionId = this.sessionIdsByVisitor.get(visitorId);

    return sessionId === undefined ? undefined : this.getSession(sessionId);
  }

  public hasSession(sessionId: SessionId): boolean {
    return this.sessions.has(sessionId);
  }

  public forEachSession(callback: (session: ChatSession<Socket>) => void): void {
    this.sessions.forEach(callback);
  }
}
