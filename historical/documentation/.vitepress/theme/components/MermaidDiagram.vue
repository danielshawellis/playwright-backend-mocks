<script setup lang="ts">
import { useData } from "vitepress";
import { nextTick, onMounted, ref, watch } from "vue";

const props = defineProps<{
  code: string;
}>();

const { isDark } = useData();
const host = ref<HTMLElement | null>(null);
const renderError = ref<string | null>(null);
let renderSeq = 0;

function decodeCode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function renderDiagram(): Promise<void> {
  const el = host.value;
  if (el === null) {
    return;
  }

  const diagram = decodeCode(props.code).trim();
  const seq = ++renderSeq;
  renderError.value = null;

  const { default: mermaid } = await import("mermaid");

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: isDark.value ? "dark" : "base",
    themeVariables: isDark.value
      ? {
          primaryColor: "#3f4a63",
          primaryTextColor: "#f3f4f6",
          primaryBorderColor: "#93c5fd",
          lineColor: "#9ca3af",
          secondaryColor: "#1f2937",
          tertiaryColor: "#111827",
          fontFamily: "var(--vp-font-family-base)",
        }
      : {
          primaryColor: "#e8f1ff",
          primaryTextColor: "#111827",
          primaryBorderColor: "#3b82f6",
          lineColor: "#64748b",
          secondaryColor: "#f8fafc",
          tertiaryColor: "#ffffff",
          fontFamily: "var(--vp-font-family-base)",
        },
    flowchart: {
      curve: "basis",
      padding: 16,
      nodeSpacing: 48,
      rankSpacing: 56,
      htmlLabels: true,
      useMaxWidth: true,
    },
  });

  const id = `mermaid-${seq}-${Math.random().toString(36).slice(2, 9)}`;

  try {
    const { svg } = await mermaid.render(id, diagram);
    if (seq !== renderSeq || host.value === null) {
      return;
    }
    host.value.innerHTML = svg;
    const svgEl = host.value.querySelector("svg");
    if (svgEl !== null) {
      svgEl.removeAttribute("height");
      svgEl.style.width = "100%";
      svgEl.style.maxWidth = "920px";
      svgEl.style.height = "auto";
      svgEl.style.margin = "0 auto";
      svgEl.style.display = "block";
    }
  } catch (error) {
    if (seq !== renderSeq) {
      return;
    }
    renderError.value = error instanceof Error ? error.message : String(error);
    el.textContent = diagram;
  }
}

onMounted(() => {
  void nextTick(() => {
    void renderDiagram();
  });
});

watch([isDark, () => props.code], () => {
  void renderDiagram();
});
</script>

<template>
  <div class="mermaid-diagram" :class="{ 'mermaid-diagram--error': renderError }">
    <div ref="host" class="mermaid-diagram__host" />
    <p v-if="renderError" class="mermaid-diagram__error">
      Failed to render diagram: {{ renderError }}
    </p>
  </div>
</template>
