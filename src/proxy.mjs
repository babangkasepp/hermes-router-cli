import { Readable } from 'node:stream';
import { fetch } from 'undici';
import { applyTokenSaver } from './tokenSaver.mjs';

export async function proxyChatCompletion(req, res, config, log) {
  const startedAt = Date.now();
  const body = applyTokenSaver(req.body, config.tokenSaver);
  const upstreams = buildUpstreams(config);
  const isStream = body?.stream === true;
  let lastError;

  for (const upstream of upstreams) {
    try {
      const targetUrl = joinUrl(upstream, config.hermes.chatPath);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.hermes.timeoutMs || 120000);

      const headers = buildUpstreamHeaders(req, config);
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const text = await safeText(response);
        lastError = new Error(`Hermes upstream ${response.status}: ${text.slice(0, 500)}`);

        if (shouldFallback(response.status)) {
          log.warn({ status: response.status, upstream }, 'Hermes upstream failed, trying fallback if available');
          continue;
        }

        return sendUpstreamError(res, response.status, text);
      }

      log.info({ upstream, ms: Date.now() - startedAt, stream: isStream }, 'chat completion proxied');

      if (isStream) {
        copyResponseHeaders(response, res, true);
        if (!response.body) return res.end();
        return Readable.fromWeb(response.body).pipe(res);
      }

      copyResponseHeaders(response, res, false);
      const text = await response.text();
      res.status(response.status).type(response.headers.get('content-type') || 'application/json').send(text);
      return;
    } catch (error) {
      lastError = error;
      log.warn({ err: error, upstream }, 'Hermes upstream request error, trying fallback if available');
      continue;
    }
  }

  return res.status(502).json({
    error: {
      message: `All Hermes upstreams failed: ${lastError?.message || 'unknown error'}`,
      type: 'upstream_error'
    }
  });
}

export async function proxyModels(req, res, config, log) {
  const upstreams = buildUpstreams(config);
  let lastError;

  for (const upstream of upstreams) {
    try {
      const targetUrl = joinUrl(upstream, config.hermes.modelsPath);
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers: buildUpstreamHeaders(req, config, { includeContentType: false })
      });

      if (!response.ok) {
        const text = await safeText(response);
        lastError = new Error(`Hermes models ${response.status}: ${text.slice(0, 500)}`);
        if (shouldFallback(response.status)) continue;
        return sendUpstreamError(res, response.status, text);
      }

      const text = await response.text();
      log.info({ upstream }, 'models proxied');
      res.status(response.status).type(response.headers.get('content-type') || 'application/json').send(text);
      return;
    } catch (error) {
      lastError = error;
      log.warn({ err: error, upstream }, 'Hermes models request error');
    }
  }

  return res.status(502).json({
    error: {
      message: `All Hermes upstreams failed: ${lastError?.message || 'unknown error'}`,
      type: 'upstream_error'
    }
  });
}

export async function checkHermes(config) {
  const upstreams = buildUpstreams(config);
  const results = [];

  for (const upstream of upstreams) {
    const targetUrl = joinUrl(upstream, config.hermes.modelsPath);
    try {
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers: buildUpstreamHeaders({}, config, { includeContentType: false })
      });
      results.push({ upstream, ok: response.ok, status: response.status });
    } catch (error) {
      results.push({ upstream, ok: false, error: error.message });
    }
  }

  return results;
}

function buildUpstreams(config) {
  const upstreams = [config.hermes.baseUrl, ...(config.hermes.fallbackBaseUrls || [])]
    .map((url) => String(url || '').trim())
    .filter(Boolean);
  return [...new Set(upstreams)];
}

function buildUpstreamHeaders(req, config, opts = {}) {
  const includeContentType = opts.includeContentType !== false;
  const headers = {
    accept: req.get?.('accept') || 'application/json'
  };

  if (includeContentType) headers['content-type'] = 'application/json';

  if (config.hermes.apiKey) {
    headers.authorization = `Bearer ${config.hermes.apiKey}`;
  } else if (req.get?.('authorization')) {
    // Pass client Authorization through only when Hermes API key is not explicitly configured.
    headers.authorization = req.get('authorization');
  }

  return headers;
}

function joinUrl(base, path) {
  return `${String(base).replace(/\/+$/, '')}/${String(path || '').replace(/^\/+/, '')}`;
}

function shouldFallback(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function sendUpstreamError(res, status, text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = {
      error: {
        message: text || `Hermes upstream returned HTTP ${status}`,
        type: 'upstream_error'
      }
    };
  }
  return res.status(status).json(payload);
}

function copyResponseHeaders(response, res, stream) {
  const contentType = response.headers.get('content-type');
  if (contentType) res.setHeader('content-type', contentType);
  if (stream) {
    res.setHeader('cache-control', 'no-cache');
    res.setHeader('connection', 'keep-alive');
    res.setHeader('x-accel-buffering', 'no');
  }
}
