/**
 * Pure string-formatting utilities.
 *
 * All functions are synchronous and side-effect-free.
 * None import from chalk or any terminal library — formatting only.
 */

// ── Numbers ───────────────────────────────────────────────────────────────

/** Format a number with thousands separators. */
export function fmtNum(value: number, decimals = 0): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format a USD dollar amount. */
export function fmtUsd(value: number, decimals = 2): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  return `${sign}$${fmtNum(abs, decimals)}`;
}

/**
 * Format a ratio as a percentage.
 * Pass a value between 0 and 1 (e.g. 0.05 → "5.00%").
 */
export function fmtRatio(ratio: number, decimals = 2): string {
  return `${(ratio * 100).toFixed(decimals)}%`;
}

/**
 * Format a percentage that is already in percentage units.
 * (e.g. 5 → "5.00%").
 */
export function fmtPct(pct: number, decimals = 2): string {
  return `${pct.toFixed(decimals)}%`;
}

/** Compact number: 1 500 000 → "1.50M", 42 300 → "42.30K". */
export function fmtCompact(value: number, decimals = 2): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(decimals)}T`;
  if (abs >= 1e9)  return `${sign}${(abs / 1e9).toFixed(decimals)}B`;
  if (abs >= 1e6)  return `${sign}${(abs / 1e6).toFixed(decimals)}M`;
  if (abs >= 1e3)  return `${sign}${(abs / 1e3).toFixed(decimals)}K`;
  return `${sign}${abs.toFixed(decimals)}`;
}

/**
 * Format an on-chain token amount given its decimal places.
 * Accepts `bigint` to avoid precision loss for large integers.
 *
 * @example fmtToken(1_500_000n, 6) → "1.500000"
 */
export function fmtToken(raw: bigint, decimals: number): string {
  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new RangeError(`decimals must be a non-negative integer, got ${decimals}`);
  }
  const str     = raw.toString().padStart(decimals + 1, "0");
  const intPart = str.slice(0, str.length - decimals) || "0";
  const fracPart = decimals > 0 ? str.slice(-decimals) : "";
  return decimals > 0 ? `${intPart}.${fracPart}` : intPart;
}

// ── Bytes ─────────────────────────────────────────────────────────────────

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/** Format a byte count as a human-readable string. */
export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "∞";
  const sign = bytes < 0 ? "-" : "";
  let v = Math.abs(bytes);
  let i = 0;
  while (v >= 1024 && i < BYTE_UNITS.length - 1) { v /= 1024; i++; }
  return `${sign}${v.toFixed(i === 0 ? 0 : 2)} ${BYTE_UNITS[i]}`;
}

// ── Time ──────────────────────────────────────────────────────────────────

/**
 * Format a duration in whole seconds to a human-readable string.
 * Omits units with value 0, except seconds (always shown if nothing else).
 *
 * @example fmtDuration(3725) → "1h 2m 5s"
 */
export function fmtDuration(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "";
  const s    = Math.abs(Math.floor(totalSeconds));
  const d    = Math.floor(s / 86_400);
  const h    = Math.floor((s % 86_400) / 3_600);
  const m    = Math.floor((s % 3_600) / 60);
  const sec  = s % 60;

  const parts: string[] = [];
  if (d)              parts.push(`${d}d`);
  if (h)              parts.push(`${h}h`);
  if (m)              parts.push(`${m}m`);
  if (sec || !parts.length) parts.push(`${sec}s`);

  return sign + parts.join(" ");
}

/** Format milliseconds. Under 1 s shown as "Xms", otherwise uses fmtDuration. */
export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return "∞";
  if (Math.abs(ms) < 1_000) return `${Math.round(ms)}ms`;
  return fmtDuration(ms / 1_000);
}

/** Format a Unix timestamp (seconds) as ISO 8601 UTC. */
export function fmtUnixIso(unixSec: number): string {
  return new Date(unixSec * 1_000).toISOString();
}

/**
 * Format a Unix timestamp as a relative phrase from `now`.
 *
 * @example fmtRelative(Date.now() / 1000 - 3700) → "1h 1m ago"
 */
export function fmtRelative(unixSec: number, nowSec = Date.now() / 1_000): string {
  const diff = nowSec - unixSec;
  if (diff < 0)  return `in ${fmtDuration(-diff)}`;
  if (diff < 5)  return "just now";
  return `${fmtDuration(diff)} ago`;
}

// ── Strings ───────────────────────────────────────────────────────────────

/**
 * Truncate a string to `maxLen` characters, appending `suffix` if cut.
 * The resulting string is always <= maxLen characters (including suffix).
 */
export function truncate(s: string, maxLen: number, suffix = "…"): string {
  if (maxLen < suffix.length) throw new RangeError("maxLen is too short to fit suffix");
  return s.length <= maxLen ? s : s.slice(0, maxLen - suffix.length) + suffix;
}

/**
 * Abbreviate a hex string by keeping `head` chars from the start
 * and `tail` chars from the end.
 *
 * @example fmtHex("0xabcdef1234567890abcd", 6, 4) → "0xabcd…abcd"
 */
export function fmtHex(hex: string, head = 6, tail = 4): string {
  if (head + tail + 1 >= hex.length) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

/** Right-pad a string or number to at least `width` characters. */
export function padRight(s: string | number, width: number, fill = " "): string {
  const str = String(s);
  return str.length >= width ? str : str + fill.repeat(width - str.length);
}

/** Left-pad a string or number to at least `width` characters. */
export function padLeft(s: string | number, width: number, fill = " "): string {
  const str = String(s);
  return str.length >= width ? str : fill.repeat(width - str.length) + str;
}

/** "helloWorld" or "HelloWorld" → "hello-world" */
export function toKebabCase(s: string): string {
  return s
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

/** "hello_world" → "helloWorld" */
export function toCamelCase(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Uppercase the first character; leave the rest unchanged. */
export function upperFirst(s: string): string {
  return s.length === 0 ? s : (s[0] ?? "").toUpperCase() + s.slice(1);
}

// ── Plain-text table ──────────────────────────────────────────────────────

/**
 * Renders a fixed-width ASCII table with no external dependencies.
 * For rich terminal output, use the `table` npm package instead.
 *
 * @example
 * console.log(renderTable(["Name", "Score"], [["Alice", "99"], ["Bob", "87"]]));
 */
export function renderTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const colCount = headers.length;
  const widths   = Array.from({ length: colCount }, (_, i) =>
    Math.max(headers[i]?.length ?? 0, ...rows.map(r => r[i]?.length ?? 0)) as number
  );

  const border = "+" + widths.map(w => "-".repeat(w + 2)).join("+") + "+";
  const row    = (cells: readonly string[]) =>
    "| " + cells.map((c, i) => padRight(c, widths[i] ?? 0)).join(" | ") + " |";

  return [
    border,
    row(headers),
    border,
    ...rows.map(row),
    border,
  ].join("\n");
}
