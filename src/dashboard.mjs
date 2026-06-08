import { checkHermes } from './proxy.mjs';

export function registerDashboard(app, config, metrics, log, apiKeyGuard) {
  app.get('/dashboard', (_req, res) => {
    res.type('html').send(renderDashboardHtml(config));
  });

  app.get('/dashboard/health', apiKeyGuard(config), async (_req, res) => {
    const started = Date.now();
    const upstreams = await checkHermes(config);
    const ok = upstreams.some((item) => item.ok);
    metrics.recordUpstream({
      ok,
      upstream: upstreams.find((item) => item.ok)?.upstream || upstreams[0]?.upstream,
      status: upstreams.find((item) => item.status)?.status || null,
      latencyMs: Date.now() - started,
      error: ok ? null : upstreams.find((item) => item.error)?.error || 'All upstream checks failed'
    });
    log.info({ ok, upstreams }, 'dashboard health check');
    res.json({ ok, checkedAt: new Date().toISOString(), upstreams });
  });

  app.get('/dashboard/api/summary', apiKeyGuard(config), (_req, res) => {
    res.json({
      router: {
        name: 'hermes-router-cli',
        mode: 'dashboard-enabled',
        baseUrl: `http://${config.server.host}:${config.server.port}`,
        apiBaseUrl: `http://${config.server.host}:${config.server.port}/v1`,
        requireApiKey: Boolean(config.server.requireApiKey)
      },
      hermes: {
        baseUrl: config.hermes.baseUrl,
        chatPath: config.hermes.chatPath,
        modelsPath: config.hermes.modelsPath,
        fallbackBaseUrls: config.hermes.fallbackBaseUrls || [],
        timeoutMs: config.hermes.timeoutMs,
        hasUpstreamApiKey: Boolean(config.hermes.apiKey)
      },
      tokenSaver: config.tokenSaver,
      metrics: metrics.snapshot()
    });
  });
}

