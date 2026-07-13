import type { ImageId, MessageId, SessionId, VisitorId } from './identifiers';

/** Anonymous visitor identity shared by one or more customer sessions. */
export interface Visitor {
  readonly visitorId: VisitorId;
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
}

/** The business conversation aggregate. All customer and agent activity belongs to a Session. */
export interface Session {
  readonly sessionId: SessionId;
  readonly visitorId: VisitorId;
  readonly status: SessionStatus;
  readonly createdAt: number;
  readonly lastActivityAt: number;
  readonly closedAt?: number;
}

export type SessionStatus = 'active' | 'idle' | 'closed';

export type MessageSender = 'visitor' | 'agent' | 'system' | 'bot' | 'ai';

export type MessageDirection = 'inbound' | 'outbound';

/** Future customer-service identity; it is intentionally independent of Telegram accounts. */
export interface Agent {
  readonly agentId: string;
  readonly displayName: string;
  readonly status: 'online' | 'away' | 'offline';
}

/** Image metadata only. Upload and storage operations belong to infrastructure services. */
export interface Attachment {
  readonly imageId: ImageId;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly storageKey?: string;
  readonly url?: string;
}

/** A channel-neutral message in a Session. */
export interface Message {
  readonly messageId: MessageId;
  readonly sessionId: SessionId;
  readonly sender: MessageSender;
  readonly direction: MessageDirection;
  readonly content?: string;
  readonly attachments?: readonly Attachment[];
  readonly createdAt: number;
}

/** Runtime connection metadata. A Connection is not a customer, agent, or Session. */
export interface Connection {
  readonly connectionId: string;
  readonly sessionId: SessionId;
  readonly connectedAt: number;
  readonly lastHeartbeatAt: number;
  readonly status: ConnectionStatus;
  readonly transport: 'websocket';
}

export type ConnectionStatus = 'connected' | 'disconnected';

export type ChannelType = 'widget' | 'telegram' | 'agent-console' | 'other';

/** External channel projection attached to a Session. */
export interface SessionChannelBinding {
  readonly bindingId: string;
  readonly sessionId: SessionId;
  readonly channel: ChannelType;
  readonly externalConversationId: string;
  readonly externalThreadId?: string;
  readonly status: 'active' | 'closed' | 'invalid';
}
