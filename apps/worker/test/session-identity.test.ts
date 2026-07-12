import { describe, expect, it } from 'vitest';

import { createSessionIdentity, verifySessionToken } from '../src/utils/session-identity';

describe('server-issued session identity', () => {
  it('round-trips a signed visitor token', async () => {
    const identity = await createSessionIdentity('test-secret');

    await expect(verifySessionToken(identity.token, 'test-secret')).resolves.toBe(
      identity.visitorId,
    );
    await expect(verifySessionToken(identity.token, 'wrong-secret')).resolves.toBeUndefined();
  });

  it('rejects a tampered token', async () => {
    const identity = await createSessionIdentity('test-secret');
    const tampered = `${identity.token.slice(0, -1)}x`;

    await expect(verifySessionToken(tampered, 'test-secret')).resolves.toBeUndefined();
  });
});
