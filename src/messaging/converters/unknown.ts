import type { ContentConverterFn } from "./types.js";
import { safeParse } from "./utils.js";

export const convertUnknown: ContentConverterFn = (raw) => {
  const parsed = safeParse(raw);
  if (parsed && typeof parsed === "object") {
    const text = (parsed as Record<string, unknown>).text;
    if (typeof text === "string") return { content: text, resources: [] };
  }
  return { content: "[unsupported message]", resources: [] };
};
