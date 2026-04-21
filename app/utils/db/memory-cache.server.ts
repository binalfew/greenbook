/**
 * Minimal in-process TTL cache.
 *
 * Keys are strings, values are whatever callers store. `get` returns
 * `undefined` on miss or expiry (and evicts expired entries).
 *
 * Intended for short-lived request-deduping (feature flag lookups, resolved
 * settings). Phase 13 swaps callers to a Redis-backed cache for multi-instance
 * correctness — keep this surface small so that swap stays easy.
 */
export class MemoryCache<T> {
  private readonly ttlMs: number;
  private readonly store = new Map<string, { value: T; expiresAt: number }>();

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}
