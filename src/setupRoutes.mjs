import { fetch } from 'undici';
import { publicConfig, updateRuntimeConfig, persistConfig, hermesInstructions } from './configStore.mjs';
import { providerSnapshot, checkProviders } from './providerRouter.mjs';

export function registerSetupRoutes(app, config, apiKeyGuard, log) {
  app.get('/dashboard/api/config', apiKeyGuard(config), (_req, res) => {
    res.json({ config: publicConfig(config), hermes: hermesInstructions(config), presets: providerPresets() });
  });

  app.post('/dashboard/api/config', apiKeyGuard(config), (req, res) => {
    try {
      updateRuntimeConfig(config, req.body || {});
      const path = persistConfig(config);
      log.info({ path }, 'router config updated from dashboard');
      res.json({ ok: true, savedTo: path, config: publicConfig(config), hermes: hermesInstructions(config) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.get('/dashboard/api/providers', apiKeyGuard(config), (_req, res) => {
    res.json({ providers: providerSnapshot(config) });
  });

  app.post('/dashboard/api/providers', apiKeyGuard(config), (req, res) => {
    try {
      config.providers = Array.isArray(config.providers) ? config.providers : [];
      const provider = normalizeProviderInput(req.body || {});
      const idx = config.providers.findIndex((item) => item.id === provider.id);
      if (idx >= 0) config.providers[idx] = provider;
      else config.providers.push(provider);
      config.routing = config.routing || {};
      if (!config.routing.defaultProvider) config.routing.defaultProvider = provider.id;
      const path = persistConfig(updateRuntimeConfig(config, {}));
      res.json({ ok: true, savedTo: path, providers: providerSnapshot(config) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.delete('/dashboard/api/providers/:id', apiKeyGuard(config), (req, res) => {
    config.providers = (config.providers || []).filter((item) => item.id !== req.params.id);
    if (config.routing?.defaultProvider === req.params.id) config.routing.defaultProvider = config.providers[0]?.id || 'default';
    const path = persistConfig(updateRuntimeConfig(config, {}));
    res.json({ ok: true, savedTo: path, providers: providerSnapshot(config) });
  });

  app.post('/dashboard/api/provider/preset', apiKeyGuard(config), (req, res) => {
    const preset = providerPresets().find((item) => item.id === req.body?.id);
    if (!preset) return res.status(404).json({ ok: false, error: 'Preset not found' });

    updateRuntimeConfig(config, {
      hermes: {
        baseUrl: preset.baseUrl,
        chatPath: preset.chatPath,
        modelsPath: preset.modelsPath,
        passThroughClientAuth: false
      }
    });
    const path = persistConfig(config);
    res.json({ ok: true, savedTo: path, preset, config: publicConfig(config) });
  });

  app.post('/dashboard/api/provider/test', apiKeyGuard(config), async (_req, res) => {
    const started = Date.now();
    const url = joinUrl(config.hermes.baseUrl, config.hermes.modelsPath);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: upstreamHeaders(config),
        signal: AbortSignal.timeout(Math.min(Number(config.hermes.timeoutMs || 30000), 30000))
      });
      const text = await response.text();
      res.status(response.ok ? 200 : 502).json({
        ok: response.ok,
        status: response.status,
        latencyMs: Date.now() - started,
        url,
        preview: safePreview(text)
      });
    } catch (error) {
      res.status(502).json({ ok: false, latencyMs: Date.now() - started, url, error: error.message });
    }
  });

  app.post('/dashboard/api/providers/test-all', apiKeyGuard(config), async (_req, res) => {
    res.json({ ok: true, providers: await checkProviders(config) });
  });
}

export function providerPresets() {
  return [
    { id: 'openrouter', name: 'OpenRouter', type: 'openai-compatible', baseUrl: 'https://openrouter.ai/api', chatPath: '/v1/chat/completions', modelsPath: '/v1/models' },
    { id: 'openai', name: 'OpenAI-compatible root', type: 'openai-compatible', baseUrl: 'https://api.openai.com', chatPath: '/v1/chat/completions', modelsPath: '/v1/models' },
    { id: 'anthropic', name: 'Anthropic native', type: 'anthropic', baseUrl: 'https://api.anthropic.com', chatPath: '/v1/messages', modelsPath: '/v1/models' },
    { id: 'gemini', name: 'Gemini native', type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', chatPath: '/v1beta/models/{model}:generateContent', modelsPath: '/v1beta/models' },
    { id: 'local-ollama-openai', name: 'Ollama OpenAI-compatible local', type: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434', chatPath: '/v1/chat/completions', modelsPath: '/v1/models' },
    { id: 'local-lmstudio', name: 'LM Studio local server', type: 'openai-compatible', baseUrl: 'http://127.0.0.1:1234', chatPath: '/v1/chat/completions', modelsPath: '/v1/models' }
  ];
}

function normalizeProviderInput(input) {
  const id = String(input.id || '').trim();
  if (!/^[a-zA-Z0-9_-]{2,40}$/.test(id)) throw new Error('Provider id must be 2-40 chars: letters, numbers, underscore, dash only.');
  return {
    id,
    name: String(input.name || id).trim(),
    type: input.type || 'openai-compatible',
    enabled: input.enabled !== false,
    baseUrl: String(input.baseUrl || '').trim().replace(/\/+$/, ''),
    apiKeys: Array.isArray(input.apiKeys) ? input.apiKeys.filter(Boolean) : (input.apiKey ? [input.apiKey] : []),
    chatPath: ensurePath(input.chatPath || '/v1/chat/completions'),
    modelsPath: ensurePath(input.modelsPath || '/v1/models'),
    timeoutMs: Number(input.timeoutMs || 120000),
    models: Array.isArray(input.models) ? input.models.filter(Boolean) : csv(input.models),
    headers: input.headers && typeof input.headers === 'object' ? input.headers : undefined,
    anthropicVersion: input.anthropicVersion || undefined
  };
}

function upstreamHeaders(config) {
  const headers = { accept: 'application/json' };
  if (config.hermes.apiKey) headers.authorization = `Bearer ${config.hermes.apiKey}`;
  return headers;
}

function joinUrl(base, path) {
  return `${String(base || '').replace(/\/+$/, '')}/${String(path || '').replace(/^\/+/, '')}`;
}

function ensurePath(value) {
  const v = String(value || '').trim();
  if (!v) return '/';
  return v.startsWith('/') ? v : `/${v}`;
}

function csv(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function safePreview(text) {
  try {
    const json = JSON.parse(text);
    if (Array.isArray(json.data)) return { models: json.data.slice(0, 8).map((item) => item.id || item.name || item) };
    return json;
  } catch {
    return String(text || '').slice(0, 600);
  }
}
