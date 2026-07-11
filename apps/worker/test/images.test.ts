import { describe, expect, it } from 'vitest';

import { IMAGE_MAX_SIZE_BYTES } from '@live-support/types';
import { ImageUploadError, uploadImage } from '@live-support/utils';

import { app } from '../src/app';
import { ImageService } from '../src/modules/r2';
import type { Env } from '../src/types/env';

function createEnv(bucket: unknown): Env {
  return {
    CHAT_CONFIG: undefined as never,
    CHAT_IMAGES: bucket as never,
    CHAT_ROOM: undefined as never,
    TELEGRAM_ADMIN_CHAT_IDS: '',
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_WEBHOOK_SECRET: '',
  };
}

describe('R2 image uploads', () => {
  it('validates and stores supported images with a public URL', async () => {
    let storedKey = '';
    let storedContentType = '';
    const bucket = {
      async put(
        key: string,
        _value: ReadableStream<Uint8Array>,
        options: { httpMetadata?: { contentType?: string } },
      ) {
        storedKey = key;
        storedContentType = options.httpMetadata?.contentType ?? '';
      },
    };
    const file = new File(['png data'], 'photo.png', { type: 'image/png' });

    const image = await new ImageService(bucket as never).upload(file, 'https://support.example');

    expect(storedKey).toBe(image.key);
    expect(storedKey).toMatch(/\.png$/);
    expect(storedContentType).toBe('image/png');
    expect(image.url).toBe(`https://support.example/images/${encodeURIComponent(image.key)}`);
    expect(image.size).toBe(file.size);
  });

  it('rejects unsupported and oversized files before writing to R2', async () => {
    const bucket = { put: async () => undefined };
    const service = new ImageService(bucket as never);
    const unsupported = new File(['text'], 'file.txt', { type: 'text/plain' });
    const oversized = new File([new Uint8Array(IMAGE_MAX_SIZE_BYTES + 1)], 'large.png', {
      type: 'image/png',
    });

    await expect(service.upload(unsupported, 'https://support.example')).rejects.toMatchObject({
      code: 'unsupported_type',
    });
    await expect(service.upload(oversized, 'https://support.example')).rejects.toMatchObject({
      code: 'file_too_large',
    });
  });

  it('retries a failed R2 write once', async () => {
    let attempts = 0;
    const bucket = {
      async put() {
        attempts += 1;

        if (attempts === 1) {
          throw new Error('temporary R2 failure');
        }
      },
    };

    await new ImageService(bucket as never).upload(
      new File(['jpeg data'], 'photo.jpg', { type: 'image/jpeg' }),
      'https://support.example',
    );

    expect(attempts).toBe(2);
  });

  it('accepts browser multipart uploads through the Worker route', async () => {
    const bucket = { put: async () => undefined };
    const form = new FormData();
    form.append('file', new File(['gif data'], 'photo.gif', { type: 'image/gif' }));

    const response = await app.request(
      '/images',
      { method: 'POST', body: form },
      createEnv(bucket),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      image: { contentType: 'image/gif', url: expect.stringContaining('/images/') },
    });
  });

  it('provides a reusable browser upload helper', async () => {
    const file = new Blob(['webp data'], { type: 'image/webp' });
    let requestBody: BodyInit | null | undefined;
    let attempts = 0;

    const result = await uploadImage(file, {
      baseUrl: 'https://support.example',
      fetchImplementation: async (_input, init) => {
        attempts += 1;
        requestBody = init?.body;

        if (attempts === 1) {
          return new Response(JSON.stringify({ error: 'temporary failure' }), { status: 503 });
        }

        return new Response(
          JSON.stringify({
            image: {
              imageId: 'image-1',
              key: 'image-1.webp',
              url: 'https://support.example/images/image-1.webp',
              contentType: 'image/webp',
              size: file.size,
            },
            url: 'https://support.example/images/image-1.webp',
          }),
          { status: 200 },
        );
      },
    });

    expect(requestBody).toBeInstanceOf(FormData);
    expect(attempts).toBe(2);
    expect(result.url).toBe('https://support.example/images/image-1.webp');
  });

  it('reports browser validation failures without making a request', async () => {
    const unsupported = new Blob(['text'], { type: 'text/plain' });

    await expect(uploadImage(unsupported)).rejects.toBeInstanceOf(ImageUploadError);
  });
});
