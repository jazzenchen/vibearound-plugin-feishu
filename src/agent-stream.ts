/**
 * AgentStreamHandler — receives agent events from the Host and renders them
 * as Feishu interactive cards (streaming).
 *
 * State machine per channel:
 *   idle → streaming (on agent_start)
 *   streaming → streaming (on agent_token / agent_thinking / agent_tool_use)
 *   streaming → idle (on agent_end / agent_error)
 *
 * Uses card/builder.ts for card construction and lark-client.ts for API calls.
 */

import type { FeishuClient } from "./lark-client.js";
import { buildStreamingCard, buildMarkdownCard } from "./card/builder.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChannelState {
  /** Accumulated text content from agent_token deltas. */
  text: string;
  /** Thinking text (latest). */
  thinking: string;
  /** Tool use status lines. */
  toolLines: string[];
  /** Feishu message_id of the streaming card (set after first send). */
  messageId: string | null;
  /** User's message_id (for reactions). */
  userMessageId: string | null;
  /** Reaction ID returned by addReaction (needed for removeReaction). */
  reactionId: string | null;
  /** Flush timer handle. */
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** Whether we've sent the first card. */
  started: boolean;
  /** Timestamp of last edit (for throttling). */
  lastEditMs: number;
}

type LogFn = (level: string, msg: string) => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum interval between card edits (ms). Feishu API rate limit. */
const MIN_EDIT_INTERVAL_MS = 600;

/** Flush interval for batching tokens (ms). */
const FLUSH_INTERVAL_MS = 500;

/** Emoji for "processing" reaction. */
const PROCESSING_EMOJI = "OnIt";

// ---------------------------------------------------------------------------
// AgentStreamHandler
// ---------------------------------------------------------------------------

export class AgentStreamHandler {
  private client: FeishuClient;
  private log: LogFn;
  private channels = new Map<string, ChannelState>();

  constructor(client: FeishuClient, log: LogFn) {
    this.client = client;
    this.log = log;
  }

  // ---- Event handlers (called from main.ts notification registrations) ----

  onAgentStart(params: Record<string, unknown>): void {
    const channelId = params.channelId as string;
    const userMessageId = (params.userMessageId as string) || null;

    this.log("debug", `agent_start channel=${channelId}`);

    // Initialize channel state
    this.channels.set(channelId, {
      text: "",
      thinking: "",
      toolLines: [],
      messageId: null,
      userMessageId,
      reactionId: null,
      flushTimer: null,
      started: false,
      lastEditMs: 0,
    });

    // Add processing reaction
    if (userMessageId) {
      this.client.addReaction(userMessageId, PROCESSING_EMOJI)
        .then((rid) => {
          const s = this.channels.get(channelId);
          if (s && rid) s.reactionId = rid;
        })
        .catch(() => {});
    }
  }

  onAgentThinking(params: Record<string, unknown>): void {
    const channelId = params.channelId as string;
    const text = params.text as string;
    const state = this.channels.get(channelId);
    if (!state) return;

    state.thinking = text;
    this.scheduleFlush(channelId);
  }

  onAgentToken(params: Record<string, unknown>): void {
    const channelId = params.channelId as string;
    const delta = params.delta as string;
    const state = this.channels.get(channelId);
    if (!state) return;

    state.text += delta;
    this.scheduleFlush(channelId);
  }

  onAgentText(params: Record<string, unknown>): void {
    const channelId = params.channelId as string;
    const text = params.text as string;

    // agent_text is a complete text block (e.g. command response)
    // Send as a simple markdown card
    const chatId = this.parseChatId(channelId);
    const card = buildMarkdownCard(text);
    this.client.sendInteractive(chatId, card).catch((e) => {
      this.log("error", `sendInteractive failed: ${e}`);
    });
  }

  onAgentToolUse(params: Record<string, unknown>): void {
    const channelId = params.channelId as string;
    const tool = params.tool as string;
    const state = this.channels.get(channelId);
    if (!state) return;

    state.toolLines.push(`🔧 ${tool}`);
    this.scheduleFlush(channelId);
  }

  onAgentToolResult(params: Record<string, unknown>): void {
    // Tool results are informational — we could show them but for now just log
    const channelId = params.channelId as string;
    const tool = params.tool as string;
    this.log("debug", `agent_tool_result channel=${channelId} tool=${tool}`);
  }

  onAgentEnd(params: Record<string, unknown>): void {
    const channelId = params.channelId as string;
    const state = this.channels.get(channelId);
    if (!state) return;

    this.log("debug", `agent_end channel=${channelId} textLen=${state.text.length}`);

    // Clear flush timer
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }

