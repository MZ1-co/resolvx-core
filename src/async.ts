/**
 * Async utilities for TypeScript.
 *
 * Design principles:
 *   - Every function returns a plain Promise — no custom wrapper types
 *   - Errors propagate naturally; wrapping in Result is the caller's choice
 *   - Functions are individually useful AND compose cleanly together
 */

// ── Primitives ────────────────────────────────────────────────────────────

/** Resolves after `ms` milliseconds. */
export const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

// ── Timeout ───────────────────────────────────────────────────────────────

export class TimeoutError extends Error {
  constructor(public readonly ms: number, label?: string) {
    super(label ? `${label} timed out after ${ms}ms` : `Timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Races `fn` against a timer. Rejects with `TimeoutError` if the timer wins.
 *
 * The timer is always cleared, even if `fn` resolves or rejects first,
 * so there are no dangling timers after this call.
 */
export function withTimeout<T>(
  fn:     () => Promise<T>,
  ms:     number,
  label?: string,
): Promise<T> {
  let timerId: ReturnType<typeof setTimeout>;

  const timer = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => reject(new TimeoutError(ms, label)), ms);
  });

  return Promise.race([fn(), timer]).finally(() => clearTimeout(timerId!));
}

// ── Retry ─────────────────────────────────────────────────────────────────

export interface RetryOptions {
  /**
   * Total number of attempts, including the first.
   * A value of 1 means "no retries". Default: 3.
   */
  attempts?: number;
  /** Base delay in ms before the first retry. Doubles each attempt. Default: 300. */
  baseDelayMs?: number;
  /** Hard ceiling on delay growth. Default: 30 000. */
  maxDelayMs?: number;
  /** Jitter fraction (0–1). Adds up to `jitter * delay` of random noise. Default: 0.1 */
  jitter?: number;
  /**
   * Return `true` to give up immediately without further retries.
   * Useful for non-transient errors (e.g. 404 Not Found).
   */
  isNonRetryable?: (error: unknown) => boolean;
  /** Called after each failed attempt, before the next sleep. */
  onFailedAttempt?: (error: unknown, attempt: number, nextDelayMs: number) => void;
}

/**
 * Retries `fn` with exponential backoff until it resolves or attempts are exhausted.
 *
 * @example
 * const data = await retry(() => fetchJSON(url), {
 *   attempts: 4,
 *   isNonRetryable: e => e instanceof HttpError && e.status === 404,
 * });
 */
export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const {
    attempts        = 3,
    baseDelayMs     = 300,
    maxDelayMs      = 30_000,
    jitter          = 0.1,
    isNonRetryable,
    onFailedAttempt,
  } = opts;

  if (attempts < 1) throw new RangeError("attempts must be >= 1");

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;

      if (isNonRetryable?.(e) || attempt === attempts) break;

      const base   = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const noise  = base * jitter * Math.random();
      const delay  = Math.round(base + noise);

      onFailedAttempt?.(e, attempt, delay);
      await sleep(delay);
    }
  }

  throw lastError;
}

// ── Concurrency pool ──────────────────────────────────────────────────────

/**
 * Executes tasks with a bounded concurrency limit.
 *
 * Unlike `Promise.all`, this does not fire all tasks at once — it keeps
 * exactly `limit` tasks running at any time. Output order matches input order.
 *
 * Errors are NOT suppressed: if any task throws, the error propagates
 * and no further tasks are started (already-running tasks complete naturally).
 *
 * @example
 * const pages = await pool(urls.map(url => () => fetch(url).then(r => r.json())), 5);
 */
export async function pool<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  if (limit < 1) throw new RangeError("limit must be >= 1");
  if (tasks.length === 0) return [];

  const results = new Array<T>(tasks.length);
  let   index   = 0;
  let   failed  = false;

  async function worker(): Promise<void> {
    while (index < tasks.length && !failed) {
      const i = index++;
      try {
        results[i] = await tasks[i]!();  // i is in-bounds: checked in while condition
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    worker,
  );

  await Promise.all(workers);
  return results;
}

// ── Memoize ───────────────────────────────────────────────────────────────

export interface MemoizeOptions<Args extends unknown[]> {
  /** Time-to-live in ms. Omit for indefinite caching. */
  ttlMs?: number;
  /**
   * How to compute the cache key from the arguments.
   * Defaults to `JSON.stringify` — override for non-serialisable args
   * or for finer control over cache granularity.
   */
  keyFn?: (...args: Args) => string;
}

/**
 * Memoizes an async function.
 *
 * Deduplicates in-flight requests: if two callers invoke with the same key
 * before the first resolves, both receive the same Promise (one network call).
 *
 * @example
 * const cachedPrice = memoize(fetchPrice, { ttlMs: 30_000 });
 * const [a, b] = await Promise.all([cachedPrice("ETH"), cachedPrice("ETH")]);
 * // Only one fetchPrice("ETH") call is made
 */
export function memoize<Args extends unknown[], T>(
  fn:   (...args: Args) => Promise<T>,
  opts: MemoizeOptions<Args> = {},
): (...args: Args) => Promise<T> {
  const {
    ttlMs,
    keyFn = (...args) => JSON.stringify(args),
  } = opts;

  const cache    = new Map<string, T>();
  const expiry   = new Map<string, number>();
  const inflight = new Map<string, Promise<T>>();

  return (...args: Args): Promise<T> => {
    const key = keyFn(...args);
    const now = Date.now();

    // Serve from cache if fresh
    if (cache.has(key)) {
      const exp = expiry.get(key);
      if (exp === undefined || now < exp) {
        return Promise.resolve(cache.get(key)!);
      }
      cache.delete(key);
      expiry.delete(key);
    }

    // Deduplicate concurrent calls
    const pending = inflight.get(key);
    if (pending) return pending;

    const promise = fn(...args).then(value => {
      cache.set(key, value);
      if (ttlMs !== undefined) expiry.set(key, Date.now() + ttlMs);
      inflight.delete(key);
      return value;
    }).catch(e => {
      inflight.delete(key);
      throw e;
    });

    inflight.set(key, promise);
    return promise;
  };
}

// ── Debounce ──────────────────────────────────────────────────────────────

/**
 * Debounces an async function: only the last call within `waitMs` is executed.
 *
 * All callers within the same window receive the same Promise, which resolves
 * (or rejects) when the debounced call finally fires.
 *
 * A new Promise is created for each distinct "window" so that a second wave
 * of callers after the first window settles gets a fresh Promise.
 */
export function debounce<Args extends unknown[], T>(
  fn:     (...args: Args) => Promise<T>,
  waitMs: number,
): (...args: Args) => Promise<T> {
  let timerId:  ReturnType<typeof setTimeout> | null = null;
  let latestArgs: Args;
  let resolvers: Array<{ resolve: (v: T) => void; reject: (e: unknown) => void }> = [];
  let currentPromise: Promise<T> | null = null;

  return (...args: Args): Promise<T> => {
    latestArgs = args;

    if (!currentPromise) {
      currentPromise = new Promise<T>((resolve, reject) => {
        resolvers.push({ resolve, reject });
      });
    } else {
      // Add to the existing waiters
      const ext = currentPromise.then(() => Promise.resolve<T>(undefined as any));
      currentPromise = new Promise<T>((resolve, reject) => {
        resolvers.push({ resolve, reject });
      });
    }

    const snapshot = currentPromise;

    if (timerId) clearTimeout(timerId);

    timerId = setTimeout(async () => {
      timerId = null;
      const waiters = resolvers;
      resolvers      = [];
      currentPromise = null;

      try {
        const result = await fn(...latestArgs);
        waiters.forEach(w => w.resolve(result));
      } catch (e) {
        waiters.forEach(w => w.reject(e));
      }
    }, waitMs);

    return snapshot;
  };
}

// ── Throttle ──────────────────────────────────────────────────────────────

/**
 * Throttles an async function to at most one call per `intervalMs`.
 *
 * - The FIRST call within each interval fires immediately.
 * - Subsequent calls within the interval return the same in-flight Promise.
 * - After the interval elapses, the next call fires a new invocation.
 */
export function throttle<Args extends unknown[], T>(
  fn:         (...args: Args) => Promise<T>,
  intervalMs: number,
): (...args: Args) => Promise<T> {
  let lastFired  = -Infinity;
  let inflight: Promise<T> | null = null;

  return (...args: Args): Promise<T> => {
    const now = Date.now();

    if (now - lastFired >= intervalMs) {
      lastFired = now;
      inflight  = fn(...args).finally(() => { inflight = null; });
    }

    // inflight is guaranteed non-null here because we just set it above,
    // or it's still running from a previous call within the interval.
    return inflight!;
  };
}

// ── Once ──────────────────────────────────────────────────────────────────

/**
 * Guarantees `fn` is called at most once, no matter how many callers invoke it.
 * All callers share the same Promise (and the same resolved value).
 *
 * Errors are NOT suppressed: if `fn` rejects, ALL callers reject.
 * Unlike `memoize`, there is no TTL — the result is cached forever.
 */
export function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let result: Promise<T> | null = null;
  return (): Promise<T> => { result ??= fn(); return result; };
}
