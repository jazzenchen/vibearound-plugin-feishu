/**
 * @mention utilities for inbound/outbound messages.
 * Adapted from openclaw-lark (MIT).
 */

import type { MentionInfo, MessageContext } from "../types.js";
import { escapeRegExp } from "../converters/utils.js";

export type { MentionInfo } from "../types.js";

/** Whether the bot was @-mentioned. */
export function mentionedBot(ctx: MessageContext): boolean {
  return ctx.mentions.some((m) => m.isBot);
}

/** All non-bot mentions. */
export function nonBotMentions(ctx: MessageContext): MentionInfo[] {
  return ctx.mentions.filter((m) => !m.isBot);
}

/** Format a mention for card content: <at id=open_id></at> */
function formatMentionForCard(m: MentionInfo): string {
  return `<at id="${m.openId}">${m.name}</at>`;
}

/** Build outbound text with @mentions prepended. */
export function buildMentionedMessage(targets: MentionInfo[], message: string): string {
  if (targets.length === 0) return message;
  const mentionTags = targets.map((m) => `@${m.name}`).join(" ");
  return `${mentionTags} ${message}`;
}

/** Build outbound card content with <at> tags prepended. */
export function buildMentionedCardContent(targets: MentionInfo[], message: string): string {
  if (targets.length === 0) return message;
  const mentionTags = targets.map(formatMentionForCard).join(" ");
  return `${mentionTags}\n${message}`;
}
