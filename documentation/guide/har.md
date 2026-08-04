# HAR

`backendMocks.routeFromHAR()` records and replays Playwright-style `.har` files for outbound Node HTTP.

```ts
await backendMocks.routeFromHAR("tests/fixtures/api.har", {
  url: "https://api.example.test/**",
});
```

Use HAR when you want a committed fixture of real upstream traffic. Use `route()` when the mock is clearer as code.

## Replay from HAR

Omit `update` or set it to `false` to replay.

```ts
test("serves users from a HAR fixture", async ({ page, backendMocks }) => {
  await backendMocks.routeFromHAR("tests/fixtures/api.har", {
    url: "https://api.example.test/**",
    notFound: "abort",
  });

  await page.goto("/users");
});
```

Matching entries fulfill the Node request. No upstream call is made for a replay hit.

## Record a HAR

Set `update: true` while authoring.

```ts
test("records API calls", async ({ page, backendMocks }) => {
  await backendMocks.routeFromHAR("tests/fixtures/api.har", {
    url: "https://api.example.test/**",
    update: true,
    updateMode: "minimal",
    updateContent: "attach",
  });

  await page.goto("/users");
});
```

In update mode, matching requests call upstream through `route.fetch()`, the app receives the real response, and entries are written when the test fixture disposes.

::: warning
Recording rewrites the HAR file for that session. It does not merge entries from previous runs.
:::

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `url` | `string \| RegExp \| (url: URL) => boolean` | `"**/*"` | Limits which requests are recorded or replayed. |
| `notFound` | `"abort" \| "fallback"` | `"abort"` | Replay behavior when no entry matches. |
| `update` | `boolean` | `false` | Record live upstream traffic and rewrite the HAR. |
| `updateContent` | `"attach" \| "embed"` | `"attach"` | Store bodies as sibling files or inline text/base64. |
| `updateMode` | `"minimal" \| "full"` | `"minimal"` | Amount of metadata written during update. |

Relative paths resolve from `process.cwd()`.

## Replay matching rules

| Rule | Behavior |
| --- | --- |
| URL and method | Must match exactly. |
| `POST` body | Compared when both the request and HAR entry have post data. Multipart boundaries are ignored. |
| Multiple candidates | Entry with the most matching request headers wins. |
| Repeated requests | Entries are reused, not consumed. |
| Redirects | HAR redirects are followed inside lookup for `301`, `302`, `303`, `307`, and `308`. |
| Failure entries | Status `-1` stalls like Playwright's failed HAR entry behavior. |

## Missing entries

```ts
await backendMocks.routeFromHAR("tests/fixtures/api.har", {
  url: "https://api.example.test/**",
  notFound: "fallback",
});
```

| `notFound` | Effect |
| --- | --- |
| `"abort"` | Abort the request when no HAR entry matches. |
| `"fallback"` | Let the next matching handler run, or continue upstream if none does. |

## Supported file shape

Plain `.har` files are supported, including Playwright-style sibling `_file` attachments created by `updateContent: "attach"`.

::: warning
Zip HAR archives are not supported in the living implementation. Commit plain `.har` files and any sibling body files.
:::

## Related

- [Mock responses](/guide/mock-responses)
- [Modify and passthrough](/guide/modify-and-passthrough)
- [backendMocks API](/api/backend-mocks)
