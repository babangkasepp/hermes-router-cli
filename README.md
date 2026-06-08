# Hermes Router CLI

Project ini adalah **CLI-only local gateway/router** yang dibuat sebagai versi ramping dari konsep 9Router, tapi fokusnya hanya untuk **Hermes**.

Targetnya:

- Satu endpoint lokal untuk Hermes.
- OpenAI-compatible API: `/v1/chat/completions` dan `/v1/models`.
- Bisa dipakai oleh agent/coding tool yang butuh `base_url` OpenAI-style.
- Tanpa dashboard berat.
- Cocok untuk pemakaian pribadi di laptop/PC/VPS private.

---

## Fitur

| Fitur | Status |
|---|---:|
| CLI command | ✅ |
| Local gateway | ✅ |
| OpenAI-compatible `/v1/chat/completions` | ✅ |
| OpenAI-compatible `/v1/models` | ✅ |
| API key lokal opsional | ✅ |
| Forward ke Hermes upstream | ✅ |
| Fallback Hermes URL | ✅ |
| Streaming response | ✅ |
| Token saver sederhana | ✅ |
| Dockerfile | ✅ |
| Dashboard | ❌ sengaja tidak dibuat |

---

## Struktur

```txt
hermes-router-cli/
├─ src/
│  ├─ cli.mjs
│  ├─ config.mjs
│  ├─ logger.mjs
│  ├─ proxy.mjs
│  ├─ security.mjs
│  ├─ server.mjs
│  └─ tokenSaver.mjs
├─ package.json
├─ config.example.json
├─ .env.example
├─ Dockerfile
├─ docker-compose.yml
└─ README.md
```

---

## Install lokal

```bash
npm install
npm link
```

Lalu cek command:

```bash
hermes-router --help
```

---

## Init config

```bash
hermes-router init
```

Config akan dibuat di:

```txt
~/.hermes-router/config.json
```

Edit bagian ini sesuai Hermes lu:

```json
{
  "hermes": {
    "baseUrl": "http://127.0.0.1:3080",
    "chatPath": "/v1/chat/completions",
    "modelsPath": "/v1/models"
  }
}
```

Kalau Hermes lu jalan di port lain, ubah `baseUrl`.

---

## Start router

```bash
hermes-router start
```

Default local endpoint:

```txt
http://127.0.0.1:20128/v1
```

Untuk override langsung dari CLI:

```bash
hermes-router start --host 127.0.0.1 --port 20128 --hermes-url http://127.0.0.1:3080
```

---

## Test health

```bash
curl http://127.0.0.1:20128/health
```

Expected:

```json
{"ok":true,"name":"hermes-router-cli","mode":"cli-only"}
```

---

## Test chat completion

Kalau `requireApiKey=true`, ambil `server.apiKey` dari config, lalu:

```bash
curl http://127.0.0.1:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer hrk_xxx" \
  -d '{
    "model": "hermes",
    "messages": [
      {"role": "user", "content": "Halo, jawab singkat."}
    ]
  }'
```

---

## Config agent/tool

Pakai format seperti ini:

```env
OPENAI_BASE_URL=http://127.0.0.1:20128/v1
OPENAI_API_KEY=isi-dengan-server.apiKey-dari-config
```

Atau kalau tool lu pakai nama lain:

```env
BASE_URL=http://127.0.0.1:20128/v1
API_KEY=isi-dengan-server.apiKey-dari-config
```

---

## Doctor check

```bash
hermes-router doctor
```

Command ini akan coba akses endpoint models Hermes.

---

## Token saver

Token saver akan memangkas isi message yang terlalu panjang, terutama role:

- `tool`
- `function`

Tujuannya agar output seperti log panjang, `git diff`, `tree`, atau hasil command tidak membengkak.

Config:

```json
{
  "tokenSaver": {
    "enabled": true,
    "maxToolChars": 12000,
    "maxContentChars": 30000
  }
}
```

---

## Fallback Hermes URL

Kalau lu punya lebih dari satu endpoint Hermes:

```json
{
  "hermes": {
    "baseUrl": "http://127.0.0.1:3080",
    "fallbackBaseUrls": [
      "http://127.0.0.1:3081",
      "http://192.168.1.50:3080"
    ]
  }
}
```

Router akan fallback kalau upstream kena timeout, error 429, atau error 5xx.

---

## Docker

Build:

```bash
docker build -t hermes-router-cli .
```

Run private localhost:

```bash
docker run -d \
  --name hermes-router-cli \
  -p 127.0.0.1:20128:20128 \
  -v "$HOME/.hermes-router:/root/.hermes-router" \
  hermes-router-cli
```

---

## Catatan desain

Project ini sengaja dibuat simple:

- Tidak ada dashboard.
- Tidak ada cloud sync.
- Tidak ada auto-login provider.
- Tidak ada multi-provider publik.
- Fokus: Hermes sebagai upstream utama.

Kalau nanti mau dikembangkan, fitur berikutnya yang masuk akal:

1. YAML config.
2. Per-project profile.
3. Request history SQLite lokal.
4. Model alias: `fast`, `smart`, `coding`.
5. Rule routing berdasarkan model name.
6. Command `hermes-router logs`.
7. Dashboard minimal TUI di terminal.

---

## Push ke GitHub

### Opsi 1 — PowerShell Windows

Buat repository kosong dulu di GitHub, lalu jalankan dari folder project:

```powershell
.\scripts\push-github.ps1 -RepoUrl "https://github.com/USERNAME/hermes-router-cli.git"
```

### Opsi 2 — Git Bash / Linux / macOS

```bash
./scripts/push-github.sh https://github.com/USERNAME/hermes-router-cli.git
```

### Opsi 3 — Manual Git

```bash
git init
git branch -M main
git add .
git commit -m "Initial commit: Hermes Router CLI"
git remote add origin https://github.com/USERNAME/hermes-router-cli.git
git push -u origin main
```

Jangan commit file `.env` berisi API key atau secret. Project ini sudah menyertakan `.gitignore` untuk menahan file sensitif.
