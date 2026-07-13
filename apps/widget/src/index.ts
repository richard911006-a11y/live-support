import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createElement, createRef } from 'react';

import { ChatWidget, type ChatWidgetProps } from './ChatWidget';
import { installGlobalApi, registerWidgetHandle } from './global-api';
import { LiveSupport } from './sdk';
import type { ChatWidgetHandle } from './sdk-types';
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
  LiveSupportWindowApi,
} from './sdk-types';

export function mountChatWidget(container: HTMLElement, props?: ChatWidgetProps): () => void {
  const root = createRoot(container);
  const widgetRef = createRef<ChatWidgetHandle>();

  installGlobalApi();
  flushSync(() => {
    root.render(createElement(ChatWidget, { ...(props ?? {}), ref: widgetRef }));
  });
  const unregisterGlobalWidget =
    widgetRef.current === null || widgetRef.current === undefined
      ? () => undefined
      : registerWidgetHandle(widgetRef.current);

  return () => {
    unregisterGlobalWidget();
    root.unmount();
  };
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
