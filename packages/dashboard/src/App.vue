<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type {
  HistoryEntry,
  RouteMatchDiagnostic,
  WsConnectionEntry,
} from "@playwright-backend-mocks/protocol";
import {
  copyText,
  fetchConnections,
  fetchHistory,
  fetchWsConnections,
  harDownloadUrl,
  loadRuntimeConfig,
  prettyBody,
  type ConnectionsResponse,
} from "./api";

type View = "http" | "ws" | "connections";

/** Published docs — keep the dashboard pointing at the living troubleshooting guide. */
const AMBIGUOUS_ROUTE_DOCS =
  "https://danielshawellis.github.io/playwright-backend-mocks/guide/troubleshooting#ambiguous_route";

const proxyUrl = ref<string | null>(null);
const view = ref<View>("http");
const error = ref<string | null>(null);
const copyFlash = ref<string | null>(null);

const search = ref("");
const from = ref("");
const to = ref("");
const autoRefresh = ref(true);

const entries = ref<HistoryEntry[]>([]);
const wsConnections = ref<WsConnectionEntry[]>([]);
const connections = ref<ConnectionsResponse | null>(null);
const selectedHttpId = ref<string | null>(null);
const selectedWsId = ref<string | null>(null);

let timer: ReturnType<typeof setInterval> | undefined;
let copyTimer: ReturnType<typeof setTimeout> | undefined;

const query = computed(() => ({
  ...(search.value.trim() ? { q: search.value.trim() } : {}),
  ...(from.value ? { from: from.value } : {}),
  ...(to.value ? { to: to.value } : {}),
}));

const selectedHttp = computed(
  () => entries.value.find((entry) => entry.id === selectedHttpId.value) ?? null,
);

const selectedWs = computed(
  () => wsConnections.value.find((entry) => entry.id === selectedWsId.value) ?? null,
);

function actionClass(action: string | undefined): string {
  if (action === "fulfill" || action === "continue" || action === "matched") return "ok";
  if (action === "passthrough" || action === "pending") return "warn";
  if (action === "abort" || action === "error" || action === "ambiguous") return "err";
  return "muted";
}

function isAmbiguousHttp(entry: HistoryEntry): boolean {
  return entry.outcome.kind === "error" && entry.outcome.code === "ambiguous_route";
}

function isAmbiguousWs(entry: WsConnectionEntry): boolean {
  return entry.outcome === "error" && entry.errorCode === "ambiguous_route";
}

function httpActionLabel(entry: HistoryEntry): string {
  if (isAmbiguousHttp(entry)) return "ambiguous";
  return entry.action ?? entry.outcome.kind;
}

function wsOutcomeLabel(entry: WsConnectionEntry): string {
  if (isAmbiguousWs(entry)) return "ambiguous";
  return entry.outcome;
}

function uniqueClaimants(
  matches: RouteMatchDiagnostic[] | undefined,
): Array<{ testId: string; title: string; file: string }> {
  if (!matches?.length) return [];
  const seen = new Map<string, { testId: string; title: string; file: string }>();
  for (const match of matches) {
    if (!seen.has(match.testId)) {
      seen.set(match.testId, {
        testId: match.testId,
        title: match.title,
        file: match.file,
      });
    }
  }
  return [...seen.values()];
}

/** Timeline "Test" column — for collisions, show who collided instead of a blank. */
function httpTestLabel(entry: HistoryEntry): string {
  if (isAmbiguousHttp(entry) && entry.outcome.kind === "error") {
    const claimants = uniqueClaimants(entry.outcome.matches);
    if (claimants.length > 0) {
      return claimants.map((claim) => claim.title).join(" · ");
    }
    return "multiple tests";
  }
  return entry.title ?? "—";
}

function wsTestLabel(entry: WsConnectionEntry): string {
  if (isAmbiguousWs(entry)) {
    const claimants = uniqueClaimants(entry.matches);
    if (claimants.length > 0) {
      return claimants.map((claim) => claim.title).join(" · ");
    }
    return "multiple tests";
  }
  return entry.title ?? "—";
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  } as Intl.DateTimeFormatOptions);
}

