import { Hono, type Context } from 'hono';

import {
  SUPPORTED_IMAGE_MIME_TYPES,
  type SupportedImageMimeType,
  type VisitorId,
} from '@live-support/types';

import { error, success } from '../http/responses';
import {
  isConfiguredAdminChat,
  TelegramService,
  type TelegramUpdate,
  type TelegramUpdateMessage,
} from '../modules/telegram';
import { ImageService } from '../modules/r2';
import { logger } from '../utils/logger';
import type { Env } from '../types/env';

const TELEGRAM_SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';
const VISITOR_METADATA_PATTERN = /(?:👤\s*)?Visitor\s*\r?\n\s*([^\r\n]+)/u;

export const telegramRoutes = new Hono<{ Bindings: Env }>()
  .post('/telegram/webhook', handleWebhook)
  .post('/webhook/telegram', handleWebhook);

async function handleWebhook(context: Context<{ Bindings: Env }>): Promise<Response> {
  const providedSecret = context.req.header(TELEGRAM_SECRET_HEADER);

  if (!secretsMatch(context.env.TELEGRAM_WEBHOOK_SECRET, providedSecret ?? null)) {
    return error('Invalid Telegram webhook secret', 401);
  }

  try {
    const update = (await context.req.raw.json()) as TelegramUpdate;
    const message = getUpdateMessage(update);

    if (message === undefined) {
      return success({ ok: true, ignored: true, read: false });
    }

    if (!isConfiguredAdminChat(message.chat.id, context.env.TELEGRAM_ADMIN_CHAT_IDS)) {
      return success({ ok: true, ignored: true, read: false });
    }

    const visitorId = extractVisitorId(message.reply_to_message);

    if (visitorId === undefined) {
      return success({ ok: true, ignored: true, read: false });
    }

    if (message.text !== undefined) {
      if (message.text.length === 0 || isCommand(message.text)) {
        return success({ ok: true, ignored: true, read: false });
      }

      return forwardReply(context, {
        type: 'message',
        visitorId,
        content: message.text,
      });
    }

    const photo = getLargestPhoto(message);

    if (photo === undefined || (message.caption !== undefined && isCommand(message.caption))) {
      return success({ ok: true, ignored: true, read: false });
    }

    try {
      const telegramService = new TelegramService(context.env);
      const downloaded = await telegramService.downloadImage(photo.file_id);
      const contentType = downloaded.contentType.split(';', 1)[0]?.toLowerCase() ?? '';

      if (!isSupportedImageType(contentType)) {
        return success({ ok: true, read: true, delivered: false });
      }

      const image = await new ImageService(context.env.CHAT_IMAGES).upload(
        new Blob([downloaded.blob], { type: contentType }),
        new URL(context.req.url).origin,
      );

      const replyPayload: ReplyPayload = {
        type: 'image',
        visitorId,
        imageId: image.imageId,
        url: image.url,
        contentType,
      };

      return forwardReply(
        context,
        message.caption === undefined
          ? replyPayload
          : { ...replyPayload, caption: message.caption },
      );
    } catch (cause) {
      logger.error('Telegram image reply processing failed', cause);
      return error('Telegram image reply processing failed', 503);
    }
  } catch (cause) {
    logger.error('Telegram webhook processing failed', cause);
    return error('Telegram webhook processing failed', 503);
  }
}

type ReplyPayload =
  | { type: 'message'; visitorId: VisitorId; content: string }
  | {
      type: 'image';
      visitorId: VisitorId;
      imageId: string;
      url: string;
      contentType: SupportedImageMimeType;
      caption?: string;
    };

async function forwardReply(
  context: Context<{ Bindings: Env }>,
  payload: ReplyPayload,
): Promise<Response> {
  try {
    const room = context.env.CHAT_ROOM.getByName(payload.visitorId);
    const response = await room.fetch(
      new Request('https://chat-room.internal/internal/telegram/reply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    );

    if (!response.ok) {
      logger.warn('Telegram reply could not reach the ChatRoom', { status: response.status });
      return error('Telegram reply delivery is temporarily unavailable.', 503);
    }

    const result = (await response.json()) as { delivered?: unknown };

    return success({ ok: true, read: true, delivered: result.delivered === true });
  } catch (cause) {
    logger.error('Telegram reply forwarding failed', cause);
    return error('Telegram reply delivery failed.', 503);
  }
}

function getUpdateMessage(update: TelegramUpdate): TelegramUpdateMessage | undefined {
  return update.message ?? update.edited_message;
}

function isCommand(text: string): boolean {
  return text.trimStart().startsWith('/');
}

function getLargestPhoto(message: TelegramUpdateMessage) {
  return message.photo?.at(-1);
}

function isSupportedImageType(value: string): value is SupportedImageMimeType {
  return SUPPORTED_IMAGE_MIME_TYPES.includes(value as SupportedImageMimeType);
}

export function extractVisitorId(
  replyToMessage: TelegramUpdateMessage | undefined,
): VisitorId | undefined {
  const metadata = replyToMessage?.text ?? replyToMessage?.caption;

  if (metadata === undefined) {
    return undefined;
  }

  const match = metadata.match(VISITOR_METADATA_PATTERN);
  const visitorId = match?.[1]?.trim();

  return visitorId === undefined || visitorId.length === 0 ? undefined : (visitorId as VisitorId);
}

function secretsMatch(expected: string | undefined, provided: string | null): boolean {
  if (provided === null || expected === undefined || expected.length === 0) {
    return false;
  }

  const expectedBytes = new TextEncoder().encode(expected);
  const providedBytes = new TextEncoder().encode(provided);
  const length = Math.max(expectedBytes.length, providedBytes.length);
  let difference = expectedBytes.length ^ providedBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (expectedBytes[index] ?? 0) ^ (providedBytes[index] ?? 0);
  }

  return difference === 0;
}
