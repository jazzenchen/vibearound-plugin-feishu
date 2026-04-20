#!/usr/bin/env node
/**
 * VibeAround Feishu Plugin — ACP Client
 *
 * Spawned by the Rust host as a child process.
 * Communicates via ACP protocol (JSON-RPC 2.0 over stdio).
 *
 * Plugin = ACP Client, Host = ACP Agent.
 * Plugin sends prompt() with chatId as sessionId.
 * Host streams back via sessionUpdate notifications.
 */

// MUST be first import — intercepts process.stdout.write before Lark SDK loads
import "./stdout-guard.js";

import { runChannelPlugin } from "@vibearound/plugin-channel-sdk";

import { FeishuClient } from "./lark-client.js";
import { FeishuGateway } from "./gateway.js";
import { AgentStreamHandler } from "./agent-stream.js";
import type { FeishuConfig } from "./protocol.js";

runChannelPlugin({
  name: "vibearound-feishu",
  version: "0.1.0",
  requiredConfig: ["app_id", "app_secret"],
  createBot: ({ config, agent, log, cacheDir }) => {
    const feishuConfig = config as unknown as FeishuConfig;
    log("info", `appId=${feishuConfig.app_id}`);
    const client = new FeishuClient(feishuConfig);
    return new FeishuGateway(client, agent, cacheDir);
  },
  afterCreate: async (gateway) => {
    // probe() calls GET /open-apis/bot/v3/info to get botOpenId + botName.
    // Must run before start() — start() blocks on WebSocket listen.
    const result = await gateway.client.probe();
    if (!result.ok) throw new Error(`Bot probe failed: ${result.error}`);
  },
  createRenderer: (gateway, log, verbose) =>
    new AgentStreamHandler(gateway.client, log, verbose),
  // Heartbeat health check — probe() re-fetches bot identity via Feishu REST,
  // exercising the tenant access token refresh path. If this fails, our
  // token is dead or the platform is unreachable.
  healthCheck: async (gateway) => {
    try {
      const r = await gateway.client.probe();
      return r.ok === true;
    } catch {
      return false;
    }
  },
});
