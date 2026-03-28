/**
 * AgentStreamHandler — receives ACP session updates from the Host and renders
 * them as separate Feishu messages, one per contiguous variant block.
 *
 * ## Block-based rendering
 *
 * Events arrive as a stream of variants: thought, thought, text, thought, text…
 * Each contiguous run of the **same** variant becomes one Feishu message (card).
 * When the variant changes, the current block is "sealed" (never edited again)
 * and a new block starts.
 *
 * Variants filtered by settings (show_thinking / show_tool_use) are skipped
 * entirely — they don't create cards and don't trigger block boundaries.
 *
 * ## Turn lifecycle
 *
 * Turn starts implicitly when the first session_notification arrives.
 * Turn ends when the plugin's `prompt()` call returns with a `StopReason`.
 * The gateway calls `onTurnEnd()` at that point to seal the last block
 * and remove the processing emoji.
 */

import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { FeishuClient } from "./lark-client.js";
import { buildStreamingCard, buildMarkdownCard } from "./card/builder.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Which variant family a block belongs to. */
type BlockKind = "thinking" | "tool" | "text";

interface MessageBlock {
  kind: BlockKind;
  content: string;
  /** Feishu message_id (set after first send). */
  messageId: string | null;
  /** Whether this block has been sealed (no more edits). */
  sealed: boolean;
}

interface ChannelState {
  /** Sequential blocks — each contiguous run of same variant = one block. */
  blocks: MessageBlock[];
  /** User's message_id (for reactions). */
  userMessageId: string | null;
  /** Reaction ID returned by addReaction. */
  reactionId: string | null;
  /** Flush timer handle. */
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** Timestamp of last edit (for throttling). */
  lastEditMs: number;
  /** Serializes send/edit calls to guarantee message order. */
  sendChain: Promise<void>;
}

type LogFn = (level: string, msg: string) => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum interval between card edits (ms). Feishu API rate limit. */
const MIN_EDIT_INTERVAL_MS = 600;

/** Flush interval for batching deltas (ms). */
const FLUSH_INTERVAL_MS = 500;

/** Emoji for "processing" reaction. */
const PROCESSING_EMOJI = "OnIt";

// ---------------------------------------------------------------------------
// AgentStreamHandler
// ---------------------------------------------------------------------------

export interface VerboseConfig {
  showThinking: boolean;
  showToolUse: boolean;
}

export class AgentStreamHandler {
  private client: FeishuClient;
  private log: LogFn;
  private verbose: VerboseConfig;
  private channels = new Map<string, ChannelState>();
  /** Track the last active channelId for lifecycle events. */
  private lastActiveChannelId: string | null = null;

  constructor(client: FeishuClient, log: LogFn, verbose?: Partial<VerboseConfig>) {
    this.client = client;
    this.log = log;
    this.verbose = {
      showThinking: verbose?.showThinking ?? false,
      showToolUse: verbose?.showToolUse ?? false,
    };
  }

  // ---- Prompt lifecycle (called by gateway) ----

  /** Called when a prompt is sent — set up state and add processing emoji.
   *  Returns after the reaction is added (must await before prompt). */
  async onPromptSent(channelId: string, userMessageId?: string): Promise<void> {
    this.lastActiveChannelId = channelId;

    // Clean up any previous state
    const oldState = this.channels.get(channelId);
    if (oldState?.flushTimer) clearTimeout(oldState.flushTimer);
    this.channels.delete(channelId);

    const state: ChannelState = {
      blocks: [],
      userMessageId: userMessageId ?? null,
      reactionId: null,
      flushTimer: null,
      lastEditMs: 0,
      sendChain: Promise.resolve(),
    };
    this.channels.set(channelId, state);

    // Add OnIt processing reaction — await so it's set before prompt returns
    if (userMessageId) {
      try {
        const rid = await this.client.addReaction(userMessageId, PROCESSING_EMOJI);
        this.log("debug", `addReaction result: rid=${rid} channelId=${channelId}`);
        if (rid) state.reactionId = rid;
      } catch (e) {
        this.log("error", `addReaction failed: ${e}`);
      }
    }
  }

