<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { HistoryEntry } from "@playwright-backend-mocks/protocol";
import {
  fetchConnections,
  fetchHistory,
  loadRuntimeConfig,
  type ConnectionsResponse,
} from "./api";

const proxyUrl = ref<string | null>(null);
const connections = ref<ConnectionsResponse | null>(null);
const entries = ref<HistoryEntry[]>([]);
const selectedId = ref<string | null>(null);
const error = ref<string | null>(null);

let timer: ReturnType<typeof setInterval> | undefined;

const selectedEntry = computed(
  () => entries.value.find((entry) => entry.id === selectedId.value) ?? null,
);

function outcomeClass(kind: HistoryEntry["outcome"]["kind"]): string {
  if (kind === "mocked" || kind === "continued") return "ok";
  if (kind === "passthrough" || kind === "pending") return "warn";
  return "err";
}

async function refresh(): Promise<void> {
  if (proxyUrl.value === null) {
    return;
  }
  try {
    const [historyEntries, connectionData] = await Promise.all([
      fetchHistory(proxyUrl.value),
      fetchConnections(proxyUrl.value),
    ]);
    entries.value = historyEntries;
    connections.value = connectionData;
    error.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function selectEntry(id: string): void {
  selectedId.value = id;
}

onMounted(async () => {
  try {
    const config = await loadRuntimeConfig();
    proxyUrl.value = config.proxyUrl;
    await refresh();
    timer = setInterval(() => {
      void refresh();
    }, 2000);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});

onUnmounted(() => {
  if (timer !== undefined) {
    clearInterval(timer);
  }
});
</script>

<template>
  <header>
    <h1>Playwright Backend Mocks</h1>
    <div class="sub">
      Read-only dashboard · auto-refreshes every 2s
      <template v-if="proxyUrl"> · proxy {{ proxyUrl }}</template>
    </div>
  </header>

  <p v-if="error" class="error" style="padding: 1rem 1.75rem">{{ error }}</p>

  <main>
    <section>
      <h2>Connections</h2>
      <div v-if="!connections" class="meta">Loading…</div>
      <ul v-else>
        <li v-if="connections.nodeAgents.length === 0" class="meta">No node agents</li>
        <li v-for="agent in connections.nodeAgents" :key="agent.connectionId">
          <span class="pill ok">node</span> {{ agent.clientId }}
        </li>
        <li v-if="connections.playwrightWorkers.length === 0" class="meta">
          No playwright workers
        </li>
        <li v-for="worker in connections.playwrightWorkers" :key="worker.connectionId">
          <span class="pill">pw</span> {{ worker.clientId }} · tests
          {{ worker.testCount }} · routes {{ worker.routeCount }}
        </li>
      </ul>
    </section>

    <section>
      <h2>Request history</h2>
      <div v-if="entries.length === 0" class="meta">No requests yet</div>
      <table v-else>
        <thead>
          <tr>
            <th>Outcome</th>
            <th>Method</th>
            <th>URL</th>
            <th>Client</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in entries"
            :key="entry.id"
            :class="{ selected: entry.id === selectedId }"
            @click="selectEntry(entry.id)"
          >
            <td>
              <span class="pill" :class="outcomeClass(entry.outcome.kind)">
                {{ entry.outcome.kind }}
              </span>
            </td>
            <td>{{ entry.request.method }}</td>
            <td class="url">{{ entry.request.url }}</td>
            <td>{{ entry.clientId }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>Detail</h2>
      <div v-if="!selectedEntry" class="meta">Select a request</div>
      <template v-else>
        <div class="meta">
          {{ new Date(selectedEntry.timestamp).toISOString() }}
          <template v-if="selectedEntry.durationMs != null">
            · {{ selectedEntry.durationMs }}ms
          </template>
          <template v-if="selectedEntry.testId">
            · test {{ selectedEntry.testId }}
          </template>
        </div>
        <pre>{{ JSON.stringify(selectedEntry, null, 2) }}</pre>
      </template>
    </section>
  </main>
</template>
