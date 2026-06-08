import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { fetch } from 'undici';
import { startServer } from '../src/server.mjs';

const upstream = await startMockHermes();
const routerConfig = {
  server: {
    host: '127.0.0.1',
    port: 20129,
    requireApiKey: true,
    apiKey: 'test-router-key'
  },
  dashboard: {
    enabled: true,
    protectPage: false,
    refreshMs: 1000
  },
  hermes: {
    baseUrl: upstream.baseUrl,
    apiKey: '',
    passThroughClientAuth: false,
    chatPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    timeoutMs: 5000,
    fallbackBaseUrls: []
  },
  tokenSaver: {
    enabled: true,
    maxToolChars: 1000,
    maxContentChars: 2000
  },
  logs: {
    level: 'silent',
    logBodies: false
  }
};

const router = await startServer(routerConfig);
const base = `http://${router.host}:${router.port}`;

try {
  await testHealth(base);
  await testAuth(base);
  await testModels(base);
  await testChat(base);
  await testDashboard(base);
  await testDashboardHealth(base);
  await testSetupCenter(base);
  console.log('All tests passed.');
} finally {
  await closeServer(router.server);
  await closeServer(upstream.server);
}

async function testHealth(baseUrl) {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.purpose, 'hermes-only-ai-router');
}

async function testAuth(baseUrl) {
  const res = await fetch(`${baseUrl}/v1/models`);
  assert.equal(res.status, 401);
}

async function testModels(baseUrl) {
  const res = await fetch(`${baseUrl}/v1/models`, { headers: authHeaders() });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(Array.isArray(data.data), true);
}

async function testChat(baseUrl) {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'hermes-test',
      messages: [{ role: 'user', content: 'hello' }]
    })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.choices[0].message.content, 'mock-ok');
}

async function testDashboard(baseUrl) {
  const page = await fetch(`${baseUrl}/dashboard`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Hermes Router Dashboard/);

  const summaryNoAuth = await fetch(`${baseUrl}/dashboard/api/summary`);
  assert.equal(summaryNoAuth.status, 401);

  const summary = await fetch(`${baseUrl}/dashboard/api/summary`, { headers: authHeaders() });
  assert.equal(summary.status, 200);
  const data = await summary.json();
  assert.equal(data.router.name, 'hermes-router-cli');
  assert.equal(typeof data.metrics.ai.total, 'number');
}

async function testDashboardHealth(baseUrl) {
  const res = await fetch(`${baseUrl}/dashboard/health`, { headers: authHeaders() });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
}

async function testSetupCenter(baseUrl) {
  const page = await fetch(`${baseUrl}/setup`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Hermes Setup Center/);

  const cfgNoAuth = await fetch(`${baseUrl}/dashboard/api/config`);
  assert.equal(cfgNoAuth.status, 401);

  const cfg = await fetch(`${baseUrl}/dashboard/api/config`, { headers: authHeaders() });
  assert.equal(cfg.status, 200);
  const data = await cfg.json();
  assert.equal(data.hermes.baseUrl, `${baseUrl}/v1`);
  assert.equal(Array.isArray(data.presets), true);

  const test = await fetch(`${baseUrl}/dashboard/api/provider/test`, {
    method: 'POST',
    headers: { ...authHeaders(), 'content-type': 'application/json' },
    body: '{}'
  });
  assert.equal(test.status, 200);
  const testData = await test.json();
  assert.equal(testData.ok, true);
}

function authHeaders() {
  return { authorization: 'Bearer test-router-key' };
}

async function startMockHermes() {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models' && req.method === 'GET') {
      sendJson(res, 200, { object: 'list', data: [{ id: 'hermes-test', object: 'model' }] });
      return;
    }

    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        sendJson(res, 200, {
          id: 'chatcmpl-test',
          object: 'chat.completion',
          model: parsed.model || 'hermes-test',
          choices: [{ index: 0, message: { role: 'assistant', content: 'mock-ok' }, finish_reason: 'stop' }]
        });
      });
      return;
    }

    sendJson(res, 404, { error: { message: 'not found' } });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  });
}
