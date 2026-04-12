/**
 * Feishu V2 card builders.
 */

import { optimizeMarkdownStyle } from "./markdown-style.js";

export const STREAMING_ELEMENT_ID = "streaming_content";

/** Build a markdown card. */
export function buildMarkdownCard(text: string): Record<string, unknown> {
  const optimized = optimizeMarkdownStyle(text);
  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    body: {
      elements: [
        {
          tag: "markdown",
          content: optimized,
          text_align: "left",
          element_id: STREAMING_ELEMENT_ID,
        },
      ],
    },
  };
}

/** Build a streaming card (with element_id for in-place updates). */
export function buildStreamingCard(text: string): Record<string, unknown> {
  const optimized = optimizeMarkdownStyle(text);
  return {
    schema: "2.0",
    config: { wide_screen_mode: true, update_multi: true },
    body: {
      elements: [
        {
          tag: "markdown",
          content: optimized,
          text_align: "left",
          element_id: STREAMING_ELEMENT_ID,
        },
      ],
    },
  };
}

/** Build a card with action buttons. */
export function buildActionCard(
  text: string,
  actions: Array<{ text: string; value: Record<string, unknown>; type?: "primary" | "danger" | "default" }>,
): Record<string, unknown> {
  const optimized = optimizeMarkdownStyle(text);
  const elements: Record<string, unknown>[] = [
    { tag: "markdown", content: optimized, text_align: "left" },
    { tag: "hr" },
  ];
  for (const a of actions) {
    elements.push({
      tag: "button",
      text: { tag: "plain_text", content: a.text },
      type: a.type ?? "default",
      behaviors: [{ type: "callback", value: a.value }],
    });
  }
  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    body: { elements },
  };
}
