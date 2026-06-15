/**
 * Result<T, E> — discriminated union for explicit error handling.
 *
 * Prefer this over try/catch when:
 *   - A function can fail for expected reasons (not programmer errors)
 *   - Callers need to branch on success/failure at the type level
 *   - You want errors to be visible in function signatures
 *
 * Do NOT use this for:
 *   - Truly unexpected errors (let those propagate as exceptions)
 *   - Simple null checks (use Option<T> or the nullish coalescing operator)
 */

// ── Core types ────────────────────────────────────────────────────────────

export type Result<T, E = unknown> =
  | { readonly ok: true;  readonly value: T }
  | { readonly ok: false; readonly error: E };

// ── Constructors ──────────────────────────────────────────────────────────

export const ok  = <T>(value: T):  Result<T, never>  => ({ ok: true,  value });
export const err = <E>(error: E):  Result<never, E>  => ({ ok: false, error });

// ── Capture helpers ───────────────────────────────────────────────────────

/** Runs `fn` and wraps thrown values in `err()`. Never throws. */
export function capture<T>(fn: () => T): Result<T, unknown> {
  try   { return ok(fn()); }
  catch (e) { return err(e); }
}

/** Async version of `capture`. Never rejects. */
export async function captureAsync<T>(fn: () => Promise<T>): Promise<Result<T, unknown>> {
  try   { return ok(await fn()); }
  catch (e) { return err(e); }
}

// ── Transforms ────────────────────────────────────────────────────────────

/** Apply `fn` to the value inside `Ok`, leaving `Err` unchanged. */
export function map<T, U, E>(result: Result<T, E>, fn: (v: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Apply `fn` to the error inside `Err`, leaving `Ok` unchanged. */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (e: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

/** Chain a fallible operation onto an `Ok` value. */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (v: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

/** Run a side-effect on `Ok` without changing the value. */
export function tap<T, E>(result: Result<T, E>, fn: (v: T) => void): Result<T, E> {
  if (result.ok) fn(result.value);
  return result;
}

/** Run a side-effect on `Err` without changing the error. */
export function tapErr<T, E>(result: Result<T, E>, fn: (e: E) => void): Result<T, E> {
  if (!result.ok) fn(result.error);
  return result;
}

// ── Extraction ────────────────────────────────────────────────────────────

/** Returns the value, or `fallback` if `Err`. */
export function unwrapOr<T>(result: Result<T, unknown>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/** Returns the value, or the result of calling `fn(error)` if `Err`. */
export function unwrapOrElse<T, E>(result: Result<T, E>, fn: (e: E) => T): T {
  return result.ok ? result.value : fn(result.error);
}

/**
 * Returns the value, or throws the error.
 * Use only at call sites where you have verified `ok === true` out-of-band,
 * or where you genuinely want to escalate to an exception.
 */
export function unwrap<T>(result: Result<T, unknown>): T {
  if (result.ok) return result.value;
  throw result.error instanceof Error
    ? result.error
    : new Error(String(result.error));
}

// ── Combinators ───────────────────────────────────────────────────────────

/**
 * Turns an array of Results into a Result of an array.
 * Returns the first `Err` encountered, or `Ok` with all values.
 *
 * Named `combine` (not `all`) to avoid collision with `Array.prototype` concepts.
 */
export function combine<T, E>(results: Array<Result<T, E>>): Result<T[], E> {
  const values: T[] = [];
  for (const r of results) {
    if (!r.ok) return r;
    values.push(r.value);
  }
  return ok(values);
}

/** Like `combine` but collects all errors instead of short-circuiting. */
export function partition<T, E>(
  results: Array<Result<T, E>>,
): { values: T[]; errors: E[] } {
  const values: T[]  = [];
  const errors: E[] = [];
  for (const r of results) {
    if (r.ok) values.push(r.value);
    else      errors.push(r.error);
  }
  return { values, errors };
}

// ── Constructors from other patterns ─────────────────────────────────────

/** Converts `null | undefined` to `Err(errorValue)`. */
export function fromNullable<T, E>(
  value:      T | null | undefined,
  errorValue: E,
): Result<T, E> {
  return value == null ? err(errorValue) : ok(value);
}

/** Wraps a throwing function so it always returns a Result. */
export function fromThrowable<Args extends unknown[], T>(
  fn: (...args: Args) => T,
): (...args: Args) => Result<T, unknown> {
  return (...args) => capture(() => fn(...args));
}
