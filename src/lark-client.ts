/**
 * Feishu/Lark SDK wrapper.
 *
 * Thin layer over @larksuiteoapi/node-sdk that provides:
 *   - SDK client + WebSocket lifecycle
 *   - Bot identity probe
 *   - Send / edit / reply / reaction APIs
 *   - Interactive card send / update
 *
 * All methods use the Feishu REST API via the SDK client.
 * The WebSocket gateway is handled separately in gateway.ts.
 */

import * as Lark from "@larksuiteoapi/node-sdk";
import type { FeishuConfig } from "./protocol.js";

// ---------------------------------------------------------------------------
// Redirect Lark SDK console.log to stderr so it doesn't pollute stdio JSON-RPC
// ---------------------------------------------------------------------------

const origConsoleLog = console.log;
const origConsoleInfo = console.info;
console.log = (...args: unknown[]) => {
  process.stderr.write(`[lark-sdk] ${args.map(String).join(" ")}\n`);
};
console.info = (...args: unknown[]) => {
  process.stderr.write(`[lark-sdk] ${args.map(String).join(" ")}\n`);
};

// ---------------------------------------------------------------------------
// Brand → SDK domain
// ---------------------------------------------------------------------------

const BRAND_DOMAIN: Record<string, Lark.Domain> = {
  feishu: Lark.Domain.Feishu,
  lark: Lark.Domain.Lark,
};

function resolveDomain(brand?: string): Lark.Domain {
  return BRAND_DOMAIN[brand ?? "feishu"] ?? Lark.Domain.Feishu;
}

import { buildMarkdownCard, serializeCard } from "./card/builder.js";

// ---------------------------------------------------------------------------
// FeishuClient
// ---------------------------------------------------------------------------

export class FeishuClient {
  private sdk: Lark.Client;
  private wsClient: Lark.WSClient | null = null;
  private config: FeishuConfig;

  botOpenId: string | undefined;
  botName: string | undefined;

  constructor(config: FeishuConfig) {
    this.config = config;
    this.sdk = new Lark.Client({
      appId: config.app_id,
      appSecret: config.app_secret,
      appType: Lark.AppType.SelfBuild,
      domain: resolveDomain(config.domain),
    });
  }

  // ---- Bot identity --------------------------------------------------------

  async probe(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await (this.sdk as any).request({
        method: "GET",
        url: "/open-apis/bot/v3/info",
        data: {},
      });
      if (res.code !== 0) {
        return { ok: false, error: `API error: ${res.msg || `code ${res.code}`}` };
      }
      const bot = res.bot || res.data?.bot;
      this.botOpenId = bot?.open_id;
      this.botName = bot?.app_name || bot?.bot_name;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ---- WebSocket -----------------------------------------------------------

  /**
   * Start WebSocket event monitoring.
   * Returns a Promise that resolves when abortSignal fires.
   */
  async startWS(
    handlers: Record<string, (data: unknown) => Promise<unknown> | void>,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const dispatcher = new Lark.EventDispatcher({
      encryptKey: this.config.encrypt_key ?? "",
      verificationToken: this.config.verification_token ?? "",
    });
    dispatcher.register(handlers as any);

    if (this.wsClient) {
      try { this.wsClient.close({ force: true }); } catch { /* ignore */ }
      this.wsClient = null;
    }

    this.wsClient = new Lark.WSClient({
      appId: this.config.app_id,
      appSecret: this.config.app_secret,
      domain: resolveDomain(this.config.domain),
      loggerLevel: Lark.LoggerLevel.info,
    });

    // Patch: SDK handleEventData only handles type="event", card actions
    // come as type="card". Rewrite to "event" so EventDispatcher routes them.
    const ws = this.wsClient as any;
    const origHandle = ws.handleEventData?.bind(ws);
    if (origHandle) {
      ws.handleEventData = (data: any) => {
        const msgType = data.headers?.find?.((h: any) => h.key === "type")?.value;
        if (msgType === "card") {
          return origHandle({
            ...data,
            headers: data.headers.map((h: any) =>
              h.key === "type" ? { ...h, value: "event" } : h
            ),
          });
        }
        return origHandle(data);
      };
    }

    return new Promise<void>((resolve, reject) => {
      if (abortSignal?.aborted) {
        this.disconnect();
        return resolve();
      }
      abortSignal?.addEventListener("abort", () => {
        this.disconnect();
        resolve();
      }, { once: true });

      try {
        void this.wsClient!.start({ eventDispatcher: dispatcher });
      } catch (err) {
        this.disconnect();
        reject(err);
      }
    });
  }

  disconnect(): void {
    if (this.wsClient) {
      try { this.wsClient.close({ force: true }); } catch { /* ignore */ }
      this.wsClient = null;
    }
  }

  // ---- Send text (as interactive card with lark_md) ------------------------

  async sendText(chatId: string, text: string): Promise<string | undefined> {
    const res = await this.sdk.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "interactive",
        content: JSON.stringify(buildMarkdownCard(text)),
      },
    });
    return res.data?.message_id;
  }

  // ---- Reply (plain text, to a specific message) ---------------------------

  async reply(messageId: string, text: string): Promise<string | undefined> {
    const res = await this.sdk.im.message.reply({
      path: { message_id: messageId },
      data: {
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    });
    return res.data?.message_id;
  }

  // ---- Edit message --------------------------------------------------------

  async editMessage(messageId: string, text: string): Promise<void> {
    await this.sdk.im.message.patch({
      path: { message_id: messageId },
      data: {
        content: JSON.stringify(buildMarkdownCard(text)),
      },
    });
  }

  // ---- Interactive card (buttons) ------------------------------------------

  async sendInteractive(chatId: string, card: object, replyTo?: string): Promise<string | undefined> {
    if (replyTo) {
      const res = await this.sdk.im.message.reply({
        path: { message_id: replyTo },
        data: {
          msg_type: "interactive",
          content: JSON.stringify(card),
        },
      });
      return res.data?.message_id;
    }
    const res = await this.sdk.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "interactive",
        content: JSON.stringify(card),
      },
    });
    return res.data?.message_id;
  }

  async updateInteractive(messageId: string, card: object): Promise<void> {
    await this.sdk.im.message.patch({
      path: { message_id: messageId },
      data: {
        content: JSON.stringify(card),
      },
    });
  }

  // ---- Reactions -----------------------------------------------------------

  async addReaction(messageId: string, emoji: string): Promise<string | undefined> {
    const res = await this.sdk.im.messageReaction.create({
      path: { message_id: messageId },
      data: { reaction_type: { emoji_type: emoji } },
    });
    return res.data?.reaction_id;
  }

  async removeReaction(messageId: string, reactionId: string): Promise<void> {
    await this.sdk.im.messageReaction.delete({
      path: { message_id: messageId, reaction_id: reactionId },
    });
  }
}
