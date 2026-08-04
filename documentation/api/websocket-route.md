# WebSocketRoute

::: danger
WebSocket interception only supports application code that uses `globalThis.WebSocket`. It does not intercept npm `ws` clients or custom WebSocket stacks.
:::

`BackendWebSocketRoute` is passed to `backendMocks.routeWebSocket()`.

```ts
await backendMocks.routeWebSocket("wss://events.example.test/socket", async (ws) => {
  ws.send("connected");

  ws.onMessage((message) => {
    if (message === "ping") {
      ws.send("pong");
    }
  });
});
```

## `ws.url()`

Returns the WebSocket URL.

```ts
expect(ws.url()).toBe("wss://events.example.test/socket");
```

## `ws.protocols()`

Returns requested protocols.

```ts
expect(ws.protocols()).toContain("graphql-transport-ws");
```

## `ws.onMessage(handler)`

Handles messages from the app side. Messages are `string` or `Buffer`.

```ts
ws.onMessage((message) => {
  ws.send(`echo:${String(message)}`);
});
```

On the server-side route returned by `connectToServer()`, `onMessage()` handles messages from the real upstream server.

## `ws.onClose(handler)`

Handles close events.

```ts
ws.onClose((code, reason) => {
  console.log("closed", code, reason);
});
```

## `ws.send(message)`

Sends a text or binary message to the opposite side.

```ts
ws.send(JSON.stringify({ type: "ready" }));
ws.send(Buffer.from([1, 2, 3]));
```

## `ws.close(options?)`

Closes the opposite side.

```ts
await ws.close({ code: 4001, reason: "closed by test" });
```

| Option | Type | Description |
| --- | --- | --- |
| `code` | `number` | Close code. |
| `reason` | `string` | Close reason. |

## `ws.connectToServer()`

Connects to the real upstream server and returns a route for the server side.

```ts
await backendMocks.routeWebSocket("wss://events.example.test/socket", async (ws) => {
  const server = ws.connectToServer();

  ws.onMessage((message) => {
    server.send(message);
  });

  server.onMessage((message) => {
    ws.send(message);
  });
});
```

Calling `connectToServer()` twice throws.

## Matching behavior

`routeWebSocket()` accepts glob string, `RegExp`, predicate, and `URLPattern` URL matchers.

Within one test, the newest matching WebSocket route is used. Across tests, more than one claiming test fails with `ambiguous_route`.

`unrouteAll()` does not remove WebSocket routes.

## Type

```ts
interface BackendWebSocketRoute {
  url(): string;
  protocols(): string[];
  onMessage(handler: (message: string | Buffer) => unknown): void;
  onClose(
    handler: (code: number | undefined, reason: string | undefined) => unknown,
  ): void;
  send(message: string | Buffer): void;
  close(options?: { code?: number; reason?: string }): Promise<void>;
  connectToServer(): BackendWebSocketRoute;
}
```
