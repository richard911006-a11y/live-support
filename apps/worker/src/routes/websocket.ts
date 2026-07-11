import { Hono } from 'hono';

import type { VisitorId } from '@live-support/types';

import type { Env } from '../types/env';
import { collectVisitorInfo, encodeVisitorInfo, VISITOR_INFO_HEADER } from '../utils/visitor-info';

export const websocketRoutes = new Hono<{ Bindings: Env }>().get('/ws', (context) => {
  const room = context.env.CHAT_ROOM.getByName('live-support');
  const request = context.req.raw;
  const visitorId = new URL(request.url).searchParams.get('visitorId');

  if (visitorId === null || visitorId.length === 0) {
    return room.fetch(request);
  }

  const headers = new Headers(request.headers);
  headers.set(
    VISITOR_INFO_HEADER,
    encodeVisitorInfo(collectVisitorInfo(request, visitorId as VisitorId)),
  );

  return room.fetch(new Request(request, { headers }));
});
