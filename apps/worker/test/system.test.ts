import { describe, expect, it } from 'vitest';

import { app } from '../src/app';

describe('system routes', () => {
  it('returns the service status', async () => {
    const response = await app.request('/');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: 'live-support',
      status: 'ok',
    });
  });

  it('returns a healthy response', async () => {
    const response = await app.request('/health');

    expect(response.status).toBe(200);
  });

  it('returns the current version', async () => {
    const response = await app.request('/version');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ version: '1.0.0' });
  });
});
