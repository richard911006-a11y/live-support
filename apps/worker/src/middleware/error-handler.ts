import { error } from '../http/responses';
import { logger } from '../utils/logger';

export function handleUnhandledError(cause: unknown): Response {
  logger.error('Unhandled request exception', cause);

  return error('服务器内部错误。', 500);
}
