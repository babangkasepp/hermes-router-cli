import { timingSafeEqual } from 'node:crypto';

export function apiKeyGuard(config) {
  return function guard(req, res, next) {
    if (!config.server.requireApiKey) return next();

    const expected = normalize(config.server.apiKey);
    const auth = req.get('authorization') || '';
    const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    const headerKey = req.get('x-api-key') || '';
    const provided = normalize(bearer || headerKey);

    if (expected && provided && safeEquals(provided, expected)) {
      return next();
    }

    return res.status(401).json({
      error: {
        message: 'Missing or invalid local router API key.',
        type: 'authentication_error'
      }
    });
  };
}

export function dashboardPageGuard(config) {
  return function guard(req, res, next) {
    if (!config.dashboard?.protectPage) return next();
    return apiKeyGuard(config)(req, res, next);
  };
}

function normalize(value) {
  return String(value || '').trim();
}

function safeEquals(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
