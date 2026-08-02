# Getting Started

::: tip Placeholder
This page is filler content to validate the documentation site. Real installation and usage docs will replace it later.
:::

Playwright Backend Mocks lets you mock outbound HTTP/HTTPS requests made by Node.js application processes during Playwright tests.

## What you'll need

- Node.js 20+
- A Playwright test project
- A Node.js app process that makes outbound HTTP calls

## Quick sketch

1. Start the proxy coordinator.
2. Enable the Node agent in your app when running under tests.
3. Compose the Playwright fixture.
4. Call `backendMocks.route(...)` in your tests.

See the repository [README](https://github.com/danielshawellis/playwright-backend-mocks-msw) for a working quick-start until this guide is filled in.
