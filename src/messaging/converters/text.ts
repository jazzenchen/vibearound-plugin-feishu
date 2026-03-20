import type { ContentConverterFn } from "./types.js";
import { resolveMentions } from "./content-converter.js";
import { safeParse } from "./utils.js";

export const convertText: ContentConverterFn = (raw, ctx) => {
  const parsed = safeParse(raw) as { text?: string } | undefined;
  const text = parsed?.text ?? raw;
  return { content: resolveMentions(text, ctx), resources: [] };
};
