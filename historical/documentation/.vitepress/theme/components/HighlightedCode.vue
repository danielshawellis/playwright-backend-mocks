<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useData } from "vitepress";

const props = defineProps<{
  code: string;
  lang?: string;
  filename?: string;
}>();

const { isDark } = useData();
const html = ref("");
const ready = ref(false);

async function highlight(): Promise<void> {
  const { codeToHtml } = await import("shiki");
  html.value = await codeToHtml(props.code.trimEnd(), {
    lang: props.lang ?? "ts",
    themes: {
      light: "github-light",
      dark: "github-dark",
    },
    defaultColor: false,
  });
  ready.value = true;
}

onMounted(() => {
  void highlight();
});

watch(
  () => [props.code, props.lang, isDark.value] as const,
  () => {
    void highlight();
  },
);
</script>

<template>
  <div class="home-code" :aria-label="filename ?? 'Code example'">
    <div v-if="filename" class="home-code__chrome">
      <span class="home-code__label">{{ filename }}</span>
    </div>
    <div v-if="ready" class="home-code__body" v-html="html" />
    <pre v-else class="home-code__pre"><code>{{ code }}</code></pre>
  </div>
</template>