function statusFor(entry: HistoryEntry): string {
  if (entry.outcome.kind === "mocked") return String(entry.outcome.response.status);
  if (entry.outcome.kind === "continued" && entry.outcome.response) {
    return String(entry.outcome.response.status);
  }
  if (entry.outcome.kind === "aborted") return entry.outcome.errorCode;
  if (entry.outcome.kind === "error") {
    return entry.outcome.code === "ambiguous_route" ? "ambiguous" : "error";
  }
  return "—";
}

function responseBody(entry: HistoryEntry): string {
  if (entry.outcome.kind === "mocked") {
    return prettyBody(entry.outcome.response.bodyBase64);
  }
  if (entry.outcome.kind === "continued" && entry.outcome.response) {
    return prettyBody(entry.outcome.response.bodyBase64);
  }
  return "(none)";
}

function responseHeaders(entry: HistoryEntry): Record<string, string> | null {
  if (entry.outcome.kind === "mocked") return entry.outcome.response.headers;
  if (entry.outcome.kind === "continued" && entry.outcome.response) {
    return entry.outcome.response.headers;
  }
  return null;
}

async function copy(label: string, text: string): Promise<void> {
  const ok = await copyText(text);
  copyFlash.value = ok ? label : "Copy failed";
  if (copyTimer !== undefined) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copyFlash.value = null;
  }, 1400);
}

