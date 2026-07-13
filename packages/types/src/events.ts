import type { Attachment, ChannelType } from './domain';
import type { ConnectionId, MessageId, SessionId, VisitorId } from './identifiers';

export type SessionEventType =
  | 'SessionCreated'
  | 'VisitorConnected'
  | 'VisitorDisconnected'
  | 'CustomerMessageReceived'
  | 'AgentMessageReceived'
  | 'AttachmentUploaded'
  | 'TopicCreated'
  | 'TopicClosed'
  | 'SessionClosed';

export interface SessionEventBase {
  readonly eventId: string;
  readonly sessionId: SessionId;
  readonly occurredAt: number;
}

export interface SessionCreatedEvent extends SessionEventBase {
  readonly type: 'SessionCreated';
  readonly visitorId: VisitorId;
}

export interface VisitorConnectedEvent extends SessionEventBase {
  readonly type: 'VisitorConnected';
  readonly connectionId: ConnectionId;
}

export interface VisitorDisconnectedEvent extends SessionEventBase {
  readonly type: 'VisitorDisconnected';
  readonly connectionId: ConnectionId;
}

export interface CustomerMessageReceivedEvent extends SessionEventBase {
  readonly type: 'CustomerMessageReceived';
  readonly messageId: MessageId;
}

export interface AgentMessageReceivedEvent extends SessionEventBase {
  readonly type: 'AgentMessageReceived';
  readonly messageId: MessageId;
}

export interface AttachmentUploadedEvent extends SessionEventBase {
  readonly type: 'AttachmentUploaded';
  readonly messageId: MessageId;
  readonly attachment: Attachment;
}

export interface TopicCreatedEvent extends SessionEventBase {
  readonly type: 'TopicCreated';
  readonly bindingId: string;
  readonly channel: ChannelType;
}

export interface TopicClosedEvent extends SessionEventBase {
  readonly type: 'TopicClosed';
  readonly bindingId: string;
  readonly channel: ChannelType;
}

export interface SessionClosedEvent extends SessionEventBase {
  readonly type: 'SessionClosed';
}

/** A small, channel-neutral contract for future logging, analytics, and automation. */
export type SessionEvent =
  | SessionCreatedEvent
  | VisitorConnectedEvent
  | VisitorDisconnectedEvent
  | CustomerMessageReceivedEvent
  | AgentMessageReceivedEvent
  | AttachmentUploadedEvent
  | TopicCreatedEvent
  | TopicClosedEvent
  | SessionClosedEvent;
