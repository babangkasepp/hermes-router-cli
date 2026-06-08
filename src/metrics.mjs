export function createMetrics(options = {}) {
  const ignoredPaths = new Set(options.ignoredPaths || ['/dashboard/api/summary']);
  const state = {
    startedAt: Date.now(),
    http: createCounter(),
    ai: createCounter(),
    dashboard: createCounter(),
    routeHits: {},
    statusBuckets: {},
    upstream: {
      total: 0,
      ok: 0,
      failed: 0,
      lastStatus: null,
      lastUpstream: null,
      lastLatencyMs: null,
      lastError: null,
      lastAt: null
    },
    lastRequests: []
  };

  return {
    middleware() {
      return (req, res, next) => {
        const started = Date.now();
        res.on('finish', () => {
          const ms = Date.now() - started;
          const path = cleanPath(req);
          const routeKey = `${req.method} ${path}`;
          const bucket = statusBucket(res.statusCode);
          const ignored = ignoredPaths.has(path);
          const category = requestCategory(path);

          if (!ignored) {
            bumpCounter(state.http, res.statusCode);
            if (category === 'ai') bumpCounter(state.ai, res.statusCode);
            if (category === 'dashboard') bumpCounter(state.dashboard, res.statusCode);
            state.routeHits[routeKey] = (state.routeHits[routeKey] || 0) + 1;
            state.statusBuckets[bucket] = (state.statusBuckets[bucket] || 0) + 1;

            state.lastRequests.unshift({
              at: new Date().toISOString(),
              category,
              method: req.method,
              path,
              status: res.statusCode,
              latencyMs: ms,
              ip: sanitizeIp(req.ip)
            });

            if (state.lastRequests.length > 50) state.lastRequests.pop();
          }
        });
        next();
      };
    },

    recordUpstream(result) {
      state.upstream.total += 1;
      state.upstream.lastAt = new Date().toISOString();
      state.upstream.lastUpstream = result.upstream || null;
      state.upstream.lastStatus = result.status || null;
      state.upstream.lastLatencyMs = result.latencyMs ?? null;
      state.upstream.lastError = result.error || null;

      if (result.ok) state.upstream.ok += 1;
      else state.upstream.failed += 1;
    },

    snapshot() {
      return {
        startedAt: new Date(state.startedAt).toISOString(),
        uptimeSeconds: Math.floor((Date.now() - state.startedAt) / 1000),
        totalRequests: state.http.total,
        totalErrors: state.http.errors,
        errorRate: errorRate(state.http),
        http: summarizeCounter(state.http),
        ai: summarizeCounter(state.ai),
        dashboard: summarizeCounter(state.dashboard),
        routeHits: { ...state.routeHits },
        statusBuckets: { ...state.statusBuckets },
        upstream: { ...state.upstream },
        lastRequests: [...state.lastRequests]
      };
    }
  };
}

function createCounter() {
  return { total: 0, ok: 0, errors: 0 };
}

function bumpCounter(counter, statusCode) {
  counter.total += 1;
  if (statusCode >= 400) counter.errors += 1;
  else counter.ok += 1;
}

function summarizeCounter(counter) {
  return {
    total: counter.total,
    ok: counter.ok,
    errors: counter.errors,
    errorRate: errorRate(counter)
  };
}

function errorRate(counter) {
  return counter.total ? Number((counter.errors / counter.total).toFixed(4)) : 0;
}

function cleanPath(req) {
  return (req.originalUrl || req.url || '').split('?')[0] || '/';
}

function requestCategory(path) {
  if (path === '/v1/chat/completions' || path === '/v1/models') return 'ai';
  if (path === '/dashboard' || path.startsWith('/dashboard/')) return 'dashboard';
  return 'system';
}

function statusBucket(status) {
  if (status < 200) return '1xx';
  if (status < 300) return '2xx';
  if (status < 400) return '3xx';
  if (status < 500) return '4xx';
  return '5xx';
}

function sanitizeIp(ip) {
  if (!ip) return '';
  return String(ip).replace('::ffff:', '');
}
