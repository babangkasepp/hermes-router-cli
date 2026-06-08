import { fetch } from 'undici';

const baseUrl = process.env.ROUTER_BASE_URL || 'http://127.0.0.1:20128';
const apiKey = process.env.ROUTER_API_KEY || '';

const health = await fetch(`${baseUrl}/health`);
console.log('health', health.status, await health.text());

const headers = { 'content-type': 'application/json' };
if (apiKey) headers.authorization = `Bearer ${apiKey}`;

const chat = await fetch(`${baseUrl}/v1/chat/completions`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    model: 'hermes',
    messages: [{ role: 'user', content: 'Halo, jawab singkat.' }]
  })
});
console.log('chat', chat.status, await chat.text());
