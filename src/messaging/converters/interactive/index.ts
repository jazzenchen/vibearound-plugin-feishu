/**
 * Converter for "interactive" (card) message type.
 * Simplified — extracts text content from card elements.
 */

import type { ContentConverterFn } from "../types.js";
import { safeParse } from "../utils.js";

export const convertInteractive: ContentConverterFn = (raw) => {
  const parsed = safeParse(raw);
  if (!parsed || typeof parsed !== "object") return { content: "[card]", resources: [] };

  const card = parsed as Record<string, unknown>;
  const parts: string[] = [];

  // Extract header title
  const header = card.header as Record<string, unknown> | undefined;
  if (header?.title) {
    const title = header.title as Record<string, unknown>;
    if (title.content) parts.push(`**${title.content}**`);
  }

  // Extract text from body elements
  const body = card.body as Record<string, unknown> | undefined;
  const elements = (body?.elements ?? card.elements) as unknown[] | undefined;
  if (elements) {
    for (const el of elements) {
      extractText(el, parts);
    }
  }

  return { content: parts.join("\n") || "[card]", resources: [] };
};

function extractText(el: unknown, parts: string[]): void {
  if (!el || typeof el !== "object") return;
  const obj = el as Record<string, unknown>;

  // div with text
  if (obj.tag === "div" && obj.text) {
    const text = obj.text as Record<string, unknown>;
    if (text.content) parts.push(String(text.content));
  }

  // markdown element
  if (obj.tag === "markdown" || obj.tag === "lark_md") {
    if (obj.content) parts.push(String(obj.content));
  }

  // plain_text
  if (obj.tag === "plain_text") {
    if (obj.content) parts.push(String(obj.content));
  }

  // Recurse into nested elements
  if (Array.isArray(obj.elements)) {
    for (const child of obj.elements) extractText(child, parts);
  }
  if (Array.isArray(obj.columns)) {
    for (const col of obj.columns) {
      const colObj = col as Record<string, unknown>;
      if (Array.isArray(colObj.elements)) {
        for (const child of colObj.elements) extractText(child, parts);
      }
    }
  }
}
