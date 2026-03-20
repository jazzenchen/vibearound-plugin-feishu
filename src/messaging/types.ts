/**
 * Messaging type definitions for the Feishu plugin.
 * Adapted from openclaw-lark, stripped of openclaw dependencies.
 */

// ---------------------------------------------------------------------------
// Feishu event types (from WebSocket)
// ---------------------------------------------------------------------------

export interface FeishuMessageEvent {
  sender: {
    sender_id: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
    sender_type?: string;
    tenant_key?: string;
  };
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    create_time?: string;
    update_time?: string;
    chat_id: string;
    thread_id?: string;
    chat_type: "p2p" | "group";
    message_type: string;
    content: string;
    mentions?: Array<{
      key: string;
      id: { open_id?: string; user_id?: string; union_id?: string };
      name: string;
      tenant_key?: string;
    }>;
    user_agent?: string;
  };
}

export interface FeishuReactionCreatedEvent {
  message_id: string;
  chat_id?: string;
  chat_type?: "p2p" | "group" | "private";
  reaction_type?: { emoji_type?: string };
  operator_type?: string;
  user_id?: { open_id?: string; user_id?: string; union_id?: string };
  action_time?: string;
}

export interface FeishuBotAddedEvent {
  chat_id: string;
  operator_id: { open_id?: string; user_id?: string; union_id?: string };
  name?: string;
}

// ---------------------------------------------------------------------------
// Message context (parsed inbound message)
// ---------------------------------------------------------------------------

export interface MentionInfo {
  key: string;
  openId: string;
  name: string;
  isBot: boolean;
}

export interface ResourceDescriptor {
  type: "image" | "file" | "audio" | "video";
  fileKey: string;
  fileName?: string;
  duration?: number;
  coverImageKey?: string;
}

export interface MessageContext {
  messageId: string;
  chatId: string;
  chatType: "p2p" | "group";
  senderId: string;
  senderType: "user" | "bot";
  text: string;
  mentions: MentionInfo[];
  resources: ResourceDescriptor[];
  replyToMessageId?: string;
  threadId?: string;
  rootId?: string;
  createTime?: string;
}

// ---------------------------------------------------------------------------
// Outbound types
// ---------------------------------------------------------------------------

export interface FeishuSendResult {
  messageId: string;
  chatId: string;
  warning?: string;
}
