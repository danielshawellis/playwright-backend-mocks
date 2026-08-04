import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import CompatibilityLogos from "./components/CompatibilityLogos.vue";
import LogoCloud from "./components/LogoCloud.vue";
import MermaidDiagram from "./components/MermaidDiagram.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("MermaidDiagram", MermaidDiagram);
    app.component("LogoCloud", LogoCloud);
    app.component("CompatibilityLogos", CompatibilityLogos);
  },
} satisfies Theme;
