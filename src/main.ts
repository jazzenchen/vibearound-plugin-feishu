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
  createRenderer: (gateway, log, verbose) =>
    new AgentStreamHandler(gateway.client, log, verbose),
});
