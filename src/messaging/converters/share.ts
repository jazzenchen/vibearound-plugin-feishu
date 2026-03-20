import type { ContentConverterFn } from "./types.js";
import { safeParse } from "./utils.js";

export const convertShareChat: ContentConverterFn = (raw) => {
  const parsed = safeParse(raw) as { chat_id?: string } | undefined;
  return { content: parsed?.chat_id ? `[shared chat: ${parsed.chat_id}]` : "[shared chat]", resources: [] };
};

export const convertShareUser: ContentConverterFn = (raw) => {
  const parsed = safeParse(raw) as { user_id?: string } | undefined;
  return { content: parsed?.user_id ? `[shared contact: ${parsed.user_id}]` : "[shared contact]", resources: [] };
};
