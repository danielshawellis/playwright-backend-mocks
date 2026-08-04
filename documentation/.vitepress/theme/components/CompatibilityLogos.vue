<script setup lang="ts">
import LogoCloud, { type LogoCloudItem } from "./LogoCloud.vue";

const items: LogoCloudItem[] = [
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
</script>

<template>
  <LogoCloud :items="items" />
</template>
