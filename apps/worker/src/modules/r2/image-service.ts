import {
  IMAGE_MAX_SIZE_BYTES,
  SUPPORTED_IMAGE_MIME_TYPES,
  type ImageId,
  type ImageUploadResult,
  type SupportedImageMimeType,
} from '@live-support/types';

const IMAGE_EXTENSIONS: Record<SupportedImageMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const MAX_UPLOAD_ATTEMPTS = 2;

export type ImageUploadErrorCode =
  'invalid_file' | 'unsupported_type' | 'file_too_large' | 'upload_failed';

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

export function getImageExtension(contentType: string): string | undefined {
  return IMAGE_EXTENSIONS[contentType as SupportedImageMimeType];
}

export function createImageKey(imageId: ImageId, contentType: SupportedImageMimeType): string {
  return `${imageId}.${IMAGE_EXTENSIONS[contentType]}`;
}

/** Validates and stores customer images in R2 without creating a database record. */
export class ImageService {
  public constructor(private readonly bucket: R2Bucket) {}

  public async upload(file: Blob, publicBaseUrl: string): Promise<ImageUploadResult> {
    const contentType = file.type.toLowerCase();

    if (file.size === 0) {
      throw new ImageUploadError('Image file is empty.', 'invalid_file');
    }

    if (file.size > IMAGE_MAX_SIZE_BYTES) {
      throw new ImageUploadError('Image exceeds the 10 MB size limit.', 'file_too_large');
    }

    if (!SUPPORTED_IMAGE_MIME_TYPES.includes(contentType as SupportedImageMimeType)) {
      throw new ImageUploadError('Unsupported image type.', 'unsupported_type');
    }

    const supportedContentType = contentType as SupportedImageMimeType;
    const imageId = crypto.randomUUID() as ImageId;
    const key = createImageKey(imageId, supportedContentType);

    let lastError: unknown;
    let uploaded = false;

    for (let attempt = 0; attempt < MAX_UPLOAD_ATTEMPTS; attempt += 1) {
      try {
        await this.bucket.put(key, file.stream(), {
          httpMetadata: { contentType: supportedContentType },
        });
        uploaded = true;
        break;
      } catch (cause) {
        lastError = cause;
      }
    }

    if (!uploaded) {
      throw new ImageUploadError('Image upload failed.', 'upload_failed', lastError);
    }

    return {
      imageId,
      key,
      url: new URL(`/images/${encodeURIComponent(key)}`, publicBaseUrl).toString(),
      contentType: supportedContentType,
      size: file.size,
    };
  }
}
