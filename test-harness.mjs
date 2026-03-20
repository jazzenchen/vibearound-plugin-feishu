#!/usr/bin/env node
/**
 * Interactive test harness for the Feishu plugin.
 * Spawns the plugin, sends initialize, waits for messages,
 * and can send replies.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const plugin = spawn("node", ["dist/main.js"], {
  cwd: import.meta.dirname,
  stdio: ["pipe", "pipe", "pipe"],
});

// Forward stderr to console
plugin.stderr.on("data", (data) => {
  process.stderr.write(`\x1b[90m${data}\x1b[0m`);
});

// Read stdout line by line
const rl = createInterface({ input: plugin.stdout, terminal: false });
rl.on("line", (line) => {
  try {
    const msg = JSON.parse(line);

    // on_message notification — print it nicely
    if (msg.method === "on_message") {
      const p = msg.params;
      console.log(`\n\x1b[36m📨 Message from ${p.sender?.id} in ${p.channelId}\x1b[0m`);
      console.log(`   Text: ${p.text}`);
      if (p.mentionedBot) console.log(`   🤖 Bot was @mentioned`);
      if (p.mentions?.length) console.log(`   @mentions: ${p.mentions.map(m => m.name).join(", ")}`);
      if (p.resources?.length) console.log(`   📎 Resources: ${JSON.stringify(p.resources)}`);

      // Auto-reply with send_text
      const chatId = p.channelId;
      const replyText = `Echo: ${p.text}`;
      const req = {
        jsonrpc: "2.0",
        id: Date.now(),
        method: "send_text",
        params: { channelId: chatId, text: replyText, replyTo: p.messageId },
      };
      console.log(`\x1b[33m📤 Sending reply: "${replyText}"\x1b[0m`);
      plugin.stdin.write(JSON.stringify(req) + "\n");
    } else if (msg.result !== undefined || msg.error) {
      // Response to our request
      if (msg.error) {
        console.log(`\x1b[31m❌ Error: ${JSON.stringify(msg.error)}\x1b[0m`);
      } else {
        console.log(`\x1b[32m✅ Response [${msg.id}]: ${JSON.stringify(msg.result)}\x1b[0m`);
      }
    } else {
      console.log(`\x1b[90m← ${line}\x1b[0m`);
    }
  } catch {
    console.log(`\x1b[90m← ${line}\x1b[0m`);
  }
});

// Send initialize
const initReq = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    config: {
      app_id: "cli_a9114951bcb81bca",
      app_secret: "Br8QjWKy79NJWn195Qp8qelOVfWunbti",
    },
    hostVersion: "0.1.0",
  },
};

plugin.stdin.write(JSON.stringify(initReq) + "\n");
console.log("🚀 Plugin started, waiting for messages... (Ctrl+C to stop)\n");

// Handle exit
plugin.on("exit", (code) => {
  console.log(`\nPlugin exited with code ${code}`);
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down...");
  plugin.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 999, method: "shutdown" }) + "\n");
  setTimeout(() => process.exit(0), 1000);
});
