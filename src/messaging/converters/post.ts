/**
 * Converter for "post" (rich text) message type.
 * Adapted from openclaw-lark (MIT).
 */

import type { ResourceDescriptor } from "../types.js";
import type { ContentConverterFn, ConvertContext, PostElement } from "./types.js";
import { resolveMentions } from "./content-converter.js";
import { safeParse } from "./utils.js";

const LOCALE_PRIORITY = ["zh_cn", "en_us", "ja_jp"] as const;

interface PostBody { title?: string; content?: PostElement[][] }

function unwrapPost(parsed: unknown): PostBody | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj.content)) return obj as PostBody;
  for (const locale of LOCALE_PRIORITY) {
    const localeBody = obj[locale];
    if (localeBody && typeof localeBody === "object" && Array.isArray((localeBody as PostBody).content)) {
      return localeBody as PostBody;
    }
  }
  return undefined;
}

export const convertPost: ContentConverterFn = (raw, ctx) => {
  const parsed = safeParse(raw);
  const body = unwrapPost(parsed);
  if (!body?.content) return { content: "[post]", resources: [] };

  const resources: ResourceDescriptor[] = [];
  const lines: string[] = [];

  if (body.title) lines.push(`**${body.title}**\n`);

  for (const paragraph of body.content) {
    const parts: string[] = [];
    for (const el of paragraph) {
      parts.push(convertElement(el, ctx, resources));
    }
    lines.push(parts.join(""));
  }

  const content = resolveMentions(lines.join("\n"), ctx);
  return { content, resources };
};

function convertElement(el: PostElement, ctx: ConvertContext, resources: ResourceDescriptor[]): string {
  switch (el.tag) {
    case "text":
      return applyStyles(el.text ?? "", el.style);
    case "a":
      return el.href ? `[${el.text ?? "link"}](${el.href})` : (el.text ?? "");
    case "at": {
      const mention = el.user_id ? ctx.mentions.get(el.user_id) ?? ctx.mentionsByOpenId.get(el.user_id) : undefined;
      return mention ? `@${mention.name}` : (el.user_name ? `@${el.user_name}` : "@unknown");
    }
    case "img":
      if (el.image_key) {
        resources.push({ type: "image", fileKey: el.image_key });
        return `![image](${el.image_key})`;
      }
      return "[image]";
    case "media":
      if (el.file_key) {
        resources.push({ type: "file", fileKey: el.file_key });
        return `<file key="${el.file_key}"/>`;
      }
      return "[media]";
    case "code_block":
      return `\n\`\`\`${el.language ?? ""}\n${el.text ?? ""}\n\`\`\`\n`;
    case "hr":
      return "\n---\n";
    default:
      return el.text ?? "";
  }
}

function applyStyles(text: string, style?: string[]): string {
  if (!style || style.length === 0 || !text) return text;
  let result = text;
  if (style.includes("bold")) result = `**${result}**`;
  if (style.includes("italic")) result = `*${result}*`;
  if (style.includes("underline")) result = `<u>${result}</u>`;
  if (style.includes("lineThrough")) result = `~~${result}~~`;
  if (style.includes("codeInline")) result = `\`${result}\``;
  return result;
}
