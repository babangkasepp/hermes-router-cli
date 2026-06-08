import { checkHermes } from './proxy.mjs';

export function registerDashboard(app, config, metrics, log, apiKeyGuard) {
  const pageGuard = config.dashboard?.protectPage ? apiKeyGuard(config) : (_req, _res, next) => next();

  app.get('/dashboard', pageGuard, (_req, res) => {
    res.type('html').send(renderDashboardHtml(config));
  });

  app.get('/dashboard/health', apiKeyGuard(config), async (_req, res) => {
    const started = Date.now();
    const upstreams = await checkHermes(config);
    const ok = upstreams.some((item) => item.ok);
    const firstWithStatus = upstreams.find((item) => Number.isInteger(item.status));

    metrics.recordUpstream({
      ok,
      upstream: upstreams.find((item) => item.ok)?.upstream || upstreams[0]?.upstream || null,
      status: firstWithStatus?.status || null,
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
        requireApiKey: Boolean(config.server.requireApiKey),
        dashboardProtectPage: Boolean(config.dashboard?.protectPage)
      },
      hermes: {
        baseUrl: config.hermes.baseUrl,
        chatPath: config.hermes.chatPath,
        modelsPath: config.hermes.modelsPath,
        fallbackBaseUrls: config.hermes.fallbackBaseUrls || [],
        timeoutMs: config.hermes.timeoutMs,
        hasUpstreamApiKey: Boolean(config.hermes.apiKey),
        passThroughClientAuth: Boolean(config.hermes.passThroughClientAuth)
      },
      tokenSaver: config.tokenSaver,
      metrics: metrics.snapshot()
    });
  });
}