  /** Called when prompt() returns — seal all blocks, remove emoji. */
  onTurnEnd(channelId: string): void {
    const state = this.channels.get(channelId);
    if (!state) return;

    this.log("debug", `turn_end channel=${channelId} blocks=${state.blocks.length}`);

    // Clear flush timer and do final flush
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    this.flushFinal(channelId, state);

    // Remove processing reaction
    if (state.userMessageId && state.reactionId) {
      this.client.removeReaction(state.userMessageId, state.reactionId).catch((e) => {
        this.log("error", `removeReaction failed: ${e}`);
      });
    }

    this.channels.delete(channelId);
  }

  /** Called on prompt error — send error card, remove emoji. */
  onTurnError(channelId: string, error: string): void {
    const state = this.channels.get(channelId);

    this.log("error", `turn_error channel=${channelId} error=${error}`);

    const chatId = this.parseChatId(channelId);
    const card = buildMarkdownCard(`❌ **Error**: ${error}`);
    this.client.sendInteractive(chatId, card).catch(() => {});

    if (state?.userMessageId && state?.reactionId) {
      this.client.removeReaction(state.userMessageId, state.reactionId).catch(() => {});
    }

    if (state?.flushTimer) clearTimeout(state.flushTimer);
    this.channels.delete(channelId);
  }

  // ---- Lifecycle events from host ext_notifications ----

  onAgentReady(agent: string, version: string): void {
    const channelId = this.lastActiveChannelId;
    if (!channelId) return;
    const chatId = this.parseChatId(channelId);
    this.client.sendText(chatId, `🤖 Agent: ${agent} v${version}`).catch(() => {});
  }

  onSessionReady(sessionId: string): void {
    const channelId = this.lastActiveChannelId;
    if (!channelId) return;
    const chatId = this.parseChatId(channelId);
    this.client.sendText(chatId, `📋 Session: ${sessionId}`).catch(() => {});
  }

  onSendSystemText(params: Record<string, unknown>): void {
    const channelId = params.channelId as string;
    const text = params.text as string;
    const replyTo = (params.replyTo as string) || undefined;
    const chatId = this.parseChatId(channelId);
    if (replyTo) {
      this.client.reply(replyTo, text).catch((e) => this.log("error", `reply failed: ${e}`));
    } else {
      this.client.sendText(chatId, text).catch((e) => this.log("error", `sendText failed: ${e}`));
    }
  }

  // ---- ACP SessionUpdate dispatcher ----

  onSessionUpdate(notification: SessionNotification): void {
    const sessionId = notification.sessionId;
    const update = notification.update;
    const variant = (update as any).sessionUpdate as string;
    const channelId = `feishu:${sessionId}`;

    switch (variant) {
      case "agent_thought_chunk": {
        if (!this.verbose.showThinking) return; // skip — no card, no boundary
        const content = (update as any).content as { text?: string } | undefined;
        const delta = content?.text ?? "";
        if (delta) this.appendToBlock(channelId, "thinking", delta);
        break;
      }
      case "agent_message_chunk": {
        const content = (update as any).content as { text?: string } | undefined;
        const delta = content?.text ?? "";
        if (delta) this.appendToBlock(channelId, "text", delta);
        break;
      }
      case "tool_call": {
        if (!this.verbose.showToolUse) return; // skip
        // ACP ToolCall: { toolCallId, title, kind, status, ... }
        const toolTitle = (update as any).title as string | undefined;
        if (toolTitle) this.appendToBlock(channelId, "tool", `🔧 ${toolTitle}\n`);
        break;
      }
      case "tool_call_update": {
        if (!this.verbose.showToolUse) return; // skip
        // ACP ToolCallUpdate: fields are flattened (title, status at top level)
        const title = (update as any).title as string | undefined;
        const status = (update as any).status as string | undefined;
        const label = title ?? "tool";
        if (status === "completed" || status === "error") {
          this.appendToBlock(channelId, "tool", `✅ ${label}\n`);
        }
        break;
      }
      default:
        this.log("debug", `unhandled session update variant: ${variant}`);
    }
  }

  // ---- Block management ----

