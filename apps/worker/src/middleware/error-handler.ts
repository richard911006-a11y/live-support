import { error } from '../http/responses';
import { logger } from '../utils/logger';

export function handleUnhandledError(cause: unknown): Response {
  logger.error('Unhandled request exception', cause);

  return error('Internal server error', 500);
}
