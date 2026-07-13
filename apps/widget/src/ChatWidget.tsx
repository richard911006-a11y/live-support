import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react';

import type {
  ImageUploadResult,
  ImageId,
  MessageId,
  ServerMessage,
  SupportedImageMimeType,
} from '@live-support/types';
import { uploadImage } from '@live-support/utils';

import {
  WebSocketClient,
  type ConnectionStatus,
  type WebSocketClientOptions,
} from './websocket-client';
import { type ChatWidgetHandle, type SupportEventName, type Visitor } from './sdk-types';
import './styles.css';

type MessageAuthor = 'visitor' | 'support';
type DeliveryStatus = 'sending' | 'sent' | 'read';

interface ChatMessage {
  id: string;
  serverMessageId?: MessageId | ImageId;
  author: MessageAuthor;
  content: string;
  imageId?: string;
  imageUrl?: string;
  imageContentType?: SupportedImageMimeType;
  timestamp: number;
  deliveryStatus: DeliveryStatus;
}

export interface ChatWidgetProps {
  connection?: WebSocketClientOptions;
  title?: string;
  autoButton?: boolean;
  initialOpen?: boolean;
  visitor?: Visitor;
  onEvent?: (event: SupportEventName, payload: unknown) => void;
}

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connecting: '正在连接…',
  connected: '已连接',
  disconnected: '已断开',
  reconnecting: '正在重新连接…',
};

const DELIVERY_LABELS: Record<DeliveryStatus, string> = {
  sending: '发送中',
  sent: '已发送',
  read: '已读',
};

function createLocalMessage(content: string): ChatMessage {
  return {
    id: `local-${crypto.randomUUID()}`,
    author: 'visitor',
    content,
    timestamp: Date.now(),
    deliveryStatus: 'sending',
  };
}

function createLocalImageMessage(image: ImageUploadResult): ChatMessage {
  return {
    id: `local-${image.imageId}`,
    author: 'visitor',
    content: '',
    imageId: image.imageId,
    imageUrl: image.url,
    imageContentType: image.contentType,
    timestamp: Date.now(),
    deliveryStatus: 'sending',
  };
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
}

