import express from 'express';
import { createLogger } from './logger.mjs';
import { apiKeyGuard } from './security.mjs';
import { proxyChatCompletion, proxyModels } from './proxy.mjs';
import { createMetrics } from './metrics.mjs';
import { registerDashboard } from './dashboardStable.mjs';
import { registerSetupRoutes } from './setupRoutes.mjs';
import { registerSetupPage } from './setupPage.mjs';

export async function startServer(config) {
  const app = express();
  const log = createLogger(config);
  const metrics = createMetrics();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '12mb' }));
  app.use(metrics.middleware());

  app.use((req, _res, next) => {
    req.requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (config.logs?.logBodies) {
      log.debug({ requestId: req.requestId, method: req.method, url: req.url, body: req.body }, 'incoming request');
    } else {
      log.info({ requestId: req.requestId, method: req.method, url: req.url }, 'incoming request');
    }
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      name: 'hermes-router-cli',
      mode: config.dashboard?.enabled ? 'dashboard-enabled' : 'cli-only',
      purpose: 'hermes-only-ai-router',
      uptimeSeconds: Math.floor(process.uptime())
    });
  });

  if (config.dashboard?.enabled) {
    registerDashboard(app, config, metrics, log, apiKeyGuard);
    registerSetupRoutes(app, config, apiKeyGuard, log);
    registerSetupPage(app, config, apiKeyGuard);
  }

  app.get('/v1/models', apiKeyGuard(config), (req, res) => proxyModels(req, res, config, log));
  app.post('/v1/chat/completions', apiKeyGuard(config), (req, res) => proxyChatCompletion(req, res, config, log));

  app.use((_req, res) => {
    res.status(404).json({
      error: {
        message: 'Route not found. Supported: GET /health, GET /dashboard, GET /setup, setup APIs, GET /v1/models, POST /v1/chat/completions',
        type: 'not_found'
      }
    });
  });

  app.use((err, _req, res, _next) => {
    log.error({ err }, 'unhandled server error');
    res.status(500).json({
      error: {
        message: err.message || 'Internal server error',
        type: 'internal_error'
      }
    });
  });

  const host = config.server.host || '127.0.0.1';
  const port = Number(config.server.port || 20128);

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      log.info({ host, port }, 'Hermes Router CLI started');
      resolve({ app, server, log, host, port, metrics });
    });

    server.on('error', (error) => {
      log.error({ err: error }, 'failed to start Hermes Router CLI');
      reject(error);
    });
  });
}
