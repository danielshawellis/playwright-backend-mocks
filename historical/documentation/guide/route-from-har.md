# Record and replay with HAR

`backendMocks.routeFromHAR()` mirrors Playwright’s [`routeFromHAR()`](https://playwright.dev/docs/mock#mocking-with-har-files): record live upstream traffic into a HAR file, commit it next to your tests, and replay matching responses in CI.

Node outbound traffic will not populate browser-only HAR fields (cookies from the browser jar, document navigation entries, etc.). Matching, redirects, `notFound`, and update behavior otherwise follow Playwright.

```ts
await backendMocks.routeFromHAR("./fixtures/api.har", {
  url: "https://api.example.test/**",
  update: true, // flip to false (or remove) after recording
});
```

## Recording

Set `update: true` while authoring the test. Matching requests go upstream via `route.fetch()`, the real response is returned to your app, and each request/response pair is recorded. When the test fixture disposes, the HAR file is **rewritten** with that session’s entries (same “replace the whole file” behavior as Playwright).

```ts
test("records users and charges", async ({ backendMocks }) => {
  await backendMocks.routeFromHAR("./fixtures/api.har", {
    url: "https://api.example.test/**",
    update: true,
    updateMode: "minimal",
  });

  // exercise the app — outbound calls are captured
});
```

Tips:

- Use a `url` glob so you only capture the APIs you care about.
- Re-running with `update: true` replaces the previous HAR; it does not merge across runs.
- Edit the HAR after recording if you want stable fixture data (ids, names, etc.).

## Replaying

Omit `update` (or set it to `false`) to serve responses from the file. No matching upstream call is made for a fulfilled entry.

```ts
test("serves users from HAR", async ({ backendMocks }) => {
  await backendMocks.routeFromHAR("./fixtures/api.har", {
    url: "https://api.example.test/**",
  });

  // app traffic is fulfilled from the HAR
});
```

### Matching rules

Replay matching follows Playwright’s HAR rules:

| Rule                        | Behavior                                                                          |
| --------------------------- | --------------------------------------------------------------------------------- |
| URL + method                | Matched strictly                                                                  |
| `POST` body                 | Matched when both sides have post data (multipart boundaries ignored)             |
| Multiple matches            | Entry with the **most matching request headers** wins; ties keep file order       |
| Repeated identical requests | The same entry is reused — entries are **not** consumed                           |
| Redirects                   | `301` / `302` / `303` / `307` / `308` with `Location` are followed inside the HAR |

If identical polling calls need distinct responses, disambiguate them the same way Playwright users do: add a sequence header while recording and replaying so header scoring picks different entries.

### Missing entries

| `notFound`   | Default | Effect                        |
| ------------ | ------- | ----------------------------- |
| `"abort"`    | yes     | Fail the outbound request     |
| `"fallback"` |         | Continue the request upstream |

```ts
await backendMocks.routeFromHAR("./fixtures/api.har", {
  url: "https://api.example.test/**",
  notFound: "fallback",
});
```

## Options

| Option          | Type                    | Default            | Description                                       |
| --------------- | ----------------------- | ------------------ | ------------------------------------------------- |
| `url`           | `string \| RegExp`      | every request      | Only record/replay URLs that match                |
| `update`        | `boolean`               | `false`            | Record live traffic and rewrite the file          |
| `updateMode`    | `"full" \| "minimal"`   | Playwright default | How much detail to record when updating           |
| `updateContent` | `"embed" \| "attach"`   | Playwright default | How response bodies are stored (`attach`/zip OOS) |
| `notFound`      | `"abort" \| "fallback"` | `"abort"`          | Replay behavior when nothing matches              |

Relative paths resolve from `process.cwd()`. Prefer plain `.har` files; zip/attach packaging is out of scope for Node mocks.

## When to use this vs `route()`

| Use `routeFromHAR` when…                       | Use `route()` when…                               |
| ---------------------------------------------- | ------------------------------------------------- |
| You want a quick recording of real API traffic | You need custom logic per request                 |
| Fixtures should be committed HAR next to tests | You’re asserting on request bodies in the handler |
| Several related endpoints share one file       | A single hard-coded mock is clearer               |
