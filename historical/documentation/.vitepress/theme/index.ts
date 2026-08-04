import { h } from "vue";
import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import HomePage from "./components/HomePage.vue";
import MermaidDiagram from "./components/MermaidDiagram.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "home-hero-after": () => h(HomePage),
    });
  },
  enhanceApp({ app }) {
    app.component("MermaidDiagram", MermaidDiagram);
  },
} satisfies Theme;
