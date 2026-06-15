/**
 * @resolv/core — Composable TypeScript primitives.
 *
 * Tree-shakeable. Import the whole barrel or individual modules:
 *
 *   import { retry, TtlCache, ok }          from "@resolv/core"
 *   import { retry }                         from "@resolv/core/async"
 *   import { TtlCache }                      from "@resolv/core/cache"
 *   import { ok, capture, combine }          from "@resolv/core/result"
 *   import { fmtMs, fmtUsd, renderTable }    from "@resolv/core/fmt"
 *   import { createLogger }                  from "@resolv/core/log"
 *   import { fetchJson, RateLimiter }        from "@resolv/core/net"
 *   import { brand, assertUnreachable }      from "@resolv/core/types"
 */

export {
  type Result,
  ok, err, capture, captureAsync,
  map, mapErr, andThen, tap, tapErr,
  unwrapOr, unwrapOrElse, unwrap,
  combine, partition,
  fromNullable, fromThrowable,
} from "./result.js";

export {
  sleep,
  TimeoutError, withTimeout,
  type RetryOptions, retry,
  pool,
  type MemoizeOptions, memoize,
  debounce, throttle, once,
} from "./async.js";

export { TtlCache, LruCache, DedupeCache } from "./cache.js";

export {
  fmtNum, fmtUsd, fmtRatio, fmtPct, fmtCompact, fmtToken, fmtBytes,
  fmtDuration, fmtMs, fmtUnixIso, fmtRelative,
  truncate, fmtHex, padLeft, padRight,
  toKebabCase, toCamelCase, upperFirst,
  renderTable,
} from "./fmt.js";

export {
  type LogLevel, type LogRecord, type Transport,
  defaultTransport, Logger, createLogger,
} from "./log.js";

export {
  HttpError, NetworkError,
  type FetchOptions,
  fetchJson, getJson, postJson,
  RateLimiter,
} from "./net.js";

export {
  type RequireOnly, type PartialOnly, type MaybePromise,
  type NonEmptyArray, type KeyOf, type ValueOf,
  type Brand, brand,
  type UnixSec, type UnixMs, type Address, type HexStr, type Bps,
  unixSec, unixMs,
  assertUnreachable,
  isString, isNumber, isBoolean, isBigInt,
  isObject, isArray, isNonEmpty, isDefined, hasKeys,
} from "./types.js";
