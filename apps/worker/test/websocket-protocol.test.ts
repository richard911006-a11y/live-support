import { describe, expect, it } from 'vitest';

import { buildWebSocketUrl, parseClientMessage, parseServerMessage } from '@live-support/utils';
import type { VisitorId } from '@live-support/types';

describe('WebSocket protocol', () => {
  it('parses valid client messages and rejects invalid JSON', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'connect', visitorId: 'visitor-a' }))).toEqual(
      { type: 'connect', visitorId: 'visitor-a' as VisitorId },
    );
    expect(parseClientMessage('{invalid')).toBeUndefined();
    expect(parseClientMessage(JSON.stringify({ type: 'unknown' }))).toBeUndefined();
  });

  it('parses server messages using the JSON protocol', () => {
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'pong',
          timestamp: 1_000,
        }),
      ),
    ).toEqual({ type: 'pong', timestamp: 1_000 });
    expect(
      parseServerMessage(JSON.stringify({ type: 'error', message: 'missing code' })),
    ).toBeUndefined();
  });

  it('builds secure WebSocket URLs without downgrading explicit schemes', () => {
    expect(buildWebSocketUrl('/ws', 'https://example.com/')).toBe('wss://example.com/ws');
    expect(buildWebSocketUrl('wss://example.com/ws', 'http://localhost/')).toBe(
      'wss://example.com/ws',
    );
  });

  it('parses image messages with supported public URLs', () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'image',
          imageId: 'image-1',
          url: 'https://support.example/images/image-1.png',
          contentType: 'image/png',
        }),
      ),
    ).toMatchObject({ type: 'image', contentType: 'image/png' });
    expect(
      parseServerMessage(
        JSON.stringify({
          type: 'image',
          imageId: 'image-1',
          visitorId: 'visitor-1',
          url: 'https://support.example/images/image-1.png',
          contentType: 'image/png',
          sentAt: 1_000,
        }),
      ),
    ).toMatchObject({ type: 'image', imageId: 'image-1' });
  });
});
