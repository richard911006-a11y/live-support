import { logger as defaultLogger, type Logger } from '../../utils/logger';

export const AUTO_REPLY_CONFIG_KEY = 'auto-replies';
export const AUTO_REPLY_CACHE_TTL_MS = 60_000;

export type AutoReplyConfig = Readonly<Record<string, string>>;

export interface AutoReplyKv {
  get(key: string, type: 'json'): Promise<unknown>;
}

interface CachedAutoReplies {
  readonly loadedAt: number;
  readonly replies: AutoReplyConfig;
}

type Clock = () => number;

/** Reads exact keyword responses from KV with a short-lived in-memory cache. */
export class AutoReplyService {
  private cache: CachedAutoReplies | undefined;

  public constructor(
    private readonly kv: AutoReplyKv | undefined,
    private readonly logger: Logger = defaultLogger,
    private readonly clock: Clock = Date.now,
  ) {}

  public async loadAutoReplies(): Promise<AutoReplyConfig> {
    const cached = this.cache;

    if (cached !== undefined && this.clock() - cached.loadedAt < AUTO_REPLY_CACHE_TTL_MS) {
      return cached.replies;
    }

    return this.reloadAutoReplies();
  }

  public async reloadAutoReplies(): Promise<AutoReplyConfig> {
    if (this.kv === undefined) {
      this.cache = { loadedAt: this.clock(), replies: {} };
      return {};
    }

    try {
      const value = await this.kv.get(AUTO_REPLY_CONFIG_KEY, 'json');
      const replies = parseAutoReplyConfig(value);
      this.cache = { loadedAt: this.clock(), replies };
      return replies;
    } catch (cause) {
      this.logger.error('Unable to load auto-reply configuration from KV.', cause);
      this.cache = { loadedAt: this.clock(), replies: {} };
      return {};
    }
  }

  public async matchKeyword(message: string): Promise<string | undefined> {
    const replies = await this.loadAutoReplies();

    return Object.prototype.hasOwnProperty.call(replies, message) ? replies[message] : undefined;
  }
}

function parseAutoReplyConfig(value: unknown): AutoReplyConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const replies = Object.create(null) as Record<string, string>;

  for (const [keyword, reply] of Object.entries(value)) {
    if (keyword.length > 0 && typeof reply === 'string' && reply.length > 0) {
      replies[keyword] = reply;
    }
  }

  return replies;
}
