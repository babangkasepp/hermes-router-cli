import { fetch } from 'undici';

const keyCursor = new Map();

export function providerSnapshot(config) {
  return buildProviders(config).map((p) => ({
    id: p.id,
    name: p.name || p.id,
    type: p.type,
    enabled: p.enabled !== false,
    baseUrl: p.baseUrl,
    models: p.models || [],
    hasApiKey: Boolean(p.apiKey || p.apiKeys?.length),
    apiKeyCount: (p.apiKeys || []).filter(Boolean).length || (p.apiKey ? 1 : 0)
  }));
}

export async function routeModels(_req, config) {
  const providers = buildProviders(config).filter((p) => p.enabled !== false);
  const data = [];

  for (const p of providers) {
    const configuredModels = Array.isArray(p.models) ? p.models : [];
    for (const model of configuredModels) {
      data.push({ id: model, object: 'model', owned_by: p.id, provider: p.id, provider_type: p.type });
      data.push({ id: `${p.id}:${model}`, object: 'model', owned_by: p.id, provider: p.id, provider_type: p.type });
    }
  }

  if (!data.length) {
    data.push({ id: 'hermes-default', object: 'model', owned_by: 'default', provider: 'default' });
  }

  return { object: 'list', data };
}

export async function routeChatCompletion(req, config, log) {
  const selection = selectProvider(req.body || {}, config);
  const provider = selection.provider;
  const body = { ...(req.body || {}), model: selection.model };
  const apiKey = selectApiKey(provider);
  const startedAt = Date.now();

  if (!provider) {
    return jsonResult(400, { error: { message: 'No provider configured.', type: 'provider_error' } });
  }

  try {
    let result;
    if (provider.type === 'anthropic') {
      result = await callAnthropic(provider, body, apiKey, config);
    } else if (provider.type === 'gemini') {
      result = await callGemini(provider, body, apiKey, config);
    } else {
      result = await callOpenAICompatible(provider, body, apiKey, config);
    }

    log.info({ provider: provider.id, type: provider.type, model: body.model, ms: Date.now() - startedAt }, 'provider routed');
    return result;
  } catch (error) {
    log.warn({ err: error, provider: provider.id, type: provider.type }, 'provider route failed');
    return jsonResult(502, { error: { message: error.message, type: 'provider_error', provider: provider.id } });
  }
}

export async function checkProviders(config) {
  const providers = buildProviders(config).filter((p) => p.enabled !== false);
  const out = [];
  for (const provider of providers) {
    const startedAt = Date.now();
    try {
      if (provider.type === 'anthropic' || provider.type === 'gemini') {
        out.push({ provider: provider.id, type: provider.type, ok: true, status: 'configured', latencyMs: Date.now() - startedAt });
        continue;
      }
      const apiKey = selectApiKey(provider);
      const response = await fetch(joinUrl(provider.baseUrl, provider.modelsPath || '/v1/models'), {
        method: 'GET',
        headers: authHeaders(provider, apiKey, false),
        signal: AbortSignal.timeout(Math.min(Number(provider.timeoutMs || config.hermes?.timeoutMs || 30000), 30000))
      });
      out.push({ provider: provider.id, type: provider.type, ok: response.ok, status: response.status, latencyMs: Date.now() - startedAt });
    } catch (error) {
      out.push({ provider: provider.id, type: provider.type, ok: false, error: error.message, latencyMs: Date.now() - startedAt });
    }
  }
  return out;
}

function buildProviders(config) {
  const providers = Array.isArray(config.providers) ? config.providers : [];
  if (providers.length) return providers.map(normalizeProvider);

  return [normalizeProvider({
    id: 'default',
    name: 'Default OpenAI-compatible provider',
    type: 'openai-compatible',
    enabled: true,
    baseUrl: config.hermes?.baseUrl,
    apiKey: config.hermes?.apiKey,
    chatPath: config.hermes?.chatPath || '/v1/chat/completions',
    modelsPath: config.hermes?.modelsPath || '/v1/models',
    timeoutMs: config.hermes?.timeoutMs || 120000,
    models: ['hermes-default']
  })];
}

function normalizeProvider(provider) {
  return {
    enabled: true,
    chatPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    timeoutMs: 120000,
    models: [],
    ...provider,
    type: provider.type || 'openai-compatible',
    apiKeys: Array.isArray(provider.apiKeys) ? provider.apiKeys : (provider.apiKey ? [provider.apiKey] : [])
  };
}

function selectProvider(body, config) {
  const providers = buildProviders(config).filter((p) => p.enabled !== false);
  const aliases = config.modelAliases || {};
  let model = String(body.model || '').trim() || 'hermes-default';

  if (aliases[model]) {
    const alias = aliases[model];
    const provider = providers.find((p) => p.id === alias.provider) || providers[0];
    return { provider, model: alias.model || model };
  }

  const prefixed = parseProviderPrefix(model);
  if (prefixed) {
    const provider = providers.find((p) => p.id === prefixed.provider);
    if (provider) return { provider, model: prefixed.model };
  }

  const modelMatch = providers.find((p) => Array.isArray(p.models) && p.models.includes(model));
  if (modelMatch) return { provider: modelMatch, model };

  const defaultId = config.routing?.defaultProvider || config.defaultProvider;
  const defaultProvider = providers.find((p) => p.id === defaultId) || providers[0];
  return { provider: defaultProvider, model: model === 'hermes-default' ? (defaultProvider.defaultModel || defaultProvider.models?.[0] || model) : model };
}

function parseProviderPrefix(model) {
  const colon = model.indexOf(':');
  if (colon > 0) return { provider: model.slice(0, colon), model: model.slice(colon + 1) };
  const slash = model.indexOf('/');
  if (slash > 0 && !model.startsWith('http')) return { provider: model.slice(0, slash), model: model.slice(slash + 1) };
  return null;
}

