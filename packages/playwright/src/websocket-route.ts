// Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/network.ts
//   (WebSocketRoute, WebSocketRouteHandler @ pin 26a9e47)
// Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/isomorphic/urlMatch.ts
import { resolveGlobToRegexPattern, urlMatches } from "@playwright-backend-mocks/protocol";
import type { PlaywrightProxyConnection } from "./connection.js";
import {
  getRouteUrlPredicate,
  getRouteURLPattern,
  isURLPattern,
  toSerializedMatcher,
  type RouteUrl,
  type RouteUrlPredicate,
} from "./types.js";

export type WebSocketRouteHandlerCallback = (ws: WebSocketRoute) => Promise<void> | void;

export type WebSocketRouteUrl = RouteUrl;

/**
 * Playwright-shaped WebSocketRoute for backendMocks.routeWebSocket.
 * Newest-matching handler only (no fallback chain).
 */
export interface WebSocketRoute {
  url(): string;
  protocols(): string[];
  onMessage(handler: (message: string | Buffer) => unknown): void;
  onClose(handler: (code: number | undefined, reason: string | undefined) => unknown): void;
  send(message: string | Buffer): void;
  close(options?: { code?: number; reason?: string }): Promise<void>;
  connectToServer(): WebSocketRoute;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export class WebSocketRouteImpl implements WebSocketRoute {
  private _onPageMessage?: (message: string | Buffer) => unknown;
  private _onPageClose?: (code: number | undefined, reason: string | undefined) => unknown;
  private _onServerMessage?: (message: string | Buffer) => unknown;
  private _onServerClose?: (code: number | undefined, reason: string | undefined) => unknown;
  private readonly _server: WebSocketRoute;
  private _connected = false;

  constructor(
    private readonly _socketId: string,
    private readonly _url: string,
    private readonly _protocols: string[],
    private readonly _connection: PlaywrightProxyConnection,
  ) {
    this._server = {
      onMessage: (handler) => {
        this._onServerMessage = handler;
      },
      onClose: (handler) => {
        this._onServerClose = handler;
      },
      connectToServer: () => {
        throw new Error("connectToServer must be called on the page-side WebSocketRoute");
      },
      url: () => this._url,
      protocols: () => [...this._protocols],
      close: async (options: { code?: number; reason?: string } = {}) => {
        this._connection.send({
          type: "ws:closeServer",
          socketId: this._socketId,
          ...(options.code !== undefined ? { code: options.code } : {}),
          ...(options.reason !== undefined ? { reason: options.reason } : {}),
          wasClean: true,
        });
      },
      send: (message: string | Buffer) => {
        if (isString(message)) {
          this._connection.send({
            type: "ws:sendToServer",
            socketId: this._socketId,
            data: message,
            isBase64: false,
          });
        } else {
          this._connection.send({
            type: "ws:sendToServer",
            socketId: this._socketId,
            data: message.toString("base64"),
            isBase64: true,
          });
        }
      },
    };
  }

  url(): string {
    return this._url;
  }

  protocols(): string[] {
    return [...this._protocols];
  }

  async close(options: { code?: number; reason?: string } = {}): Promise<void> {
    this._connection.send({
      type: "ws:closePage",
      socketId: this._socketId,
      ...(options.code !== undefined ? { code: options.code } : {}),
      ...(options.reason !== undefined ? { reason: options.reason } : {}),
      wasClean: true,
    });
  }

  connectToServer(): WebSocketRoute {
    if (this._connected) {
      throw new Error("Already connected to the server");
    }
    this._connected = true;
    this._connection.send({
      type: "ws:connect",
      socketId: this._socketId,
    });
    return this._server;
  }

  send(message: string | Buffer): void {
    if (isString(message)) {
      this._connection.send({
        type: "ws:sendToPage",
        socketId: this._socketId,
        data: message,
        isBase64: false,
      });
    } else {
      this._connection.send({
        type: "ws:sendToPage",
        socketId: this._socketId,
        data: message.toString("base64"),
        isBase64: true,
      });
    }
  }

  onMessage(handler: (message: string | Buffer) => unknown): void {
    this._onPageMessage = handler;
  }

  onClose(handler: (code: number | undefined, reason: string | undefined) => unknown): void {
    this._onPageClose = handler;
  }

  /** Called after the user handler resolves — mock-open if never connected. */
  async _afterHandle(): Promise<void> {
    if (this._connected) {
      return;
    }
    this._connection.send({
      type: "ws:ensureOpened",
      socketId: this._socketId,
    });
  }

  _handleMessageFromPage(data: string, isBase64: boolean): void {
    const message = isBase64 ? Buffer.from(data, "base64") : data;
    if (this._onPageMessage) {
      void this._onPageMessage(message);
    } else if (this._connected) {
      this._connection.send({
        type: "ws:sendToServer",
        socketId: this._socketId,
        data,
        isBase64,
      });
    }
  }

  _handleMessageFromServer(data: string, isBase64: boolean): void {
    const message = isBase64 ? Buffer.from(data, "base64") : data;
    if (this._onServerMessage) {
      void this._onServerMessage(message);
    } else {
      this._connection.send({
        type: "ws:sendToPage",
        socketId: this._socketId,
        data,
        isBase64,
      });
    }
  }

  _handleClosePage(code: number | undefined, reason: string | undefined, wasClean: boolean): void {
    if (this._onPageClose) {
      void this._onPageClose(code, reason);
    } else {
      this._connection.send({
        type: "ws:closeServer",
        socketId: this._socketId,
        ...(code !== undefined ? { code } : {}),
        ...(reason !== undefined ? { reason } : {}),
        wasClean,
      });
    }
  }

  _handleCloseServer(code: number | undefined, reason: string | undefined, wasClean: boolean): void {
    if (this._onServerClose) {
      void this._onServerClose(code, reason);
    } else {
      this._connection.send({
        type: "ws:closePage",
        socketId: this._socketId,
        ...(code !== undefined ? { code } : {}),
        ...(reason !== undefined ? { reason } : {}),
        wasClean,
      });
    }
  }
}

export class WebSocketRouteHandlerRecord {
  readonly routeId: string;
  readonly url: WebSocketRouteUrl;
  readonly handler: WebSocketRouteHandlerCallback;
  private readonly _baseURL: string | undefined;

