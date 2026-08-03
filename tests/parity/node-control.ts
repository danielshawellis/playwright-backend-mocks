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
  | { event: "open" }
  | { event: "message"; data: string; encoding: "utf8" | "base64"; binaryType?: string }
  | { event: "close"; code: number; reason: string; wasClean: boolean }
  | { event: "error" };

export type DownstreamSocket = {
  socketId: string;
  protocol: string;
  extensions: string;
  events: DownstreamSocketEvent[];
  send: (data: string | Buffer | Uint8Array, encoding?: "utf8" | "base64") => Promise<void>;
  close: (code?: number, reason?: string) => Promise<void>;
  info: () => Promise<{
    readyState: number;
    protocol: string;
    extensions: string;
  }>;
  waitForMessage: (
    timeoutMs?: number,
  ) => Promise<DownstreamSocketEvent & { event: "message" }>;
  waitForClose: (
    timeoutMs?: number,
  ) => Promise<DownstreamSocketEvent & { event: "close" }>;
  waitForOpen: (timeoutMs?: number) => Promise<void>;
  /** Convenience poll of readyState via info(). */
  readyState: () => Promise<number>;
};

let nextId = 1;
let shared: ControlClient | undefined;

class ControlClient {
  private ws: WebSocket;
  private pending = new Map<
    string,
    { resolve: (msg: ControlMsg) => void; reject: (err: Error) => void }
  >();
  private socketWaiters = new Map<string, Array<(msg: ControlMsg) => void>>();
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
        if (msg.event === "open") {
          list.push({ event: "open" });
        } else if (msg.event === "message") {
          list.push({
            event: "message",
            data: String(msg.data ?? ""),
            encoding: msg.encoding === "base64" ? "base64" : "utf8",
            binaryType: typeof msg.binaryType === "string" ? msg.binaryType : undefined,
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
    redirect?: RequestRedirect;
  }): Promise<TriggerResult> {
    const msg = await this.request("http.request", init);
    return msg.result as TriggerResult;
  }

  async openSocket(init: {
    url: string;
    protocols?: string | string[];
    binaryType?: BinaryType;
    waitUntil?: "open" | "connecting";
  }): Promise<DownstreamSocket> {
    const id = `c${nextId++}`;
    const openMsg = {
      v: 1 as const,
      id,
      op: "ws.open",
      url: init.url,
      protocols: init.protocols,
      binaryType: init.binaryType,
      waitUntil: init.waitUntil ?? "open",
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
    // If we waited for open, record a synthetic open event when none arrived yet.
    if ((init.waitUntil ?? "open") === "open") {
      const list = this.socketEvents.get(socketId) ?? [];
      if (!list.some((e) => e.event === "open")) {
        list.unshift({ event: "open" });
        this.socketEvents.set(socketId, list);
      }
    }

    return this.createDownstreamSocket(
      socketId,
      String(opened.protocol ?? ""),
      String(opened.extensions ?? ""),
    );
  }

  private createDownstreamSocket(
    socketId: string,
    protocol: string,
    extensions: string,
  ): DownstreamSocket {
    const eventsBySocket = this.socketEvents;
    const waitersBySocket = this.socketWaiters;
    const request = this.request.bind(this);

    const waitFor = async <E extends DownstreamSocketEvent["event"]>(
      event: E,
      timeoutMs: number,
    ): Promise<Extract<DownstreamSocketEvent, { event: E }>> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const list = eventsBySocket.get(socketId) ?? [];
        const idx = list.findIndex((e) => e.event === event);
        if (idx >= 0) {
          const [hit] = list.splice(idx, 1);
          if (hit && hit.event === event) {
            return hit as Extract<DownstreamSocketEvent, { event: E }>;
          }
        }
        await new Promise<void>((resolve) => {
          const remaining = Math.max(1, deadline - Date.now());
          const timer = setTimeout(() => resolve(), remaining);
          const waiters = waitersBySocket.get(socketId) ?? [];
          waiters.push(() => {
            clearTimeout(timer);
            resolve();
          });
          waitersBySocket.set(socketId, waiters);
        });
      }
      throw new Error(`timeout waiting for ws ${event}`);
    };

    return {
      socketId,
      protocol,
      extensions,
      get events() {
        return eventsBySocket.get(socketId) ?? [];
      },
      send: async (data: string | Buffer | Uint8Array, encoding: "utf8" | "base64" = "utf8") => {
        if (typeof data !== "string") {
          const buf = Buffer.isBuffer(data)
            ? data
            : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
          await request("ws.send", {
            socketId,
            data: buf.toString("base64"),
            encoding: "base64",
          });
          return;
        }
        await request("ws.send", {
          socketId,
          data,
          encoding,
        });
      },
      close: async (code?: number, reason?: string) => {
        await request("ws.close", { socketId, code, reason });
      },
      info: async () => {
        const msg = await request("ws.info", { socketId });
        return {
          readyState: Number(msg.readyState),
          protocol: String(msg.protocol ?? ""),
          extensions: String(msg.extensions ?? ""),
        };
      },
      waitForMessage: (timeoutMs = 5_000) => waitFor("message", timeoutMs),
      waitForClose: (timeoutMs = 5_000) => waitFor("close", timeoutMs),
      waitForOpen: async (timeoutMs = 5_000) => {
        await waitFor("open", timeoutMs);
      },
      readyState: async () => (await request("ws.info", { socketId })).readyState as number,
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
