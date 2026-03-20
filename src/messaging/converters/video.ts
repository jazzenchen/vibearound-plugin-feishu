import type { ContentConverterFn } from "./types.js";
import { safeParse, formatDuration } from "./utils.js";

export const convertVideo: ContentConverterFn = (raw) => {
  const parsed = safeParse(raw) as { file_key?: string; image_key?: string; duration?: number; file_name?: string } | undefined;
  const fileKey = parsed?.file_key;
  if (!fileKey) return { content: "[video]", resources: [] };
  const duration = parsed?.duration;
  const durationAttr = duration != null ? ` duration="${formatDuration(duration)}"` : "";
  return {
    content: `<video key="${fileKey}"${durationAttr}/>`,
    resources: [{ type: "video", fileKey, coverImageKey: parsed?.image_key, duration: duration ?? undefined }],
  };
};
