/**
 * Feishu WebSocket gateway.
 *
 * Connects to Lark via WebSocket, listens for inbound events,
 * parses messages using the full converter system, and forwards
 * them to the Host as JSON-RPC notifications.
 */

import path from "node:path";

import type { Agent, ContentBlock, ChannelBot } from "@vibearound/plugin-channel-sdk";
import type { FeishuClient } from "./lark-client.js";
import type { AgentStreamHandler } from "./agent-stream.js";
import type { FeishuMessageEvent, FeishuReactionCreatedEvent, MentionInfo } from "./messaging/types.js";
import type { ConvertContext } from "./messaging/converters/types.js";
import { convertMessageContent } from "./messaging/converters/content-converter.js";
import { MessageDedup } from "./messaging/inbound/dedup.js";
import { downloadMessageResource } from "./messaging/media-download.js";
import type { DownloadedResource } from "./messaging/media-download.js";

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------

export class FeishuGateway implements ChannelBot<AgentStreamHandler> {
  /** Public so `createRenderer` can pass the client to the stream handler. */
  readonly client: FeishuClient;
  private agent: Agent;
  private cacheDir: string;
  private streamHandler: AgentStreamHandler | null = null;
  private dedup = new MessageDedup();
  private abortController = new AbortController();

  constructor(client: FeishuClient, agent: Agent, cacheDir: string) {
    this.client = client;
    this.agent = agent;
    this.cacheDir = cacheDir;
  }

  setStreamHandler(handler: AgentStreamHandler): void {
    this.streamHandler = handler;
  }

  async start(): Promise<void> {
    this.log("info", "starting WebSocket gateway...");
    // probe() already called in afterCreate — botOpenId/botName are set.
    this.log("info", `bot identity: ${this.client.botName} (${this.client.botOpenId})`);

    await this.client.startWS(
      {
        "im.message.receive_v1": (data) => this.handleMessage(data),
        "im.message.message_read_v1": async () => {},
        "im.message.reaction.created_v1": (data) => this.handleReaction(data),
        "im.chat.member.bot.added_v1": async (data) => {
          this.log("info", `bot added to chat: ${JSON.stringify(data)}`);
        },
        "im.chat.member.bot.deleted_v1": async (data) => {
          this.log("info", `bot removed from chat: ${JSON.stringify(data)}`);
        },
        "card.action.trigger": (data) => this.handleCardAction(data),
      },
      this.abortController.signal,
    );
  }

  stop(): void {
    this.abortController.abort();
  }

  private log(level: string, msg: string): void {
    process.stderr.write(`[feishu-gateway][${level}] ${msg}\n`);
  }

  // --------------------------------------------------------------------------

