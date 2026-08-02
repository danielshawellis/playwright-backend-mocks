<script setup lang="ts">
import { withBase } from "vitepress";
import { onMounted, ref } from "vue";

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

const videoSrc = withBase("/dashboard-demo.mp4");
const posterSrc = withBase("/dashboard-demo-poster.svg");
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
  <div class="home-sections">
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
        <div class="home-code" aria-label="Example Playwright test">
          <div class="home-code__chrome">
            <span class="home-code__dot" />
            <span class="home-code__dot" />
            <span class="home-code__dot" />
            <span class="home-code__label">checkout.spec.ts</span>
          </div>
          <pre class="home-code__pre"><code>{{ example }}</code></pre>
        </div>
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

        <div class="arch" role="img" aria-label="Architecture diagram">
          <div class="arch__node">
            <span class="arch__label">Playwright test</span>
            <span class="arch__detail"><code>backendMocks.route(...)</code></span>
          </div>
          <div class="arch__arrow" aria-hidden="true">
            <span class="arch__arrow-line" />
            <span class="arch__arrow-text">WebSocket</span>
          </div>
          <div class="arch__node arch__node--accent">
            <span class="arch__label">Proxy</span>
            <span class="arch__detail">Match routes · history · dashboard</span>
          </div>
          <div class="arch__arrow" aria-hidden="true">
            <span class="arch__arrow-line" />
            <span class="arch__arrow-text">WebSocket</span>
          </div>
          <div class="arch__node">
            <span class="arch__label">Your Node app</span>
            <span class="arch__detail"><code>startBackendMocks()</code></span>
          </div>
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
  </div>
</template>
