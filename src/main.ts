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
 *   → Host sends agent event notifications (agent_start, agent_token, agent_end, etc.)
 *   → Host sends "shutdown" → Plugin exits
 */

// MUST be first import — intercepts stdout before Lark SDK loads
import "./stdout-guard.js";
import { setLogSink } from "./stdout-guard.js";

import { StdioTransport } from "./stdio.js";
import { FeishuClient } from "./lark-client.js";
import { FeishuGateway } from "./gateway.js";
import { AgentStreamHandler } from "./agent-stream.js";
import type {
  FeishuConfig,
  InitializeParams,
  InitializeResult,
} from "./protocol.js";

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

const transport = new StdioTransport();

// Wire console.error/warn from stdout-guard.ts into JSON-RPC plugin_log
setLogSink((level, message) => {
  transport.notify("plugin_log", { level, message });
});

let client: FeishuClient | null = null;
let gateway: FeishuGateway | null = null;
let streamHandler: AgentStreamHandler | null = null;

function log(level: string, msg: string): void {
  process.stderr.write(`[feishu-plugin][${level}] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Host → Plugin: initialize
// ---------------------------------------------------------------------------

transport.onRequest("initialize", async (params) => {
  const { config, hostVersion } = params as unknown as InitializeParams;
  const cfg = config as FeishuConfig;

  log("info", `initialize hostVersion=${hostVersion} appId=${cfg.app_id}`);

  // Create Feishu client
  client = new FeishuClient(cfg);
  await client.probe();

  // Create AgentStreamHandler
  streamHandler = new AgentStreamHandler(client, log);

  // Start WebSocket gateway
  gateway = new FeishuGateway(client, transport);
  gateway.start();

  const result: InitializeResult = {
    protocolVersion: "0.2.0",
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
// Host → Plugin: agent event notifications (from MessageHub)
// ---------------------------------------------------------------------------

transport.onNotification("agent_start", (params) => {
  streamHandler?.onAgentStart(params);
});

transport.onNotification("agent_thinking", (params) => {
  streamHandler?.onAgentThinking(params);
});

transport.onNotification("agent_token", (params) => {
  streamHandler?.onAgentToken(params);
});

transport.onNotification("agent_text", (params) => {
  streamHandler?.onAgentText(params);
});

transport.onNotification("agent_tool_use", (params) => {
  streamHandler?.onAgentToolUse(params);
});

transport.onNotification("agent_tool_result", (params) => {
  streamHandler?.onAgentToolResult(params);
});

transport.onNotification("agent_end", (params) => {
  streamHandler?.onAgentEnd(params);
});

transport.onNotification("agent_error", (params) => {
  streamHandler?.onAgentError(params);
});

transport.onNotification("send_system_text", (params) => {
  streamHandler?.onSendSystemText(params);
});

// ---------------------------------------------------------------------------
// Host → Plugin: shutdown
// ---------------------------------------------------------------------------

transport.onRequest("shutdown", async () => {
  log("info", "shutdown requested");
  gateway?.stop();
  client?.disconnect();
  setTimeout(() => process.exit(0), 200);
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Start listening
// ---------------------------------------------------------------------------

transport.start();
log("info", "plugin started, waiting for initialize...");
