/**
 * Message deduplication with TTL.
 */

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const PRUNE_THRESHOLD = 5000;

export class MessageDedup {
  private seen = new Map<string, number>();
  private ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /** Returns true if this is a new (non-duplicate) message. */
  check(key: string): boolean {
    const now = Date.now();
    if (this.seen.size > PRUNE_THRESHOLD) {
      for (const [k, t] of this.seen) {
        if (now - t > this.ttlMs) this.seen.delete(k);
      }
    }
    if (this.seen.has(key)) return false;
    this.seen.set(key, now);
    return true;
  }

  clear(): void {
    this.seen.clear();
  }
}
