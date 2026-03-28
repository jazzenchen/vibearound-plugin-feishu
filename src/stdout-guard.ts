/**
 * stdout-guard.ts — MUST be the first import in main.ts.
 *
 * Intercepts process.stdout.write so that only JSON lines (starting with '{')
 * pass through. Everything else is redirected to stderr.
 * This prevents Lark SDK debug output from polluting the ACP JSON-RPC channel.
 *
 * Note: The ACP SDK uses Web Streams (Writable.toWeb) which may write
 * Uint8Array/Buffer chunks. We must handle both string and binary data.
 */

const _origWrite = process.stdout.write.bind(process.stdout);

process.stdout.write = function (chunk: any, ...args: any[]): boolean {
  // Convert to string if needed
  const str = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) || chunk instanceof Uint8Array
    ? Buffer.from(chunk).toString("utf-8")
    : String(chunk);

  for (const line of str.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("{")) {
      // JSON line — pass through as original chunk format
      _origWrite(line + "\n");
    } else {
      process.stderr.write("[stdout-guard] " + line + "\n");
    }
  }
  return true;
} as any;
