/**
 * Feishu stream renderer — extends BlockRenderer with Feishu-specific transport.
 *
 * Only implements:
 *   - sendText / sendBlock / editBlock — Feishu API calls
 *   - formatContent — Feishu markdown formatting
 *   - onAfterTurnEnd / onAfterTurnError — "OnIt" reaction management
 *
 * Everything else (block accumulation, debouncing, notification routing,
 * lastActiveChatId tracking) is handled by BlockRenderer in the SDK.
 */

import {
  BlockRenderer,
  type BlockKind,
  type CommandEntry,
  type VerboseConfig,
} from "@vibearound/plugin-channel-sdk";
import type { FeishuClient } from "./lark-client.js";
import { buildStreamingCard, buildMarkdownCard } from "./card/builder.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LogFn = (level: string, msg: string) => void;

/** Per-chat state for "OnIt" reaction tracking. */
interface ReactionState {
  userMessageId: string | null;
  reactionId: string | null;
}

const PROCESSING_EMOJI = "OnIt";

// ---------------------------------------------------------------------------
// FeishuStreamHandler
// ---------------------------------------------------------------------------

export class AgentStreamHandler extends BlockRenderer<string> {
  private feishuClient: FeishuClient;
  private log: LogFn;
  private reactionStates = new Map<string, ReactionState>();

  constructor(client: FeishuClient, log: LogFn, verbose?: Partial<VerboseConfig>) {
    super({
      streaming: true,
      flushIntervalMs: 500,
      minEditIntervalMs: 600,
      verbose,
    });
    this.feishuClient = client;
    this.log = log;
  }

  // ---- Required by BlockRenderer ----

  /** Send plain text message (for system text, agent ready, errors). */
  protected async sendText(chatId: string, text: string): Promise<void> {
    await this.feishuClient.sendText(chatId, text);
  }

  /** Send new streaming block as an interactive card. */
  protected async sendBlock(chatId: string, kind: BlockKind, content: string): Promise<string | null> {
    try {
      const card = buildStreamingCard(content);
      const messageId = await this.feishuClient.sendInteractive(chatId, card);
      this.log("debug", `sendBlock kind=${kind} messageId=${messageId}`);
      return messageId ?? null;
    } catch (e) {
      this.log("error", `sendBlock failed: ${e}`);
      return null;
    }
  }

  /** Edit existing block — streaming card while live, markdown card when sealed. */
  protected async editBlock(
    _chatId: string,
    ref: string,
    _kind: BlockKind,
    content: string,
    sealed: boolean,
  ): Promise<void> {
    try {
      const card = sealed ? buildMarkdownCard(content) : buildStreamingCard(content);
      await this.feishuClient.updateInteractive(ref, card);
    } catch (e) {
      this.log("error", `editBlock failed: ${e}`);
    }
  }

  /** Feishu markdown formatting. */
  protected formatContent(kind: BlockKind, content: string, _sealed: boolean): string {
    switch (kind) {
      case "thinking": return `💭 *${content}*`;
      case "tool":     return content;
      case "text":     return content;
    }
  }

  // ---- Feishu-specific: "OnIt" reaction ----

  /** Add "OnIt" reaction when prompt starts. */
  async onPromptSent(chatId: string, userMessageId?: string): Promise<void> {
    super.onPromptSent(chatId);

    const state: ReactionState = { userMessageId: userMessageId ?? null, reactionId: null };
    this.reactionStates.set(chatId, state);

    if (userMessageId) {
      try {
        const rid = await this.feishuClient.addReaction(userMessageId, PROCESSING_EMOJI);
        if (rid) state.reactionId = rid;
      } catch (e) {
        this.log("error", `addReaction failed: ${e}`);
      }
    }
  }

  /** Remove reaction after turn completes. */
  protected async onAfterTurnEnd(chatId: string): Promise<void> {
    await this.removeReaction(chatId);
  }

  /** Send error card and remove reaction. */
  protected async onAfterTurnError(chatId: string, error: string): Promise<void> {
    const card = buildMarkdownCard(`❌ **Error**: ${error}`);
    this.feishuClient.sendInteractive(chatId, card).catch(() => {});
    await this.removeReaction(chatId);
  }

  // ---- Command menu card ----

  /** Render command menu as a Feishu V2 card. */
  onCommandMenu(
    chatId: string,
    systemCommands: CommandEntry[],
    agentCommands: CommandEntry[],
  ): void {
    const elements: Record<string, unknown>[] = [];

    if (systemCommands.length > 0) {
      elements.push({ tag: "markdown", content: "**System Commands**" });

      // Clickable commands (no args) — primary buttons
      const clickable = systemCommands.filter((cmd) => !cmd.args && cmd.name !== "help");
      for (const cmd of clickable) {
        elements.push({
          tag: "button",
          text: { tag: "plain_text", content: `/${cmd.name}  —  ${cmd.description}` },
          type: "primary",
          size: "medium",
          behaviors: [{ type: "callback", value: { command: `/${cmd.name}` } }],
        });
      }

      // Non-clickable commands (with args) — label style
      const withArgs = systemCommands.filter((cmd) => !!cmd.args && cmd.name !== "help");
      if (withArgs.length > 0) {
        elements.push({ tag: "hr" });
        const lines = withArgs.map((cmd) => {
          const usage = `/${cmd.name} ${cmd.args}`;
          return `\`${usage}\`  <font color="grey">${cmd.description}</font>`;
        });
        elements.push({ tag: "markdown", content: lines.join("\n") });
      }
    }

    if (agentCommands.length > 0) {
      elements.push({ tag: "markdown", content: "**Agent Commands**" });
      // Agent commands as markdown list (too many for buttons)
      const lines = agentCommands.map((cmd) => {
        const desc = cmd.description
          ? `  <font color="grey">${cmd.description.length > 60 ? cmd.description.slice(0, 57) + "..." : cmd.description}</font>`
          : "";
        return `\`/agent ${cmd.name}\`${desc}`;
      });
      elements.push({ tag: "markdown", content: lines.join("\n") });
    } else if (systemCommands.length === 0) {
      // /agent with no session yet
      elements.push({
        tag: "markdown",
        content: "<font color=\"grey\">Agent commands will appear after sending your first message.</font>",
      });
    }

    const card = {
      schema: "2.0",
      config: { wide_screen_mode: true },
      body: { elements },
    };

    this.feishuClient.sendInteractive(chatId, card).catch((e) => {
      this.log("error", `sendCommandMenu failed: ${e}`);
    });
  }

  // ---- Internals ----

  private async removeReaction(chatId: string): Promise<void> {
    const state = this.reactionStates.get(chatId);
    this.reactionStates.delete(chatId);
    if (state?.userMessageId && state.reactionId) {
      await this.feishuClient
        .removeReaction(state.userMessageId, state.reactionId)
        .catch((e) => this.log("error", `removeReaction failed: ${e}`));
    }
  }
}
