/**
 * Shared utilities for content converters.
 * Copied from openclaw-lark (MIT).
 */

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function safeParse(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 1) return `${ms}ms`;
  if (Number.isInteger(seconds)) return `${seconds}s`;
  return `${seconds.toFixed(1)}s`;
}

export function millisToDatetime(ms: string | number): string {
  const num = Number(ms);
  if (!Number.isFinite(num)) return String(ms);
  const utc8Offset = 8 * 60 * 60 * 1000;
  const d = new Date(num + utc8Offset);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hour = String(d.getUTCHours()).padStart(2, "0");
  const minute = String(d.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}