function selectApiKey(provider) {
  const keys = (provider.apiKeys || []).filter(Boolean);
  if (!keys.length) return '';
  const current = keyCursor.get(provider.id) || 0;
  const key = keys[current % keys.length];
  keyCursor.set(provider.id, current + 1);
  return key;
}

async function callOpenAICompatible(provider, body, apiKey, config) {
  const response = await fetch(joinUrl(provider.baseUrl, provider.chatPath), {
    method: 'POST',
    headers: authHeaders(provider, apiKey, true),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(provider.timeoutMs || config.hermes?.timeoutMs || 120000))
  });
  const text = await response.text();
  return rawResult(response.status, text, response.headers.get('content-type') || 'application/json', body.stream === true);
}

async function callAnthropic(provider, body, apiKey, config) {
  const url = joinUrl(provider.baseUrl || 'https://api.anthropic.com', provider.chatPath || '/v1/messages');
  const translated = openAIToAnthropic(body);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': provider.anthropicVersion || '2023-06-01',
      ...(apiKey ? { 'x-api-key': apiKey } : {})
    },
    body: JSON.stringify(translated),
    signal: AbortSignal.timeout(Number(provider.timeoutMs || config.hermes?.timeoutMs || 120000))
  });
  const text = await response.text();
  if (!response.ok) return rawResult(response.status, text, 'application/json', false);
  const mapped = anthropicToOpenAI(JSON.parse(text), body.model);
  return maybeStreamOpenAI(mapped, body.stream === true);
}

async function callGemini(provider, body, apiKey, config) {
  const model = encodeURIComponent(body.model);
  const base = provider.baseUrl || 'https://generativelanguage.googleapis.com';
  const path = provider.chatPath || `/v1beta/models/${model}:generateContent`;
  const url = `${joinUrl(base, path.replace('{model}', model))}${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`;
  const translated = openAIToGemini(body);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(translated),
    signal: AbortSignal.timeout(Number(provider.timeoutMs || config.hermes?.timeoutMs || 120000))
  });
  const text = await response.text();
  if (!response.ok) return rawResult(response.status, text, 'application/json', false);
  const mapped = geminiToOpenAI(JSON.parse(text), body.model);
  return maybeStreamOpenAI(mapped, body.stream === true);
}

function openAIToAnthropic(body) {
  const system = [];
  const messages = [];
  for (const msg of body.messages || []) {
    if (msg.role === 'system') system.push(textContent(msg.content));
    else if (msg.role === 'assistant' || msg.role === 'user') messages.push({ role: msg.role, content: textContent(msg.content) });
    else messages.push({ role: 'user', content: `[${msg.role}] ${textContent(msg.content)}` });
  }
  return {
    model: body.model,
    max_tokens: body.max_tokens || body.max_completion_tokens || 1024,
    temperature: body.temperature,
    system: system.filter(Boolean).join('\n\n') || undefined,
    messages
  };
}

function openAIToGemini(body) {
  const systemParts = [];
  const contents = [];
  for (const msg of body.messages || []) {
    const text = textContent(msg.content);
    if (msg.role === 'system') systemParts.push({ text });
    else contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text }] });
  }
  return {
    systemInstruction: systemParts.length ? { parts: systemParts } : undefined,
    contents,
    generationConfig: {
      temperature: body.temperature,
      maxOutputTokens: body.max_tokens || body.max_completion_tokens
    }
  };
}

function anthropicToOpenAI(data, model) {
  const content = Array.isArray(data.content) ? data.content.map((p) => p.text || '').join('') : '';
  return {
    id: data.id || `chatcmpl_${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: data.stop_reason || 'stop' }],
    usage: data.usage ? { prompt_tokens: data.usage.input_tokens, completion_tokens: data.usage.output_tokens, total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0) } : undefined
  };
}

function geminiToOpenAI(data, model) {
  const candidate = data.candidates?.[0] || {};
  const content = candidate.content?.parts?.map((p) => p.text || '').join('') || '';
  return {
    id: `chatcmpl_${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: candidate.finishReason || 'stop' }],
    usage: data.usageMetadata ? { prompt_tokens: data.usageMetadata.promptTokenCount, completion_tokens: data.usageMetadata.candidatesTokenCount, total_tokens: data.usageMetadata.totalTokenCount } : undefined
  };
}

function maybeStreamOpenAI(payload, stream) {
  if (!stream) return jsonResult(200, payload);
  const content = payload.choices?.[0]?.message?.content || '';
  const chunk = { id: payload.id, object: 'chat.completion.chunk', created: payload.created, model: payload.model, choices: [{ index: 0, delta: { content }, finish_reason: null }] };
  const end = { id: payload.id, object: 'chat.completion.chunk', created: payload.created, model: payload.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
  return rawResult(200, `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`, 'text/event-stream', true);
}

function textContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => p.text || p.content || '').join('\n');
  if (content === null || content === undefined) return '';
  return String(content);
}

function authHeaders(provider, apiKey, json) {
  const headers = { accept: 'application/json' };
  if (json) headers['content-type'] = 'application/json';
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  if (provider.headers && typeof provider.headers === 'object') Object.assign(headers, provider.headers);
  return headers;
}

function joinUrl(base, path) {
  return `${String(base || '').replace(/\/+$/, '')}/${String(path || '').replace(/^\/+/, '')}`;
}

function jsonResult(status, payload) {
  return { status, contentType: 'application/json', body: JSON.stringify(payload), stream: false };
}

function rawResult(status, body, contentType, stream) {
  return { status, contentType, body, stream };
}
