import { Hono, type Context } from 'hono';

import { IMAGE_MAX_SIZE_BYTES } from '@live-support/types';

import { error, success } from '../http/responses';
import { ImageService, ImageUploadError } from '../modules/r2';
import { logger } from '../utils/logger';
import type { Env } from '../types/env';

export const imageRoutes = new Hono<{ Bindings: Env }>()
  .use('*', async (context, next) => {
    const origin = context.req.header('origin');

    if (origin !== undefined) {
      context.header('access-control-allow-origin', origin);
      context.header('access-control-allow-methods', 'GET, POST, OPTIONS');
      context.header('access-control-allow-headers', 'content-type');
      context.header('vary', 'Origin');
    }

    if (context.req.method === 'OPTIONS') {
      return context.body(null, 204);
    }

    return next();
  })
  .post('/images', uploadImage)
  .post('/images/upload', uploadImage)
  .get('/images/*', getImage);

async function uploadImage(context: Context<{ Bindings: Env }>): Promise<Response> {
  try {
    const contentLength = Number(context.req.header('content-length'));

    if (Number.isFinite(contentLength) && contentLength > IMAGE_MAX_SIZE_BYTES + 1_048_576) {
      return error('Image exceeds the 10 MB size limit.', 413);
    }

    const form = await context.req.raw.formData();
    const entry = form.get('file') ?? form.get('image');

    if (!(entry instanceof File)) {
      return error('An image file is required.', 400);
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
      return error('Image upload failed', 500);
    }

    if (cause instanceof TypeError) {
      return error('Invalid multipart upload.', 400);
    }

    logger.error('Image upload request failed', cause);
    return error('Image upload failed', 500);
  }
}

async function getImage(context: Context<{ Bindings: Env }>): Promise<Response> {
  try {
    const pathname = new URL(context.req.url).pathname;
    const key = decodeURIComponent(pathname.slice('/images/'.length));

    if (key.length === 0) {
      return error('Image key is required.', 400);
    }

    const object = await context.env.CHAT_IMAGES.get(key);

    if (object === null) {
      return error('Image not found.', 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('cache-control', 'public, max-age=31536000, immutable');
    headers.set('x-content-type-options', 'nosniff');

    return new Response(object.body, { headers });
  } catch (cause) {
    logger.error('R2 image read failed', cause);
    return error('Image could not be loaded', 500);
  }
}
