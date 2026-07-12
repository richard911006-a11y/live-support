import { useEffect, useRef, useState } from 'react';
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
}

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Connecting...',
  connected: 'Connected',
  disconnected: 'Disconnected',
  reconnecting: 'Reconnecting...',
};

const DELIVERY_LABELS: Record<DeliveryStatus, string> = {
  sending: 'Sending',
  sent: 'Sent',
  read: 'Read',
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

export function ChatWidget({ connection, title = 'Live support' }: ChatWidgetProps): JSX.Element {
  const clientRef = useRef<WebSocketClient | null>(null);
  const endOfMessagesRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>(undefined);

  if (clientRef.current === null) {
    clientRef.current = new WebSocketClient({ ...(connection ?? {}), autoConnect: false });
  }

  const client = clientRef.current;

  useEffect(() => {
    const unsubscribeStatus = client.subscribeStatus(setStatus);
    const unsubscribeMessages = client.subscribe((message: ServerMessage) => {
      if (message.type === 'error') {
        setUploadError(message.message);
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
  }, [client]);

  useEffect(() => {
    client.connect();
  }, [client]);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  function sendMessage(): void {
    console.log('[UI Debug] sendMessage', {
      draft,
      status,
    });
    const content = draft.trim();

    if (content.length === 0 || status !== 'connected') {
      return;
    }

    const localMessage = createLocalMessage(content);
    setMessages((currentMessages) => [...currentMessages, localMessage]);
    setDraft('');

    console.log('[UI Debug] before client.sendMessage', content);
    const result = client.sendMessage(content);
    console.log('[UI Debug] client.sendMessage returned', result);

    if (!result) {
      setMessages((currentMessages) =>
        currentMessages.filter((currentMessage) => currentMessage.id !== localMessage.id),
      );
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    console.log('[UI Debug] handleSubmit');
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
        connection?.baseUrl === undefined ? {} : { baseUrl: connection.baseUrl },
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
      }
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : 'Image upload failed.');
    } finally {
      setIsUploading(false);
    }
  }

  const isConnected = status === 'connected';

  return (
    <div className="live-support-widget">
      {isOpen ? (
        <section className="live-support-window" aria-label="Customer support chat">
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
              aria-label="Close support chat"
              onClick={() => setIsOpen(false)}
            >
              ×
            </button>
          </header>

          <div className="live-support-messages" aria-live="polite" aria-label="Chat messages">
            {messages.length === 0 ? (
              <p className="live-support-empty">
                Send a message and our team will be right with you.
              </p>
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
                      alt={message.content || 'Shared image'}
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
                aria-label="Send image"
                className="live-support-attach"
                disabled={!isConnected || isUploading}
                type="button"
                onClick={() => imageInputRef.current?.click()}
              >
                {isUploading ? 'Uploading...' : 'Image'}
              </button>
              <textarea
                aria-label="Message"
                disabled={!isConnected || isUploading}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={isConnected ? 'Write a message...' : STATUS_LABELS[status]}
                rows={2}
                value={draft}
              />
              <button
                disabled={!isConnected || isUploading || draft.trim().length === 0}
                type="submit"
              >
                Send
              </button>
            </div>
            {isUploading ? <p className="live-support-upload-status">Uploading image...</p> : null}
            {uploadError ? (
              <p className="live-support-upload-error" role="alert">
                {uploadError}
              </p>
            ) : null}
          </form>
        </section>
      ) : null}

      <button
        className="live-support-launcher"
        type="button"
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Close support chat' : 'Open support chat'}
        onClick={() => setIsOpen((open) => !open)}
      >
        {isOpen ? 'Close' : 'Chat with us'}
      </button>
    </div>
  );
}
