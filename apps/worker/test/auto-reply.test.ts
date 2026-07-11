import { describe, expect, it } from 'vitest';

import {
  AUTO_REPLY_CACHE_TTL_MS,
  AUTO_REPLY_CONFIG_KEY,
  AutoReplyService,
  type AutoReplyKv,
} from '../src/modules/kv';

function createKv(value: unknown, onRead?: () => void): AutoReplyKv {
  return {
    async get(key, type) {
      expect(key).toBe(AUTO_REPLY_CONFIG_KEY);
      expect(type).toBe('json');
      onRead?.();
      return value;
    },
  };
}

describe('AutoReplyService', () => {
  it('matches configured keywords exactly and case-sensitively', async () => {
    const service = new AutoReplyService(createKv({ 充值: '您好，请联系客服处理充值问题。' }));

    await expect(service.matchKeyword('充值')).resolves.toBe('您好，请联系客服处理充值问题。');
    await expect(service.matchKeyword(' 充值')).resolves.toBeUndefined();
    await expect(service.matchKeyword('充值 ')).resolves.toBeUndefined();
  });

  it('caches KV reads and refreshes after the cache TTL', async () => {
    let now = 1_000;
    let reads = 0;
    const service = new AutoReplyService(
      createKv({ keyword: 'reply' }, () => {
        reads += 1;
      }),
      undefined,
      () => now,
    );

    await service.matchKeyword('keyword');
    await service.matchKeyword('keyword');
    expect(reads).toBe(1);

    now += AUTO_REPLY_CACHE_TTL_MS;
    await service.matchKeyword('keyword');
    expect(reads).toBe(2);
  });

  it('reloads configuration on demand', async () => {
    let value: unknown = { keyword: 'first' };
    const service = new AutoReplyService({
      async get() {
        return value;
      },
    });

    await expect(service.matchKeyword('keyword')).resolves.toBe('first');
    value = { keyword: 'second' };
    await expect(service.reloadAutoReplies()).resolves.toEqual({ keyword: 'second' });
    await expect(service.matchKeyword('keyword')).resolves.toBe('second');
  });

  it('skips auto replies when KV is unavailable or invalid', async () => {
    const service = new AutoReplyService({
      async get() {
        throw new Error('KV unavailable');
      },
    });
    const invalidService = new AutoReplyService(createKv(['not an object']));

    await expect(service.matchKeyword('keyword')).resolves.toBeUndefined();
    await expect(invalidService.matchKeyword('keyword')).resolves.toBeUndefined();
  });
});
