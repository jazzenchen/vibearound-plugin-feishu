/**
 * AgentStreamHandler — receives ACP session updates from the Host and renders
 * them as separate Feishu messages, one per contiguous variant block.
 *
 * Extends BlockRenderer from @vibearound/plugin-channel-sdk which handles:
 *   - Block accumulation and kind-change detection
 *   - Debounced flushing + edit throttling (600ms for Feishu's rate limit)
 *   - Serialized sendChain for guaranteed message order
 *   - Verbose filtering (thinking / tool blocks)
 *
 * This class adds Feishu-specific concerns:
 *   - "OnIt" processing reaction on prompt start, removed on turn end
 *   - Streaming card format while live, markdown card when sealed
 *   - Platform-specific error card on turn error
 */

import {
  BlockRenderer,
  type BlockKind,
  type SessionNotification,
  type VerboseConfig,
} from "@vibearound/plugin-channel-sdk";
import type { FeishuClient } from "./lark-client.js";
import { buildStreamingCard, buildMarkdownCard } from "./card/builder.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LogFn = (level: string, msg: string) => void;

/** Feishu-specific per-channel state (reaction tracking). */
interface FeishuChannelState {
  userMessageId: string | null;
  reactionId: string | null;
}

const PROCESSING_EMOJI = "OnIt";

// ---------------------------------------------------------------------------
// AgentStreamHandler
// ---------------------------------------------------------------------------

export class AgentStreamHandler extends BlockRenderer<string> {
  private feishuClient: FeishuClient;
  private log: LogFn;
  /** Feishu-specific state: reaction IDs per channel. */
  private feishuStates = new Map<string, FeishuChannelState>();
  private lastActiveChannelId: string | null = null;

  constructor(client: FeishuClient, log: LogFn, verbose?: Partial<VerboseConfig>) {
    super({
      flushIntervalMs: 500,
      minEditIntervalMs: 600,
      verbose,
    });
    this.feishuClient = client;
    this.log = log;
  }

  // ---- BlockRenderer overrides ----

  /** Prefix sessionId with "feishu:" to form the channel ID. */
  protected sessionIdToChannelId(sessionId: string): string {
    return `feishu:${sessionId}`;
  }

  /** Feishu markdown: italicise thinking, plain for tool/text. */
  protected formatContent(kind: BlockKind, content: string, _sealed: boolean): string {
    switch (kind) {
      case "thinking": return `💭 *${content}*`;
      case "tool":     return content;
      case "text":     return content;
    }
  }

  /** Send new block as a streaming card. */
  protected async sendBlock(channelId: string, kind: BlockKind, content: string): Promise<string | null> {
    const chatId = this.parseChatId(channelId);
    try {
      const card = buildStreamingCard(content, "streaming");
      const messageId = await this.feishuClient.sendInteractive(chatId, card);
      this.log("debug", `flush: new card kind=${kind} messageId=${messageId}`);
      return messageId ?? null;
    } catch (e) {
      this.log("error", `sendBlock failed: ${e}`);
      return null;
    }
  }

  /** Edit existing block — streaming card while live, markdown card when sealed. */
  protected async editBlock(
    channelId: string,
    ref: string,
    _kind: BlockKind,
    content: string,
    sealed: boolean,
  ): Promise<void> {
    try {
      const card = sealed ? buildMarkdownCard(content) : buildStreamingCard(content, "streaming");
      await this.feishuClient.updateInteractive(ref, card);
    } catch (e) {
      this.log("error", `editBlock failed: ${e}`);
    }
  }

  /** Remove processing reaction after all blocks are flushed. */
  protected async onAfterTurnEnd(channelId: string): Promise<void> {
    await this.removeReaction(channelId);
  }

  /** Send error card and remove processing reaction. */
  protected async onAfterTurnError(channelId: string, error: string): Promise<void> {
    const chatId = this.parseChatId(channelId);
    const card = buildMarkdownCard(`❌ **Error**: ${error}`);
    this.feishuClient.sendInteractive(chatId, card).catch(() => {});
    await this.removeReaction(channelId);
  }

  // ---- Prompt lifecycle ----

  /**
   * Called before sending a prompt.
   * Resets renderer state (via super) and adds the "OnIt" processing reaction.
   * Must be awaited so the reaction is visible before the agent starts responding.
   */
  async onPromptSent(channelId: string, userMessageId?: string): Promise<void> {
    this.lastActiveChannelId = channelId;
    super.onPromptSent(channelId); // reset block state

    const feishuState: FeishuChannelState = { userMessageId: userMessageId ?? null, reactionId: null };
    this.feishuStates.set(channelId, feishuState);

    if (userMessageId) {
      try {
        const rid = await this.feishuClient.addReaction(userMessageId, PROCESSING_EMOJI);
        this.log("debug", `addReaction result: rid=${rid} channelId=${channelId}`);
        if (rid) feishuState.reactionId = rid;
      } catch (e) {
        this.log("error", `addReaction failed: ${e}`);
      }
    }
  }

  // ---- Host ext notification handlers ----

  onAgentReady(agent: string, version: string): void {
    const channelId = this.lastActiveChannelId;
    if (!channelId) return;
    const chatId = this.parseChatId(channelId);
    this.feishuClient.sendText(chatId, `🤖 Agent: ${agent} v${version}`).catch(() => {});
  }

  onSessionReady(sessionId: string): void {
    const channelId = this.lastActiveChannelId;
    if (!channelId) return;
    const chatId = this.parseChatId(channelId);
    this.feishuClient.sendText(chatId, `📋 Session: ${sessionId}`).catch(() => {});
  }

  onSystemText(text: string, channelId?: string): void {
    const target = channelId ?? this.lastActiveChannelId;
    if (!target) return;
    const chatId = this.parseChatId(target);
    this.feishuClient.sendText(chatId, text).catch((e) => this.log("error", `sendText failed: ${e}`));
  }

  // ---- Internals ----

  private async removeReaction(channelId: string): Promise<void> {
    const state = this.feishuStates.get(channelId);
    this.feishuStates.delete(channelId); // delete before await to avoid race with next onPromptSent
    if (state?.userMessageId && state.reactionId) {
      await this.feishuClient
        .removeReaction(state.userMessageId, state.reactionId)
        .catch((e) => this.log("error", `removeReaction failed: ${e}`));
    }
  }

  /** Extract chat_id from channel_id (e.g. "feishu:oc_abc" → "oc_abc"). */
  private parseChatId(channelId: string): string {
    const idx = channelId.indexOf(":");
    return idx >= 0 ? channelId.slice(idx + 1) : channelId;
  }
}
