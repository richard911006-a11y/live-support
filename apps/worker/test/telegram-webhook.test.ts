import { describe, expect, it } from 'vitest';

import type { VisitorId } from '@live-support/types';

import { app } from '../src/app';
import { extractVisitorId } from '../src/routes/telegram';
import { formatCustomerImageCaption, formatCustomerMessage } from '../src/modules/telegram';
import type { Env } from '../src/types/env';

function createEnv(forward: (request: Request) => Promise<Response>, adminChatIds = '100'): Env {
  return {
    CHAT_CONFIG: undefined as never,
    CHAT_IMAGES: undefined as never,
    CHAT_ROOM: {
      getByName: () => ({ fetch: forward }),
    } as never,
    TELEGRAM_ADMIN_CHAT_IDS: adminChatIds,
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_WEBHOOK_SECRET: 'test-secret',
  };
}

function webhookRequest(payload: unknown): RequestInit {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
    },
    body: JSON.stringify(payload),
  };
}

describe('Telegram webhook', () => {
  it('forwards a Telegram reply to the active visitor session', async () => {
    let forwardedPayload: unknown;
    const env = createEnv(async (request) => {
      forwardedPayload = await request.json();
      return new Response(JSON.stringify({ delivered: true }), { status: 200 });
    });
    const visitorId = 'visitor-123';
    const response = await app.request(
      '/telegram/webhook',
      webhookRequest({
        update_id: 1,
        message: {
          message_id: 2,
          chat: { id: 100, type: 'private' },
          text: 'Thanks! 👋\nI will check this now.',
          reply_to_message: {
            message_id: 1,
            chat: { id: 100, type: 'private' },
            text: formatCustomerMessage(visitorId as VisitorId, 'Hello'),
          },
        },
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      delivered: true,
      ok: true,
      read: true,
    });
    expect(forwardedPayload).toEqual({
      content: 'Thanks! 👋\nI will check this now.',
      type: 'message',
      visitorId,
    });
  });

  it('returns a safe read confirmation when the visitor is disconnected', async () => {
    const response = await app.request(
      '/telegram/webhook',
      webhookRequest({
        update_id: 2,
        edited_message: {
          message_id: 3,
          chat: { id: 100, type: 'private' },
          text: 'A later reply',
          reply_to_message: {
            message_id: 1,
            chat: { id: 100, type: 'private' },
            text: formatCustomerMessage('visitor-123' as VisitorId, 'Hello'),
          },
        },
      }),
      createEnv(async () => new Response(JSON.stringify({ delivered: false }), { status: 200 })),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      delivered: false,
      ok: true,
      read: true,
    });
  });

  it('ignores commands and rejects invalid webhook secrets', async () => {
    const commandResponse = await app.request(
      '/telegram/webhook',
      webhookRequest({
        update_id: 3,
        message: {
          message_id: 4,
          chat: { id: 100, type: 'private' },
          text: '/start',
        },
      }),
      createEnv(async () => new Response(JSON.stringify({ delivered: true }), { status: 200 })),
    );
    const invalidSecretResponse = await app.request(
      '/telegram/webhook',
      {
        ...webhookRequest({ update_id: 4 }),
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret' },
      },
      createEnv(async () => new Response(JSON.stringify({ delivered: true }), { status: 200 })),
    );

    expect(commandResponse.status).toBe(200);
    await expect(commandResponse.json()).resolves.toEqual({
      ignored: true,
      ok: true,
      read: false,
    });
    expect(invalidSecretResponse.status).toBe(401);
  });

  it('recovers visitor metadata from an image caption', () => {
    expect(
      extractVisitorId({
        message_id: 1,
        chat: { id: 100, type: 'private' },
        caption: formatCustomerImageCaption('visitor-image' as VisitorId, 'Customer image'),
      }),
    ).toBe('visitor-image' as VisitorId);
  });
});
