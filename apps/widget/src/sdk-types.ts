import type { ErrorMessage, ServerMessage } from '@live-support/types';

import type { ConnectionStatus } from './websocket-client';

/** Metadata supplied by an embedding site for the current visitor. */
export type Visitor = Readonly<Record<string, unknown>>;

export type SupportEventName =
  | 'open'
  | 'close'
  | 'connected'
  | 'disconnected'
  | 'message'
  | 'message:sent'
  | 'message:received'
  | 'error';

export interface SentMessageEvent {
  readonly kind: 'text' | 'image';
  readonly content?: string;
  readonly imageId?: string;
}

export interface SupportEventPayloadMap {
  open: undefined;
  close: undefined;
  connected: ConnectionStatus;
  disconnected: ConnectionStatus;
  message: ServerMessage;
  'message:sent': SentMessageEvent;
  'message:received': ServerMessage;
  error: Error | ErrorMessage;
}

export type SupportEventCallback<EventName extends SupportEventName = SupportEventName> = (
  payload: SupportEventPayloadMap[EventName],
) => void;

export interface ChatWidgetHandle {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  setVisitor(visitor: Visitor | undefined): void;
  getVisitor(): Visitor | undefined;
}