  /** Append delta to the current block, or start a new block if kind changed. */
  private appendToBlock(channelId: string, kind: BlockKind, delta: string): void {
    const state = this.ensureState(channelId);
    const current = state.blocks.length > 0
      ? state.blocks[state.blocks.length - 1]
      : null;

    if (current && !current.sealed && current.kind === kind) {
      // Same kind — append delta
      current.content += delta;
    } else {
      // Different kind — seal current, start new
      if (current && !current.sealed) {
        current.sealed = true;
        this.enqueueFlush(channelId, state, current);
      }
      state.blocks.push({ kind, content: delta, messageId: null, sealed: false });
    }

    this.scheduleFlush(channelId);
  }

  private ensureState(channelId: string): ChannelState {
    let state = this.channels.get(channelId);
    if (!state) {
      this.log("debug", `creating channel state for ${channelId}`);
      state = {
        blocks: [],
        userMessageId: null,
        reactionId: null,
        flushTimer: null,
        lastEditMs: 0,
        sendChain: Promise.resolve(),
      };
      this.channels.set(channelId, state);
    }
    return state;
  }

  // ---- Flush / render ----

  private scheduleFlush(channelId: string): void {
    const state = this.channels.get(channelId);
    if (!state || state.flushTimer) return;

    state.flushTimer = setTimeout(() => {
      state.flushTimer = null;
      this.flush(channelId);
    }, FLUSH_INTERVAL_MS);
  }

  /** Flush the current (last, unsealed) block. */
  private flush(channelId: string): void {
    const state = this.channels.get(channelId);
    if (!state) return;

    const block = state.blocks.length > 0
      ? state.blocks[state.blocks.length - 1]
      : null;
    if (!block || block.sealed || !block.content) return;

    // Throttle edits
    const now = Date.now();
    if (now - state.lastEditMs < MIN_EDIT_INTERVAL_MS) {
      this.scheduleFlush(channelId);
      return;
    }

    this.enqueueFlush(channelId, state, block);
  }

  /** Chain flushBlock onto the send queue to guarantee message order. */
  private enqueueFlush(channelId: string, state: ChannelState, block: MessageBlock): void {
    state.sendChain = state.sendChain
      .then(() => this.flushBlock(channelId, state, block))
      .catch((e) => this.log("error", `enqueueFlush error: ${e}`));
  }

  /** Send or update a single block's Feishu card. */
  private async flushBlock(
    channelId: string,
    state: ChannelState,
    block: MessageBlock,
  ): Promise<void> {
    const content = this.formatBlockContent(block);
    if (!content) return;

    const chatId = this.parseChatId(channelId);
    const status = block.sealed ? "complete" : "streaming";

    try {
      if (!block.messageId) {
        // Guard: set sentinel before async HTTP to prevent concurrent creates
        block.messageId = "sending";
        const card = block.sealed
          ? buildMarkdownCard(content)
          : buildStreamingCard(content, status);
        const messageId = await this.client.sendInteractive(chatId, card);
        block.messageId = messageId ?? null;
        state.lastEditMs = Date.now();
        this.log("debug", `flush: new card kind=${block.kind} messageId=${block.messageId} sealed=${block.sealed}`);
      } else if (block.messageId !== "sending") {
        // Only update if we have a real messageId (not mid-create)
        const card = buildStreamingCard(content, status);
        await this.client.updateInteractive(block.messageId, card);
        state.lastEditMs = Date.now();
      }
      // else: messageId === "sending" → skip, first create is in flight
    } catch (e) {
      this.log("error", `flushBlock failed: ${e}`);
    }
  }

  /** Final flush on turn end — seal and flush the last block. */
  private flushFinal(channelId: string, state: ChannelState): void {
    const block = state.blocks.length > 0
      ? state.blocks[state.blocks.length - 1]
      : null;
    if (!block || block.sealed) return;

    block.sealed = true;
    this.enqueueFlush(channelId, state, block);
  }

  /** Format block content with appropriate prefix based on kind. */
  private formatBlockContent(block: MessageBlock): string {
    switch (block.kind) {
      case "thinking":
        return `💭 *${block.content}*`;
      case "tool":
        return block.content;
      case "text":
        return block.content;
    }
  }

  /** Extract chat_id from channel_id (e.g. "feishu:oc_abc" → "oc_abc"). */
  private parseChatId(channelId: string): string {
    const idx = channelId.indexOf(":");
    return idx >= 0 ? channelId.slice(idx + 1) : channelId;
  }
}
