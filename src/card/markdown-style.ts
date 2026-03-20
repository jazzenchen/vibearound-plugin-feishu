/**
 * Markdown style optimizer for Feishu cards.
 * Adapted from openclaw-lark (MIT).
 */

export function optimizeMarkdownStyle(text: string, cardVersion = 2): string {
  try {
    let r = _optimizeMarkdownStyle(text, cardVersion);
    r = stripInvalidImageKeys(r);
    return r;
  } catch {
    return text;
  }
}

function _optimizeMarkdownStyle(text: string, cardVersion = 2): string {
  const MARK = "___CB_";
  const codeBlocks: string[] = [];
  let r = text.replace(/```[\s\S]*?```/g, (m) => `${MARK}${codeBlocks.push(m) - 1}___`);

  // Heading downgrade: H1→H4, H2~H6→H5
  if (cardVersion >= 2) {
    r = r.replace(/^(#{1,6})\s/gm, (_, hashes: string) => {
      return hashes.length === 1 ? "#### " : "##### ";
    });
  }

  // Ordered list: ensure single space after number
  r = r.replace(/^(\d+)\.\s{2,}/gm, "$1. ");

  // Unordered list: normalize to "- " (skip --- separators)
  r = r.replace(/^([*+])\s/gm, "- ");

  // Table formatting
  r = r.replace(/\|([^|\n]+)/g, (_, cell: string) => {
    const trimmed = cell.trim();
    return `| ${trimmed} `;
  });
  // Add blank lines around tables
  r = r.replace(/([^\n])\n(\|)/g, "$1\n\n$2");
  r = r.replace(/(\|[^\n]*)\n([^\n|])/g, "$1\n\n$2");

  // Restore code blocks
  r = r.replace(new RegExp(`${MARK}(\\d+)___`, "g"), (_, idx) => codeBlocks[Number(idx)] ?? "");

  return r;
}

const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

function stripInvalidImageKeys(text: string): string {
  if (!text.includes("![")) return text;
  return text.replace(IMAGE_RE, (fullMatch, _alt: string, value: string) => {
    if (value.startsWith("img_")) return fullMatch;
    return "";
  });
}
