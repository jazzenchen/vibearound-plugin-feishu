import type { ContentConverterFn } from "./types.js";
import { safeParse } from "./utils.js";

export const convertSticker: ContentConverterFn = (raw) => {
  const parsed = safeParse(raw) as { file_key?: string } | undefined;
  return { content: parsed?.file_key ? `[sticker: ${parsed.file_key}]` : "[sticker]", resources: [] };
};