function renderDashboardHtml(config) {
  const needsKey = Boolean(config.server.requireApiKey);
  const refreshMs = Number(config.dashboard?.refreshMs || 5000);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hermes Router Dashboard</title><style>${css()}</style></head><body><header><div><h1>Hermes Router Dashboard</h1><p>Local CLI gateway monitor • OpenAI-compatible endpoint</p></div><strong id="status">Waiting</strong></header><main><section class="bar"><input id="key" type="password" placeholder="${needsKey ? 'Paste local router API key' : 'API key guard is off'}"><button onclick="saveKey()">Save Key</button><button onclick="refreshAll()">Refresh</button><button onclick="checkHealth()">Check Hermes</button></section><section class="grid"><article><span>AI Requests</span><b id="ai">—</b><small>Only /v1 traffic</small></article><article><span>Total Errors</span><b id="errors">—</b><small>HTTP status >= 400</small></article><article><span>AI Error Rate</span><b id="rate">—</b><small>AI route stability</small></article><article><span>Uptime</span><b id="uptime">—</b><small>Router runtime</small></article><article class="wide"><span>Router</span><pre id="router">Loading...</pre></article><article class="wide"><span>Hermes Upstream</span><pre id="hermes">Loading...</pre></article><article class="wide"><span>Route Hits</span><div id="routes">Loading...</div></article><article class="wide"><span>Status Buckets</span><div id="buckets">Loading...</div></article><article class="full"><span>Last Requests</span><table><thead><tr><th>Time</th><th>Type</th><th>Method</th><th>Path</th><th>Status</th><th>Latency</th></tr></thead><tbody id="rows"><tr><td colspan="6">Loading...</td></tr></tbody></table></article></section></main><script>${js(refreshMs)}</script></body></html>`;
}

function css() {
  return `:root{color-scheme:dark;--bg:#080b12;--panel:#101827;--text:#e8eefc;--muted:#91a0b8;--border:#223047;--good:#36d399;--bad:#fb7185;--accent:#7c3aed;--accent2:#06b6d4}*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,sans-serif;background:radial-gradient(circle at top left,rgba(124,58,237,.22),transparent 35%),var(--bg);color:var(--text)}header{padding:28px clamp(18px,4vw,48px);display:flex;justify-content:space-between;gap:16px;align-items:center}h1{margin:0;font-size:26px}p{margin:4px 0 0;color:var(--muted)}main{padding:0 clamp(18px,4vw,48px) 48px}.bar{display:flex;gap:10px;flex-wrap:wrap;background:rgba(16,24,39,.75);border:1px solid var(--border);border-radius:18px;padding:12px;margin-bottom:18px}input{flex:1;min-width:220px;background:#070a11;color:var(--text);border:1px solid var(--border);border-radius:12px;padding:11px}button{background:linear-gradient(135deg,var(--accent),var(--accent2));color:white;border:0;border-radius:12px;padding:11px 14px;font-weight:700;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}article{grid-column:span 3;background:rgba(16,24,39,.78);border:1px solid var(--border);border-radius:20px;padding:18px;min-height:118px}.wide{grid-column:span 6}.full{grid-column:span 12}span{display:block;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em}b{display:block;font-size:30px;margin-top:8px}small{color:var(--muted)}pre{background:#070a11;border:1px solid var(--border);border-radius:12px;padding:12px;overflow:auto;color:#cbd5e1}.pill{display:inline-block;padding:5px 9px;border-radius:999px;border:1px solid var(--border);color:var(--muted);font-size:12px;margin:4px 4px 0 0}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:10px 8px;border-bottom:1px solid var(--border);text-align:left}@media(max-width:980px){article,.wide{grid-column:span 12}}`;
}

function js(refreshMs) {
  return `const k=document.getElementById('key');k.value=localStorage.getItem('hermesRouterApiKey')||'';function h(){const v=localStorage.getItem('hermesRouterApiKey')||'';return v?{Authorization:'Bearer '+v}:{}}function saveKey(){localStorage.setItem('hermesRouterApiKey',k.value.trim());refreshAll()}async function refreshAll(){try{const r=await fetch('/dashboard/api/summary',{headers:h()});if(!r.ok)throw new Error('HTTP '+r.status);render(await r.json());status('Dashboard connected',true)}catch(e){status('Need API key or router unavailable',false)}}async function checkHealth(){try{status('Checking Hermes...');const r=await fetch('/dashboard/health',{headers:h()});if(!r.ok)throw new Error('HTTP '+r.status);const d=await r.json();status(d.ok?'Hermes reachable':'Hermes failed',d.ok);await refreshAll()}catch(e){status('Health check failed',false)}}function render(d){const m=d.metrics;ai.textContent=m.ai.total;errors.textContent=m.http.errors;rate.textContent=Math.round(m.ai.errorRate*100)+'%';uptime.textContent=up(m.uptimeSeconds);router.textContent=JSON.stringify(d.router,null,2);hermes.textContent=JSON.stringify({...d.hermes,upstream:m.upstream},null,2);pills(routes,m.routeHits);pills(buckets,m.statusBuckets);table(m.lastRequests||[])}function pills(el,o){const e=Object.entries(o||{});el.innerHTML=e.length?e.map(([a,b])=>'<i class="pill">'+esc(a)+': '+b+'</i>').join(''):'No data yet.'}function table(a){rows.innerHTML=a.length?a.map(r=>'<tr><td>'+esc(r.at)+'</td><td>'+esc(r.category)+'</td><td>'+esc(r.method)+'</td><td>'+esc(r.path)+'</td><td>'+r.status+'</td><td>'+r.latencyMs+'ms</td></tr>').join(''):'<tr><td colspan="6">No requests yet.</td></tr>'}function status(t,ok){document.getElementById('status').textContent=t;document.getElementById('status').style.color=ok===undefined?'#91a0b8':ok?'#36d399':'#fb7185'}function up(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h?h+'h '+m+'m':m?m+'m '+s%60+'s':s+'s'}function esc(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}refreshAll();setInterval(refreshAll,${refreshMs});`;
}