  private async handleMessage(data: unknown): Promise<void> {
    const event = data as FeishuMessageEvent;
    const msg = event.message;
    if (!msg) return;

    const messageId = msg.message_id ?? "";
    const chatId = msg.chat_id ?? "";

    if (!this.dedup.check(messageId)) return;

    // Discard stale messages (>5 min, from WebSocket reconnect replay)
    if (msg.create_time) {
      const createMs = parseInt(msg.create_time, 10);
      if (!isNaN(createMs) && Date.now() - createMs > 5 * 60 * 1000) return;
    }

    // Ignore bot's own messages
    const senderOpenId = event.sender?.sender_id?.open_id ?? "";
    if (senderOpenId === this.client.botOpenId) return;

    // Build converter context with mentions
    const mentionsMap = new Map<string, MentionInfo>();
    const mentionsByOpenId = new Map<string, MentionInfo>();

    if (msg.mentions) {
      for (const m of msg.mentions) {
        const openId = m.id?.open_id ?? "";
        const info: MentionInfo = {
          key: m.key,
          openId,
          name: m.name,
          isBot: openId === this.client.botOpenId,
        };
        mentionsMap.set(m.key, info);
        if (openId) mentionsByOpenId.set(openId, info);
      }
    }

    const ctx: ConvertContext = {
      mentions: mentionsMap,
      mentionsByOpenId,
      messageId,
      botOpenId: this.client.botOpenId,
    };

    // Convert message content using the full converter system
    const result = await convertMessageContent(msg.message_type, msg.content, ctx);

    // Download media resources (images, files, etc.)
    const downloaded: DownloadedResource[] = [];
    for (const resource of result.resources) {
      const media = await downloadMessageResource({
        client: this.client,
        messageId,
        resource,
        cacheDir: this.cacheDir,
        chatId,
      });
      if (media) downloaded.push(media);
    }

    // Build ACP prompt content blocks
    const contentBlocks: ContentBlock[] = [];

    if (result.content) {
      contentBlocks.push({ type: "text", text: result.content });
    } else if (downloaded.length > 0) {
      const types = [...new Set(downloaded.map((m) => m.type))].join(", ");
      contentBlocks.push({ type: "text", text: `The user sent ${types}.` });
    }

    for (const media of downloaded) {
      contentBlocks.push({
        type: "resource_link",
        uri: `file://${media.path}`,
        name: media.fileName ?? path.basename(media.path),
        mimeType: media.mimeType,
      });
    }

    if (contentBlocks.length === 0) return;

    const firstText = contentBlocks[0]?.type === "text" ? contentBlocks[0].text : "";
    this.log("info", `prompt: chat=${chatId} blocks=${contentBlocks.length} text=${firstText.slice(0, 60)}`);
    await this.streamHandler?.onPromptSent(chatId, messageId);

    try {
      const response = await this.agent.prompt({
        sessionId: chatId,
        prompt: contentBlocks,
      });
      this.log("info", `prompt done chat=${chatId} stopReason=${response.stopReason}`);
      this.streamHandler?.onTurnEnd(chatId);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log("error", `prompt failed chat=${chatId}: ${msg}`);
      this.streamHandler?.onTurnError(chatId, msg);
    }
  }

  private async handleReaction(data: unknown): Promise<void> {
    const event = data as FeishuReactionCreatedEvent;
    const messageId = event.message_id ?? "";
    const emoji = event.reaction_type?.emoji_type ?? "";
    const senderOpenId = event.user_id?.open_id ?? "";

    const dedupKey = `reaction:${messageId}:${emoji}:${senderOpenId}`;
    if (!this.dedup.check(dedupKey)) return;
    if (senderOpenId === this.client.botOpenId) return;

    // Reaction events are not forwarded to host.
  }

  private async handleCardAction(data: unknown): Promise<unknown> {
    const event = data as {
      action?: { value?: Record<string, unknown>; tag?: string };
      operator?: { open_id?: string };
      // V2 puts chat/message IDs in context, V1 had them at top level
      context?: { open_chat_id?: string; open_message_id?: string };
      open_chat_id?: string;
      open_message_id?: string;
    };

    const chatId = event.context?.open_chat_id ?? event.open_chat_id ?? "";
    const messageId = event.context?.open_message_id ?? event.open_message_id;
    const command = event.action?.value?.command as string | undefined;

    this.log("info", `card action: chat=${chatId} command=${command ?? "none"}`);

    if (command && chatId) {
      // Command button clicked — send as a prompt so the host can parse the slash command
      const contentBlocks: ContentBlock[] = [{ type: "text", text: command }];
      await this.streamHandler?.onPromptSent(chatId);
      try {
        const response = await this.agent.prompt({
          sessionId: chatId,
          prompt: contentBlocks,
        });
        this.log("info", `card command done chat=${chatId} cmd=${command} stopReason=${response.stopReason}`);
        this.streamHandler?.onTurnEnd(chatId);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        this.log("error", `card command failed chat=${chatId}: ${msg}`);
        this.streamHandler?.onTurnError(chatId, msg);
      }
    } else {
      // Generic callback (non-command button)
      this.agent
        .extNotification?.("_va/callback", {
          chatId,
          callbackId: `card_${Date.now()}`,
          sender: { id: event.operator?.open_id ?? "" },
          data: event.action?.value ?? {},
          messageId,
        })
        .catch(() => {});
    }
    return {};
  }
}
