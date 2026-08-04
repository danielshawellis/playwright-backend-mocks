# WebSockets

::: danger
WebSocket interception only supports application code that uses `globalThis.WebSocket`. It does not intercept sockets created with the npm `ws` package or other custom WebSocket clients.
:::

Use `backendMocks.routeWebSocket()` to handle outbound app WebSocket connections made through `globalThis.WebSocket`.

```ts
await backendMocks.routeWebSocket("wss://events.example.test/socket", async (ws) => {
  ws.onMessage((message) => {
    if (message === "ping") {
      ws.send("pong-from-test");
    }
  });
});
```

## Mock a socket

If the handler does not call `connectToServer()`, the library opens a mocked socket and the handler controls messages sent to the app.

```ts
await backendMocks.routeWebSocket("wss://events.example.test/socket", async (ws) => {
  ws.send(JSON.stringify({ type: "ready" }));

  ws.onMessage((message) => {
    const event = JSON.parse(String(message)) as { type: string };
    if (event.type === "subscribe") {
      ws.send(JSON.stringify({ type: "subscribed" }));
    }
  });
});
```

## Pass through to the real server

Call `connectToServer()` to open the real upstream connection. The returned route represents the server side.

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

With no `onMessage` handler, messages are relayed by default after `connectToServer()`.

## Modify messages

```ts
await backendMocks.routeWebSocket("wss://events.example.test/socket", async (ws) => {
  const server = ws.connectToServer();

  ws.onMessage((message) => {
    server.send(
      JSON.stringify({
        ...JSON.parse(String(message)),
        fromTest: true,
      }),
    );
  });

  server.onMessage((message) => {
    ws.send(message);
  });
});
```

## Close sockets

```ts
await backendMocks.routeWebSocket("wss://events.example.test/socket", async (ws) => {
  ws.close({ code: 4001, reason: "closed by test" });
});
```

`onClose()` receives the close code and reason.

```ts
await backendMocks.routeWebSocket("wss://events.example.test/socket", async (ws) => {
  ws.onClose((code, reason) => {
    console.log("app socket closed", code, reason);
  });
});
```

## Matching and ownership

`routeWebSocket()` accepts the URL matcher forms: glob string, `RegExp`, predicate, and `URLPattern`.

Within one test, the newest matching WebSocket route handles the connection. There is no fallback chain. Across tests, two claiming tests cause `ambiguous_route`, just like HTTP.

::: warning
`unrouteAll()` removes HTTP routes only. WebSocket routes intentionally survive it, matching the living implementation's Playwright parity behavior.
:::

## API summary

| Method | Description |
| --- | --- |
| `ws.url()` | WebSocket URL. |
| `ws.protocols()` | Requested protocols. |
| `ws.onMessage(handler)` | Handle messages from the app side, or from the server side on the route returned by `connectToServer()`. |
| `ws.onClose(handler)` | Handle close from that side. |
| `ws.send(message)` | Send text or `Buffer` to the opposite side. |
| `ws.close(options?)` | Close the opposite side. |
| `ws.connectToServer()` | Connect to the real upstream and return the server-side route. |

See [WebSocketRoute API](/api/websocket-route).
