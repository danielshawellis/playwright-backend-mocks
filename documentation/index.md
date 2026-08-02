---
layout: home

hero:
  name: Playwright Backend Mocks
  text: Run the real app. Mock only the outside world.
  tagline: Good e2e tests cover your UI and your server — then fake Stripe, email, and every other third party at the boundary. Playwright can do the browser half. We make the server half just as easy.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: See why this is rare
      link: /guide/why
    - theme: alt
      text: GitHub
      link: https://github.com/danielshawellis/playwright-backend-mocks-msw

features:
  - title: Your whole app, not just the browser
    details: Click a button in the UI, run the real Node server, and assert the result. No “e2e” that stops at the API boundary or stubs half the app out of existence.
  - title: Mock only at the edges
    details: Leave your codepaths intact. Intercept the outbound HTTP your server makes to payments, email, SMS, and other third parties — the true system boundary.
  - title: Same idea as page.route()
    details: If you already mock browser traffic in Playwright, you already know this API. route, fulfill, continue, abort — now for Node outbound calls too.
  - title: Surprisingly hard elsewhere
    details: Most Playwright suites can’t see server-side HTTP at all. They hit real services, bury test doubles in app code, or skip the server. We remove that tradeoff.
---
