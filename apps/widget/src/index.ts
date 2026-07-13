import { createRoot } from 'react-dom/client';
import { createElement } from 'react';

import { ChatWidget, type ChatWidgetProps } from './ChatWidget';
import { LiveSupport } from './sdk';
export { ImageUploadError, uploadImage, type ImageUploadOptions } from '@live-support/utils';

export { ChatWidget } from './ChatWidget';
export type { ChatWidgetProps } from './ChatWidget';
export { LiveSupport } from './sdk';
export type { LiveSupportOptions, SupportInstance } from './sdk';
export type {
  ChatWidgetHandle,
  SentMessageEvent,
  SupportEventCallback,
  SupportEventName,
  SupportEventPayloadMap,
  Visitor,
} from './sdk-types';

export function mountChatWidget(container: HTMLElement, props?: ChatWidgetProps): () => void {
  const root = createRoot(container);
  root.render(createElement(ChatWidget, props ?? {}));

  return () => root.unmount();
}

export const init = LiveSupport.init;

export {
  connectLiveSupport,
  WebSocketClient,
  type ConnectionStatus,
  type ConnectionStatusListener,
  type ServerMessageListener,
  type WebSocketClientOptions,
} from './websocket-client';
