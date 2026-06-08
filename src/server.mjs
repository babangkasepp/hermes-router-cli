import express from 'express';
import { createLogger } from './logger.mjs';
import { apiKeyGuard } from './security.mjs';
import { proxyChatCompletion, proxyModels } from './proxy.mjs';

export async function startServer(config) {
  const app = express();
  const log = createLogger(config);

  app.disable('x-powered-by');
  app.use(express.json({ limit: '12mb' }));

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
    res.json({ ok: true, name: 'hermes-router-cli', mode: 'cli-only' });
  });

  app.get('/v1/models', apiKeyGuard(config), (req, res) => proxyModels(req, res, config, log));
  app.post('/v1/chat/completions', apiKeyGuard(config), (req, res) => proxyChatCompletion(req, res, config, log));

  app.use((_req, res) => {
    res.status(404).json({
      error: {
        message: 'Route not found. Supported: GET /health, GET /v1/models, POST /v1/chat/completions',
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

  return new Promise((resolve) => {
    const server = app.listen(port, host, () => {
      log.info({ host, port }, 'Hermes Router CLI started');
      resolve({ server, log, host, port });
    });
  });
}
