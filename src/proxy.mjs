import { routeChatCompletion, routeModels, checkProviders } from './providerRouter.mjs';
import { applyTokenSaver } from './tokenSaver.mjs';

export async function proxyChatCompletion(req, res, config, log) {
  const body = applyTokenSaver(req.body, config.tokenSaver);
  const result = await routeChatCompletion({ ...req, body }, config, log);

  res.status(result.status);
  if (result.contentType) res.setHeader('content-type', result.contentType);

  if (result.stream) {
    res.setHeader('cache-control', 'no-cache');
    res.setHeader('connection', 'keep-alive');
    res.setHeader('x-accel-buffering', 'no');
  }

  return res.send(result.body);
}

export async function proxyModels(req, res, config, _log) {
  const payload = await routeModels(req, config);
  return res.status(200).json(payload);
}

export async function checkHermes(config) {
  return checkProviders(config);
}