  constructor(
    routeId: string,
    baseURL: string | undefined,
    url: WebSocketRouteUrl,
    handler: WebSocketRouteHandlerCallback,
  ) {
    this.routeId = routeId;
    this._baseURL = baseURL;
    this.url = url;
    this.handler = handler;
    // Eagerly validate string globs (Playwright WebSocketRouteHandler).
    if (typeof url === "string") {
      resolveGlobToRegexPattern(baseURL, url, true);
    }
  }

  matches(wsURL: string): boolean {
    const predicate = typeof this.url === "function" ? (this.url as RouteUrlPredicate) : undefined;
    const pattern = isURLPattern(this.url) ? this.url : undefined;
    if (predicate !== undefined || pattern !== undefined) {
      return urlMatches(this._baseURL, wsURL, predicate ?? pattern, true);
    }
    return urlMatches(this._baseURL, wsURL, this.url as string | RegExp, true);
  }

  async handle(route: WebSocketRouteImpl): Promise<void> {
    await this.handler(route);
    await route._afterHandle();
  }
}

export function toWebSocketSerializedMatcher(url: WebSocketRouteUrl) {
  // Reuse HTTP matcher serialization (predicate / glob / regex / URLPattern).
  return toSerializedMatcher(url);
}

export function extractWebSocketUrl(url: WebSocketRouteUrl): RouteUrl {
  return url;
}

export function getWebSocketUrlPredicate(url: WebSocketRouteUrl): RouteUrlPredicate | undefined {
  return getRouteUrlPredicate(url);
}

export function getWebSocketURLPattern(url: WebSocketRouteUrl): URLPattern | undefined {
  return getRouteURLPattern(url);
}
