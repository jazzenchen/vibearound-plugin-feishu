/**
 * Content converter — orchestrates message type → text conversion.
 * Adapted from openclaw-lark (MIT), stripped of openclaw deps.
 */

import type { MentionInfo } from "../types.js";
import { converters } from "./index.js";
import { escapeRegExp } from "./utils.js";
import type { ApiMessageItem, ConvertContext, ConvertResult } from "./types.js";

export type { ApiMessageItem, ConvertContext, ConvertResult, ContentConverterFn } from "./types.js";

/**
 * Convert raw message content to AI-friendly text + resource descriptors.
 */
export async function convertMessageContent(
  msgType: string,
  rawContent: string,
  ctx: ConvertContext,
): Promise<ConvertResult> {
  const converter = converters.get(msgType) ?? converters.get("unknown");
  if (!converter) return { content: `[${msgType}]`, resources: [] };
  return converter(rawContent, ctx);
}

/**
 * Build a ConvertContext from an API message item (for merge_forward sub-messages).
 */
export function buildConvertContextFromItem(
  item: ApiMessageItem,
  parentCtx: ConvertContext,
): ConvertContext {
  const mentions = new Map<string, MentionInfo>();
  const mentionsByOpenId = new Map<string, MentionInfo>();

  if (item.mentions) {
    for (const m of item.mentions) {
      const openId = (m.id as { open_id?: string })?.open_id ?? "";
      const info: MentionInfo = {
        key: m.key,
        openId,
        name: m.name ?? "",
        isBot: openId === parentCtx.botOpenId,
      };
      mentions.set(m.key, info);
      if (openId) mentionsByOpenId.set(openId, info);
    }
  }

  return {
    mentions,
    mentionsByOpenId,
    messageId: item.message_id ?? "",
    botOpenId: parentCtx.botOpenId,
    accountId: parentCtx.accountId,
    resolveUserName: parentCtx.resolveUserName,
    batchResolveNames: parentCtx.batchResolveNames,
    fetchSubMessages: parentCtx.fetchSubMessages,
  };
}

/**
 * Resolve @mention keys in text:
 * - Bot mentions → stripped
 * - User mentions → replaced with @name
 */
export function resolveMentions(text: string, ctx: ConvertContext): string {
  if (ctx.mentions.size === 0) return text;
  let result = text;
  for (const [key, info] of ctx.mentions) {
    if (info.isBot) {
      result = result.replace(new RegExp(`@${escapeRegExp(info.name)}\\s*`, "g"), "").trim();
      result = result.replace(new RegExp(escapeRegExp(key) + "\\s*", "g"), "").trim();
    } else {
      result = result.replace(new RegExp(escapeRegExp(key), "g"), `@${info.name}`);
    }
  }
  return result;
}
