/**
 * stdio JSON-RPC 2.0 transport.
 *
 * Newline-delimited JSON on stdin/stdout.
 * stderr for debug logging (not part of protocol).
 */

import { createInterface } from "node:readline";
import type {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcNotification,
  JsonRpcResponse,
} from "./protocol.js";

type RequestHandler = (params: Record<string, unknown>) => Promise<unknown>;
type NotificationHandler = (params: Record<string, unknown>) => void;

export class StdioTransport {
  private requestHandlers = new Map<string, RequestHandler>();
  private notificationHandlers = new Map<string, NotificationHandler>();
  private pendingRequests = new Map<
    string | number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private nextId = 1;
  private rl: ReturnType<typeof createInterface> | null = null;

  onRequest(method: string, handler: RequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  onNotification(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.set(method, handler);
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  start(): void {
    this.rl = createInterface({ input: process.stdin, terminal: false });
    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        this.handleMessage(JSON.parse(trimmed) as JsonRpcMessage);
      } catch (err) {
        this.log("error", `parse failed: ${err}`);
      }
    });
    this.rl.on("close", () => {
      this.log("warn", "stdin closed — host disconnected");
      // Don't exit immediately; let gateway keep running for graceful shutdown.
      // The process will exit when the host sends SIGTERM or kills the child.
    });
  }

  stop(): void {
    this.rl?.close();
    this.rl = null;
  }

  log(level: string, msg: string): void {
    process.stderr.write(`[feishu-plugin][${level}] ${msg}\n`);
    // Also send via JSON-RPC so the host can handle structured logs
    this.notify("plugin_log", { level, message: msg });
  }

  // --------------------------------------------------------------------------

  private async handleMessage(msg: JsonRpcMessage): Promise<void> {
    // Response to our outgoing request
    if ("result" in msg || "error" in msg) {
      const resp = msg as JsonRpcResponse;
      const pending = this.pendingRequests.get(resp.id);
      if (pending) {
        this.pendingRequests.delete(resp.id);
        resp.error
          ? pending.reject(new Error(`${resp.error.code}: ${resp.error.message}`))
          : pending.resolve(resp.result);
      }
      return;
    }

    // Incoming request (has id → expects response)
    if ("id" in msg && msg.id != null) {
      const req = msg as JsonRpcRequest;
      const handler = this.requestHandlers.get(req.method);
      if (!handler) {
        this.write({
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32601, message: `Method not found: ${req.method}` },
        });
        return;
      }
      try {
        const result = await handler(req.params ?? {});
        this.write({ jsonrpc: "2.0", id: req.id, result });
      } catch (err) {
        this.write({
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
        });
      }
      return;
    }

    // Incoming notification (no id)
    const notif = msg as JsonRpcNotification;
    this.notificationHandlers.get(notif.method)?.(notif.params ?? {});
  }

  private write(msg: Record<string, unknown>): void {
    process.stdout.write(JSON.stringify(msg) + "\n");
  }
}
