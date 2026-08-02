import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Playwright Backend Mocks",
  description:
    "Mock outbound HTTP/HTTPS requests made by Node.js application processes from Playwright tests.",
  base: "/playwright-backend-mocks-msw/",
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "Guide", link: "/guide/getting-started" },
      {
        text: "GitHub",
        link: "https://github.com/danielshawellis/playwright-backend-mocks-msw",
      },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "Concepts", link: "/guide/concepts" },
        ],
      },
      {
        text: "Reference",
        items: [{ text: "API Overview", link: "/reference/api" }],
      },
    ],
    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/danielshawellis/playwright-backend-mocks-msw",
      },
    ],
    search: {
      provider: "local",
    },
  },
});
