/**
 * In-memory caches for TypeScript.
 *
 * Three implementations for three different eviction strategies:
 *
 *   TtlCache   — time-based expiry; keys die after `ttlMs`
 *   LruCache   — capacity-based; least-recently-used key is evicted when full
 *   DedupeCache — inflight-deduplication layer on top of TtlCache;
 *                 concurrent callers for the same key share one Promise
 *
 * All three implement the same `get / set / has / delete / clear` surface
 * so they can be swapped without changing call sites.
 */

// ── TtlCache ──────────────────────────────────────────────────────────────

interface TtlEntry<V> {
  value:     V;
  expiresAt: number;
}

export class TtlCache<K, V> {
  private readonly store = new Map<K, TtlEntry<V>>();
  private cleanupHandle: ReturnType<typeof setInterval> | null = null;

  /**
   * @param ttlMs         Default TTL for entries, in ms.
   * @param cleanupEveryMs How often to sweep stale entries. Pass `0` to disable
   *                       background sweeping (entries are still lazily evicted on
   *                       read). Default: same as `ttlMs`.
   */
  constructor(
    private readonly ttlMs:          number,
    private readonly cleanupEveryMs: number = ttlMs,
  ) {
    if (ttlMs <= 0) throw new RangeError("ttlMs must be positive");

    if (cleanupEveryMs > 0) {
      this.cleanupHandle = setInterval(() => this.sweep(), cleanupEveryMs).unref?.() as any
        ?? setInterval(() => this.sweep(), cleanupEveryMs);
    }
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: K, value: V, ttlMs?: number): this {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.ttlMs),
    });
    return this;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /** Remove all expired entries. Called automatically unless `cleanupEveryMs` is 0. */
  sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  /** Number of non-expired entries. Triggers a sweep first. */
  get size(): number {
    this.sweep();
    return this.store.size;
  }

  /**
   * Returns the cached value, or calls `compute()`, caches, and returns the result.
   * Uses the default TTL unless `ttlMs` is specified.
   */
  async getOrSet(key: K, compute: () => Promise<V>, ttlMs?: number): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;

    const value = await compute();
    this.set(key, value, ttlMs);
    return value;
  }

  /** Frees the background sweep interval. Call this when discarding the cache. */
  dispose(): void {
    if (this.cleanupHandle !== null) {
      clearInterval(this.cleanupHandle as any);
      this.cleanupHandle = null;
    }
  }
}

// ── LruCache ──────────────────────────────────────────────────────────────

export class LruCache<K, V> {
  private readonly store = new Map<K, V>();

  constructor(private readonly capacity: number) {
    if (capacity < 1) throw new RangeError("capacity must be >= 1");
  }

  get(key: K): V | undefined {
    if (!this.store.has(key)) return undefined;

    // Promote to most-recently-used by re-inserting at the end of the Map.
    const value = this.store.get(key)!;
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  set(key: K, value: V): this {
    if (this.store.has(key)) {
      // Overwrite without eviction — just re-insert to update recency.
      this.store.delete(key);
    } else if (this.store.size >= this.capacity) {
      // Evict the oldest entry (first key in insertion order).
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, value);
    return this;
  }

  has(key: K): boolean {
    return this.store.has(key);
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  /** Peek at a value without updating recency. */
  peek(key: K): V | undefined {
    return this.store.get(key);
  }

  /** Returns the cached value or computes, caches, and returns it. Synchronous. */
  getOrSet(key: K, compute: () => V): V {
    const hit = this.get(key);
    if (hit !== undefined) return hit;

    const value = compute();
    this.set(key, value);
    return value;
  }
}

// ── DedupeCache ───────────────────────────────────────────────────────────

/**
 * A cache that deduplicates concurrent requests for the same key.
 *
 * If two callers request the same key before the first `fetch` resolves,
 * both receive the same Promise — `fetch` is only called once.
 *
 * Successful values are stored with a TTL. Rejected Promises are NOT cached,
 * so the next caller will attempt a fresh `fetch`.
 */
export class DedupeCache<K, V> {
  private readonly ttl      = new Map<K, { value: V; expiresAt: number }>();
  private readonly inflight = new Map<K, Promise<V>>();

  constructor(private readonly ttlMs: number) {
    if (ttlMs <= 0) throw new RangeError("ttlMs must be positive");
  }

  private getFresh(key: K): V | undefined {
    const entry = this.ttl.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.ttl.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Returns the cached value if fresh, otherwise calls `fetch(key)`.
   * Concurrent calls with the same key share one `fetch` invocation.
   */
  getOrFetch(key: K, fetch: (key: K) => Promise<V>): Promise<V> {
    const cached = this.getFresh(key);
    if (cached !== undefined) return Promise.resolve(cached);

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = fetch(key)
      .then(value => {
        this.ttl.set(key, { value, expiresAt: Date.now() + this.ttlMs });
        this.inflight.delete(key);
        return value;
      })
      .catch(e => {
        // Don't cache errors — let the next caller retry
        this.inflight.delete(key);
        throw e;
      });

    this.inflight.set(key, promise);
    return promise;
  }

  has(key: K): boolean {
    return this.getFresh(key) !== undefined;
  }

  invalidate(key: K): void {
    this.ttl.delete(key);
    // Leave inflight alone — it's still running and callers expect a resolution
  }

  clear(): void {
    this.ttl.clear();
    // Do NOT clear inflight — callers are awaiting those Promises
  }

  get size(): number {
    return this.ttl.size;
  }
}
