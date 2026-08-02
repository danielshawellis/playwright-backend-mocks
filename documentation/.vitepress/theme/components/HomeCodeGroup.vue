<script setup lang="ts">
import { ref } from "vue";
import HighlightedCode from "./HighlightedCode.vue";

export interface CodeGroupTab {
  label: string;
  code: string;
  lang?: string;
}

const props = defineProps<{
  tabs: CodeGroupTab[];
}>();

const active = ref(0);
</script>

<template>
  <div class="home-code-group vp-code-group">
    <div class="tabs" role="tablist">
      <button
        v-for="(tab, index) in props.tabs"
        :key="tab.label"
        type="button"
        class="home-code-group__tab"
        role="tab"
        :aria-selected="active === index"
        :class="{ 'is-active': active === index }"
        @click="active = index"
      >
        {{ tab.label }}
      </button>
    </div>
    <div
      v-for="(tab, index) in props.tabs"
      :key="`${tab.label}-panel`"
      class="home-code-group__panel"
      role="tabpanel"
      :hidden="active !== index"
    >
      <HighlightedCode :code="tab.code" :lang="tab.lang ?? 'ts'" />
    </div>
  </div>
</template>
