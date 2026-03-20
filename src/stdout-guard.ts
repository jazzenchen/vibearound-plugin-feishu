/**
 * stdout-guard.ts — MUST be the first import in main.ts.
 *
 * 1. Intercepts process.stdout.write so that only JSON lines (starting with '{')
 *    pass through. Everything else is redirected to stderr.
 *    This prevents Lark SDK internal debug output (TLS socket dumps, etc.)
 *    from polluting the stdio JSON-RPC channel.
 *
 * 2. Redirects all console.* methods to stderr with proper object serialization
 *    (handles circular references via util.inspect).
 *
 * 3. Provides plugLog() — sends structured log via JSON-RPC "plugin_log"
 *    notification when a transport is attached, falls back to stderr otherwise.
 */

import { inspect } from "node:util";

// ---------------------------------------------------------------------------
// stdout filter — only JSON lines pass through
// ---------------------------------------------------------------------------

const _origWrite = process.stdout.write.bind(process.stdout);

process.stdout.write = function (chunk: any, ..._args: any[]): boolean {
  const str = typeof chunk === "string" ? chunk : chunk.toString();
  for (const line of str.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("{")) {
      _origWrite(line + "\n");
    } else {
      process.stderr.write("[stdout-guard] " + line + "\n");
    }
  }
  return true;
} as any;

// ---------------------------------------------------------------------------
// Serialize helper — handles circular refs, AxiosError, etc.
// ---------------------------------------------------------------------------

function serialize(v: unknown): string {
  if (typeof v === "string") return v;
  // Extract useful info from AxiosError before generic serialization
  if (v && typeof v === "object" && "isAxiosError" in v) {
    return formatAxiosError(v as any);
  }
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    // Circular reference or other — fall back to util.inspect
    return inspect(v, { depth: 3, colors: false, maxStringLength: 2000 });
  }
}

/** Extract readable info from an AxiosError. */
function formatAxiosError(err: any): string {
  const parts: string[] = [`AxiosError: ${err.message ?? "unknown"}`];
  if (err.response) {
    parts.push(`status=${err.response.status}`);
    const data = err.response.data;
    if (data) {
      try {
        const s = typeof data === "string" ? data : JSON.stringify(data);
        parts.push(`body=${s}`);
      } catch {
        parts.push(`body=${inspect(data, { depth: 2, colors: false })}`);
      }
    }
  }
  if (err.config?.url) parts.push(`url=${err.config.url}`);
  return parts.join(" | ");
}

// ---------------------------------------------------------------------------
// plugin_log transport hook — set by main.ts after StdioTransport is ready
// ---------------------------------------------------------------------------

type LogSink = (level: string, message: string) => void;
let _logSink: LogSink | null = null;

/** Attach a JSON-RPC transport sink for plugin_log notifications. */
export function setLogSink(sink: LogSink): void {
  _logSink = sink;
}

/** Send a structured log. Goes via JSON-RPC if transport attached, else stderr. */
export function plugLog(level: string, message: string): void {
  if (_logSink) {
    _logSink(level, message);
  }
  // Always write to stderr as well (host reads stderr for debug)
  process.stderr.write(`[feishu-plugin][${level}] ${message}\n`);
}

// ---------------------------------------------------------------------------
// Redirect all console.* to stderr (with proper serialization)
// ---------------------------------------------------------------------------

console.log = (...args: unknown[]) => { process.stderr.write(args.map(serialize).join(" ") + "\n"); };
console.info = console.log;
console.warn = (...args: unknown[]) => {
  const msg = args.map(serialize).join(" ");
  process.stderr.write(`[warn] ${msg}\n`);
  _logSink?.("warn", msg);
};
console.debug = (...args: unknown[]) => { process.stderr.write("[debug] " + args.map(serialize).join(" ") + "\n"); };
console.error = (...args: unknown[]) => {
  const msg = args.map(serialize).join(" ");
  process.stderr.write(`[error] ${msg}\n`);
  _logSink?.("error", msg);
};
