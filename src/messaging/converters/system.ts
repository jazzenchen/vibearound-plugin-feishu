import type { ContentConverterFn } from "./types.js";
export const convertSystem: ContentConverterFn = (raw) => ({ content: `[system: ${raw}]`, resources: [] });
