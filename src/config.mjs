import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { webcrypto as crypto } from 'node:crypto';

dotenv.config();

export function defaultConfigPath() {
  return path.join(os.homedir(), '.hermes-router', 'config.json');
}

export function ensureConfigDir(configPath = defaultConfigPath()) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
}

export function defaultConfig() {
  return {
    server: {
      host: process.env.HERMES_ROUTER_HOST || '127.0.0.1',
      port: numberFromEnv(process.env.HERMES_ROUTER_PORT, 20128, 1, 65535),
      requireApiKey: parseBool(process.env.HERMES_ROUTER_REQUIRE_API_KEY, true),
      apiKey: process.env.HERMES_ROUTER_API_KEY || 'change-this-local-router-key'
    },
    dashboard: {
      enabled: parseBool(process.env.HERMES_DASHBOARD_ENABLED, true),
      protectPage: parseBool(process.env.HERMES_DASHBOARD_PROTECT_PAGE, false),
      refreshMs: numberFromEnv(process.env.HERMES_DASHBOARD_REFRESH_MS, 5000, 1000, 60000)
    },
    hermes: {
      baseUrl: process.env.HERMES_BASE_URL || 'http://127.0.0.1:3080',
      apiKey: process.env.HERMES_API_KEY || '',
      passThroughClientAuth: parseBool(process.env.HERMES_PASS_THROUGH_CLIENT_AUTH, false),
      chatPath: process.env.HERMES_CHAT_PATH || '/v1/chat/completions',
      modelsPath: process.env.HERMES_MODELS_PATH || '/v1/models',
      timeoutMs: numberFromEnv(process.env.HERMES_TIMEOUT_MS, 120000, 1000, 600000),
      fallbackBaseUrls: parseCsv(process.env.HERMES_FALLBACK_BASE_URLS)
    },
    tokenSaver: {
      enabled: parseBool(process.env.HERMES_TOKEN_SAVER_ENABLED, true),
      maxToolChars: numberFromEnv(process.env.HERMES_TOKEN_SAVER_MAX_TOOL_CHARS, 12000, 1000, 200000),
      maxContentChars: numberFromEnv(process.env.HERMES_TOKEN_SAVER_MAX_CONTENT_CHARS, 30000, 1000, 400000)
    },
    logs: {
      level: process.env.HERMES_LOG_LEVEL || 'info',
      logBodies: parseBool(process.env.HERMES_LOG_BODIES, false)
    }
  };
}

export function loadConfig(configPath) {
  const base = defaultConfig();
  const targetPath = configPath || defaultConfigPath();

  if (!fs.existsSync(targetPath)) {
    return validateConfig(base);
  }

  const raw = fs.readFileSync(targetPath, 'utf8');
  const fileCfg = JSON.parse(raw);
  return validateConfig(deepMerge(base, fileCfg));
}

export function writeDefaultConfig(configPath = defaultConfigPath(), { force = false } = {}) {
  ensureConfigDir(configPath);
  if (fs.existsSync(configPath) && !force) {
    return { created: false, path: configPath };
  }

  const cfg = defaultConfig();
  cfg.server.apiKey = randomKey('hrk');
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  return { created: true, path: configPath };
}

export function validateConfig(config) {
  if (!config.server.apiKey && config.server.requireApiKey) {
    throw new Error('Invalid config: server.apiKey is required when server.requireApiKey=true');
  }

  config.server.port = clampNumber(config.server.port, 20128, 1, 65535);
  config.hermes.timeoutMs = clampNumber(config.hermes.timeoutMs, 120000, 1000, 600000);
  config.dashboard.refreshMs = clampNumber(config.dashboard.refreshMs, 5000, 1000, 60000);
  config.tokenSaver.maxToolChars = clampNumber(config.tokenSaver.maxToolChars, 12000, 1000, 200000);
  config.tokenSaver.maxContentChars = clampNumber(config.tokenSaver.maxContentChars, 30000, 1000, 400000);

  return config;
}

function deepMerge(target, source) {
  const output = { ...target };
  for (const [key, value] of Object.entries(source || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = deepMerge(target[key] || {}, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value).toLowerCase());
}

function parseCsv(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberFromEnv(value, fallback, min, max) {
  return clampNumber(value === undefined || value === '' ? fallback : Number(value), fallback, min, max);
}

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function randomKey(prefix) {
  const bytes = cryptoRandomHex(24);
  return `${prefix}_${bytes}`;
}

function cryptoRandomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
