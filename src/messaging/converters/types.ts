/**
 * Converter types — stripped of openclaw dependencies.
 */

import type { MentionInfo, ResourceDescriptor } from "../types.js";

export interface ApiMessageItem {
  message_id?: string;
  msg_type?: string;
  create_time?: string;
  upper_message_id?: string;
  body?: { content?: string };
  sender?: { id?: string; sender_type?: string };
  mentions?: Array<{ key: string; id: unknown; name?: string }>;
  parent_id?: string;
  thread_id?: string;
  deleted?: boolean;
  updated?: boolean;
}

export interface ConvertContext {
  mentions: Map<string, MentionInfo>;
  mentionsByOpenId: Map<string, MentionInfo>;
  messageId: string;
  botOpenId?: string;
  accountId?: string;
  resolveUserName?: (openId: string) => Promise<string | undefined>;
  batchResolveNames?: (openIds: string[]) => Promise<Map<string, string>>;
  fetchSubMessages?: (messageId: string) => Promise<ApiMessageItem[]>;
}

export interface ConvertResult {
  content: string;
  resources: ResourceDescriptor[];
}

export type ContentConverterFn = (
  raw: string,
  ctx: ConvertContext,
) => ConvertResult | Promise<ConvertResult>;

export interface PostElement {
  tag: string;
  text?: string;
  href?: string;
  image_key?: string;
  file_key?: string;
  user_id?: string;
  user_name?: string;
  style?: string[];
  language?: string;
  un_escape?: boolean;
}
