/**
 * Feishu stream renderer — extends BlockRenderer with Feishu-specific transport.
 *
 * Implements:
 *   - sendText / sendBlock / editBlock — Feishu API calls
 *   - formatContent — Feishu markdown formatting
 *   - onAfterTurnError — error card
 *   - onCommandMenu — V2 card for command listing
 *   - onRequestPermission — V2 card with interactive permission buttons
 *
 * Everything else (block accumulation, debouncing, notification routing,
 * toolCallId caching, text-permission fallback, lastActiveChatId tracking)
 * is handled by BlockRenderer in the SDK.
 */

import {
  BlockRenderer,
  type BlockKind,
  type CommandEntry,
  type RequestPermissionRequest,
  type VerboseConfig,
} from "@vibearound/plugin-channel-sdk";
import type { FeishuClient } from "./lark-client.js";
import { buildStreamingCard, buildMarkdownCard } from "./card/builder.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LogFn = (level: string, msg: string) => void;

// ---------------------------------------------------------------------------
// FeishuStreamHandler
// ---------------------------------------------------------------------------

export class AgentStreamHandler extends BlockRenderer<string> {
  private feishuClient: FeishuClient;
  private log: LogFn;

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

  // ---- Error rendering ----

  /** Send error card on turn error. */
  protected async onAfterTurnError(chatId: string, error: string): Promise<void> {
    const card = buildMarkdownCard(`❌ **Error**\n\n${error}`);
    this.feishuClient.sendInteractive(chatId, card).catch(() => {});
  }

  // ---- Permission UI (Tier 1: interactive card buttons) ----

  /**
   * Render a permission request as a V2 card with all options on a single
   * horizontal row of buttons (via `column_set`). The button `value` encodes
   * `{ kind: "permission", callbackId, optionId, optionName }` so the gateway's
   * card action handler can route the click back to `resolvePermission` and
   * update the card into a resolved state.
   *
   * We capture the sent messageId in `permissionCardMessages` keyed by
   * callbackId so the gateway can edit the card after the first click.
   */
  protected async onRequestPermission(
    chatId: string,
    request: RequestPermissionRequest,
    callbackId: string,
  ): Promise<void> {
    const options = request.options ?? [];
    const toolTitle =
      (request.toolCall as { title?: string } | undefined)?.title ?? "the agent";

    const buttonColumns = options.map((opt) => ({
      tag: "column",
      width: "weighted",
      weight: 1,
      vertical_align: "center",
      elements: [
        {
          tag: "button",
          text: { tag: "plain_text", content: opt.name },
          type: buttonTypeForKind(opt.kind),
          size: "medium",
          width: "fill",
          behaviors: [
            {
              type: "callback",
              value: {
                kind: "permission",
                callbackId,
                optionId: opt.optionId,
                optionName: opt.name,
              },
            },
          ],
        },
      ],
    }));

    const card = {
      schema: "2.0",
      config: { wide_screen_mode: true },
      body: {
        elements: [
          {
            tag: "markdown",
            content: `🔐 **Permission required**\n\n\`${toolTitle}\``,
          },
          {
            tag: "column_set",
            flex_mode: "stretch",
            horizontal_spacing: "8px",
            columns: buttonColumns,
          },
        ],
      },
    };

    try {
      await this.feishuClient.sendInteractive(chatId, card);
    } catch (e) {
      this.log("error", `onRequestPermission send failed: ${e}`);
      throw e;
    }
  }

  /**
   * Build the "finalized" card shown after a permission button has been
   * clicked. Used as the HTTP response body of the Feishu card-action
   * callback, which atomically replaces the original card with this one —
   * no separate update-API roundtrip, no timing window where the user can
   * click the button twice.
   */
  buildFinalizedPermissionCard(optionName: string): Record<string, unknown> {
    return {
      schema: "2.0",
      config: { wide_screen_mode: true },
      body: {
        elements: [
          {
            tag: "markdown",
            content: `🔐 Permission — selected: **${optionName}**`,
          },
        ],
      },
    };
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map permission option kinds to Feishu V2 button styles. */
function buttonTypeForKind(kind: string): string {
  switch (kind) {
    case "allow_once":
    case "allow_always":
      return "primary";
    case "reject_once":
    case "reject_always":
      return "danger";
    default:
      return "default";
  }
}
