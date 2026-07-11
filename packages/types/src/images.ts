import type { ImageId } from './identifiers';

export const IMAGE_MAX_SIZE_BYTES = 10 * 1024 * 1024;

export const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

export interface ImageUploadResult {
  imageId: ImageId;
  key: string;
  url: string;
  contentType: SupportedImageMimeType;
  size: number;
}

export interface ImageUploadResponse {
  image: ImageUploadResult;
  url: string;
}
