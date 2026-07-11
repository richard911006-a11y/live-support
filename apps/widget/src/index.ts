import { createRoot } from 'react-dom/client';
import { createElement } from 'react';

import { ChatWidget, type ChatWidgetProps } from './ChatWidget';
export { ImageUploadError, uploadImage, type ImageUploadOptions } from '@live-support/utils';

export { ChatWidget } from './ChatWidget';
export type { ChatWidgetProps } from './ChatWidget';

export function mountChatWidget(container: HTMLElement, props?: ChatWidgetProps): () => void {
  const root = createRoot(container);
  root.render(createElement(ChatWidget, props ?? {}));

  return () => root.unmount();
}

export {
  connectLiveSupport,
  WebSocketClient,
  type ConnectionStatus,
  type ConnectionStatusListener,
  type ServerMessageListener,
  type WebSocketClientOptions,
} from './websocket-client';
