<script setup lang="ts">
import { withBase } from "vitepress";
import { onMounted, ref } from "vue";
import HighlightedCode from "./HighlightedCode.vue";
import MermaidDiagram from "./MermaidDiagram.vue";

const example = `test("declined card shows an error", async ({ page, backendMocks }) => {
  await backendMocks.route("https://api.stripe.com/**", async (route) => {
    await route.fulfill({
      status: 402,
      json: { error: "card_declined" },
    });
  });

  await page.goto("/checkout");
  await page.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByText("Your card was declined")).toBeVisible();
});`;

const architectureDiagram = `sequenceDiagram
  participant App as Your Node app
  participant MSW as @mswjs/interceptors
  participant Proxy as Proxy server
  participant Test as Playwright test

  App->>MSW: outbound HTTP call
  MSW->>Proxy: pause and forward request
  Proxy->>Test: match backendMocks.route()
  Test-->>Proxy: fulfill / continue / abort
  Proxy-->>MSW: return decision
  MSW-->>App: mocked or real response`;

const videoSrc = withBase("/dashboard-demo.mp4");
const posterSrc = withBase("/dashboard-demo-poster.svg");
const gettingStartedHref = withBase("/guide/getting-started");
const whyHref = withBase("/guide/why");
const hasVideo = ref(false);

onMounted(async () => {
  try {
    const response = await fetch(videoSrc, { method: "HEAD" });
    hasVideo.value = response.ok;
  } catch {
    hasVideo.value = false;
  }
});
</script>

<template>
  <div class="home-page">
    <section class="home-section home-section--syntax">
      <div class="home-section__inner">
        <p class="home-section__eyebrow">From your Playwright tests</p>
        <h2 class="home-section__title">
          Mock Requests from Node.js Directly from Your Tests with Familiar Playwright
          Syntax
        </h2>
        <p class="home-section__lead">
          Same
          <code>route</code> / <code>fulfill</code> / <code>continue</code> /
          <code>abort</code>
          mental model as
          <code>page.route()</code>
          — aimed at the outbound HTTP your
          <strong>server</strong> makes, not the browser.
        </p>
        <HighlightedCode :code="example" lang="ts" filename="checkout.spec.ts" />
      </div>
    </section>

    <section class="home-section home-section--architecture">
      <div class="home-section__inner">
        <p class="home-section__eyebrow">How it works</p>
        <h2 class="home-section__title">
          Not magic — a proxy your Playwright tests control
        </h2>
        <p class="home-section__lead">
          Your app still runs for real. We intercept the HTTP it sends to the outside
          world, then let the test decide what happens next.
        </p>

        <div class="home-pillars" role="list">
          <article class="home-pillar" role="listitem">
            <span class="home-pillar__num">1</span>
            <h3 class="home-pillar__title">Start a proxy server</h3>
            <p class="home-pillar__body">
              A small local process that sits between your Node app and Playwright. It
              matches routes, returns decisions, and hosts the debug dashboard.
            </p>
          </article>
          <article class="home-pillar" role="listitem">
            <span class="home-pillar__num">2</span>
            <h3 class="home-pillar__title">Route Node HTTP through it</h3>
            <p class="home-pillar__body">
              In your app, <code>startBackendMocks()</code> uses
              <code>@mswjs/interceptors</code> to catch outbound <code>fetch</code> /
              <code>http</code> / <code>https</code> calls and send them to the proxy
              instead of going straight to Stripe, email, etc.
            </p>
          </article>
          <article class="home-pillar" role="listitem">
            <span class="home-pillar__num">3</span>
            <h3 class="home-pillar__title">Control it from Playwright</h3>
            <p class="home-pillar__body">
              Your test calls <code>backendMocks.route(...)</code>. When the app makes a
              matching request, the handler runs in Playwright — fulfill a mock, continue
              upstream, or abort — and Node gets that result.
            </p>
          </article>
        </div>

        <p class="home-section__sublead">One request, end to end:</p>

        <div class="home-diagram">
          <MermaidDiagram :code="architectureDiagram" />
        </div>

        <p class="home-section__footnote">
          Unmatched requests pass through to the real network. Outside tests, with no
          proxy URL set, the Node agent is a no-op.
        </p>
      </div>
    </section>

    <section class="home-section home-section--dashboard">
      <div class="home-section__inner">
        <p class="home-section__eyebrow">Observability</p>
        <h2 class="home-section__title">
          Watch connections and request history while you debug
        </h2>
        <p class="home-section__lead">
          Open the proxy dashboard to see which Node agents and Playwright workers are
          connected, and whether each outbound call was mocked, continued, aborted, or
          passed through.
        </p>

        <div class="home-video">
          <div class="home-video__frame" :class="{ 'has-video': hasVideo }">
            <video
              v-if="hasVideo"
              class="home-video__player"
              controls
              playsinline
              preload="metadata"
              :poster="posterSrc"
            >
              <source :src="videoSrc" type="video/mp4" />
            </video>

            <div v-else class="home-video__filler">
              <div class="home-video__filler-ui">
                <div class="home-video__filler-bar">
                  <span>Playwright Backend Mocks</span>
                  <span class="home-video__filler-pill">live</span>
                </div>
                <div class="home-video__filler-grid">
                  <div class="home-video__filler-card">
                    <strong>Connections</strong>
                    <span>api-server · job-worker · playwright-0</span>
                  </div>
                  <div class="home-video__filler-card">
                    <strong>Request history</strong>
                    <span>mocked · passthrough · aborted</span>
                  </div>
                </div>
                <div class="home-video__play" aria-hidden="true">
                  <span class="home-video__play-icon" />
                </div>
                <p class="home-video__filler-caption">
                  Dashboard demo placeholder — drop a screen recording at
                  <code>documentation/public/dashboard-demo.mp4</code>
                </p>
              </div>
            </div>
          </div>
          <p class="home-video__note">
            Available at <code>/dashboard</code> while the proxy is running.
          </p>
        </div>
      </div>
    </section>

    <section class="home-section home-section--cta">
      <div class="home-section__inner home-cta">
        <h2 class="home-section__title">Ready to wire it into a suite?</h2>
        <p class="home-section__lead">
          Four steps: start the proxy, enable the Node agent, compose the fixture, write
          your first route.
        </p>
        <div class="home-cta__actions">
          <a class="home-cta__button home-cta__button--brand" :href="gettingStartedHref"
            >Get Started</a
          >
          <a class="home-cta__button" :href="whyHref">Why this library</a>
        </div>
      </div>
    </section>
  </div>
</template>
