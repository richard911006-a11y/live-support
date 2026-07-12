import { Hono } from 'hono';

import { error } from '../http/responses';
import {
  createSessionIdentity,
  SESSION_TOKEN_HEADER,
  verifySessionToken,
  VISITOR_ID_HEADER,
} from '../utils/session-identity';
import { InMemoryRateLimiter, getClientRateLimitKey } from '../utils/rate-limit';
import { collectVisitorInfo, encodeVisitorInfo, VISITOR_INFO_HEADER } from '../utils/visitor-info';
import type { Env } from '../types/env';

const connectionLimiter = new InMemoryRateLimiter(30, 60_000);

export const websocketRoutes = new Hono<{ Bindings: Env }>().get('/ws', async (context) => {
  const request = context.req.raw;

  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return error('需要升级为 WebSocket 连接。', 426);
  }

  if (!connectionLimiter.consume(getClientRateLimitKey(request))) {
    return error('连接尝试过于频繁，请稍后再试。', 429);
  }

  const url = new URL(request.url);
  const suppliedToken = url.searchParams.get('token');
  const suppliedVisitorId = url.searchParams.get('visitorId');

  if (suppliedToken === null && suppliedVisitorId !== null) {
    return error('需要服务器签发的会话令牌。', 401);
  }

  const visitorId =
    suppliedToken === null
      ? undefined
      : await verifySessionToken(suppliedToken, context.env.TELEGRAM_WEBHOOK_SECRET);

  if (suppliedToken !== null && visitorId === undefined) {
    return error('会话令牌无效或已过期。', 401);
  }

  const identity =
    visitorId === undefined
      ? await createSessionIdentity(context.env.TELEGRAM_WEBHOOK_SECRET)
      : { visitorId, token: suppliedToken as string };
  const room = context.env.CHAT_ROOM.getByName(identity.visitorId);
  const headers = new Headers(request.headers);
  headers.set(VISITOR_ID_HEADER, identity.visitorId);
  headers.set(SESSION_TOKEN_HEADER, identity.token);
  headers.set(
    VISITOR_INFO_HEADER,
    encodeVisitorInfo(collectVisitorInfo(request, identity.visitorId)),
  );

  return room.fetch(new Request(request, { headers }));
});
