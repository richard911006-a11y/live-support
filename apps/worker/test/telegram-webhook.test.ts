import { describe, expect, it } from 'vitest';

import type { VisitorId } from '@live-support/types';

import { app } from '../src/app';
import { extractVisitorId } from '../src/routes/telegram';
import { formatCustomerImageCaption, formatCustomerMessage } from '../src/modules/telegram';
import type { Env } from '../src/types/env';

function createEnv(
  forward: (request: Request) => Promise<Response>,
  adminChatIds = '100',
  webhookSecret = 'test-secret',
): Env {
  return {
    CHAT_CONFIG: undefined as never,
    CHAT_IMAGES: undefined as never,
    CHAT_ROOM: {
      getByName: () => ({ fetch: forward }),
    } as never,
    TELEGRAM_ADMIN_CHAT_IDS: adminChatIds,
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_WEBHOOK_SECRET: webhookSecret,
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

  it('routes a reply from a Topic through the Topic-to-Session mapping', async () => {
    let forwardedPayload: unknown;
    const topicIndex = {
      get: async () => JSON.stringify({ sessionId: 'session-topic', visitorId: 'visitor-topic' }),
    };
    const env = {
      ...createEnv(async (request) => {
        forwardedPayload = await request.json();
        return new Response(JSON.stringify({ delivered: true }), { status: 200 });
      }),
      CHAT_CONFIG: topicIndex as never,
    };

    const response = await app.request(
      '/webhook/telegram',
      webhookRequest({
        update_id: 10,
        message: {
          message_id: 11,
          message_thread_id: 42,
          chat: { id: 100, type: 'supergroup' },
          text: 'Topic reply',
        },
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(forwardedPayload).toEqual({
      content: 'Topic reply',
      sessionId: 'session-topic',
      type: 'message',
      visitorId: 'visitor-topic',
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

  it('allows direct Telegram requests when webhook secret authentication is disabled', async () => {
    const response = await app.request(
      '/telegram/webhook',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ update_id: 6 }),
      },
      createEnv(
        async () => new Response(JSON.stringify({ delivered: true }), { status: 200 }),
        '100',
        '',
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ignored: true,
      ok: true,
      read: false,
    });
  });

  it('does not guess a Session when a Topic binding is missing', async () => {
    const response = await app.request(
      '/telegram/webhook',
      webhookRequest({
        update_id: 5,
        message: {
          message_id: 6,
          message_thread_id: 999,
          chat: { id: 100, type: 'supergroup' },
          text: 'Unmapped reply',
          reply_to_message: {
            message_id: 1,
            chat: { id: 100, type: 'supergroup' },
            text: formatCustomerMessage('visitor-123' as VisitorId, 'Hello'),
          },
        },
      }),
      createEnv(async () => new Response(JSON.stringify({ delivered: true }), { status: 200 })),
    );

    await expect(response.json()).resolves.toEqual({ ok: true, ignored: true, read: false });
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
