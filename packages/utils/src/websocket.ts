import type {
  ClientImageMessage,
  ClientMessage,
  ImageId,
  MessageId,
  ProtocolMessage,
  ServerMessage,
  ServerImageMessage,
  SessionId,
  SupportedImageMimeType,
  VisitorId,
} from '@live-support/types';
import { SUPPORTED_IMAGE_MIME_TYPES } from '@live-support/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSupportedImageType(value: unknown): value is SupportedImageMimeType {
  return (
    typeof value === 'string' &&
    SUPPORTED_IMAGE_MIME_TYPES.includes(value as SupportedImageMimeType)
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function generateVisitorId(): VisitorId {
  return `visitor_${crypto.randomUUID()}` as VisitorId;
}

export function getOrCreateVisitorId(storage?: Storage): VisitorId {
  try {
    const existingVisitorId = storage?.getItem('live-support:visitor-id');

    if (isNonEmptyString(existingVisitorId)) {
      return existingVisitorId as VisitorId;
    }

    const visitorId = generateVisitorId();
    storage?.setItem('live-support:visitor-id', visitorId);
    return visitorId;
  } catch {
    return generateVisitorId();
  }
}

export function buildWebSocketUrl(endpoint: string, baseUrl: string): string {
  const url = new URL(endpoint, baseUrl);

  if (url.protocol === 'http:') {
    url.protocol = 'ws:';
  } else if (url.protocol === 'https:') {
    url.protocol = 'wss:';
  }

  return url.toString();
}

export function serializeProtocolMessage(message: ProtocolMessage): string {
  return JSON.stringify(message);
}

export function parseClientMessage(raw: unknown): ClientMessage | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }

  let value: unknown;

  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }

  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }

  switch (value.type) {
    case 'connect':
      return isNonEmptyString(value.visitorId)
        ? { type: 'connect', visitorId: value.visitorId as VisitorId }
        : undefined;
    case 'heartbeat':
      return { type: 'heartbeat' };
    case 'message':
      return isNonEmptyString(value.content)
        ? { type: 'message', content: value.content }
        : undefined;
    case 'image': {
      if (
        !isNonEmptyString(value.imageId) ||
        !isNonEmptyString(value.url) ||
        !isHttpUrl(value.url) ||
        !isSupportedImageType(value.contentType) ||
        (value.caption !== undefined && typeof value.caption !== 'string')
      ) {
        return undefined;
      }

      const image: ClientImageMessage = {
        type: 'image',
        imageId: value.imageId as ImageId,
        url: value.url,
        contentType: value.contentType,
      };

      return value.caption === undefined ? image : { ...image, caption: value.caption };
    }
    case 'disconnect':
      return { type: 'disconnect' };
    default:
      return undefined;
  }
}

export function parseServerMessage(raw: unknown): ServerMessage | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }

  let value: unknown;

  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }

  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }

  switch (value.type) {
    case 'connected':
      return isNonEmptyString(value.visitorId) &&
        isNonEmptyString(value.sessionId) &&
        typeof value.connectedAt === 'number'
        ? {
            type: 'connected',
            visitorId: value.visitorId as VisitorId,
            sessionId: value.sessionId as SessionId,
            connectedAt: value.connectedAt,
          }
        : undefined;
    case 'message':
      return isNonEmptyString(value.messageId) &&
        isNonEmptyString(value.visitorId) &&
        isNonEmptyString(value.content) &&
        typeof value.sentAt === 'number' &&
        (value.autoReplied === undefined || typeof value.autoReplied === 'boolean')
        ? value.autoReplied === undefined
          ? {
              type: 'message',
              messageId: value.messageId as MessageId,
              visitorId: value.visitorId as VisitorId,
              content: value.content,
              sentAt: value.sentAt,
            }
          : {
              type: 'message',
              messageId: value.messageId as MessageId,
              visitorId: value.visitorId as VisitorId,
              content: value.content,
              sentAt: value.sentAt,
              autoReplied: value.autoReplied,
            }
        : undefined;
    case 'image': {
      if (
        !isNonEmptyString(value.imageId) ||
        !isNonEmptyString(value.visitorId) ||
        !isNonEmptyString(value.url) ||
        !isHttpUrl(value.url) ||
        !isSupportedImageType(value.contentType) ||
        typeof value.sentAt !== 'number' ||
        (value.caption !== undefined && typeof value.caption !== 'string')
      ) {
        return undefined;
      }

      const image: ServerImageMessage = {
        type: 'image',
        imageId: value.imageId as ImageId,
        visitorId: value.visitorId as VisitorId,
        url: value.url,
        contentType: value.contentType,
        sentAt: value.sentAt,
      };

      return value.caption === undefined ? image : { ...image, caption: value.caption };
    }
    case 'read':
      return isNonEmptyString(value.messageId)
        ? { type: 'read', messageId: value.messageId as MessageId }
        : undefined;
    case 'error':
      if (!isNonEmptyString(value.code) || !isNonEmptyString(value.message)) {
        return undefined;
      }

      return typeof value.retryable === 'boolean'
        ? { type: 'error', code: value.code, message: value.message, retryable: value.retryable }
        : { type: 'error', code: value.code, message: value.message };
    case 'pong':
      return typeof value.timestamp === 'number'
        ? { type: 'pong', timestamp: value.timestamp }
        : undefined;
    default:
      return undefined;
  }
}
