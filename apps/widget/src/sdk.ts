import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createElement, createRef } from 'react';

import type { ChatWidgetProps } from './ChatWidget';
import { ChatWidget } from './ChatWidget';
import type {
  ChatWidgetHandle,
  SupportEventCallback,
  SupportEventName,
  Visitor,
} from './sdk-types';

export interface LiveSupportOptions extends Omit<ChatWidgetProps, 'onEvent' | 'initialOpen'> {
  /** Worker origin used when the Widget and Worker are deployed separately. */
  worker?: string;
}

export interface SupportInstance {
  open(): void;
  close(): void;
  toggle(): void;
  destroy(): void;
  isOpen(): boolean;
  on<EventName extends SupportEventName>(
    event: EventName,
    callback: SupportEventCallback<EventName>,
  ): () => void;
  off<EventName extends SupportEventName>(
    event: EventName,
    callback: SupportEventCallback<EventName>,
  ): void;
  setVisitor(visitor: Visitor | undefined): void;
  getVisitor(): Visitor | undefined;
}

/** Small, dependency-free event emitter used by the public SDK instance. */
export class SupportEventEmitter {
  private readonly listeners = new Map<SupportEventName, Set<(payload: unknown) => void>>();

  public on<EventName extends SupportEventName>(
    event: EventName,
    callback: SupportEventCallback<EventName>,
  ): () => void {
    const listeners = this.listeners.get(event) ?? new Set<(payload: unknown) => void>();
    listeners.add(callback as unknown as (payload: unknown) => void);
    this.listeners.set(event, listeners);

    return () => this.off(event, callback);
  }

  public off<EventName extends SupportEventName>(
    event: EventName,
    callback: SupportEventCallback<EventName>,
  ): void {
    const listeners = this.listeners.get(event);
    listeners?.delete(callback as unknown as (payload: unknown) => void);
    if (listeners?.size === 0) {
      this.listeners.delete(event);
    }
  }

  public emit(event: SupportEventName, payload: unknown): void {
    this.listeners.get(event)?.forEach((listener) => listener(payload));
  }

  public clear(): void {
    this.listeners.clear();
  }
}

function resolveConnection(options: LiveSupportOptions): ChatWidgetProps['connection'] {
  if (options.worker === undefined || options.worker.trim().length === 0) {
    return options.connection;
  }

  return {
    ...(options.connection ?? {}),
    baseUrl: options.worker,
  };
}

function createContainer(): HTMLElement {
  if (typeof document === 'undefined') {
    throw new Error('LiveSupport.init() 需要在浏览器环境中调用。');
  }

  const container = document.createElement('div');
  container.dataset.liveSupportSdk = 'true';
  (document.body ?? document.documentElement).appendChild(container);
  return container;
}

function createSupportInstance(options: LiveSupportOptions): SupportInstance {
  const container = createContainer();
  const root = createRoot(container);
  const widgetRef = createRef<ChatWidgetHandle>();
  const events = new SupportEventEmitter();
  let destroyed = false;

  const handleEvent = (event: SupportEventName, payload: unknown): void => {
    if (!destroyed) {
      events.emit(event, payload);
    }
  };

  const resolvedConnection = resolveConnection(options);
  const widgetProps: ChatWidgetProps = {
    ...(resolvedConnection === undefined ? {} : { connection: resolvedConnection }),
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.visitor === undefined ? {} : { visitor: options.visitor }),
    autoButton: options.autoButton ?? true,
    onEvent: handleEvent,
  };

  flushSync(() => {
    root.render(createElement(ChatWidget, { ...widgetProps, ref: widgetRef }));
  });

  return {
    open(): void {
      if (!destroyed) {
        widgetRef.current?.open();
      }
    },
    close(): void {
      if (!destroyed) {
        widgetRef.current?.close();
      }
    },
    toggle(): void {
      if (!destroyed) {
        widgetRef.current?.toggle();
      }
    },
    destroy(): void {
      if (destroyed) {
        return;
      }

      destroyed = true;
      widgetRef.current?.close();
      root.unmount();
      container.remove();
      events.clear();
    },
    isOpen(): boolean {
      return !destroyed && (widgetRef.current?.isOpen() ?? false);
    },
    on<EventName extends SupportEventName>(
      event: EventName,
      callback: SupportEventCallback<EventName>,
    ): () => void {
      if (destroyed) {
        return () => undefined;
      }
      return events.on(event, callback);
    },
    off<EventName extends SupportEventName>(
      event: EventName,
      callback: SupportEventCallback<EventName>,
    ): void {
      events.off(event, callback);
    },
    setVisitor(visitor: Visitor | undefined): void {
      if (!destroyed) {
        widgetRef.current?.setVisitor(visitor);
      }
    },
    getVisitor(): Visitor | undefined {
      return destroyed ? undefined : widgetRef.current?.getVisitor();
    },
  };
}

export const LiveSupport = {
  init(options: LiveSupportOptions = {}): SupportInstance {
    return createSupportInstance(options);
  },
};

export type {
  SupportEventCallback,
  SupportEventName,
  SupportEventPayloadMap,
  Visitor,
} from './sdk-types';
