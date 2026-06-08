import fs from 'node:fs';
import { defaultConfigPath, ensureConfigDir, validateConfig } from './config.mjs';

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
