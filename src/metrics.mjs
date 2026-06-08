export function createMetrics() {
  const state = {
    startedAt: Date.now(),
    totalRequests: 0,
    totalErrors: 0,
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
          const routeKey = routeKeyFrom(req);
          const bucket = statusBucket(res.statusCode);

          state.totalRequests += 1;
          if (res.statusCode >= 400) state.totalErrors += 1;
          state.routeHits[routeKey] = (state.routeHits[routeKey] || 0) + 1;
          state.statusBuckets[bucket] = (state.statusBuckets[bucket] || 0) + 1;

          state.lastRequests.unshift({
            at: new Date().toISOString(),
            method: req.method,
            path: req.originalUrl || req.url,
            status: res.statusCode,
            latencyMs: ms,
            ip: sanitizeIp(req.ip)
          });

          if (state.lastRequests.length > 30) state.lastRequests.pop();
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
        totalRequests: state.totalRequests,
        totalErrors: state.totalErrors,
        errorRate: state.totalRequests ? Number((state.totalErrors / state.totalRequests).toFixed(4)) : 0,
        routeHits: state.routeHits,
        statusBuckets: state.statusBuckets,
        upstream: state.upstream,
        lastRequests: state.lastRequests
      };
    }
  };
}

function routeKeyFrom(req) {
  const path = (req.originalUrl || req.url || '').split('?')[0];
  return `${req.method} ${path}`;
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
