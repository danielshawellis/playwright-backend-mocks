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

## The simple picture

```
Browser  →  Your server  →  Stripe / email / whatever
   ▲              ▲                    ▲
 run for real   run for real      mock here
```

Playwright already helps with the left side. **This library covers the middle-to-right arrow** — the calls your Node process makes that never show up in the browser Network tab.

```ts
test("declined card shows an error", async ({ page, backendMocks }) => {
  await backendMocks.route("https://api.stripe.com/**", async (route) => {
    await route.fulfill({ status: 402, json: { error: "card_declined" } });
  });

  await page.goto("/checkout");
  await page.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByText("Your card was declined")).toBeVisible();
});
```

That mock runs against the **server’s** outbound request — not a browser fetch, and not a fake module inside your app.

[Get started in four steps →](/guide/getting-started)
