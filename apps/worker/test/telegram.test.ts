import { describe, expect, it } from 'vitest';

import type { SessionId, TelegramChatId, VisitorId } from '@live-support/types';

import { TelegramApiClient } from '../src/modules/telegram/client';
import {
  findTopicForVisitor,
  findTopicForSession,
  formatCustomerMessage,
  formatTopicName,
  TelegramService,
} from '../src/modules/telegram/service';
import type { TelegramTopic } from '../src/modules/telegram/service';
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
  it('creates stable visitor-number topic names without website metadata', () => {
    const name = formatTopicName({
      visitorId: 'visitor-a' as VisitorId,
      website: 'shop.example',
      connectionTime: 1,
    });

    expect(name).toBe('#4962');
  });

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

  it('keeps multiple visitors mapped to independent topics and restores the mapping', async () => {
    const values = new Map<string, string>();
    const topicIndex = {
      get: async (key: string) => values.get(key) ?? null,
      put: async (key: string, value: string) => {
        values.set(key, value);
      },
    };
    let nextThreadId = 100;
    const createdNames: string[] = [];
    const service = new TelegramService(
      { ...createEnv('100,200'), CHAT_CONFIG: topicIndex as never },
      {
        fetchImplementation: async (input, init) => {
          const method = String(input).split('/').pop() ?? '';
          const body =
            method === 'createForumTopic'
              ? (JSON.parse(String(init?.body)) as { name: string })
              : undefined;

          if (body !== undefined) {
            createdNames.push(body.name);
          }

          const result =
            method === 'createForumTopic'
              ? { message_id: nextThreadId, message_thread_id: nextThreadId++ }
              : method === 'closeForumTopic'
                ? true
                : { message_id: nextThreadId++ };

          return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
        },
      },
    );

    const firstTopics = await service.createVisitorTopics(
      'visitor-a' as VisitorId,
      {
        visitorId: 'visitor-a' as VisitorId,
        website: 'shop-a.example',
        connectionTime: 1,
      },
      'session-a' as SessionId,
    );
    const secondTopics = await service.createVisitorTopics(
      'visitor-b' as VisitorId,
      {
        visitorId: 'visitor-b' as VisitorId,
        website: 'shop-b.example',
        connectionTime: 1,
      },
      'session-b' as SessionId,
    );

    expect(firstTopics).toHaveLength(2);
    expect(secondTopics).toHaveLength(2);
    expect(
      new Set([...firstTopics, ...secondTopics].map((topic) => topic.messageThreadId)).size,
    ).toBe(4);
    expect(createdNames).toEqual(['#4962', '#4962', '#4963', '#4963']);

    const firstTopic = firstTopics[0];
    if (firstTopic === undefined) {
      throw new Error('Expected the first visitor to have a topic.');
    }
    expect(findTopicForVisitor(firstTopics, 'visitor-a' as VisitorId)).toBe(firstTopic);
    expect(findTopicForSession(firstTopics, 'session-a' as SessionId)).toBe(firstTopic);

    const restoredService = new TelegramService(
      { ...createEnv('100,200'), CHAT_CONFIG: topicIndex as never },
      { fetchImplementation: async () => new Response(JSON.stringify({ ok: true, result: true })) },
    );

    await expect(
      restoredService.lookupVisitorByTopic(firstTopic.chatId, firstTopic.messageThreadId),
    ).resolves.toBe('visitor-a' as VisitorId);
    await expect(
      restoredService.lookupTopicBinding(firstTopic.chatId, firstTopic.messageThreadId),
    ).resolves.toEqual({ sessionId: 'session-a', visitorId: 'visitor-a' });

    await expect(restoredService.closeTopics(firstTopics)).resolves.toBeUndefined();
  });

  it('retries Topic creation after a transient Telegram failure', async () => {
    let createAttempts = 0;
    const service = new TelegramService(createEnv('100'), {
      fetchImplementation: async (input) => {
        const method = String(input).split('/').pop() ?? '';
        if (method === 'createForumTopic') {
          createAttempts += 1;
          if (createAttempts <= 2) {
            return new Response(JSON.stringify({ ok: false, description: 'unavailable' }), {
              status: 503,
            });
          }
        }

        const result =
          method === 'createForumTopic'
            ? { message_id: 1, message_thread_id: 99 }
            : { message_id: 2 };
        return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
      },
    });

    await expect(
      service.createVisitorTopics(
        'visitor-retry' as VisitorId,
        { visitorId: 'visitor-retry' as VisitorId, website: 'shop.example', connectionTime: 1 },
        'session-retry' as SessionId,
      ),
    ).resolves.toHaveLength(0);
    await expect(
      service.createVisitorTopics(
        'visitor-retry' as VisitorId,
        { visitorId: 'visitor-retry' as VisitorId, website: 'shop.example', connectionTime: 1 },
        'session-retry' as SessionId,
      ),
    ).resolves.toHaveLength(1);
  });

  it('recreates a deleted Topic and keeps the Session binding', async () => {
    const values = new Map<string, string>();
    let sendAttempts = 0;
    const service = new TelegramService(
      {
        ...createEnv('100'),
        CHAT_CONFIG: {
          get: async (key: string) => values.get(key) ?? null,
          put: async (key: string, value: string) => values.set(key, value),
          delete: async (key: string) => values.delete(key),
        } as never,
      },
      {
        fetchImplementation: async (input) => {
          const method = String(input).split('/').pop() ?? '';
          if (method === 'sendMessage') {
            sendAttempts += 1;
            if (sendAttempts <= 2) {
              return new Response(
                JSON.stringify({
                  ok: false,
                  description: 'message thread not found',
                  error_code: 400,
                }),
                { status: 400 },
              );
            }
          }
          const result =
            method === 'createForumTopic'
              ? { message_id: 3, message_thread_id: 88 }
              : { message_id: 4 };
          return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
        },
      },
    );
    const oldTopic: TelegramTopic = {
      chatId: '100' as TelegramChatId,
      messageThreadId: 7,
      sessionId: 'session-delete' as SessionId,
      visitorId: 'visitor-delete' as VisitorId,
      createdAt: 1,
    };

    const topics = await service.deliverCustomerMessage(
      oldTopic.visitorId,
      '恢复测试',
      { visitorId: oldTopic.visitorId, website: 'shop.example', connectionTime: 1 },
      [oldTopic],
    );

    expect(topics[0]?.messageThreadId).toBe(88);
    await expect(service.lookupTopicBinding('100' as TelegramChatId, 7)).resolves.toBeUndefined();
    await expect(service.lookupTopicBinding('100' as TelegramChatId, 88)).resolves.toEqual({
      sessionId: 'session-delete',
      visitorId: 'visitor-delete',
    });
  });

  it('uses a new Topic binding for a new Session after timeout', async () => {
    let nextThreadId = 1;
    const service = new TelegramService(createEnv('100'), {
      fetchImplementation: async (input) => {
        const method = String(input).split('/').pop() ?? '';
        const result =
          method === 'createForumTopic'
            ? { message_id: 1, message_thread_id: nextThreadId++ }
            : { message_id: 2 };
        return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
      },
    });
    const info = {
      visitorId: 'visitor-timeout' as VisitorId,
      website: 'shop.example',
      connectionTime: 1,
    };
    const first = await service.createVisitorTopics(
      info.visitorId,
      info,
      'session-old' as SessionId,
    );
    const second = await service.createVisitorTopics(
      info.visitorId,
      info,
      'session-new' as SessionId,
    );

    expect(first[0]?.sessionId).toBe('session-old');
    expect(second[0]?.sessionId).toBe('session-new');
    expect(second[0]?.messageThreadId).not.toBe(first[0]?.messageThreadId);
  });

  it('closes every Topic binding when a Session is cleaned up', async () => {
    const closedTopics: string[] = [];
    const topics: TelegramTopic[] = [
      {
        chatId: '100' as TelegramChatId,
        messageThreadId: 41,
        sessionId: 'session-a' as SessionId,
        visitorId: 'visitor-a' as VisitorId,
        createdAt: 1,
      },
      {
        chatId: '200' as TelegramChatId,
        messageThreadId: 42,
        sessionId: 'session-a' as SessionId,
        visitorId: 'visitor-a' as VisitorId,
        createdAt: 1,
      },
    ];
    const service = new TelegramService(createEnv('100,200'), {
      fetchImplementation: async (input, init) => {
        const method = String(input).split('/').pop() ?? '';
        if (method === 'closeForumTopic') {
          const body = JSON.parse(String(init?.body)) as {
            chat_id: string;
            message_thread_id: number;
          };
          closedTopics.push(`${body.chat_id}:${body.message_thread_id}`);
        }

        return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
      },
    });

    await service.closeTopics(topics);

    expect(closedTopics).toEqual(['100:41', '200:42']);
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
