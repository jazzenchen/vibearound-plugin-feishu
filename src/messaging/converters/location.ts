import type { ContentConverterFn } from "./types.js";
import { safeParse } from "./utils.js";

export const convertLocation: ContentConverterFn = (raw) => {
  const parsed = safeParse(raw) as { name?: string; latitude?: number; longitude?: number } | undefined;
  if (!parsed) return { content: "[location]", resources: [] };
  const name = parsed.name ?? "unknown";
  const coords = parsed.latitude != null && parsed.longitude != null ? ` (${parsed.latitude}, ${parsed.longitude})` : "";
  return { content: `[location: ${name}${coords}]`, resources: [] };
};