function renderDashboardHtml(config) {
  const needsKey = Boolean(config.server.requireApiKey);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Hermes Router Dashboard</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #080b12;
      --panel: #101827;
      --panel-2: #0d1320;
      --text: #e8eefc;
      --muted: #91a0b8;
      --border: #223047;
      --good: #36d399;
      --warn: #fbbf24;
      --bad: #fb7185;
      --accent: #7c3aed;
      --accent2: #06b6d4;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: radial-gradient(circle at top left, rgba(124,58,237,.22), transparent 35%), radial-gradient(circle at top right, rgba(6,182,212,.14), transparent 30%), var(--bg);
      color: var(--text);
    }
    header {
      padding: 28px clamp(18px, 4vw, 48px) 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .brand { display: flex; align-items: center; gap: 14px; }
    .logo {
      width: 44px; height: 44px; border-radius: 14px;
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      box-shadow: 0 0 40px rgba(124,58,237,.35);
    }
    h1 { margin: 0; font-size: 24px; letter-spacing: -.02em; }
    .sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
    main { padding: 12px clamp(18px, 4vw, 48px) 48px; }
    .toolbar {
      display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
      background: rgba(16,24,39,.72); border: 1px solid var(--border);
      border-radius: 18px; padding: 12px; backdrop-filter: blur(12px);
      margin-bottom: 18px;
    }
    input {
      flex: 1; min-width: 220px;
      background: #070a11; color: var(--text); border: 1px solid var(--border);
      border-radius: 12px; padding: 11px 12px; outline: none;
    }
    button {
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      color: white; border: 0; border-radius: 12px; padding: 11px 14px;
      font-weight: 700; cursor: pointer;
    }
    button.secondary { background: #172033; border: 1px solid var(--border); }
    .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; }
    .card {
      grid-column: span 3;
      background: rgba(16,24,39,.76); border: 1px solid var(--border);
      border-radius: 20px; padding: 18px; backdrop-filter: blur(12px);
      min-height: 118px;
    }
    .wide { grid-column: span 6; }
    .full { grid-column: span 12; }
    .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .value { font-size: 30px; font-weight: 800; margin-top: 8px; letter-spacing: -.03em; }
    .small { color: var(--muted); font-size: 13px; margin-top: 8px; line-height: 1.5; }
    .status { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--warn); display: inline-block; }
    .dot.good { background: var(--good); box-shadow: 0 0 18px rgba(54,211,153,.45); }
    .dot.bad { background: var(--bad); box-shadow: 0 0 18px rgba(251,113,133,.45); }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 10px 8px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
    th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
    code, pre { background: #070a11; border: 1px solid var(--border); border-radius: 12px; }
    pre { padding: 12px; overflow: auto; color: #cbd5e1; font-size: 12px; }
    .pill { display: inline-block; padding: 5px 9px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); font-size: 12px; margin: 4px 4px 0 0; }
    @media (max-width: 980px) { .card, .wide { grid-column: span 12; } }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="logo"></div>
      <div>
        <h1>Hermes Router Dashboard</h1>
        <div class="sub">Local CLI gateway monitor • OpenAI-compatible endpoint</div>
      </div>
    </div>
    <div class="status"><span id="statusDot" class="dot"></span><span id="statusText">Waiting</span></div>
  </header>
  <main>
    <div class="toolbar">
      <input id="apiKey" type="password" placeholder="${needsKey ? 'Paste local router API key from config' : 'API key guard is off'}" />
      <button onclick="saveKey()">Save Key</button>
      <button class="secondary" onclick="refreshAll()">Refresh</button>
      <button class="secondary" onclick="checkHealth()">Check Hermes</button>
    </div>

    <section class="grid">
      <div class="card"><div class="label">Total Requests</div><div id="totalRequests" class="value">—</div><div class="small">All local router HTTP hits</div></div>
      <div class="card"><div class="label">Errors</div><div id="totalErrors" class="value">—</div><div class="small">HTTP status >= 400</div></div>
      <div class="card"><div class="label">Error Rate</div><div id="errorRate" class="value">—</div><div class="small">Runtime in-memory metric</div></div>
      <div class="card"><div class="label">Uptime</div><div id="uptime" class="value">—</div><div class="small">Since router process started</div></div>

      <div class="card wide">
        <div class="label">Router</div>
        <pre id="routerInfo">Loading...</pre>
      </div>
      <div class="card wide">
        <div class="label">Hermes Upstream</div>
        <pre id="hermesInfo">Loading...</pre>
      </div>

      <div class="card wide">
        <div class="label">Route Hits</div>
        <div id="routeHits" class="small">Loading...</div>
      </div>
      <div class="card wide">
        <div class="label">Status Buckets</div>
        <div id="statusBuckets" class="small">Loading...</div>
      </div>

      <div class="card full">
        <div class="label">Last Requests</div>
        <table>
          <thead><tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>Latency</th></tr></thead>
          <tbody id="lastRequests"><tr><td colspan="5">Loading...</td></tr></tbody>
        </table>
      </div>
    </section>
  </main>

  <script>
    const keyInput = document.getElementById('apiKey');
    keyInput.value = localStorage.getItem('hermesRouterApiKey') || '';

    function headers() {
      const key = localStorage.getItem('hermesRouterApiKey') || '';
      return key ? { Authorization: 'Bearer ' + key } : {};
    }

    function saveKey() {
      localStorage.setItem('hermesRouterApiKey', keyInput.value.trim());
      refreshAll();
    }

    async function refreshAll() {
      try {
        const res = await fetch('/dashboard/api/summary', { headers: headers() });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        renderSummary(data);
        setStatus('Dashboard connected', 'good');
      } catch (err) {
        setStatus('Need API key or router unavailable', 'bad');
      }
    }

    async function checkHealth() {
      try {
        setStatus('Checking Hermes...', '');
        const res = await fetch('/dashboard/health', { headers: headers() });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        setStatus(data.ok ? 'Hermes reachable' : 'Hermes failed', data.ok ? 'good' : 'bad');
        await refreshAll();
      } catch (err) {
        setStatus('Health check failed', 'bad');
      }
    }

    function renderSummary(data) {
      const m = data.metrics;
      document.getElementById('totalRequests').textContent = m.totalRequests;
      document.getElementById('totalErrors').textContent = m.totalErrors;
      document.getElementById('errorRate').textContent = Math.round(m.errorRate * 100) + '%';
      document.getElementById('uptime').textContent = formatUptime(m.uptimeSeconds);
      document.getElementById('routerInfo').textContent = JSON.stringify(data.router, null, 2);
      document.getElementById('hermesInfo').textContent = JSON.stringify({ ...data.hermes, upstream: m.upstream }, null, 2);
      renderPills('routeHits', m.routeHits);
      renderPills('statusBuckets', m.statusBuckets);
      renderRequests(m.lastRequests || []);
    }

    function renderPills(id, obj) {
      const el = document.getElementById(id);
      const entries = Object.entries(obj || {});
      el.innerHTML = entries.length ? entries.map(([k, v]) => '<span class="pill">' + escapeHtml(k) + ': ' + v + '</span>').join('') : 'No data yet.';
    }

    function renderRequests(rows) {
      const el = document.getElementById('lastRequests');
      if (!rows.length) {
        el.innerHTML = '<tr><td colspan="5">No requests yet.</td></tr>';
        return;
      }
      el.innerHTML = rows.map((r) => '<tr><td>' + escapeHtml(r.at) + '</td><td>' + escapeHtml(r.method) + '</td><td>' + escapeHtml(r.path) + '</td><td>' + r.status + '</td><td>' + r.latencyMs + 'ms</td></tr>').join('');
    }

    function setStatus(text, state) {
      document.getElementById('statusText').textContent = text;
      const dot = document.getElementById('statusDot');
      dot.className = 'dot ' + (state || '');
    }

    function formatUptime(seconds) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      if (h) return h + 'h ' + m + 'm';
      if (m) return m + 'm ' + s + 's';
      return s + 's';
    }

    function escapeHtml(str) {
      return String(str).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
    }

    refreshAll();
    setInterval(refreshAll, 5000);
  </script>
</body>
</html>`;
}
