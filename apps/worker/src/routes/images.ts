import { Hono, type Context } from 'hono';

import { IMAGE_MAX_SIZE_BYTES } from '@live-support/types';

import { error, success } from '../http/responses';
import { ImageService, ImageUploadError } from '../modules/r2';
import { logger } from '../utils/logger';
import { getClientRateLimitKey, InMemoryRateLimiter } from '../utils/rate-limit';
import type { Env } from '../types/env';

const uploadLimiter = new InMemoryRateLimiter(20, 60_000);

export const imageRoutes = new Hono<{ Bindings: Env }>()
  .use('*', async (context, next) => {
    const origin = context.req.header('origin');
    const allowedOrigins =
      context.env.PUBLIC_WIDGET_ORIGINS?.split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0) ?? [];

    if (context.req.method === 'OPTIONS') {
      context.res = context.body(null, 204);
    } else {
      await next();
    }

    applyCorsHeaders(context, origin, allowedOrigins);

    return context.res;
  })
  .post('/images', uploadImage)
  .post('/images/upload', uploadImage)
  .get('/images/*', getImage);

function applyCorsHeaders(
  context: Context<{ Bindings: Env }>,
  origin: string | undefined,
  allowedOrigins: string[],
): void {
  if (origin === undefined || !allowedOrigins.includes(origin)) {
    return;
  }

  const response = context.res;
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', origin);
  headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  headers.set('access-control-allow-headers', 'content-type');
  headers.set('vary', 'Origin');

  context.res = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function uploadImage(context: Context<{ Bindings: Env }>): Promise<Response> {
  try {
    if (!uploadLimiter.consume(getClientRateLimitKey(context.req.raw))) {
      return error('图片上传过于频繁，请稍后再试。', 429);
    }

    const contentLength = Number(context.req.header('content-length'));

    if (Number.isFinite(contentLength) && contentLength > IMAGE_MAX_SIZE_BYTES + 1_048_576) {
      return error('图片大小超过 10 MB 限制。', 413);
    }

    const form = await context.req.raw.formData();
    const entry = form.get('file') ?? form.get('image');

    if (!(entry instanceof File)) {
      return error('请选择图片文件。', 400);
    }

    const image = await new ImageService(context.env.CHAT_IMAGES).upload(
      entry,
      new URL(context.req.url).origin,
    );

    return success({ image, url: image.url });
  } catch (cause) {
    if (cause instanceof ImageUploadError) {
      if (
        cause.code === 'invalid_file' ||
        cause.code === 'file_too_large' ||
        cause.code === 'unsupported_type'
      ) {
        return error(cause.message, 400);
      }

      logger.error('R2 image upload failed', cause.cause);
      return error('图片上传失败。', 500);
    }

    if (cause instanceof TypeError) {
      return error('无效的 multipart 上传请求。', 400);
    }

    logger.error('Image upload request failed', cause);
    return error('图片上传失败。', 500);
  }
}

async function getImage(context: Context<{ Bindings: Env }>): Promise<Response> {
  try {
    const pathname = new URL(context.req.url).pathname;
    let key: string;

    try {
      key = decodeURIComponent(pathname.slice('/images/'.length));
    } catch {
      return error('图片标识无效。', 400);
    }

    if (key.length === 0) {
      return error('缺少图片标识。', 400);
    }

    const object = await context.env.CHAT_IMAGES.get(key);

    if (object === null) {
      return error('未找到图片。', 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('cache-control', 'public, max-age=31536000, immutable');
    headers.set('x-content-type-options', 'nosniff');

    return new Response(object.body, { headers });
  } catch (cause) {
    logger.error('R2 image read failed', cause);
    return error('无法加载图片。', 500);
  }
}
