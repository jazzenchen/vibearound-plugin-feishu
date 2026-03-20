/**
 * VibeAround Plugin Protocol — Type definitions
 *
 * JSON-RPC 2.0 over stdio between Host (Rust) and Plugin (Node.js).
 */

// ============================================================================
// JSON-RPC 2.0 base
// ============================================================================

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

// ============================================================================
// Host → Plugin
// ============================================================================

export interface InitializeParams {
  config: FeishuConfig;
  hostVersion: string;
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: PluginCapabilities;
  botInfo?: { openId: string; name: string };
}

export interface SendTextParams {
  channelId: string;
  text: string;
  replyTo?: string;
}

export interface EditMessageParams {
  channelId: string;
  messageId: string;
  text: string;
}

export interface SendInteractiveParams {
  channelId: string;
  card: Record<string, unknown>;
  replyTo?: string;
}

export interface UpdateInteractiveParams {
  channelId: string;
  messageId: string;
  card: Record<string, unknown>;
}

export interface ReactionParams {
  channelId: string;
  messageId: string;
  emoji: string;
}

// ============================================================================
// Plugin → Host (notifications)
// ============================================================================

export interface OnMessageParams {
  channelId: string;
  messageId: string;
  chatType: "p2p" | "group";
  sender: SenderInfo;
  text: string;
  /** Non-bot @mentions in the message */
  mentions?: Array<{ id: string; name: string }>;
  /** Whether the bot was @-mentioned */
  mentionedBot?: boolean;
  /** Attached resources (images, files, audio, video) */
  resources?: ResourceInfo[];
  replyTo?: string;
  threadId?: string;
  rootId?: string;
}

export interface OnCallbackParams {
  channelId: string;
  callbackId: string;
  sender: SenderInfo;
  data: Record<string, unknown>;
  messageId?: string;
}

export interface OnReactionParams {
  channelId: string;
  messageId: string;
  sender: SenderInfo;
  emoji: string;
}

// ============================================================================
// Shared types
// ============================================================================

export interface FeishuConfig {
  app_id: string;
  app_secret: string;
  domain?: "feishu" | "lark";
  encrypt_key?: string;
  verification_token?: string;
}

export interface SenderInfo {
  id: string;
  name?: string;
  type?: "user" | "bot";
}

export interface ResourceInfo {
  type: "image" | "file" | "audio" | "video";
  fileKey: string;
  fileName?: string;
  duration?: number;
  coverImageKey?: string;
}

export interface PluginCapabilities {
  streaming: boolean;
  interactiveCards: boolean;
  reactions: boolean;
  editMessage: boolean;
  media: boolean;
}