export const ChatWidget = forwardRef<ChatWidgetHandle, ChatWidgetProps>(function ChatWidget(
  {
    connection,
    title = '在线客服',
    autoButton = true,
    initialOpen = false,
    visitor: initialVisitor,
    onEvent,
  },
  ref,
): JSX.Element {
  const clientRef = useRef<WebSocketClient | null>(null);
  const endOfMessagesRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [isOpen, setIsOpen] = useState(initialOpen);
  const isOpenRef = useRef(initialOpen);
  const [visitor, setVisitorState] = useState<Visitor | undefined>(initialVisitor);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>(undefined);
  const workerBaseUrl = connection?.baseUrl ?? import.meta.env.VITE_WORKER_BASE_URL?.trim();
  const emitEvent = useCallback(
    (event: SupportEventName, payload: unknown): void => {
      onEvent?.(event, payload);
    },
    [onEvent],
  );

  if (clientRef.current === null) {
    clientRef.current = new WebSocketClient({
      ...(connection ?? {}),
      ...(workerBaseUrl === undefined ? {} : { baseUrl: workerBaseUrl }),
      autoConnect: false,
    });
  }

  const client = clientRef.current;

  const open = useCallback((): void => {
    isOpenRef.current = true;
    setIsOpen(true);
  }, []);

  const close = useCallback((): void => {
    isOpenRef.current = false;
    setIsOpen(false);
  }, []);

  const toggle = useCallback((): void => {
    isOpenRef.current = !isOpenRef.current;
    setIsOpen(isOpenRef.current);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      open,
      close,
      toggle,
      isOpen: () => isOpenRef.current,
      setVisitor: setVisitorState,
      getVisitor: () => visitor,
    }),
    [close, isOpen, open, toggle, visitor],
  );

  const previousOpenRef = useRef(isOpen);
  useEffect(() => {
    if (previousOpenRef.current !== isOpen) {
      emitEvent(isOpen ? 'open' : 'close', undefined);
      previousOpenRef.current = isOpen;
    }
  }, [emitEvent, isOpen]);

  useEffect(() => {
    const previousStatusRef: { current: ConnectionStatus | undefined } = { current: undefined };
    const unsubscribeStatus = client.subscribeStatus((nextStatus) => {
      setStatus(nextStatus);
      if (previousStatusRef.current !== undefined && previousStatusRef.current !== nextStatus) {
        if (nextStatus === 'connected') {
          emitEvent('connected', nextStatus);
        } else if (nextStatus === 'disconnected') {
          emitEvent('disconnected', nextStatus);
        }
      }
      previousStatusRef.current = nextStatus;
    });
    const unsubscribeMessages = client.subscribe((message: ServerMessage) => {
      if (message.type === 'message' || message.type === 'image') {
        emitEvent('message', message);
        emitEvent('message:received', message);
      }

      if (message.type === 'error') {
        setUploadError(message.message);
        emitEvent('error', message);
      }

      if (message.type === 'message') {
        setMessages((currentMessages) => {
          if (message.visitorId === client.visitorId) {
            const existingMessage = [...currentMessages]
              .reverse()
              .find(
                (currentMessage) =>
                  currentMessage.author === 'visitor' &&
                  currentMessage.deliveryStatus === 'sending' &&
                  currentMessage.content === message.content,
              );

            if (existingMessage !== undefined) {
              return currentMessages.map((currentMessage) =>
                currentMessage.id === existingMessage.id
                  ? {
                      ...currentMessage,
                      serverMessageId: message.messageId,
                      deliveryStatus: 'sent',
                    }
                  : currentMessage,
              );
            }
          }

          return [
            ...currentMessages,
            {
              id: message.messageId,
              serverMessageId: message.messageId,
              author: message.visitorId === client.visitorId ? 'visitor' : 'support',
              content: message.content,
              timestamp: message.sentAt,
              deliveryStatus: 'sent',
            },
          ];
        });
      }

      if (message.type === 'image') {
        setMessages((currentMessages) => {
          if (message.visitorId === client.visitorId) {
            const existingMessage = [...currentMessages]
              .reverse()
              .find(
                (currentMessage) =>
                  currentMessage.author === 'visitor' &&
                  currentMessage.deliveryStatus === 'sending' &&
                  currentMessage.imageId === message.imageId,
              );

            if (existingMessage !== undefined) {
              return currentMessages.map((currentMessage) =>
                currentMessage.id === existingMessage.id
                  ? {
                      ...currentMessage,
                      serverMessageId: message.imageId,
                      deliveryStatus: 'sent',
                    }
                  : currentMessage,
              );
            }
          }

          return [
            ...currentMessages,
            {
              id: message.imageId,
              serverMessageId: message.imageId,
              author: message.visitorId === client.visitorId ? 'visitor' : 'support',
              content: message.caption ?? '',
              imageId: message.imageId,
              imageUrl: message.url,
              imageContentType: message.contentType,
              timestamp: message.sentAt,
              deliveryStatus: 'sent',
            },
          ];
        });
      }

      if (message.type === 'read') {
        setMessages((currentMessages) =>
          currentMessages.map((currentMessage) =>
            currentMessage.serverMessageId === message.messageId
              ? { ...currentMessage, deliveryStatus: 'read' }
              : currentMessage,
          ),
        );
      }
    });

    return () => {
      unsubscribeStatus();
      unsubscribeMessages();
      client.disconnect();
    };
  }, [client, emitEvent]);

  useEffect(() => {
    client.connect();
  }, [client]);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  function sendMessage(): void {
    const content = draft.trim();

    if (content.length === 0 || status !== 'connected') {
      return;
    }

    const localMessage = createLocalMessage(content);
    setMessages((currentMessages) => [...currentMessages, localMessage]);
    setDraft('');

    if (!client.sendMessage(content)) {
      setMessages((currentMessages) =>
        currentMessages.filter((currentMessage) => currentMessage.id !== localMessage.id),
      );
      emitEvent('error', new Error('无法发送消息。'));
      return;
    }

    emitEvent('message:sent', { kind: 'text', content });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    sendMessage();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  async function handleImageSelected(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (file === undefined || !isConnected || isUploading) {
      return;
    }

    setIsUploading(true);
    setUploadError(undefined);

    try {
      const image = await uploadImage(
        file,
        workerBaseUrl === undefined ? {} : { baseUrl: workerBaseUrl },
      );
      const localMessage = createLocalImageMessage(image);

      setMessages((currentMessages) => [...currentMessages, localMessage]);

      if (
        !client.sendImage({
          imageId: image.imageId,
          url: image.url,
          contentType: image.contentType,
        })
      ) {
        setMessages((currentMessages) =>
          currentMessages.filter((currentMessage) => currentMessage.id !== localMessage.id),
        );
        emitEvent('error', new Error('无法发送图片。'));
      } else {
        emitEvent('message:sent', { kind: 'image', imageId: image.imageId });
      }
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error('图片上传失败。');
      setUploadError(error.message);
      emitEvent('error', error);
    } finally {
      setIsUploading(false);
    }
  }

  const isConnected = status === 'connected';

  return (
    <div className="live-support-widget">
      {isOpen ? (
        <section className="live-support-window" aria-label="客服聊天窗口">
          <header className="live-support-header">
            <div>
              <h2>{title}</h2>
              <p className={`live-support-status live-support-status--${status}`}>
                <span aria-hidden="true" />
                {STATUS_LABELS[status]}
              </p>
            </div>
            <button
              className="live-support-close"
              type="button"
              aria-label="关闭客服聊天"
              onClick={close}
            >
              ×
            </button>
          </header>

          <div className="live-support-messages" aria-live="polite" aria-label="聊天消息">
            {messages.length === 0 ? (
              <p className="live-support-empty">发送消息后，客服会尽快回复您。</p>
            ) : (
              messages.map((message) => (
                <article
                  className={`live-support-message live-support-message--${message.author}`}
                  key={message.id}
                >
                  {message.imageUrl ? (
                    <img
                      className="live-support-image"
                      src={message.imageUrl}
                      alt={message.content || '共享图片'}
                      loading="lazy"
                    />
                  ) : null}
                  {message.content.length > 0 ? <p>{message.content}</p> : null}
                  <footer>
                    <time dateTime={new Date(message.timestamp).toISOString()}>
                      {formatTimestamp(message.timestamp)}
                    </time>
                    {message.author === 'visitor' ? (
                      <span className="live-support-delivery">
                        {DELIVERY_LABELS[message.deliveryStatus]}
                      </span>
                    ) : null}
                  </footer>
                </article>
              ))
            )}
            <div ref={endOfMessagesRef} />
          </div>

          <form className="live-support-composer" onSubmit={handleSubmit}>
            <div className="live-support-composer-row">
              <input
                ref={imageInputRef}
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="live-support-file-input"
                type="file"
                onChange={handleImageSelected}
              />
              <button
                aria-label="发送图片"
                className="live-support-attach"
                disabled={!isConnected || isUploading}
                type="button"
                onClick={() => imageInputRef.current?.click()}
              >
                {isUploading ? '上传中…' : '图片'}
              </button>
              <textarea
                aria-label="消息"
                disabled={!isConnected || isUploading}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={isConnected ? '请输入消息…' : STATUS_LABELS[status]}
                rows={2}
                value={draft}
              />
              <button
                disabled={!isConnected || isUploading || draft.trim().length === 0}
                type="submit"
              >
                发送
              </button>
            </div>
            {isUploading ? <p className="live-support-upload-status">正在上传图片…</p> : null}
            {uploadError ? (
              <p className="live-support-upload-error" role="alert">
                {uploadError}
              </p>
            ) : null}
          </form>
        </section>
      ) : null}

      {autoButton ? (
        <button
          className="live-support-launcher"
          type="button"
          aria-expanded={isOpen}
          aria-label={isOpen ? '关闭客服聊天' : '打开客服聊天'}
          onClick={toggle}
        >
          {isOpen ? '关闭' : '联系客服'}
        </button>
      ) : null}
    </div>
  );
});

ChatWidget.displayName = 'ChatWidget';
