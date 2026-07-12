import { Hono } from 'hono';

import { error } from './http/responses';
import { handleUnhandledError } from './middleware/error-handler';
import { imageRoutes } from './routes/images';
import { systemRoutes } from './routes/system';
import { telegramRoutes } from './routes/telegram';
import { websocketRoutes } from './routes/websocket';
import type { Env } from './types/env';

export const app = new Hono<{ Bindings: Env }>();

app.route('/', systemRoutes);
app.route('/', websocketRoutes);
app.route('/', telegramRoutes);
app.route('/', imageRoutes);

app.notFound(() => error('未找到请求的路由。', 404));
app.onError((cause) => handleUnhandledError(cause));
