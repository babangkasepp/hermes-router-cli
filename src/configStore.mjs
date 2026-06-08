import fs from 'node:fs';
import { defaultConfigPath, ensureConfigDir, validateConfig } from './config.mjs';
import { providerSnapshot } from './providerRouter.mjs';

export function publicConfig(config) {
  return {
    server: {
      host: config.server.host,
      port: config.server.port,
      requireApiKey: Boolean(config.server.requireApiKey),
      apiKeySet: Boolean(config.server.apiKey),
      apiKeyPreview: previewSecret(config.server.apiKey)
    },
    dashboard: {
      enabled: Boolean(config.dashboard?.enabled),
      protectPage: Boolean(config.dashboard?.protectPage),
      refreshMs: config.dashboard?.refreshMs
    },
    routing: { ...(config.routing || {}) },
    modelAliases: config.modelAliases || {},
    providers: providerSnapshot(config),
    hermes: {
      baseUrl: config.hermes.baseUrl,
      apiKeySet: Boolean(config.hermes.apiKey),
      apiKeyPreview: previewSecret(config.hermes.apiKey),
      passThroughClientAuth: Boolean(config.hermes.passThroughClientAuth),
      chatPath: config.hermes.chatPath,
      modelsPath: config.hermes.modelsPath,
      timeoutMs: config.hermes.timeoutMs,
      fallbackBaseUrls: config.hermes.fallbackBaseUrls || []
    },
    tokenSaver: { ...config.tokenSaver },
    logs: { ...config.logs }
  };
}

export function updateRuntimeConfig(config, patch = {}) {
  if (patch.server) {
    if (typeof patch.server.requireApiKey === 'boolean') config.server.requireApiKey = patch.server.requireApiKey;
    if (typeof patch.server.apiKey === 'string' && patch.server.apiKey.trim()) config.server.apiKey = patch.server.apiKey.trim();
  }

  if (patch.dashboard) {
    if (typeof patch.dashboard.enabled === 'boolean') config.dashboard.enabled = patch.dashboard.enabled;
    if (typeof patch.dashboard.protectPage === 'boolean') config.dashboard.protectPage = patch.dashboard.protectPage;
    if (patch.dashboard.refreshMs !== undefined) config.dashboard.refreshMs = Number(patch.dashboard.refreshMs);
  }

  if (patch.routing) {
    config.routing = config.routing || {};
    if (typeof patch.routing.defaultProvider === 'string') config.routing.defaultProvider = patch.routing.defaultProvider;
    if (typeof patch.routing.strategy === 'string') config.routing.strategy = patch.routing.strategy;
  }

  if (patch.modelAliases && typeof patch.modelAliases === 'object') {
    config.modelAliases = { ...(config.modelAliases || {}), ...patch.modelAliases };
  }

  if (Array.isArray(patch.providers)) {
    config.providers = patch.providers.map(normalizeProviderPatch);
  }

  if (patch.hermes) {
    if (typeof patch.hermes.baseUrl === 'string') config.hermes.baseUrl = trimSlash(patch.hermes.baseUrl);
    if (typeof patch.hermes.apiKey === 'string' && patch.hermes.apiKey.trim()) config.hermes.apiKey = patch.hermes.apiKey.trim();
    if (typeof patch.hermes.passThroughClientAuth === 'boolean') config.hermes.passThroughClientAuth = patch.hermes.passThroughClientAuth;
    if (typeof patch.hermes.chatPath === 'string') config.hermes.chatPath = ensurePath(patch.hermes.chatPath);
    if (typeof patch.hermes.modelsPath === 'string') config.hermes.modelsPath = ensurePath(patch.hermes.modelsPath);
    if (patch.hermes.timeoutMs !== undefined) config.hermes.timeoutMs = Number(patch.hermes.timeoutMs);
    if (Array.isArray(patch.hermes.fallbackBaseUrls)) {
      config.hermes.fallbackBaseUrls = patch.hermes.fallbackBaseUrls.map(trimSlash).filter(Boolean);
    }
    syncDefaultProvider(config);
  }

  if (patch.tokenSaver) {
    if (typeof patch.tokenSaver.enabled === 'boolean') config.tokenSaver.enabled = patch.tokenSaver.enabled;
    if (patch.tokenSaver.maxToolChars !== undefined) config.tokenSaver.maxToolChars = Number(patch.tokenSaver.maxToolChars);
    if (patch.tokenSaver.maxContentChars !== undefined) config.tokenSaver.maxContentChars = Number(patch.tokenSaver.maxContentChars);
  }

  if (patch.logs) {
    if (typeof patch.logs.level === 'string') config.logs.level = patch.logs.level;
    if (typeof patch.logs.logBodies === 'boolean') config.logs.logBodies = patch.logs.logBodies;
  }

  return validateConfig(config);
}

export function persistConfig(config, configPath = defaultConfigPath()) {
  ensureConfigDir(configPath);
  const clean = JSON.parse(JSON.stringify(config));
  delete clean._meta;
  fs.writeFileSync(configPath, JSON.stringify(clean, null, 2));
  return configPath;
}

export function hermesInstructions(config) {
  return {
    baseUrl: `http://${config.server.host}:${config.server.port}/v1`,
    apiKey: config.server.apiKey,
    apiKeyPreview: previewSecret(config.server.apiKey),
    note: 'Use this Base URL and local API key inside Hermes. Put the real LLM provider API key in this router config, not inside Hermes.'
  };
}

function syncDefaultProvider(config) {
  config.providers = Array.isArray(config.providers) ? config.providers : [];
  let provider = config.providers.find((p) => p.id === 'default');
  if (!provider) {
    provider = { id: 'default', name: 'Default OpenAI-compatible provider', type: 'openai-compatible', enabled: true, models: ['hermes-default'] };
    config.providers.unshift(provider);
  }

  provider.baseUrl = config.hermes.baseUrl;
  provider.chatPath = config.hermes.chatPath;
  provider.modelsPath = config.hermes.modelsPath;
  provider.timeoutMs = config.hermes.timeoutMs;
  provider.apiKeys = config.hermes.apiKey ? [config.hermes.apiKey] : provider.apiKeys || [];
}

function normalizeProviderPatch(provider) {
  return {
    id: String(provider.id || '').trim(),
    name: String(provider.name || provider.id || '').trim(),
    type: provider.type || 'openai-compatible',
    enabled: provider.enabled !== false,
    baseUrl: trimSlash(provider.baseUrl),
    apiKeys: Array.isArray(provider.apiKeys) ? provider.apiKeys.filter(Boolean) : (provider.apiKey ? [provider.apiKey] : []),
    chatPath: ensurePath(provider.chatPath || '/v1/chat/completions'),
    modelsPath: ensurePath(provider.modelsPath || '/v1/models'),
    timeoutMs: Number(provider.timeoutMs || 120000),
    models: Array.isArray(provider.models) ? provider.models.filter(Boolean) : [],
    headers: provider.headers || undefined,
    anthropicVersion: provider.anthropicVersion || undefined
  };
}

function previewSecret(secret) {
  if (!secret) return '';
  const s = String(secret);
  if (s.length <= 10) return '***';
  return `${s.slice(0, 5)}...${s.slice(-4)}`;
}

function ensurePath(value) {
  const v = String(value || '').trim();
  if (!v) return '/';
  return v.startsWith('/') ? v : `/${v}`;
}

function trimSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}
