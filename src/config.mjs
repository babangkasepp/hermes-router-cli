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
      port: Number(process.env.HERMES_ROUTER_PORT || 20128),
      requireApiKey: parseBool(process.env.HERMES_ROUTER_REQUIRE_API_KEY, true),
      apiKey: process.env.HERMES_ROUTER_API_KEY || 'change-this-local-router-key'
    },
    hermes: {
      baseUrl: process.env.HERMES_BASE_URL || 'http://127.0.0.1:3080',
      apiKey: process.env.HERMES_API_KEY || '',
      chatPath: process.env.HERMES_CHAT_PATH || '/v1/chat/completions',
      modelsPath: process.env.HERMES_MODELS_PATH || '/v1/models',
      timeoutMs: Number(process.env.HERMES_TIMEOUT_MS || 120000),
      fallbackBaseUrls: parseCsv(process.env.HERMES_FALLBACK_BASE_URLS)
    },
    tokenSaver: {
      enabled: parseBool(process.env.HERMES_TOKEN_SAVER_ENABLED, true),
      maxToolChars: Number(process.env.HERMES_TOKEN_SAVER_MAX_TOOL_CHARS || 12000),
      maxContentChars: Number(process.env.HERMES_TOKEN_SAVER_MAX_CONTENT_CHARS || 30000)
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
    return base;
  }

  const raw = fs.readFileSync(targetPath, 'utf8');
  const fileCfg = JSON.parse(raw);
  return deepMerge(base, fileCfg);
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

function randomKey(prefix) {
  const bytes = cryptoRandomHex(24);
  return `${prefix}_${bytes}`;
}

function cryptoRandomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
