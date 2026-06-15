/**
 * Structured logger for Node.js CLI tools and servers.
 *
 * chalk is an optional peer dependency. If not installed, output is
 * identical but without colour. No runtime error is thrown either way.
 *
 * @example
 * import { createLogger } from "@resolv/core/log";
 * const log = createLogger("api");
 * log.info("Listening", { port: 3000 });
 * log.warn("Retrying", { attempt: 2, ms: 400 });
 * log.error("Failed", new Error("timeout"));
 */

// ── Optional chalk ────────────────────────────────────────────────────────
// Dynamically imported so the package works without it.

type Colourise = (s: string) => string;
const id: Colourise = (s) => s;

interface Palette {
  dim:    Colourise;
  gray:   Colourise;
  cyan:   Colourise;
  yellow: Colourise;
  red:    Colourise;
  green:  Colourise;
}

let palette: Palette = { dim: id, gray: id, cyan: id, yellow: id, red: id, green: id };

// Best-effort: load chalk at module initialisation, fail silently.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const c = require("chalk");
  if (c?.default ?? c) {
    const ch = c.default ?? c;
    palette = {
      dim:    (s) => ch.dim(s),
      gray:   (s) => ch.gray(s),
      cyan:   (s) => ch.cyan(s),
      yellow: (s) => ch.yellow(s),
      red:    (s) => ch.red(s),
      green:  (s) => ch.green(s),
    };
  }
} catch { /* chalk not installed — plain output */ }

// ── Types ─────────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const RANK: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3, silent: 4,
};

export interface LogRecord {
  readonly level:     LogLevel;
  readonly ns:        string;
  readonly msg:       string;
  readonly ctx:       Record<string, unknown>;
  readonly ts:        number;
  readonly err?:      unknown;
}

export type Transport = (record: LogRecord) => void;

// ── Default transport ─────────────────────────────────────────────────────

const LABEL: Record<LogLevel, string> = {
  debug:  "DBG",
  info:   "INF",
  warn:   "WRN",
  error:  "ERR",
  silent: "   ",
};

const LABEL_COLOUR: Record<LogLevel, Colourise> = {
  debug:  palette.gray,
  info:   palette.cyan,
  warn:   palette.yellow,
  error:  palette.red,
  silent: id,
};

function fmtCtx(ctx: Record<string, unknown>): string {
  const keys = Object.keys(ctx);
  if (keys.length === 0) return "";
  return " " + palette.dim(keys.map(k => `${k}=${JSON.stringify(ctx[k])}`).join(" "));
}

export const defaultTransport: Transport = (rec) => {
  const ts    = new Date(rec.ts).toISOString().slice(11, 23);
  const label = LABEL_COLOUR[rec.level](LABEL[rec.level]);
  const ns    = palette.dim(rec.ns.slice(0, 18).padEnd(18));
  const line  = `${palette.dim(ts)} ${label} ${ns} ${rec.msg}${fmtCtx(rec.ctx)}`;
  const out   = rec.level === "error" ? process.stderr : process.stdout;
  out.write(line + "\n");

  if (rec.err instanceof Error && rec.err.stack) {
    process.stderr.write(palette.red(rec.err.stack) + "\n");
  }
};

// ── Logger ────────────────────────────────────────────────────────────────

export class Logger {
  readonly ns: string;

  private _level:     LogLevel;
  private _ctx:       Record<string, unknown>;
  private _transport: Transport;

  constructor(ns: string, opts: {
    level?:     LogLevel;
    ctx?:       Record<string, unknown>;
    transport?: Transport;
  } = {}) {
    this.ns         = ns;
    this._level     = opts.level     ?? (process.env["LOG_LEVEL"] as LogLevel | undefined) ?? "info";
    this._ctx       = { ...opts.ctx };
    this._transport = opts.transport ?? defaultTransport;
  }

  debug(msg: string, ctx?: Record<string, unknown>): void { this._emit("debug", msg, ctx); }
  info (msg: string, ctx?: Record<string, unknown>): void { this._emit("info",  msg, ctx); }
  warn (msg: string, ctx?: Record<string, unknown>): void { this._emit("warn",  msg, ctx); }

  error(msg: string, errOrCtx?: unknown, ctx?: Record<string, unknown>): void {
    const isErr  = errOrCtx instanceof Error;
    const err    = isErr ? errOrCtx : undefined;
    const merged = { ...this._ctx, ...(isErr ? ctx : errOrCtx as Record<string, unknown>) };
    this._write({ level: "error", ns: this.ns, msg, ctx: merged, ts: Date.now(), err });
  }

  /** Returns a child logger that prepends extra context to every line. */
  child(ns: string, ctx?: Record<string, unknown>): Logger {
    return new Logger(ns, {
      level:     this._level,
      ctx:       { ...this._ctx, ...ctx },
      transport: this._transport,
    });
  }

  setLevel(level: LogLevel): void { this._level = level; }
  get level(): LogLevel           { return this._level; }

  /**
   * Wraps an async operation and logs its duration at `debug` level.
   * Always re-throws errors — does not suppress them.
   */
  async time<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const t0 = Date.now();
    try {
      const result = await fn();
      this.debug(label, { ms: Date.now() - t0 });
      return result;
    } catch (e) {
      this.debug(`${label} failed`, { ms: Date.now() - t0 });
      throw e;
    }
  }

  private _emit(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
    if (RANK[level] < RANK[this._level]) return;
    this._write({ level, ns: this.ns, msg, ctx: { ...this._ctx, ...ctx }, ts: Date.now() });
  }

  private _write(record: LogRecord): void {
    if (RANK[record.level] >= RANK[this._level]) this._transport(record);
  }
}

export function createLogger(ns: string, opts?: ConstructorParameters<typeof Logger>[1]): Logger {
  return new Logger(ns, opts);
}
