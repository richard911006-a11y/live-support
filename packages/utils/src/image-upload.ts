import {
  IMAGE_MAX_SIZE_BYTES,
  SUPPORTED_IMAGE_MIME_TYPES,
  type ImageUploadResponse,
  type ImageUploadResult,
  type SupportedImageMimeType,
} from '@live-support/types';

export type ImageUploadErrorCode =
  'invalid_file' | 'unsupported_type' | 'file_too_large' | 'upload_failed';
const MAX_UPLOAD_ATTEMPTS = 2;

export class ImageUploadError extends Error {
  public constructor(
    message: string,
    public readonly code: ImageUploadErrorCode,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ImageUploadError';
  }
}

export interface ImageUploadOptions {
  endpoint?: string;
  baseUrl?: string;
  fetchImplementation?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

function defaultBaseUrl(): string {
  return typeof location === 'undefined' ? 'http://localhost/' : location.href;
}

function isSupportedImageType(value: string): value is SupportedImageMimeType {
  return SUPPORTED_IMAGE_MIME_TYPES.includes(value as SupportedImageMimeType);
}

/** Validates an image in the browser and uploads it as multipart form data. */
export async function uploadImage(
  file: Blob,
  options: ImageUploadOptions = {},
): Promise<ImageUploadResult> {
  const contentType = file.type.toLowerCase();

  if (file.size === 0) {
    throw new ImageUploadError('图片文件为空。', 'invalid_file');
  }

  if (!isSupportedImageType(contentType)) {
    throw new ImageUploadError('不支持的图片格式。', 'unsupported_type');
  }

  if (file.size > IMAGE_MAX_SIZE_BYTES) {
    throw new ImageUploadError('图片大小超过 10 MB 限制。', 'file_too_large');
  }

  const form = new FormData();
  const filename = typeof File !== 'undefined' && file instanceof File ? file.name : 'image';
  form.append('file', file, filename);

  const endpoint = new URL(options.endpoint ?? '/images', options.baseUrl ?? defaultBaseUrl());
  const upload = options.fetchImplementation ?? fetch;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await upload(endpoint, {
        method: 'POST',
        body: form,
      });
      const payload = (await response.json()) as ImageUploadResponse;

      if (!response.ok || payload.image === undefined) {
        throw new ImageUploadError('图片上传失败。', 'upload_failed');
      }

      return payload.image;
    } catch (cause) {
      if (cause instanceof ImageUploadError && cause.code !== 'upload_failed') {
        throw cause;
      }

      lastError = cause;
    }
  }

  throw lastError instanceof ImageUploadError
    ? lastError
    : new ImageUploadError('图片重试上传后仍然失败。', 'upload_failed', lastError);
}
