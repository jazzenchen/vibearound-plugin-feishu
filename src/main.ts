#!/usr/bin/env node
/**
 * VibeAround Feishu Plugin — entry point
 *
 * Spawned by the Rust host as a child process.
 * Communicates via stdio JSON-RPC 2.0.
 *
 * Lifecycle:
 *   Host spawns → "initialize" with config
 *   → Plugin probes bot identity + starts WebSocket gateway
 *   → Inbound events → on_message / on_reaction / on_callback notifications
 *   → Host sends outbound requests (send_text, edit_message, etc.)
 *   → Host sends "shutdown" → Plugin exits
 */

import { StdioTransport } from "./stdio.js";
import { FeishuClient } from "./lark-client.js";
import { FeishuGateway } from "./gateway.js";
import type {
  FeishuConfig,
  InitializeParams,
  InitializeResult,
  SendTextParams,
  EditMessageParams,
  SendInteractiveParams,
  UpdateInteractiveParams,
  ReactionParams,
} from "./protocol.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const transport = new StdioTransport();
let client: FeishuClient | null = null;
let gateway: FeishuGateway | null = null;

function requireClient(): FeishuClient {
  if (!client) throw new Error("Plugin not initialized");
  return client;
}

/** Strip "feishu:" prefix from channel ID to get raw chat_id. */
function parseChatId(channelId: string): string {
  return channelId.replace(/^feishu:/, "");
}

// ---------------------------------------------------------------------------
// Host → Plugin: initialize
// ---------------------------------------------------------------------------

transport.onRequest("initialize", async (params) => {
  const { config, hostVersion } = params as unknown as InitializeParams;
  transport.log("info", `initialize: hostVersion=${hostVersion}`);

  // Validate config
  const cfg = config as FeishuConfig;
  if (!cfg.app_id || !cfg.app_secret) {
    throw new Error("Missing required config: app_id and app_secret");
  }

  // Create SDK client
  client = new FeishuClient(cfg);

  // Start gateway in background (includes probe + WebSocket)
  gateway = new FeishuGateway(client, transport);
  gateway.start().catch((err) => {
    transport.log("error", `gateway failed: ${err}`);
  });

  // Return immediately — bot identity will be available after probe completes
  const result: InitializeResult = {
    protocolVersion: "0.1.0",
    capabilities: {
      streaming: true,
      interactiveCards: true,
      reactions: true,
      editMessage: true,
      media: true,
    },
  };
  return result;
});

// ---------------------------------------------------------------------------
// Host → Plugin: send_text
// ---------------------------------------------------------------------------

transport.onRequest("send_text", async (params) => {
  const { channelId, text, replyTo } = params as unknown as SendTextParams;
  const c = requireClient();
  const chatId = parseChatId(channelId);

  let messageId: string | undefined;
  if (replyTo) {
    messageId = await c.reply(replyTo, text);
  } else {
    messageId = await c.sendText(chatId, text);
  }

  return { messageId: messageId ?? null };
});

// ---------------------------------------------------------------------------
// Host → Plugin: edit_message
// ---------------------------------------------------------------------------

transport.onRequest("edit_message", async (params) => {
  const { messageId, text } = params as unknown as EditMessageParams;
  await requireClient().editMessage(messageId, text);
  return {};
});

// ---------------------------------------------------------------------------
// Host → Plugin: send_interactive
// ---------------------------------------------------------------------------

transport.onRequest("send_interactive", async (params) => {
  const { channelId, card, replyTo } = params as unknown as SendInteractiveParams;
  const chatId = parseChatId(channelId);
  const messageId = await requireClient().sendInteractive(chatId, card, replyTo);
  return { messageId: messageId ?? null };
});

// ---------------------------------------------------------------------------
// Host → Plugin: update_interactive
// ---------------------------------------------------------------------------

transport.onRequest("update_interactive", async (params) => {
  const { messageId, card } = params as unknown as UpdateInteractiveParams;
  await requireClient().updateInteractive(messageId, card);
  return {};
});

// ---------------------------------------------------------------------------
// Host → Plugin: add_reaction / remove_reaction
// ---------------------------------------------------------------------------

transport.onRequest("add_reaction", async (params) => {
  const { messageId, emoji } = params as unknown as ReactionParams;
  const reactionId = await requireClient().addReaction(messageId, emoji);
  return { reactionId: reactionId ?? null };
});

transport.onRequest("remove_reaction", async (params) => {
  const { messageId, emoji } = params as unknown as ReactionParams;
  // Note: our protocol sends emoji, but Feishu API needs reaction_id.
  // The host should track reaction_id from add_reaction response.
  // For now, treat emoji as reaction_id (host-side mapping needed).
  await requireClient().removeReaction(messageId, emoji);
  return {};
});

// ---------------------------------------------------------------------------
// Host → Plugin: shutdown
// ---------------------------------------------------------------------------

transport.onRequest("shutdown", async () => {
  transport.log("info", "shutdown requested");
  gateway?.stop();
  client?.disconnect();
  setTimeout(() => process.exit(0), 300);
  return {};
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

transport.log("info", "VibeAround Feishu plugin starting...");
transport.start();

process.on("SIGTERM", () => {
  gateway?.stop();
  client?.disconnect();
  process.exit(0);
});

process.on("SIGINT", () => {
  gateway?.stop();
  client?.disconnect();
  process.exit(0);
});

// Keep alive
process.stdin.resume();
