/**
 * HTTP utilities for TypeScript.
 *
 * Built on top of the native `fetch` API (Node 18+) with typed errors,
 * per-request timeout, retry, and a token-bucket rate limiter.
 *
 * All functions compose with `result.ts` — use `captureAsync(fn)` at call sites
 * where you want to avoid throws.
 */

import { retry, withTimeout, type RetryOptions } from "./async.js";

// ── Errors ────────────────────────────────────────────────────────────────

/**
 * Raised when the server returns a non-2xx status code.
 * Includes the status, URL, and raw response body for debugging.
 */
export class HttpError extends Error {
  constructor(
    public readonly status:  number,
    public readonly url:     string,
    public readonly body:    string,
  ) {
    super(`HTTP ${status} ${url}`);
    this.name = "HttpError";
  }

  /** True for client errors (4xx). These are typically not worth retrying. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  /** True for server errors (5xx). May be worth retrying. */
  get isServerError(): boolean {
    return this.status >= 500;
  }
}

/**
 * Raised when the network layer fails entirely (DNS failure, connection refused, etc.)
 * Wraps the underlying error as `cause`.
 */
export class NetworkError extends Error {
  constructor(public readonly url: string, cause: unknown) {
    super(`Network error: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name  = "NetworkError";
    this.cause = cause;
  }
}

// ── Request options ───────────────────────────────────────────────────────

export interface FetchOptions extends Omit<RequestInit, "body"> {
  /** Request timeout in ms. Default: 10 000. */
  timeoutMs?: number;
  /** URL query parameters appended to the URL. */
  params?:    Record<string, string | number | boolean | undefined>;
  /**
   * If provided, serialised to JSON and sent as the request body.
   * Sets `Content-Type: application/json` automatically.
   */
  json?:      unknown;
  /**
   * Retry configuration. Pass `false` to disable retries entirely.
   * Default: 3 attempts with exponential backoff, client errors not retried.
   */
  retry?:     RetryOptions | false;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function buildUrl(
  base:   string,
  params: Record<string, string | number | boolean | undefined> | undefined,
): string {
  if (!params) return base;

  const entries = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string | number | boolean][];
  if (entries.length === 0) return base;

  const qs = new URLSearchParams(entries.map(([k, v]) => [k, String(v)] as [string, string]));
  return `${base}${base.includes("?") ? "&" : "?"}${qs}`;
}

// ── Core ──────────────────────────────────────────────────────────────────

/**
 * Fetch a URL and parse the response as JSON.
 *
 * Throws `HttpError` for non-2xx responses and `NetworkError` for
 * transport-level failures. Both extend `Error`.
 *
 * Retries automatically (3 attempts, exponential backoff) unless
 * `retry: false` is passed or the error is a client error (4xx).
 *
 * @example
 * const price = await fetchJson<{ usd: number }>("https://api.example.com/price");
 */
export async function fetchJson<T = unknown>(
  url:  string,
  opts: FetchOptions = {},
): Promise<T> {
  const {
    timeoutMs = 10_000,
    params,
    json,
    retry: retryOpts = {},
    ...init
  } = opts;

  const finalUrl = buildUrl(url, params);

  const headers = new Headers(init.headers);
  let body: string | undefined;

  if (json !== undefined) {
    body = JSON.stringify(json);
    headers.set("Content-Type", "application/json");
  }

  const defaultRetry: RetryOptions = {
    attempts:        3,
    baseDelayMs:     300,
    isNonRetryable:  e => e instanceof HttpError && e.isClientError,
  };

  const retryConfig: RetryOptions | false =
    retryOpts === false ? false : { ...defaultRetry, ...retryOpts };

  const attempt = async (): Promise<T> => {
    let res: Response;

    try {
      res = await withTimeout(
        () => {
        const opts: RequestInit = { ...init, headers };
        if (body !== undefined) opts.body = body;
        return fetch(finalUrl, opts);
      },
        timeoutMs,
        finalUrl,
      );
    } catch (e) {
      // Don't double-wrap HttpError/NetworkError from nested calls
      if (e instanceof HttpError || e instanceof NetworkError) throw e;
      throw new NetworkError(finalUrl, e);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new HttpError(res.status, finalUrl, text);
    }

    return res.json() as Promise<T>;
  };

  return retryConfig === false
    ? attempt()
    : retry(attempt, retryConfig);
}

/** GET → JSON */
export const getJson = <T>(url: string, opts?: FetchOptions): Promise<T> =>
  fetchJson<T>(url, { method: "GET", ...opts });

/** POST JSON body → JSON response */
export const postJson = <T>(url: string, json: unknown, opts?: FetchOptions): Promise<T> =>
  fetchJson<T>(url, { method: "POST", json, ...opts });

// ── Rate limiter ──────────────────────────────────────────────────────────

/**
 * Token-bucket rate limiter.
 *
 * The bucket refills continuously at `rps` tokens per second up to `burst`.
 * `acquire()` is safe to call concurrently — a mutex ensures only one caller
 * drains the bucket at a time, preventing the double-refill race condition.
 *
 * @example
 * const limiter = new RateLimiter({ rps: 10 });
 * await limiter.acquire();
 * const data = await getJson(url);
 */
export class RateLimiter {
  private tokens:     number;
  private lastRefill: number;
  private readonly burst: number;
  private queue: Array<() => void> = [];
  private draining = false;

  constructor(private readonly opts: {
    /** Steady-state refill rate (tokens per second). */
    rps:    number;
    /** Maximum burst capacity. Defaults to `rps`. */
    burst?: number;
  }) {
    if (opts.rps <= 0) throw new RangeError("rps must be positive");
    this.burst      = opts.burst ?? opts.rps;
    this.tokens     = this.burst;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now   = Date.now();
    const delta = (now - this.lastRefill) / 1_000;
    this.tokens = Math.min(this.burst, this.tokens + delta * this.opts.rps);
    this.lastRefill = now;
  }

  /** Acquire one token, waiting if the bucket is empty. */
  async acquire(): Promise<void> {
    return new Promise(resolve => {
      this.queue.push(resolve);
      if (!this.draining) this.drain();
    });
  }

  private async drain(): Promise<void> {
    this.draining = true;

    while (this.queue.length > 0) {
      this.refill();

      if (this.tokens >= 1) {
        this.tokens--;
        this.queue.shift()!();
      } else {
        const waitMs = ((1 - this.tokens) / this.opts.rps) * 1_000;
        await new Promise(r => setTimeout(r, waitMs));
      }
    }

    this.draining = false;
  }

  /** Wrap a fetch call with automatic rate limiting. */
  wrap<T>(fn: () => Promise<T>): () => Promise<T> {
    return async () => {
      await this.acquire();
      return fn();
    };
  }
}
