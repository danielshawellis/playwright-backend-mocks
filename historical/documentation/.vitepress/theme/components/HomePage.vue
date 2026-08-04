<script setup lang="ts">
import { withBase } from "vitepress";
import { onMounted, ref } from "vue";
import HighlightedCode from "./HighlightedCode.vue";
import HomeCodeGroup from "./HomeCodeGroup.vue";
import LogoCloud from "./LogoCloud.vue";
import MermaidDiagram from "./MermaidDiagram.vue";

const compatibilityLogos = [
  { name: "fetch", icon: "logos:fetch" },
  { name: "http", icon: "carbon:http" },
  { name: "axios", icon: "logos:axios" },
  { name: "Next.js", icon: "logos:nextjs-icon", invertDark: true },
  { name: "Nuxt.js", icon: "logos:nuxt-icon" },
  { name: "Stripe", icon: "logos:stripe" },
  { name: "Got", src: "/logos/got.svg" },
  { name: "node-fetch", src: "/logos/node-fetch.svg" },
  { name: "Twilio", icon: "logos:twilio-icon" },
  { name: "GraphQL", icon: "logos:graphql" },
  { name: "Supabase", icon: "logos:supabase-icon" },
  { name: "Firebase", icon: "logos:firebase-icon" },
  { name: "OpenAI", icon: "logos:openai-icon", invertDark: true },
  { name: "Algolia", icon: "logos:algolia" },
  { name: "Express", icon: "simple-icons:express", invertDark: true },
  { name: "Fastify", icon: "logos:fastify-icon", invertDark: true },
  { name: "NestJS", icon: "logos:nestjs" },
  { name: "RedwoodJS", icon: "logos:redwoodjs" },
  { name: "SvelteKit", icon: "logos:svelte-icon" },
  { name: "Astro", icon: "logos:astro-icon" },
  { name: "Apollo", icon: "logos:apollostack" },
  { name: "urql", src: "/logos/urql.svg" },
  { name: "tRPC", icon: "logos:trpc" },
  { name: "Undici", icon: "logos:nodejs-icon" },
  { name: "Ky", src: "/logos/ky.png" },
  { name: "Koa", icon: "logos:koa" },
  { name: "Hapi", icon: "logos:hapi" },
  { name: "Remix", icon: "logos:remix-icon", invertDark: true },
];

const introExample = `test("declined card shows an error", async ({ page, backendMocks }) => {
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

const nodeSetupExample = `import { startBackendMocks } from "@playwright-backend-mocks/node";

if (process.env.NODE_ENV === "test") {
  await startBackendMocks({
    proxyUrl: process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL,
    clientId: "api-server",
  });
}

// The rest of your app is unchanged — keep using fetch, http, axios, etc.`;

const apiTabs = [
  {
    label: "Mock",
    code: `test("shows a declined card error", async ({ page, backendMocks }) => {
  await backendMocks.route("https://api.stripe.com/**", async (route) => {
    await route.fulfill({
      status: 402,
      json: { error: "card_declined" },
    });
  });

  await page.goto("/checkout");
  await page.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByText("Your card was declined")).toBeVisible();
});`,
  },
  {
    label: "Spy",
    code: `test("charges the expected amount", async ({ page, backendMocks }) => {
  await backendMocks.route("https://api.stripe.com/v1/charges", async (route) => {
    await route.continue(); // real upstream — just observe the call
  });

  const pending = backendMocks.waitForRequest(
    "https://api.stripe.com/v1/charges",
    { method: "POST" },
  );

  await page.goto("/checkout");
  await page.getByRole("button", { name: "Pay" }).click();

  const charge = await pending;
  expect(charge.json()).toEqual({ amount: 2000, currency: "usd" });
});`,
  },
  {
    label: "Modify",
    code: `test("renders an extra user from a modified upstream response", async ({
  page,
  backendMocks,
}) => {
  await backendMocks.route("https://api.example.test/users", async (route) => {
    const upstream = await route.fetch();
    const users = upstream.json() as Array<{ id: number; name: string }>;
    users.push({ id: 100, name: "Injected" });
    await route.fulfill({ response: upstream, json: users });
  });

  await page.goto("/users");
  await expect(page.getByText("Injected")).toBeVisible();
});`,
  },
  {
    label: "Abort",
    code: `test("shows a timeout message when payments hang", async ({
  page,
  backendMocks,
}) => {
  await backendMocks.route("https://api.stripe.com/**", async (route) => {
    await route.abort("timedout");
  });

  await page.goto("/checkout");
  await page.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByText(/timed out|try again/i)).toBeVisible();
});`,
  },
];

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
          Mock Node.js Outbound Requests from Playwright
        </h2>
        <p class="home-section__lead">
          Your UI and server stay real.
          <code>backendMocks.route()</code> targets the outbound HTTP your Node process
          makes — the calls that never show up in the browser Network tab.
        </p>
        <HighlightedCode :code="introExample" lang="ts" filename="checkout.spec.ts" />
      </div>
    </section>

    <section class="home-section home-section--api">
      <div class="home-section__inner">
        <p class="home-section__eyebrow">Familiar API</p>
        <h2 class="home-section__title">
          Mock, Spy, Modify, and Abort Requests with an API that Matches Playwright
        </h2>
        <p class="home-section__lead">
          If you know <code>page.route()</code>, you already know this shape —
          <code>fulfill</code>, <code>fetch</code>, <code>continue</code>, and
          <code>abort</code> — plus request spying for what your server actually called.
        </p>
        <HomeCodeGroup :tabs="apiTabs" />
      </div>
    </section>

    <section class="home-section home-section--node">
      <div class="home-section__inner">
        <p class="home-section__eyebrow">In your Node app</p>
        <h2 class="home-section__title">
          Simple Node.js Setup that Stays Out of the Way
        </h2>
        <p class="home-section__lead">
          Add one startup call. Under the hood it uses
          <a
            href="https://www.npmjs.com/package/@mswjs/interceptors"
            target="_blank"
            rel="noreferrer"
            >@mswjs/interceptors</a
          >
          to catch outbound HTTP, so you configure mocks in Playwright and write the rest
          of your app exactly as you otherwise would — no test-only branches, wrappers, or
          dependency-injection seams for Stripe, email, and friends.
        </p>
        <HighlightedCode :code="nodeSetupExample" lang="ts" filename="server.ts" />
      </div>
    </section>

    <section class="home-section home-section--compat">
      <div class="home-section__inner">
        <p class="home-section__eyebrow">Works with your stack</p>
        <h2 class="home-section__title">
          Compatible with Your Codebase, Regardless of HTTP Client
        </h2>
        <p class="home-section__lead">
          Because interception happens at the lowest level through
          <a
            href="https://www.npmjs.com/package/@mswjs/interceptors"
            target="_blank"
            rel="noreferrer"
            >@mswjs/interceptors</a
          >, this library can capture and mock requests from virtually every Node HTTP
          client and the frameworks and SDKs built on top of them — without rewriting how
          your app talks to the network.
        </p>
        <LogoCloud :items="compatibilityLogos" />
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

        <figure class="home-diagram">
          <MermaidDiagram :code="architectureDiagram" />
          <figcaption class="home-diagram__caption">
            Unmatched requests pass through to the real network. Outside tests, with no
            proxy URL set, the Node agent is a no-op.
          </figcaption>
        </figure>
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
