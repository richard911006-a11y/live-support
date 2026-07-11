export interface Logger {
  error(message: string, cause?: unknown): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
}

/** Minimal runtime logger backed by the Workers console implementation. */
export const logger: Logger = {
  error(message, cause) {
    if (cause === undefined) {
      console.error(message);
      return;
    }

    console.error(message, cause);
  },
  info(message, context) {
    if (context === undefined) {
      console.info(message);
      return;
    }

    console.info(message, context);
  },
  warn(message, context) {
    if (context === undefined) {
      console.warn(message);
      return;
    }

    console.warn(message, context);
  },
};
