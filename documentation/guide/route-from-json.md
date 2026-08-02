# Record and replay with JSON

`backendMocks.routeFromJSON()` gives you the same record/replay developer experience as Playwright’s [`routeFromHAR()`](https://playwright.dev/docs/mock#mocking-with-har-files), using a JSON cassette instead of a HAR file.

1. Record live upstream traffic into a JSON file (`update: true`).
2. Commit the file next to your tests.
3. Replay matching responses from that file in CI (`update: false` / omitted).

```ts
await backendMocks.routeFromJSON("./cassettes/users.json", {
  url: "https://api.example.test/**",
  update: true, // flip to false (or remove) after recording
});
```

## Recording

Set `update: true` while authoring the test. Matching requests go upstream via `route.fetch()`, the real response is returned to your app, and each request/response pair is appended to an in-memory cassette. When the test fixture disposes, the JSON file is **rewritten** with that session’s entries (same “replace the whole file” behavior as Playwright HAR update).

```ts
test("records users and charges", async ({ backendMocks, request }) => {
  await backendMocks.routeFromJSON("./cassettes/api.json", {
    url: "https://api.example.test/**",
    update: true,
  });

  // exercise the app — outbound calls are captured
});
```

Tips:

- Use a `url` glob so you only capture the APIs you care about.
- Re-running with `update: true` replaces the previous cassette; it does not merge across runs.
- Edit the JSON after recording if you want stable fixture data (ids, names, etc.).

## Replaying

Omit `update` (or set it to `false`) to serve responses from the file. No matching upstream call is made.

```ts
test("serves users from JSON", async ({ backendMocks }) => {
  await backendMocks.routeFromJSON("./cassettes/api.json", {
    url: "https://api.example.test/**",
  });

  // app traffic is fulfilled from the cassette
});
```

### Matching rules

Replay matching follows Playwright’s HAR rules:

| Rule                        | Behavior                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------- |
| URL + method                | Matched strictly                                                                       |
| `POST` body                 | Matched strictly (multipart boundaries ignored)                                        |
| Multiple matches            | Entry with the **most matching request headers** wins; ties keep file order            |
| Repeated identical requests | The same entry is reused — entries are **not** consumed                                |
| Redirects                   | `301` / `302` / `303` / `307` / `308` with `Location` are followed inside the cassette |

If identical polling calls need distinct responses, disambiguate them the same way Playwright users do: add a sequence header while recording and replaying so header scoring picks different entries.

### Missing entries

| `notFound`   | Default | Effect                        |
| ------------ | ------- | ----------------------------- |
| `"abort"`    | yes     | Fail the outbound request     |
| `"fallback"` |         | Continue the request upstream |

```ts
await backendMocks.routeFromJSON("./cassettes/api.json", {
  url: "https://api.example.test/**",
  notFound: "fallback",
});
```

## File format

```json
{
  "version": 1,
  "entries": [
    {
      "request": {
        "url": "https://api.example.test/users",
        "method": "GET",
        "headers": {
          "accept": "application/json"
        },
        "bodyBase64": null
      },
      "response": {
        "status": 200,
        "statusText": "OK",
        "headers": {
          "content-type": "application/json"
        },
        "bodyBase64": "W3siaWQiOjEsIm5hbWUiOiJBZGEifV0="
      }
    }
  ]
}
```

- One file holds **many** entries (a session log), not a single request/response pair.
- Bodies use base64 (`bodyBase64`) so binary payloads round-trip cleanly.
- Relative paths resolve from `process.cwd()`.

## Options

| Option     | Type                    | Default       | Description                              |
| ---------- | ----------------------- | ------------- | ---------------------------------------- |
| `url`      | `string \| RegExp`      | every request | Only record/replay URLs that match       |
| `update`   | `boolean`               | `false`       | Record live traffic and rewrite the file |
| `notFound` | `"abort" \| "fallback"` | `"abort"`     | Replay behavior when nothing matches     |

## When to use this vs `route()`

| Use `routeFromJSON` when…                         | Use `route()` when…                               |
| ------------------------------------------------- | ------------------------------------------------- |
| You want a quick cassette of real API traffic     | You need custom logic per request                 |
| Fixtures should be editable JSON committed to git | You’re asserting on request bodies in the handler |
| Several related endpoints share one file          | A single hard-coded mock is clearer               |
