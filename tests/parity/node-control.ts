/**
 * Client for the Node downstream control-plane WebSocket.
 * Drives shared outbound fetch + app WebSockets inside the Node host process.
 */
import WebSocket from "ws";
import type { TriggerResult } from "./helpers.js";
import { NODE_CONTROL_WS } from "./helpers.js";

type ControlMsg = {
  v: 1;
  id?: string;
  op: string;
  [key: string]: unknown;
};

export type DownstreamSocketEvent =
  | { event: "message"; data: string; encoding: "utf8" | "base64" }
  | { event: "close"; code: number; reason: string; wasClean: boolean }
  | { event: "error" };

export type DownstreamSocket = {
  socketId: string;
  protocol: string;
  extensions: string;
  events: DownstreamSocketEvent[];
  send: (data: string | Buffer, encoding?: "utf8" | "base64") => Promise<void>;
  close: (code?: number, reason?: string) => Promise<void>;
  info: () => Promise<{
    readyState: number;
    protocol: string;
    extensions: string;
  }>;
  waitForMessage: (timeoutMs?: number) => Promise<DownstreamSocketEvent & { event: "message" }>;
};

let nextId = 1;
let shared: ControlClient | undefined;

class ControlClient {
  private ws: WebSocket;
  private pending = new Map<
    string,
    { resolve: (msg: ControlMsg) => void; reject: (err: Error) => void }
  >();
  private socketWaiters = new Map<
    string,
    Array<(msg: ControlMsg) => void>
  >();
  private socketEvents = new Map<string, DownstreamSocketEvent[]>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (raw) => {
      let msg: ControlMsg;
      try {
        msg = JSON.parse(String(raw)) as ControlMsg;
      } catch {
        return;
      }
      if (msg.op === "ws.event" && typeof msg.socketId === "string") {
        const socketId = msg.socketId;
        const list = this.socketEvents.get(socketId) ?? [];
        if (msg.event === "message") {
          list.push({
            event: "message",
            data: String(msg.data ?? ""),
            encoding: msg.encoding === "base64" ? "base64" : "utf8",
          });
        } else if (msg.event === "close") {
          list.push({
            event: "close",
            code: Number(msg.code ?? 0),
            reason: String(msg.reason ?? ""),
            wasClean: Boolean(msg.wasClean),
          });
        } else if (msg.event === "error") {
          list.push({ event: "error" });
        }
        this.socketEvents.set(socketId, list);
        const waiters = this.socketWaiters.get(socketId) ?? [];
        this.socketWaiters.set(socketId, []);
        for (const wake of waiters) wake(msg);
      }
      if (typeof msg.id === "string" && this.pending.has(msg.id)) {
        // ws.event shares the open request id — don't resolve open on events.
        if (msg.op === "ws.event") return;
        const pending = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.op === "error") {
          pending?.reject(new Error(String(msg.message ?? "control_error")));
        } else {
          pending?.resolve(msg);
        }
      }
    });
  }

  static async connect(url = NODE_CONTROL_WS): Promise<ControlClient> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", (err) => reject(err));
    });
    return new ControlClient(ws);
  }

  private request(op: string, body: Record<string, unknown>): Promise<ControlMsg> {
    const id = `c${nextId++}`;
    const msg = { v: 1 as const, id, op, ...body };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(msg));
    });
  }

  async httpRequest(init: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<TriggerResult> {
    const msg = await this.request("http.request", init);
    return msg.result as TriggerResult;
  }

  async openSocket(init: {
    url: string;
    protocols?: string | string[];
    binaryType?: BinaryType;
  }): Promise<DownstreamSocket> {
    const id = `c${nextId++}`;
    const openMsg = {
      v: 1 as const,
      id,
      op: "ws.open",
      url: init.url,
      protocols: init.protocols,
      binaryType: init.binaryType,
    };

    const opened = await new Promise<ControlMsg>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(openMsg));
    });
    if (opened.op !== "ws.opened" || typeof opened.socketId !== "string") {
      throw new Error(`expected ws.opened, got ${opened.op}`);
    }
    const socketId = opened.socketId;
    // Preserve any events that raced in before we observed ws.opened.
    if (!this.socketEvents.has(socketId)) {
      this.socketEvents.set(socketId, []);
    }

    const self = this;
    return {
      socketId,
      protocol: String(opened.protocol ?? ""),
      extensions: String(opened.extensions ?? ""),
      get events() {
        return self.socketEvents.get(socketId) ?? [];
      },
      async send(data: string | Buffer, encoding: "utf8" | "base64" = "utf8") {
        if (Buffer.isBuffer(data)) {
          await self.request("ws.send", {
            socketId,
            data: data.toString("base64"),
            encoding: "base64",
          });
          return;
        }
        await self.request("ws.send", {
          socketId,
          data,
          encoding,
        });
      },
      async close(code?: number, reason?: string) {
        await self.request("ws.close", { socketId, code, reason });
      },
      async info() {
        const msg = await self.request("ws.info", { socketId });
        return {
          readyState: Number(msg.readyState),
          protocol: String(msg.protocol ?? ""),
          extensions: String(msg.extensions ?? ""),
        };
      },
      async waitForMessage(timeoutMs = 5_000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const list = self.socketEvents.get(socketId) ?? [];
          const idx = list.findIndex((e) => e.event === "message");
          if (idx >= 0) {
            const [hit] = list.splice(idx, 1);
            if (hit && hit.event === "message") return hit;
          }
          await new Promise<void>((resolve) => {
            const remaining = Math.max(1, deadline - Date.now());
            const timer = setTimeout(() => resolve(), remaining);
            const waiters = self.socketWaiters.get(socketId) ?? [];
            waiters.push(() => {
              clearTimeout(timer);
              resolve();
            });
            self.socketWaiters.set(socketId, waiters);
          });
        }
        throw new Error("timeout waiting for ws message");
      },
    };
  }

  async close(): Promise<void> {
    this.ws.close();
  }
}

export async function getNodeControl(): Promise<ControlClient> {
  if (!shared) {
    shared = await ControlClient.connect();
  }
  return shared;
}

export async function resetNodeControl(): Promise<void> {
  if (shared) {
    await shared.close().catch(() => undefined);
    shared = undefined;
  }
}
