import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Playwright Backend Mocks",
  description:
    "Mock outbound HTTP and WebSocket traffic from Node.js application processes in Playwright tests — with a DX that matches Playwright interception.",
  base: "/playwright-backend-mocks-msw/",
  cleanUrls: true,
  lastUpdated: true,
  head: [["link", { rel: "icon", href: "/playwright-backend-mocks-msw/logo.svg" }]],
  markdown: {
    config(md) {
      const defaultFence = md.renderer.rules.fence;
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        if (token.info.trim() === "mermaid") {
          return `<MermaidDiagram code="${encodeURIComponent(token.content)}" />\n`;
        }
        return defaultFence
          ? defaultFence(tokens, idx, options, env, self)
          : self.renderToken(tokens, idx, options);
      };
    },
  },
  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "Playwright Backend Mocks",
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "API", link: "/api/backend-mocks" },
      { text: "Recipes", link: "/recipes/compose-fixtures" },
      { text: "Ops", link: "/ops/proxy" },
      {
        text: "GitHub",
        link: "https://github.com/danielshawellis/playwright-backend-mocks-msw",
      },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Introduction",
          items: [
            { text: "Getting started", link: "/guide/getting-started" },
            { text: "Philosophy", link: "/guide/philosophy" },
            { text: "Concepts", link: "/guide/concepts" },
          ],
        },
        {
          text: "Mocking Node HTTP",
          items: [
            { text: "Network mocking", link: "/guide/network-mocking" },
            { text: "Matching requests", link: "/guide/matching" },
            { text: "Mocking responses", link: "/guide/mock-responses" },
            {
              text: "Passthrough & modification",
              link: "/guide/modify-and-passthrough",
            },
            { text: "Aborting & failures", link: "/guide/abort-and-failures" },
            { text: "Spying & waiting", link: "/guide/spying-and-waiting" },
            { text: "Record & replay (HAR)", link: "/guide/har" },
          ],
        },
        {
          text: "WebSockets",
          items: [{ text: "Mocking WebSockets", link: "/guide/websockets" }],
        },
        {
          text: "Product setup",
          items: [
            { text: "Multiple processes", link: "/guide/multi-process" },
            { text: "Configuration", link: "/guide/configuration" },
            { text: "Limitations", link: "/guide/limitations" },
            { text: "Troubleshooting", link: "/guide/troubleshooting" },
          ],
        },
      ],
      "/api/": [
        {
          text: "API reference",
          items: [
            { text: "backendMocks", link: "/api/backend-mocks" },
            { text: "Route", link: "/api/route" },
            { text: "Request", link: "/api/request" },
            { text: "Response", link: "/api/response" },
            { text: "WebSocketRoute", link: "/api/websocket-route" },
            { text: "Matchers", link: "/api/matchers" },
            { text: "Node agent", link: "/api/node" },
          ],
        },
      ],
      "/recipes/": [
        {
          text: "Recipes",
          items: [
            { text: "Compose fixtures", link: "/recipes/compose-fixtures" },
            { text: "Modify upstream responses", link: "/recipes/modify-upstream" },
            { text: "Simulate network failures", link: "/recipes/network-failures" },
            { text: "Scope by clientId", link: "/recipes/scope-by-client" },
          ],
        },
      ],
      "/ops/": [
        {
          text: "Operations",
          items: [
            { text: "Proxy", link: "/ops/proxy" },
            { text: "REST API", link: "/ops/rest-api" },
            { text: "Errors", link: "/ops/errors" },
          ],
        },
      ],
    },
    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/danielshawellis/playwright-backend-mocks-msw",
      },
    ],
    search: {
      provider: "local",
    },
    editLink: {
      pattern:
        "https://github.com/danielshawellis/playwright-backend-mocks-msw/edit/main/documentation/:path",
      text: "Edit this page on GitHub",
    },
    outline: {
      level: [2, 3],
    },
    footer: {
      message: "Mock the outside world. Keep the real app.",
      copyright:
        'MIT Licensed · <a href="https://github.com/danielshawellis/playwright-backend-mocks-msw">GitHub</a>',
    },
  },
});
