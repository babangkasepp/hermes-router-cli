import pino from 'pino';

export function createLogger(config) {
  return pino({
    level: config.logs?.level || 'info',
    redact: {
      paths: [
        'req.headers.authorization',
        'headers.authorization',
        'config.server.apiKey',
        'config.hermes.apiKey'
      ],
      censor: '[redacted]'
    }
  });
}
