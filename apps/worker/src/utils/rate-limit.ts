interface WindowEntry {
  startedAt: number;
  count: number;
}

/** Small per-isolate sliding-window limiter for abuse protection. */
export class InMemoryRateLimiter {
  private readonly entries = new Map<string, WindowEntry>();

  public constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
    private readonly clock: () => number = Date.now,
  ) {}

  public consume(key: string): boolean {
    const now = this.clock();
    const entry = this.entries.get(key);

    if (entry === undefined || now - entry.startedAt >= this.windowMs) {
      if (entry !== undefined) {
        this.entries.delete(key);
      }

      if (this.entries.size >= this.maxKeys) {
        this.prune(now);
      }

      if (this.entries.size >= this.maxKeys) {
        return false;
      }

      this.entries.set(key, { startedAt: now, count: 1 });
      return true;
    }

    if (entry.count >= this.limit) {
      return false;
    }

    entry.count += 1;
    return true;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.startedAt >= this.windowMs) {
        this.entries.delete(key);
      }
    }
  }
}

export function getClientRateLimitKey(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim() ??
    'unknown'
  );
}
