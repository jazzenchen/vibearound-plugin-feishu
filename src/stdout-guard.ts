/**
 * stdout-guard.ts — MUST be the first import in main.ts.
 *
 * Intercepts process.stdout.write so Lark SDK debug output never pollutes
 * the ACP JSON-RPC channel.
 *
 * Strategy: pass the chunk through **unchanged** if it starts with `{` (after
 * trimming leading whitespace) — this preserves exact ndjson framing for
 * ACP messages including heartbeats + prompt responses. Anything else is
 * redirected to stderr in full (no per-line split that could desync a
 * multi-chunk write).
 *
 * Note: Web Streams `Writable.toWeb(process.stdout)` emits Uint8Array chunks.
 * We handle both binary and string input.
 */

const _origWrite = process.stdout.write.bind(process.stdout);

process.stdout.write = function (chunk: any, ...args: any[]): boolean {
  const str = typeof chunk === "string"
    ? chunk
    : Buffer.isBuffer(chunk) || chunk instanceof Uint8Array
    ? Buffer.from(chunk).toString("utf-8")
    : String(chunk);

  // Leading whitespace trim only — we do NOT want to lose trailing newlines
  // that ndjson framing depends on.
  let i = 0;
  while (i < str.length && (str[i] === " " || str[i] === "\t" || str[i] === "\n" || str[i] === "\r")) i++;

  if (str[i] === "{") {
    // Pass the chunk through byte-for-byte as the ACP SDK wrote it.
    return _origWrite(chunk, ...args);
  }

  // Non-JSON noise — route to stderr. Trim once for readability.
  const trimmed = str.trim();
  if (trimmed) {
    process.stderr.write("[stdout-guard] " + trimmed + "\n");
  }
  return true;
} as any;
