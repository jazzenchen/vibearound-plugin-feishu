/**
 * Interactive card builder for Feishu.
 * Adapted from openclaw-lark (MIT), stripped of openclaw deps.
 */

import { optimizeMarkdownStyle } from "./markdown-style.js";

export const STREAMING_ELEMENT_ID = "streaming_content";

// ---------------------------------------------------------------------------
// Card types
// ---------------------------------------------------------------------------

interface FeishuCardElement {
  tag: string;
  [key: string]: unknown;
}

interface FeishuCard {
  config?: Record<string, unknown>;
  header?: Record<string, unknown>;
  elements: FeishuCardElement[];
}

// ---------------------------------------------------------------------------
// Card builders
// ---------------------------------------------------------------------------

/** Build a simple markdown card (v2 schema). */
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

/** Build a streaming card (v2 schema with element_id for updates). */
export function buildStreamingCard(text: string, status: "thinking" | "streaming" | "complete" = "streaming"): Record<string, unknown> {
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

/** Build a card with action buttons (v2 schema). */
export function buildActionCard(
  text: string,
  actions: Array<{ text: string; value: Record<string, unknown>; type?: "primary" | "danger" | "default" }>,
): Record<string, unknown> {
  const optimized = optimizeMarkdownStyle(text);
  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    body: {
      elements: [
        { tag: "markdown", content: optimized, text_align: "left" },
        { tag: "hr" },
        {
          tag: "action",
          actions: actions.map((a) => ({
            tag: "button",
            text: { tag: "plain_text", content: a.text },
            type: a.type ?? "default",
            value: a.value,
          })),
        },
      ],
    },
  };
}

/** Serialize a card object to the JSON string Feishu API expects. */
export function serializeCard(card: Record<string, unknown>): string {
  return JSON.stringify(card);
}
