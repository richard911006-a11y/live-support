import { describe, expect, it } from 'vitest';

import type { TelegramChatId, VisitorId } from '@live-support/types';

import { TelegramApiClient } from '../src/modules/telegram/client';
import { formatCustomerMessage, TelegramService } from '../src/modules/telegram/service';
import type { Env } from '../src/types/env';
import type { VisitorInfo } from '../src/types';

function createEnv(adminChatIds = '100,200'): Env {
  return {
    CHAT_CONFIG: undefined as never,
    CHAT_IMAGES: undefined as never,
    CHAT_ROOM: undefined as never,
    TELEGRAM_ADMIN_CHAT_IDS: adminChatIds,
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_WEBHOOK_SECRET: 'test-secret',
  };
}

describe('Telegram integration', () => {
  it('formats customer messages using the support notification template', () => {
    expect(formatCustomerMessage('visitor-123' as VisitorId, 'Hello')).toBe(
      [
        '--------------------------------',
        '网站',
        '',
        'live-support',
        '',
        '访客',
        '',
        'visitor-123',
        '',
        '访客消息',
        '',
        'Hello',
        '--------------------------------',
      ].join('\n'),
    );
  });

  it('includes connection metadata only when a new conversation starts', () => {
    const visitorInfo: VisitorInfo = {
      visitorId: 'visitor-123' as VisitorId,
      website: 'merchant.example',
      country: 'TW',
      region: 'Taiwan',
      city: 'Taipei City',
      timezone: 'Asia/Taipei',
      language: 'zh-TW',
      asn: 1234,
      isp: 'Example ISP',
      browser: 'Chrome',
      operatingSystem: 'Windows',
      deviceType: 'Desktop',
      userAgent: 'Example UA',
      connectionTime: Date.UTC(2026, 0, 1),
    };

    const text = formatCustomerMessage('visitor-123' as VisitorId, 'Hello', visitorInfo);

    expect(text).toContain('merchant.example');
    expect(text).toContain('Taipei City, Taiwan');
    expect(text).toContain('Chrome');
    expect(text).toContain('Example UA');
    expect(text).toContain('Hello');
  });

  it('retries a failed Telegram request once', async () => {
    let attempts = 0;
    const client = new TelegramApiClient('test-token', {
      apiBaseUrl: 'https://telegram.test',
      fetchImplementation: async () => {
        attempts += 1;

        if (attempts === 1) {
          return new Response(JSON.stringify({ ok: false, description: 'temporary failure' }), {
            status: 500,
          });
        }

        return new Response(
          JSON.stringify({
            ok: true,
            result: { message_id: 1, chat: { id: 100, type: 'private' } },
          }),
          { status: 200 },
        );
      },
    });

    await expect(client.sendMessage('100' as TelegramChatId, 'Hello')).resolves.toMatchObject({
      message_id: 1,
    });
    expect(attempts).toBe(2);
  });

  it('supports forum topic creation and threaded messages', async () => {
    const requests: { method: string; body: Record<string, unknown> }[] = [];
    const client = new TelegramApiClient('test-token', {
      apiBaseUrl: 'https://telegram.test',
      fetchImplementation: async (input, init) => {
        const method = String(input).split('/').pop() ?? '';
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        requests.push({ method, body });

        const result =
          method === 'createForumTopic'
            ? { message_id: 1, message_thread_id: 42, chat: { id: 100, type: 'supergroup' } }
            : { message_id: 2, message_thread_id: 42, chat: { id: 100, type: 'supergroup' } };

        return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
      },
    });

    await client.createForumTopic('100' as TelegramChatId, '访客 #1001');
    await client.sendMessage('100' as TelegramChatId, '用户：你好', { messageThreadId: 42 });

    expect(requests).toEqual([
      { method: 'createForumTopic', body: { chat_id: '100', name: '访客 #1001' } },
      {
        method: 'sendMessage',
        body: { chat_id: '100', text: '用户：你好', message_thread_id: 42 },
      },
    ]);
  });

  it('delivers each customer message to every configured administrator', async () => {
    const chatIds: string[] = [];
    const messages: string[] = [];
    const service = new TelegramService(createEnv('100,200,100'), {
      fetchImplementation: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { chat_id: string; text: string };
        chatIds.push(body.chat_id);
        messages.push(body.text);
        return new Response(
          JSON.stringify({ ok: true, result: { message_id: 1, chat: { id: 1, type: 'private' } } }),
          { status: 200 },
        );
      },
    });

    await service.notifyCustomerMessage('visitor-123' as VisitorId, 'Hello');

    expect(chatIds).toEqual(['100', '200']);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('网站');
    expect(messages[0]).toContain('访客消息');
  });

  it('does not throw when Telegram delivery fails after retrying', async () => {
    const loggedErrors: string[] = [];
    const service = new TelegramService(createEnv('100'), {
      fetchImplementation: async () =>
        new Response(JSON.stringify({ ok: false, description: 'unavailable' }), { status: 503 }),
      logger: {
        error(message) {
          loggedErrors.push(message);
        },
        info() {
          return undefined;
        },
        warn() {
          return undefined;
        },
      },
    });

    await expect(
      service.notifyCustomerMessage('visitor-123' as VisitorId, 'Hello'),
    ).resolves.toBeUndefined();
    expect(loggedErrors).toHaveLength(1);
  });
});
