/**
 * Converter for "merge_forward" message type.
 * Adapted from openclaw-lark (MIT).
 */

import type { ApiMessageItem, ContentConverterFn } from "./types.js";
import { convertMessageContent, buildConvertContextFromItem } from "./content-converter.js";

export const convertMergeForward: ContentConverterFn = async (_raw, ctx) => {
  const { messageId, resolveUserName, batchResolveNames, fetchSubMessages } = ctx;
  if (!fetchSubMessages) return { content: "<forwarded_messages/>", resources: [] };

  try {
    const items = await fetchSubMessages(messageId);
    if (!items.length) return { content: "<forwarded_messages/>", resources: [] };

    // Batch resolve sender names
    const senderIds = [...new Set(items.map((i) => i.sender?.id).filter(Boolean) as string[])];
    let nameMap = new Map<string, string>();
    if (batchResolveNames && senderIds.length > 0) {
      nameMap = await batchResolveNames(senderIds);
    }

    // Build tree from flat list
    const rootItems = items.filter((i) => !i.upper_message_id || i.upper_message_id === messageId);
    const lines: string[] = ["<forwarded_messages>"];

    for (const item of rootItems) {
      const senderId = item.sender?.id ?? "unknown";
      const senderName = nameMap.get(senderId) ?? senderId;
      const subCtx = buildConvertContextFromItem(item, ctx);
      const result = await convertMessageContent(item.msg_type ?? "unknown", item.body?.content ?? "", subCtx);
      const time = item.create_time ? formatTime(item.create_time) : "";
      lines.push(`${time} ${senderName}:`);
      lines.push(`    ${result.content}`);
    }

    lines.push("</forwarded_messages>");
    return { content: lines.join("\n"), resources: [] };
  } catch {
    return { content: "<forwarded_messages/>", resources: [] };
  }
};

function formatTime(ms: string): string {
  const num = parseInt(ms, 10);
  if (isNaN(num)) return "";
  const d = new Date(num);
  return d.toISOString().replace("T", " ").slice(0, 19);
}
