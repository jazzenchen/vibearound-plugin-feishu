/**
 * Download and cache media resources from Feishu messages.
 */

import fs from "node:fs/promises";
import path from "node:path";

import type { FeishuClient } from "../lark-client.js";
import type { ResourceDescriptor } from "./types.js";

function log(level: string, msg: string): void {
  process.stderr.write(`[feishu-media][${level}] ${msg}\n`);
}

export interface DownloadedResource {
  type: "image" | "file" | "audio" | "video";
  path: string;
  mimeType: string;
  fileName?: string;
}

function buildCachePath(params: {
  cacheDir: string;
  chatId: string;
  fileKey: string;
  ext: string;
}): string {
  const { cacheDir, chatId, fileKey, ext } = params;
  return path.join(cacheDir, "feishu", chatId, `${fileKey}${ext}`);
}

async function isCached(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

const TYPE_TO_EXT: Record<string, string> = {
  image: ".jpg",
  file: ".bin",
  audio: ".mp3",
  video: ".mp4",
};

const TYPE_TO_MIME: Record<string, string> = {
  image: "image/jpeg",
  file: "application/octet-stream",
  audio: "audio/mpeg",
  video: "video/mp4",
};

/**
 * Download and cache a single message resource.
 */
export async function downloadMessageResource(params: {
  client: FeishuClient;
  messageId: string;
  resource: ResourceDescriptor;
  cacheDir: string;
  chatId: string;
}): Promise<DownloadedResource | null> {
  const { client, messageId, resource, cacheDir, chatId } = params;
  const { type, fileKey, fileName } = resource;

  // Determine ext from fileName if available, otherwise use defaults
  const ext = fileName && fileName.includes(".")
    ? `.${fileName.split(".").pop()}`
    : TYPE_TO_EXT[type] ?? ".bin";

  const cachePath = buildCachePath({ cacheDir, chatId, fileKey, ext });

  if (await isCached(cachePath)) {
    log("debug", `cache hit: ${cachePath}`);
    return {
      type,
      path: cachePath,
      mimeType: TYPE_TO_MIME[type] ?? "application/octet-stream",
      fileName,
    };
  }

  // Feishu API uses "image" or "file" as the resource type
  const apiType = type === "image" ? "image" : "file";

  try {
    log("debug", `downloading ${type} fileKey=${fileKey} messageId=${messageId}`);
    const buf = await client.downloadResource(messageId, fileKey, apiType);
    log("debug", `downloaded ${buf.length} bytes for ${fileKey}`);

    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, buf);
    log("debug", `cached to ${cachePath}`);

    return {
      type,
      path: cachePath,
      mimeType: TYPE_TO_MIME[type] ?? "application/octet-stream",
      fileName,
    };
  } catch (err) {
    log("error", `download failed for ${type} fileKey=${fileKey}: ${String(err)}`);
    return null;
  }
}
