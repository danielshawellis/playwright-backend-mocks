<script setup lang="ts">
import { Icon } from "@iconify/vue";
import { withBase } from "vitepress";

export interface LogoCloudItem {
  name: string;
  /** Iconify icon id */
  icon?: string;
  /** Local image under docs public/ (preferred over inventing icons) */
  src?: string;
  /** Invert in dark mode (black-only logos like Next.js) */
  invertDark?: boolean;
}

defineProps<{
  items: LogoCloudItem[];
}>();
</script>

<template>
  <ul class="logo-cloud" role="list">
    <li
      v-for="item in items"
      :key="item.name"
      class="logo-cloud__item"
      :class="{ 'logo-cloud__item--invert-dark': item.invertDark }"
    >
      <img
        v-if="item.src"
        :src="withBase(item.src)"
        :alt="item.name"
        class="logo-cloud__icon"
        width="28"
        height="28"
        loading="lazy"
      />
      <Icon
        v-else-if="item.icon"
        :icon="item.icon"
        class="logo-cloud__icon"
        aria-hidden="true"
        width="28"
        height="28"
      />
      <span class="logo-cloud__name">{{ item.name }}</span>
    </li>
  </ul>
</template>
