import { Hono } from 'hono';

import { VERSION } from '../config/version';
import { success } from '../http/responses';
import type { Env } from '../types/env';

export const systemRoutes = new Hono<{ Bindings: Env }>()
  .get('/', () =>
    success({
      service: 'live-support',
      status: 'ok',
    }),
  )
  .get('/health', () =>
    success({
      status: 'ok',
    }),
  )
  .get('/version', () =>
    success({
      version: VERSION,
    }),
  );
