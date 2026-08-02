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

const architectureDiagram = `flowchart LR
  PW["Playwright test<br/>backendMocks.route()"]
  Proxy["Proxy<br/>match · history · dashboard"]
  Node["Your Node app<br/>startBackendMocks()"]
  Outside["Third parties<br/>Stripe · email · APIs"]

  PW <-->|"WebSocket"| Proxy
  Proxy <-->|"WebSocket"| Node
  Node -->|"outbound HTTP"| Outside`;

const boundaryDiagram = `flowchart LR
  Browser["Browser<br/>run for real"] --> Server["Your server<br/>run for real"]
  Server --> Edge["Third parties<br/>mock here"]`;

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
          A small proxy sits between your tests and your Node app
        </h2>
        <p class="home-section__lead">
          Your real server keeps running. When it calls the outside world, a tiny agent
          pauses that request and asks the proxy what to do. Your Playwright test answers
          — mock it, let it through, or fail it — then the server continues.
        </p>

        <div class="home-diagram">
          <MermaidDiagram :code="architectureDiagram" />
        </div>

        <p class="home-section__sublead">
          The goal in one glance: run the browser and server for real; mock only the
          outside world.
        </p>

        <div class="home-diagram home-diagram--compact">
          <MermaidDiagram :code="boundaryDiagram" />
        </div>

        <ol class="home-steps">
          <li>
            <strong>Start the proxy</strong> next to your app (usually via Playwright
            <code>webServer</code>).
          </li>
          <li>
            <strong>Enable the Node agent</strong> in each process under test — it’s a
            no-op when the proxy URL isn’t set.
          </li>
          <li>
            <strong>Register routes in the test</strong> with familiar Playwright syntax.
            Unmatched calls pass through to the real network.
          </li>
        </ol>
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
