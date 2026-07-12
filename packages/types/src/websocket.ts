import type { SupportedImageMimeType } from './images';
import type { ImageId, MessageId, SessionId, VisitorId } from './identifiers';

export const HEARTBEAT_INTERVAL_MS = 30_000;
export const MAX_MESSAGE_LENGTH = 4_000;
export const MAX_IMAGE_CAPTION_LENGTH = 1_000;

export interface ConnectMessage {
  type: 'connect';
  /** Deprecated client field; identity is established by the server-issued token. */
  visitorId?: VisitorId;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
}

export interface ClientMessagePayload {
  type: 'message';
  content: string;
}

export interface ClientImageMessage {
  type: 'image';
  imageId: ImageId;
  url: string;
  contentType: SupportedImageMimeType;
  caption?: string;
}

export interface DisconnectMessage {
  type: 'disconnect';
}

export type ClientMessage =
  ConnectMessage | HeartbeatMessage | ClientMessagePayload | ClientImageMessage | DisconnectMessage;

export interface ConnectedMessage {
  type: 'connected';
  visitorId: VisitorId;
  sessionId: SessionId;
  sessionToken: string;
  connectedAt: number;
}

export interface ServerMessagePayload {
  type: 'message';
  messageId: MessageId;
  visitorId: VisitorId;
  content: string;
  sentAt: number;
  autoReplied?: boolean;
}

export interface ServerImageMessage {
  type: 'image';
  imageId: ImageId;
  visitorId: VisitorId;
  url: string;
  contentType: SupportedImageMimeType;
  caption?: string;
  sentAt: number;
}

export interface ReadMessage {
  type: 'read';
  messageId: MessageId;
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
  retryable?: boolean;
}

export interface PongMessage {
  type: 'pong';
  timestamp: number;
}

export type ServerMessage =
  | ConnectedMessage
  | ServerMessagePayload
  | ServerImageMessage
  | ReadMessage
  | ErrorMessage
  | PongMessage;

export type ProtocolMessage = ClientMessage | ServerMessage;
