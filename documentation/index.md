---
layout: home

hero:
  name: Playwright Backend Mocks
  text: Mock Node outbound HTTP from Playwright
  tagline: Route, fulfill, and observe backend traffic made by your Node.js app processes — with an API that feels like Playwright browser routing.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Why this library
      link: /guide/why
    - theme: alt
      text: GitHub
      link: https://github.com/danielshawellis/playwright-backend-mocks-msw

features:
  - title: Familiar Playwright API
    details: Use route / fulfill / continue / fetch / abort from your tests — the same mental model as page.route(), applied to Node outbound HTTP.
  - title: Process-aware interception
    details: Intercept Fetch and node:http/https inside your app via @mswjs/interceptors. Works across API servers, workers, and other Node processes.
  - title: Safe by default outside tests
    details: The Node agent is a no-op unless PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL is set, so the same startup path works in production and e2e.
  - title: Built-in observability
    details: Spy on matched requests in tests, and use the proxy dashboard for live connections and request history while debugging.
---
