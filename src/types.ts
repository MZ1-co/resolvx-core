/**
 * TypeScript utility types and runtime type guards.
 *
 * This module only exports things that are:
 *   1. Not already in the TypeScript standard library, or
 *   2. Opinionated refinements with a specific usage contract
 *
 * If something is already in `lib.es2021.d.ts`, it doesn't belong here.
 */

// ── Conditional types ─────────────────────────────────────────────────────

/** Require exactly the keys in K to be present; all others become optional. */
export type RequireOnly<T, K extends keyof T> =
  Required<Pick<T, K>> & Partial<Omit<T, K>>;

/** Make exactly the keys in K optional; leave the rest required. */
export type PartialOnly<T, K extends keyof T> =
  Omit<T, K> & Partial<Pick<T, K>>;

/** A value that is either T or a Promise<T>. */
export type MaybePromise<T> = T | PromiseLike<T>;

/** An array guaranteed to have at least one element. */
export type NonEmptyArray<T> = readonly [T, ...T[]];

/** The key type of an object. */
export type KeyOf<T>   = keyof T & string;

/** The value type of an object. */
export type ValueOf<T> = T[keyof T];

// ── Branded types ─────────────────────────────────────────────────────────
//
// Branded types prevent you from accidentally mixing structurally-identical
// primitives (e.g. a millisecond timestamp vs a second timestamp vs a block
// number — all are `number` but are not interchangeable).
//
// Usage:
//   type UserId = Brand<string, "UserId">
//   const id = brand<UserId>("user-abc-123")

declare const BRAND: unique symbol;

export type Brand<T, B extends string> = T & { readonly [BRAND]: B };

export function brand<B extends Brand<unknown, string>>(
  value: B extends Brand<infer T, string> ? T : never,
): B {
  return value as B;
}

// Common branded types used throughout the POC
export type UnixSec  = Brand<number, "UnixSec">;
export type UnixMs   = Brand<number, "UnixMs">;
export type Address  = Brand<string, "Address">;
export type HexStr   = Brand<string, "HexStr">;
export type Bps      = Brand<number, "Bps">;       // basis points (1 = 0.01%)

export const unixSec  = (n: number): UnixSec => n as unknown as UnixSec;
export const unixMs   = (n: number): UnixMs  => n as unknown as UnixMs;

// ── Exhaustiveness check ──────────────────────────────────────────────────

/**
 * Use in `switch` default branches to get a compile-time error when a
 * case is not handled.
 *
 * @example
 * switch (status) {
 *   case "ok":    return "✓";
 *   case "error": return "✗";
 *   default:      return assertUnreachable(status); // error if a new status is added
 * }
 */
export function assertUnreachable(value: never, label?: string): never {
  throw new Error(
    label
      ? `Unhandled case in ${label}: ${JSON.stringify(value)}`
      : `Unhandled value: ${JSON.stringify(value)}`
  );
}

// ── Runtime guards ────────────────────────────────────────────────────────

export function isString(v: unknown): v is string   { return typeof v === "string"; }
export function isNumber(v: unknown): v is number   { return typeof v === "number" && !Number.isNaN(v); }
export function isBoolean(v: unknown): v is boolean { return typeof v === "boolean"; }
export function isBigInt(v: unknown): v is bigint   { return typeof v === "bigint"; }

export function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function isArray<T>(v: unknown, guard?: (item: unknown) => item is T): v is T[] {
  if (!Array.isArray(v)) return false;
  return guard == null || v.every(guard);
}

export function isNonEmpty<T>(v: readonly T[]): v is NonEmptyArray<T> {
  return v.length > 0;
}

export function isDefined<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined;
}

/**
 * Narrows `unknown` to `Record<string, unknown>` after verifying it
 * has the specified required keys. Useful when parsing external data.
 *
 * @example
 * const data = await fetchJson(url);
 * if (hasKeys(data, ["price", "symbol"])) {
 *   console.log(data.price); // typed as unknown but accessible
 * }
 */
export function hasKeys<K extends string>(
  v:    unknown,
  keys: readonly K[],
): v is Record<K, unknown> {
  return isObject(v) && keys.every(k => k in v);
}
