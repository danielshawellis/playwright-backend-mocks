export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Playwright Backend Mocks</title>
  <style>
    :root {
      --bg: #0f1419;
      --panel: #1a2332;
      --text: #e7ecf3;
      --muted: #9aa8bc;
      --accent: #3d9cf0;
      --ok: #3ecf8e;
      --warn: #f0b429;
      --err: #f07178;
      --border: #2a3648;
      --mono: "IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace;
      --sans: "IBM Plex Sans", "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--sans);
      background:
        radial-gradient(1200px 600px at 10% -10%, #1d3a5c 0%, transparent 55%),
        radial-gradient(900px 500px at 100% 0%, #2a4a3a 0%, transparent 50%),
        var(--bg);
      color: var(--text);
      min-height: 100vh;
    }
    header {
      padding: 1.5rem 1.75rem 1rem;
      border-bottom: 1px solid var(--border);
    }
    h1 {
      margin: 0;
      font-size: 1.35rem;
      letter-spacing: -0.02em;
    }
    .sub {
      color: var(--muted);
      margin-top: 0.35rem;
      font-size: 0.9rem;
    }
    main {
      display: grid;
      grid-template-columns: 280px 1fr 360px;
      gap: 1rem;
      padding: 1rem 1.75rem 2rem;
    }
    @media (max-width: 1100px) {
      main { grid-template-columns: 1fr; }
    }
    section {
      background: color-mix(in srgb, var(--panel) 92%, black);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1rem;
      min-height: 200px;
    }
    h2 {
      margin: 0 0 0.75rem;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    .pill {
      display: inline-block;
      font-family: var(--mono);
      font-size: 0.75rem;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      background: #243044;
      color: var(--text);
    }
    .pill.ok { background: color-mix(in srgb, var(--ok) 25%, #243044); color: var(--ok); }
    .pill.warn { background: color-mix(in srgb, var(--warn) 25%, #243044); color: var(--warn); }
    .pill.err { background: color-mix(in srgb, var(--err) 25%, #243044); color: var(--err); }
    ul { list-style: none; margin: 0; padding: 0; }
    li {
      padding: 0.55rem 0.4rem;
      border-bottom: 1px solid var(--border);
      font-size: 0.9rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    th, td {
      text-align: left;
      padding: 0.55rem 0.4rem;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    th { color: var(--muted); font-weight: 500; }
    tr { cursor: pointer; }
    tr:hover, tr.selected { background: #223047; }
    .url { font-family: var(--mono); word-break: break-all; }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: var(--mono);
      font-size: 0.78rem;
      background: #121821;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.75rem;
      max-height: 50vh;
      overflow: auto;
    }
    .meta { color: var(--muted); font-size: 0.8rem; margin-bottom: 0.75rem; }
  </style>
</head>
<body>
  <header>
    <h1>Playwright Backend Mocks</h1>
    <div class="sub">Read-only proxy dashboard · auto-refreshes every 2s</div>
  </header>
  <main>
    <section>
      <h2>Connections</h2>
      <div id="connections">Loading…</div>
    </section>
    <section>
      <h2>Request history</h2>
      <div id="history">Loading…</div>
    </section>
    <section>
      <h2>Detail</h2>
      <div id="detail" class="meta">Select a request</div>
    </section>
  </main>
  <script>
    let selectedId = null;
    let latest = [];

    function outcomeClass(kind) {
      if (kind === "mocked" || kind === "continued") return "ok";
      if (kind === "passthrough" || kind === "pending") return "warn";
      return "err";
    }

    function renderConnections(data) {
      const nodes = (data.nodeAgents || []).map((n) =>
        "<li><span class=\\"pill ok\\">node</span> " + escapeHtml(n.clientId) + "</li>"
      ).join("");
      const workers = (data.playwrightWorkers || []).map((w) =>
        "<li><span class=\\"pill\\">pw</span> " + escapeHtml(w.clientId) +
        " · tests " + w.testCount + " · routes " + w.routeCount + "</li>"
      ).join("");
      document.getElementById("connections").innerHTML =
        "<ul>" + (nodes || "<li class=meta>No node agents</li>") +
        (workers || "<li class=meta>No playwright workers</li>") + "</ul>";
    }

    function renderHistory(entries) {
      latest = entries;
      if (!entries.length) {
        document.getElementById("history").innerHTML = "<div class=meta>No requests yet</div>";
        return;
      }
      const rows = entries.map((e) => {
        const selected = e.id === selectedId ? " selected" : "";
        return "<tr class=\\"" + selected + "\\" data-id=\\"" + e.id + "\\">" +
          "<td><span class=\\"pill " + outcomeClass(e.outcome.kind) + "\\">" + e.outcome.kind + "</span></td>" +
          "<td>" + escapeHtml(e.request.method) + "</td>" +
          "<td class=url>" + escapeHtml(e.request.url) + "</td>" +
          "<td>" + escapeHtml(e.clientId) + "</td>" +
          "</tr>";
      }).join("");
      document.getElementById("history").innerHTML =
        "<table><thead><tr><th>Outcome</th><th>Method</th><th>URL</th><th>Client</th></tr></thead><tbody>" +
        rows + "</tbody></table>";
      document.querySelectorAll("#history tr[data-id]").forEach((row) => {
        row.addEventListener("click", () => {
          selectedId = row.getAttribute("data-id");
          renderHistory(latest);
          renderDetail();
        });
      });
    }

    function renderDetail() {
      const entry = latest.find((e) => e.id === selectedId);
      if (!entry) {
        document.getElementById("detail").innerHTML = "<div class=meta>Select a request</div>";
        return;
      }
      document.getElementById("detail").innerHTML =
        "<div class=meta>" + new Date(entry.timestamp).toISOString() +
        (entry.durationMs != null ? " · " + entry.durationMs + "ms" : "") +
        (entry.testId ? " · test " + escapeHtml(entry.testId) : "") +
        "</div><pre>" + escapeHtml(JSON.stringify(entry, null, 2)) + "</pre>";
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    async function refresh() {
      try {
        const [historyRes, connectionsRes] = await Promise.all([
          fetch("/api/history"),
          fetch("/api/connections"),
        ]);
        const history = await historyRes.json();
        const connections = await connectionsRes.json();
        renderConnections(connections);
        renderHistory(history.entries || []);
        renderDetail();
      } catch (error) {
        document.getElementById("history").textContent = String(error);
      }
    }

    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>`;
}