    // Final flush — send or edit the complete card
    this.flushFinal(channelId, state);

    // Remove processing reaction
    if (state.userMessageId && state.reactionId) {
      this.client.removeReaction(state.userMessageId, state.reactionId).catch(() => {});
    }

    // Cleanup
    if (state?.flushTimer) clearTimeout(state.flushTimer);
    this.channels.delete(channelId);
  }

  onAgentError(params: Record<string, unknown>): void {
    const channelId = params.channelId as string;
    const error = params.error as string;
    const state = this.channels.get(channelId);

    this.log("error", `agent_error channel=${channelId} error=${error}`);

    const chatId = this.parseChatId(channelId);
    const card = buildMarkdownCard(`❌ **Error**: ${error}`);
    this.client.sendInteractive(chatId, card).catch(() => {});

    // Remove processing reaction
    if (state?.userMessageId && state?.reactionId) {
      this.client.removeReaction(state.userMessageId, state.reactionId).catch(() => {});
    }

    // Cleanup
    if (state?.flushTimer) clearTimeout(state.flushTimer);
    this.channels.delete(channelId);
  }

  onSendSystemText(params: Record<string, unknown>): void {
    const channelId = params.channelId as string;
    const text = params.text as string;
    const replyTo = (params.replyTo as string) || undefined;

    const chatId = this.parseChatId(channelId);
    if (replyTo) {
      this.client.reply(replyTo, text).catch((e) => {
        this.log("error", `reply failed: ${e}`);
      });
    } else {
      this.client.sendText(chatId, text).catch((e) => {
        this.log("error", `sendText failed: ${e}`);
      });
    }
  }

  // ---- Internal ----

  private scheduleFlush(channelId: string): void {
    const state = this.channels.get(channelId);
    if (!state || state.flushTimer) return;

    state.flushTimer = setTimeout(() => {
      state.flushTimer = null;
      this.flush(channelId);
    }, FLUSH_INTERVAL_MS);
  }

  private async flush(channelId: string): Promise<void> {
    const state = this.channels.get(channelId);
    if (!state) return;

    // Throttle edits
    const now = Date.now();
    if (now - state.lastEditMs < MIN_EDIT_INTERVAL_MS) {
      // Reschedule
      this.scheduleFlush(channelId);
      return;
    }

    const content = this.buildContent(state);
    if (!content) return;

    const chatId = this.parseChatId(channelId);

    try {
      if (!state.started) {
        // First message — send a new streaming card
        const card = buildStreamingCard(content, "streaming");
        const messageId = await this.client.sendInteractive(chatId, card);
        state.messageId = messageId ?? null;
        state.started = true;
        state.lastEditMs = Date.now();
        this.log("debug", `flush: sent initial card messageId=${state.messageId}`);
      } else if (state.messageId) {
        // Update existing card
        const card = buildStreamingCard(content, "streaming");
        await this.client.updateInteractive(state.messageId, card);
        state.lastEditMs = Date.now();
      }
    } catch (e) {
      this.log("error", `flush failed: ${e}`);
    }
  }

  private async flushFinal(channelId: string, state: ChannelState): Promise<void> {
    const content = this.buildContent(state);
    if (!content) return;

    const chatId = this.parseChatId(channelId);

    try {
      if (!state.started) {
        // Never sent anything — send the complete card
        const card = buildMarkdownCard(content);
        await this.client.sendInteractive(chatId, card);
      } else if (state.messageId) {
        // Update to final (complete) card
        const card = buildStreamingCard(content, "complete");
        await this.client.updateInteractive(state.messageId, card);
      }
    } catch (e) {
      this.log("error", `flushFinal failed: ${e}`);
    }
  }

  private buildContent(state: ChannelState): string {
    const parts: string[] = [];

    // Thinking indicator
    if (state.thinking && !state.text) {
      parts.push(`💭 *${state.thinking}*`);
    }

    // Tool use lines
    if (state.toolLines.length > 0) {
      parts.push(state.toolLines.join("\n"));
    }

    // Main text
    if (state.text) {
      parts.push(state.text);
    }

    return parts.join("\n\n");
  }

  /** Extract chat_id from channel_id (e.g. "feishu:oc_abc" → "oc_abc"). */
  private parseChatId(channelId: string): string {
    const idx = channelId.indexOf(":");
    return idx >= 0 ? channelId.slice(idx + 1) : channelId;
  }
}