async function refresh(): Promise<void> {
  if (proxyUrl.value === null) return;
  try {
    const [historyEntries, wsEntries, connectionData] = await Promise.all([
      fetchHistory(proxyUrl.value, query.value),
      fetchWsConnections(proxyUrl.value, query.value),
      fetchConnections(proxyUrl.value),
    ]);
    entries.value = historyEntries;
    wsConnections.value = wsEntries;
    connections.value = connectionData;
    if (
      selectedHttpId.value !== null &&
      !historyEntries.some((entry) => entry.id === selectedHttpId.value)
    ) {
      selectedHttpId.value = null;
    }
    if (
      selectedWsId.value !== null &&
      !wsEntries.some((entry) => entry.id === selectedWsId.value)
    ) {
      selectedWsId.value = null;
    }
    error.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function syncTimer(): void {
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
  if (autoRefresh.value) {
    timer = setInterval(() => {
      void refresh();
    }, 2000);
  }
}

watch(autoRefresh, () => {
  syncTimer();
});

watch([search, from, to], () => {
  void refresh();
});

onMounted(async () => {
  try {
    const config = await loadRuntimeConfig();
    proxyUrl.value = config.proxyUrl;
    await refresh();
    syncTimer();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});

onUnmounted(() => {
  if (timer !== undefined) clearInterval(timer);
  if (copyTimer !== undefined) clearTimeout(copyTimer);
});
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="topbar__row">
        <div class="brand">
          <h1>Playwright Backend Mocks</h1>
          <div class="brand__sub">
            Read-only observability
            <template v-if="proxyUrl"> · proxy {{ proxyUrl }}</template>
          </div>
        </div>
        <nav class="nav" aria-label="Views">
          <button
            type="button"
            :class="{ active: view === 'http' }"
            @click="view = 'http'"
          >
            HTTP
          </button>
          <button type="button" :class="{ active: view === 'ws' }" @click="view = 'ws'">
            WebSockets
          </button>
          <button
            type="button"
            :class="{ active: view === 'connections' }"
            @click="view = 'connections'"
          >
            Connections
          </button>
        </nav>
      </div>

      <div v-if="view !== 'connections'" class="toolbar">
        <input
          v-model="search"
          type="search"
          placeholder="Search URL, body, headers, test…"
        />
        <input v-model="from" type="datetime-local" aria-label="From time" />
        <input v-model="to" type="datetime-local" aria-label="To time" />
        <label class="auto">
          <input v-model="autoRefresh" type="checkbox" />
          Auto-refresh
        </label>
        <button type="button" class="btn" @click="refresh">Refresh</button>
      </div>
      <div v-else class="toolbar">
        <label class="auto">
          <input v-model="autoRefresh" type="checkbox" />
          Auto-refresh
        </label>
        <button type="button" class="btn" @click="refresh">Refresh</button>
      </div>
    </header>

    <p v-if="error" class="error-banner">{{ error }}</p>
    <p v-if="copyFlash" class="copy-toast" role="status">{{ copyFlash }}</p>

    <main class="main">
      <div v-if="view === 'http'" class="split">
        <section class="panel">
          <div class="panel__head">HTTP timeline · {{ entries.length }}</div>
          <div v-if="entries.length === 0" class="meta">
            {{ search || from || to ? "No matching requests" : "No requests yet" }}
          </div>
          <table v-else class="timeline">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Method</th>
                <th>Status</th>
                <th>URL</th>
                <th>Test</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="entry in entries"
                :key="entry.id"
                :class="{ selected: entry.id === selectedHttpId }"
                @click="selectedHttpId = entry.id"
              >
                <td class="mono">{{ formatTime(entry.timestamp) }}</td>
                <td>
                  <span class="pill" :class="actionClass(httpActionLabel(entry))">
                    {{ httpActionLabel(entry) }}
                  </span>
                </td>
                <td>{{ entry.request.method }}</td>
                <td class="mono">{{ statusFor(entry) }}</td>
                <td class="mono" :title="entry.request.url">{{ entry.request.url }}</td>
                <td :title="httpTestLabel(entry)">{{ httpTestLabel(entry) }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <aside class="panel">
          <div class="panel__head panel__head--actions">
            <span>Detail</span>
            <div v-if="selectedHttp && proxyUrl" class="icon-row">
              <button
                type="button"
                class="icon-btn"
                title="Copy URL"
                aria-label="Copy URL"
                @click="copy('URL copied', selectedHttp.request.url)"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M6.5 2A1.5 1.5 0 0 0 5 3.5v7A1.5 1.5 0 0 0 6.5 12h5A1.5 1.5 0 0 0 13 10.5v-7A1.5 1.5 0 0 0 11.5 2h-5zm-3 3A1.5 1.5 0 0 0 2 6.5v7A1.5 1.5 0 0 0 3.5 15h5A1.5 1.5 0 0 0 10 13.5V13H6.5A2.5 2.5 0 0 1 4 10.5V5H3.5z"
                  />
                </svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                title="Copy full history entry"
                aria-label="Copy full history entry"
                @click="copy('History copied', JSON.stringify(selectedHttp, null, 2))"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M6.5 2A1.5 1.5 0 0 0 5 3.5v7A1.5 1.5 0 0 0 6.5 12h5A1.5 1.5 0 0 0 13 10.5v-7A1.5 1.5 0 0 0 11.5 2h-5zm-3 3A1.5 1.5 0 0 0 2 6.5v7A1.5 1.5 0 0 0 3.5 15h5A1.5 1.5 0 0 0 10 13.5V13H6.5A2.5 2.5 0 0 1 4 10.5V5H3.5z"
                  />
                </svg>
              </button>
              <a
                class="icon-btn"
                title="Download HAR for routeFromHAR"
                aria-label="Download HAR"
                :href="harDownloadUrl(proxyUrl, selectedHttp.id)"
                download
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M8 1a.75.75 0 0 1 .75.75v7.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 1.06-1.06l2.22 2.22V1.75A.75.75 0 0 1 8 1zM2.75 12a.75.75 0 0 0 0 1.5h10.5a.75.75 0 0 0 0-1.5H2.75z"
                  />
                </svg>
              </a>
            </div>
          </div>
          <div v-if="!selectedHttp" class="meta">Select a request</div>
          <div v-else class="detail">
            <section v-if="isAmbiguousHttp(selectedHttp)" class="callout callout--danger">
              <h3>Ambiguous route</h3>
              <p>
                More than one Playwright test claimed this Node request. The proxy fails
                loud on purpose — this is a test-architecture bug, not flaky networking.
              </p>
              <p
                v-if="selectedHttp.outcome.kind === 'error'"
                class="callout__message mono"
              >
                {{ selectedHttp.outcome.message }}
              </p>
              <ul
                v-if="
                  selectedHttp.outcome.kind === 'error' && selectedHttp.outcome.matches
                "
              >
                <li
                  v-for="claim in uniqueClaimants(selectedHttp.outcome.matches)"
                  :key="claim.testId"
                >
                  <strong>{{ claim.title }}</strong>
                  <span class="mono"> · {{ claim.file }}</span>
                </li>
              </ul>
              <p class="callout__actions">
                <a :href="AMBIGUOUS_ROUTE_DOCS" target="_blank" rel="noreferrer">
                  How to fix ambiguous_route →
                </a>
              </p>
            </section>

            <section>
              <h3>Summary</h3>
              <div class="kv">
                <dt>Request</dt>
                <dd class="mono with-copy">
                  <span
                    >{{ selectedHttp.request.method }}
                    {{ selectedHttp.request.url }}</span
                  >
                  <button
                    type="button"
                    class="icon-btn"
                    title="Copy URL"
                    aria-label="Copy URL"
                    @click="copy('URL copied', selectedHttp.request.url)"
                  >
                    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M6.5 2A1.5 1.5 0 0 0 5 3.5v7A1.5 1.5 0 0 0 6.5 12h5A1.5 1.5 0 0 0 13 10.5v-7A1.5 1.5 0 0 0 11.5 2h-5zm-3 3A1.5 1.5 0 0 0 2 6.5v7A1.5 1.5 0 0 0 3.5 15h5A1.5 1.5 0 0 0 10 13.5V13H6.5A2.5 2.5 0 0 1 4 10.5V5H3.5z"
                      />
                    </svg>
                  </button>
                </dd>
                <dt>Action</dt>
                <dd>
                  <span class="pill" :class="actionClass(httpActionLabel(selectedHttp))">
                    {{ httpActionLabel(selectedHttp) }}
                  </span>
                  <template v-if="selectedHttp.durationMs !== undefined">
                    · {{ selectedHttp.durationMs }}ms
                  </template>
                </dd>
                <dt>Client</dt>
                <dd class="mono">{{ selectedHttp.clientId }}</dd>
              </div>
            </section>

            <section
              v-if="selectedHttp.title || selectedHttp.path || selectedHttp.testId"
            >
              <h3>Test</h3>
              <div class="kv">
                <dt v-if="selectedHttp.title">Title</dt>
                <dd v-if="selectedHttp.title">{{ selectedHttp.title }}</dd>
                <dt v-if="selectedHttp.path">Path</dt>
                <dd v-if="selectedHttp.path" class="mono">{{ selectedHttp.path }}</dd>
                <dt v-if="selectedHttp.testId">testId</dt>
                <dd v-if="selectedHttp.testId" class="mono">{{ selectedHttp.testId }}</dd>
                <dt v-if="selectedHttp.routeId">routeId</dt>
                <dd v-if="selectedHttp.routeId" class="mono">
                  {{ selectedHttp.routeId }}
                </dd>
              </div>
            </section>

            <section>
              <h3>Request</h3>
              <pre>{{ JSON.stringify(selectedHttp.request.headers, null, 2) }}</pre>
              <pre>{{ prettyBody(selectedHttp.request.bodyBase64) }}</pre>
            </section>

            <section>
              <h3>Response</h3>
              <pre v-if="responseHeaders(selectedHttp)">{{
                JSON.stringify(responseHeaders(selectedHttp), null, 2)
              }}</pre>
              <pre>{{ responseBody(selectedHttp) }}</pre>
            </section>

            <section v-if="selectedHttp.overrides">
              <h3>Overrides</h3>
              <pre>{{ JSON.stringify(selectedHttp.overrides, null, 2) }}</pre>
            </section>

            <section v-if="selectedHttp.events?.length">
              <h3>Timeline</h3>
              <div class="events">
                <div v-for="event in selectedHttp.events" :key="event.id" class="event">
                  <div class="event__time">{{ formatTime(event.timestamp) }}</div>
                  <div class="event__dir">•</div>
                  <div>
                    <strong>{{ event.kind }}</strong>
                    <span v-if="event.detail"> — {{ event.detail }}</span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </aside>
      </div>

      <div v-else-if="view === 'ws'" class="split split--ws">
        <section class="panel">
          <div class="panel__head">Connections · {{ wsConnections.length }}</div>
          <div v-if="wsConnections.length === 0" class="meta">
            {{
              search || from || to
                ? "No matching connections"
                : "No WebSocket connections yet"
            }}
          </div>
          <ul v-else class="list">
            <li
              v-for="socket in wsConnections"
              :key="socket.id"
              :class="{ selected: socket.id === selectedWsId }"
              @click="selectedWsId = socket.id"
            >
              <div class="list__title">{{ socket.url }}</div>
              <div class="list__sub">
                <span class="pill" :class="actionClass(wsOutcomeLabel(socket))">{{
                  wsOutcomeLabel(socket)
                }}</span>
                ·
                {{ wsTestLabel(socket) }}
                <template v-if="socket.path && !isAmbiguousWs(socket)">
                  · {{ socket.path }}
                </template>
              </div>
            </li>
          </ul>
        </section>

        <aside class="panel">
          <div class="panel__head panel__head--actions">
            <span>Event timeline</span>
            <div v-if="selectedWs" class="icon-row">
              <button
                type="button"
                class="icon-btn"
                title="Copy URL"
                aria-label="Copy URL"
                @click="copy('URL copied', selectedWs.url)"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M6.5 2A1.5 1.5 0 0 0 5 3.5v7A1.5 1.5 0 0 0 6.5 12h5A1.5 1.5 0 0 0 13 10.5v-7A1.5 1.5 0 0 0 11.5 2h-5zm-3 3A1.5 1.5 0 0 0 2 6.5v7A1.5 1.5 0 0 0 3.5 15h5A1.5 1.5 0 0 0 10 13.5V13H6.5A2.5 2.5 0 0 1 4 10.5V5H3.5z"
                  />
                </svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                title="Copy full connection history"
                aria-label="Copy full connection history"
                @click="copy('History copied', JSON.stringify(selectedWs, null, 2))"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M6.5 2A1.5 1.5 0 0 0 5 3.5v7A1.5 1.5 0 0 0 6.5 12h5A1.5 1.5 0 0 0 13 10.5v-7A1.5 1.5 0 0 0 11.5 2h-5zm-3 3A1.5 1.5 0 0 0 2 6.5v7A1.5 1.5 0 0 0 3.5 15h5A1.5 1.5 0 0 0 10 13.5V13H6.5A2.5 2.5 0 0 1 4 10.5V5H3.5z"
                  />
                </svg>
              </button>
            </div>
          </div>
          <div v-if="!selectedWs" class="meta">Select a connection</div>
          <div v-else class="detail">
            <section v-if="isAmbiguousWs(selectedWs)" class="callout callout--danger">
              <h3>Ambiguous route</h3>
              <p>
                More than one Playwright test claimed this WebSocket. The proxy fails loud
                on purpose — fix suite scoping rather than treating this as flakiness.
              </p>
              <p v-if="selectedWs.errorMessage" class="callout__message mono">
                {{ selectedWs.errorMessage }}
              </p>
              <ul v-if="selectedWs.matches?.length">
                <li
                  v-for="claim in uniqueClaimants(selectedWs.matches)"
                  :key="claim.testId"
                >
                  <strong>{{ claim.title }}</strong>
                  <span class="mono"> · {{ claim.file }}</span>
                </li>
              </ul>
              <p class="callout__actions">
                <a :href="AMBIGUOUS_ROUTE_DOCS" target="_blank" rel="noreferrer">
                  How to fix ambiguous_route →
                </a>
              </p>
            </section>

            <section>
              <h3>Connection</h3>
              <div class="kv">
                <dt>URL</dt>
                <dd class="mono with-copy">
                  <span>{{ selectedWs.url }}</span>
                  <button
                    type="button"
                    class="icon-btn"
                    title="Copy URL"
                    aria-label="Copy URL"
                    @click="copy('URL copied', selectedWs.url)"
                  >
                    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M6.5 2A1.5 1.5 0 0 0 5 3.5v7A1.5 1.5 0 0 0 6.5 12h5A1.5 1.5 0 0 0 13 10.5v-7A1.5 1.5 0 0 0 11.5 2h-5zm-3 3A1.5 1.5 0 0 0 2 6.5v7A1.5 1.5 0 0 0 3.5 15h5A1.5 1.5 0 0 0 10 13.5V13H6.5A2.5 2.5 0 0 1 4 10.5V5H3.5z"
                      />
                    </svg>
                  </button>
                </dd>
                <dt>Outcome</dt>
                <dd>
                  <span class="pill" :class="actionClass(wsOutcomeLabel(selectedWs))">{{
                    wsOutcomeLabel(selectedWs)
                  }}</span>
                </dd>
                <dt v-if="selectedWs.title">Title</dt>
                <dd v-if="selectedWs.title">{{ selectedWs.title }}</dd>
                <dt v-if="selectedWs.path">Path</dt>
                <dd v-if="selectedWs.path" class="mono">{{ selectedWs.path }}</dd>
                <dt>Client</dt>
                <dd class="mono">{{ selectedWs.clientId }}</dd>
              </div>
            </section>
            <section>
              <h3>Events</h3>
              <div v-if="selectedWs.events.length === 0" class="meta">No events</div>
              <div v-else class="events">
                <div
                  v-for="event in [...selectedWs.events].reverse()"
                  :key="event.id"
                  class="event"
                >
                  <div class="event__time">{{ formatTime(event.timestamp) }}</div>
                  <div class="event__dir">
                    <template v-if="event.direction === 'client'">→</template>
                    <template v-else-if="event.direction === 'server'">←</template>
                    <template v-else>•</template>
                  </div>
                  <div>
                    <strong>{{ event.kind }}</strong>
                    <span v-if="event.detail"> — {{ event.detail }}</span>
                    <pre v-if="event.data">{{
                      event.isBase64 ? prettyBody(event.data) : event.data
                    }}</pre>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </aside>
      </div>

      <div v-else class="connections-grid">
        <section class="panel">
          <div class="panel__head">Node agents</div>
          <div v-if="!connections" class="meta">Loading…</div>
          <ul v-else-if="connections.nodeAgents.length === 0">
            <li class="meta">No node agents</li>
          </ul>
          <ul v-else>
            <li v-for="agent in connections.nodeAgents" :key="agent.connectionId">
              <span class="pill ok">node</span>
              <span class="mono"> {{ agent.clientId }}</span>
            </li>
          </ul>
        </section>
        <section class="panel">
          <div class="panel__head">Playwright workers</div>
          <div v-if="!connections" class="meta">Loading…</div>
          <ul v-else-if="connections.playwrightWorkers.length === 0">
            <li class="meta">No playwright workers</li>
          </ul>
          <ul v-else>
            <li
              v-for="worker in connections.playwrightWorkers"
              :key="worker.connectionId"
            >
              <span class="pill">pw</span>
              <span class="mono"> {{ worker.clientId }}</span>
              · tests {{ worker.testCount }} · routes {{ worker.routeCount }}
            </li>
          </ul>
        </section>
      </div>
    </main>
  </div>
</template>
