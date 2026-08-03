import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Playwright Backend Mocks",
  description:
    "Mock outbound HTTP/HTTPS requests made by Node.js application processes from Playwright tests.",
  base: "/playwright-backend-mocks-msw/",
  cleanUrls: true,
  lastUpdated: true,
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
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Recipes", link: "/recipes/compose-fixtures" },
      { text: "Reference", link: "/reference/playwright" },
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
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Concepts", link: "/guide/concepts" },
            { text: "Why this library", link: "/guide/why" },
          ],
        },
        {
          text: "Using mocks",
          items: [
            { text: "Mocking requests", link: "/guide/mocking-requests" },
            { text: "Record and replay JSON", link: "/guide/route-from-json" },
            { text: "Matching requests", link: "/guide/matching-requests" },
            { text: "Inspecting requests", link: "/guide/inspecting-requests" },
            { text: "Multiple processes", link: "/guide/multiple-processes" },
          ],
        },
        {
          text: "Setup & operations",
          items: [
            { text: "Configuration", link: "/guide/configuration" },
            { text: "Limitations", link: "/guide/limitations" },
            { text: "Troubleshooting", link: "/guide/troubleshooting" },
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
      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "Playwright fixture", link: "/reference/playwright" },
            { text: "Node agent", link: "/reference/node" },
            { text: "Proxy", link: "/reference/proxy" },
            { text: "Errors", link: "/reference/errors" },
            { text: "Protocol", link: "/reference/protocol" },
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
  },
});
