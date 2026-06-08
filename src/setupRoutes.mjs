import { fetch } from 'undici';
import { publicConfig, updateRuntimeConfig, persistConfig, hermesInstructions } from './configStore.mjs';

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
}

export function providerPresets() {
  return [
    {
      id: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api',
      chatPath: '/v1/chat/completions',
      modelsPath: '/v1/models'
    },
    {
      id: 'openai',
      name: 'OpenAI-compatible root',
      baseUrl: 'https://api.openai.com',
      chatPath: '/v1/chat/completions',
      modelsPath: '/v1/models'
    },
    {
      id: 'local-ollama-openai',
      name: 'Ollama OpenAI-compatible local',
      baseUrl: 'http://127.0.0.1:11434',
      chatPath: '/v1/chat/completions',
      modelsPath: '/v1/models'
    },
    {
      id: 'local-lmstudio',
      name: 'LM Studio local server',
      baseUrl: 'http://127.0.0.1:1234',
      chatPath: '/v1/chat/completions',
      modelsPath: '/v1/models'
    }
  ];
}

function upstreamHeaders(config) {
  const headers = { accept: 'application/json' };
  if (config.hermes.apiKey) headers.authorization = `Bearer ${config.hermes.apiKey}`;
  return headers;
}

function joinUrl(base, path) {
  return `${String(base || '').replace(/\/+$/, '')}/${String(path || '').replace(/^\/+/, '')}`;
}

function safePreview(text) {
  try {
    const json = JSON.parse(text);
    if (Array.isArray(json.data)) {
      return { models: json.data.slice(0, 8).map((item) => item.id || item.name || item) };
    }
    return json;
  } catch {
    return String(text || '').slice(0, 600);
  }
}
