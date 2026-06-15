# @resolvx/core

Composable TypeScript primitives for production Node.js.

No magic. No framework opinions. Seven focused modules you can import individually or together. Tree-shakeable, typed end-to-end, zero mandatory dependencies.

```bash
npm install @resolvx/core
```

chalk is an optional peer dependency for coloured log output. Install it if you want colour, skip it if you don't â€” the logger works either way.

---

## Modules

### `result` â€” Explicit error handling

Stop writing try/catch everywhere. `Result<T, E>` makes failure visible in function signatures.

```typescript
import { capture, captureAsync, ok, err, combine, unwrapOr } from "@resolvx/core/result";

// Wrap a throwing function
const parsed = capture(() => JSON.parse(raw));
if (!parsed.ok) {
  console.error("Bad JSON:", parsed.error);
  return;
}
console.log(parsed.value);

// Async version
const result = await captureAsync(() => fetch(url).then(r => r.json()));

// Combine an array of Results â€” returns first Err or Ok([...values])
const all = combine([parseA, parseB, parseC]);

// Default on failure
const name = unwrapOr(parseName(input), "anonymous");
```

**API:** `ok` `err` `capture` `captureAsync` `map` `mapErr` `andThen` `tap` `tapErr` `unwrapOr` `unwrapOrElse` `unwrap` `combine` `partition` `fromNullable` `fromThrowable`

---

### `async` â€” Async control flow

```typescript
import { retry, pool, memoize, debounce, throttle, once, withTimeout, sleep } from "@resolvx/core/async";

// Retry with exponential backoff + jitter
const data = await retry(() => fetchFromApi(url), {
  attempts:       4,
  baseDelayMs:    300,
  isNonRetryable: e => e instanceof HttpError && e.status === 404,
  onFailedAttempt: (err, attempt, nextDelay) =>
    console.warn(`Attempt ${attempt} failed, retrying in ${nextDelay}ms`),
});

// Bounded concurrency â€” 5 requests at a time, output order preserved
const pages = await pool(urls.map(url => () => fetch(url).then(r => r.json())), 5);

// Memoize with TTL + in-flight deduplication
// Two concurrent calls with the same args share one execution
const getUser = memoize(fetchUser, { ttlMs: 60_000 });

// Timeout
const result = await withTimeout(() => heavyComputation(), 5000, "heavyComputation");
```

**API:** `sleep` `withTimeout` `retry` `pool` `memoize` `debounce` `throttle` `once`

---

### `cache` â€” In-memory caching

Three implementations, consistent interface.

```typescript
import { TtlCache, LruCache, DedupeCache } from "@resolvx/core/cache";

// Time-to-live cache â€” entries expire after ttlMs
const prices = new TtlCache<string, number>(30_000);
const price = await prices.getOrSet("ETH", () => fetchPrice("ETH"));

// LRU cache â€” evicts least-recently-used when full
const images = new LruCache<string, Buffer>(100);
images.set("logo", buffer);

// Deduplication cache â€” concurrent callers share one in-flight request
const users = new DedupeCache<string, User>(60_000);
// Called 10 times simultaneously â†’ only 1 fetchUser() call
const user = await users.getOrFetch(userId, id => fetchUser(id));
```

**API:** `TtlCache` Â· `LruCache` Â· `DedupeCache`

---

### `fmt` â€” Formatting

Pure functions. No side effects.

```typescript
import { fmtNum, fmtUsd, fmtMs, fmtDuration, fmtBytes, fmtToken, fmtHex, fmtRelative, renderTable } from "@resolvx/core/fmt";

fmtNum(1_234_567.89, 2)   // "1,234,567.89"
fmtUsd(1234.5)             // "$1,234.50"
fmtMs(12_345)              // "12.35s"
fmtDuration(3725)          // "1h 2m 5s"
fmtBytes(1_536)            // "1.50 KB"
fmtToken(1_500_000n, 6)    // "1.500000"  (bigint â€” no precision loss)
fmtHex("0xabcdef1234", 6, 4) // "0xabcdâ€¦3234"
fmtRelative(Date.now() / 1000 - 3700) // "1h 1m ago"

// No-dependency ASCII table
console.log(renderTable(
  ["Name", "Age"],
  [["Alice", "30"], ["Bob", "25"]],
));
```

---

### `log` â€” Structured logger

Named namespaces, child loggers, pluggable transport.

```typescript
import { createLogger } from "@resolvx/core/log";

const log = createLogger("api");
log.info("Server started", { port: 3000 });
log.warn("Rate limit approaching", { remaining: 5 });
log.error("Request failed", new Error("timeout"), { url: "/api/data" });

// Child logger â€” inherits level and transport, adds context to every line
const reqLog = log.child("request", { requestId: "abc-123" });
reqLog.info("Processing");  // â†’ ns=request requestId=abc-123

// Measure async operations
const data = await log.time("fetchData", () => fetch(url).then(r => r.json()));

// Control level at runtime
log.setLevel("debug");

// Custom transport (e.g. JSON to stdout for log aggregators)
const log2 = createLogger("worker", {
  transport: rec => process.stdout.write(JSON.stringify(rec) + "\n"),
});
```

Set `LOG_LEVEL` env var to control the default level (`debug` | `info` | `warn` | `error` | `silent`).

---

### `net` â€” Typed HTTP

```typescript
import { fetchJson, getJson, postJson, RateLimiter, HttpError, NetworkError } from "@resolvx/core/net";

// GET with timeout + retry (3 attempts, backoff, 4xx not retried)
const user = await getJson<User>("https://api.example.com/users/1");

// POST JSON
const created = await postJson<Post>("/api/posts", { title: "Hello" });

// Error types
try {
  await getJson("/api/data");
} catch (e) {
  if (e instanceof HttpError)    console.log(e.status, e.url);
  if (e instanceof NetworkError) console.log("DNS/connection failure", e.cause);
}

// Rate limiter â€” 10 req/s, bursting to 20
const limiter = new RateLimiter({ rps: 10, burst: 20 });
const throttledFetch = limiter.wrap(() => getJson(url));
await Promise.all(Array.from({ length: 100 }, throttledFetch));
```

---

### `types` â€” TypeScript utilities

```typescript
import { brand, assertUnreachable, hasKeys, isDefined, isString } from "@resolvx/core/types";

// Branded types â€” prevent mixing structurally identical primitives
type UserId  = Brand<string, "UserId">;
type OrderId = Brand<string, "OrderId">;

const uid = brand<UserId>("user-123");
// processOrder(uid) â† type error if OrderId is expected

// Exhaustiveness check â€” compile error if a union case is unhandled
function describe(status: "ok" | "pending" | "failed"): string {
  switch (status) {
    case "ok":      return "âœ“";
    case "pending": return "â€¦";
    case "failed":  return "âœ—";
    default:        return assertUnreachable(status);
  }
}

// Runtime type narrowing
if (hasKeys(data, ["price", "symbol"])) {
  console.log(data.price); // data is Record<"price"|"symbol", unknown>
}
```

---

## Requirements

- Node.js â‰¥ 18 (native `fetch`)
- TypeScript â‰¥ 5.0

## Contributing

Bug reports and PRs welcome. Run `npm test` before submitting.

## License

MIT


