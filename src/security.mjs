export function apiKeyGuard(config) {
  return function guard(req, res, next) {
    if (!config.server.requireApiKey) return next();

    const expected = config.server.apiKey;
    const auth = req.get('authorization') || '';
    const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    const headerKey = req.get('x-api-key') || '';

    if (expected && (bearer === expected || headerKey === expected)) {
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
