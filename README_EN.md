# Infinite Servers - Cloudflare Edition

Server fleet monitoring tool on Cloudflare. Fully deployed on Cloudflare Edge, no self-hosted servers required.

[中文文档](./README.md)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Cloudflare Edge                       │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────────────────────┐  │
│  │   Pages      │    │         Workers               │  │
│  │  React/Vite  │◄──►│  TypeScript + Hono            │  │
│  └──────────────┘    └──────────────────────────────┘  │
│         │                       │                       │
│         │              ┌────────────────┐              │
│         │              │   D1 + KV      │              │
│         │              └────────────────┘              │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│          Agent (monitored server, Bash script)           │
└─────────────────────────────────────────────────────────┘
```

- **Frontend**: React + Vite → Cloudflare Pages
- **Backend**: TypeScript + Hono → Cloudflare Workers
- **Data**: D1 (SQLite) + KV (config)

---

## Quick Deploy

### 1. Create D1 Database

Dashboard → Storage & Databases → D1 → Create database → Console tab, run:

```sql
CREATE TABLE IF NOT EXISTS server_info (server TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS server_status (server TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS history (server TEXT NOT NULL, ts INTEGER NOT NULL, load1 REAL, mem_pct REAL, disk_pct REAL, net_rx INTEGER, net_tx INTEGER, cpu_pct REAL, swap_pct REAL, PRIMARY KEY (server, ts));
CREATE TABLE IF NOT EXISTS login_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, ts INTEGER NOT NULL, success INTEGER NOT NULL DEFAULT 0, password_hash TEXT);
CREATE INDEX IF NOT EXISTS idx_login_logs_ip_ts ON login_logs(ip, ts);
CREATE TABLE IF NOT EXISTS ip_bans (ip TEXT PRIMARY KEY, banned_until INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_ts ON rate_limits(ip, ts);
```

### 2. Create KV Namespace

Dashboard → KV → Create namespace `CONFIG`

### 3. Upload Config to KV

Go to `CONFIG` → **View Data** → **Add entry**:

**config.json** (copy and change password):

```json
{
  "password": "change-this-to-your-password",
  "sse": false,
  "interval": 5,
  "history-interval": 1,
  "history-days": 30,
  "cors-origins": "*.pages.dev,*.workers.dev",
  "telegram": { "enabled": false, "bot_token": "", "chat_id": "" }
}
```

**servers.json** (replace token after Agent install):

```json
{
  "servers": {
    "My Server": {
      "region": "US",
      "location": "New York",
      "tags": ["Production"],
      "token": "replace-after-installing-agent"
    }
  }
}
```

### 4. Create Worker + Bindings

1. Workers & Pages → Create Worker → name `infinite-servers`
2. Settings → Bindings → Add D1 (name `DB`) + KV (name `CONFIG`)
3. Settings → Triggers → Cron Triggers → Add `0 0 * * *`

Deploy Worker (requires TypeScript build, via GitHub integration or local upload):

```bash
cd worker && npm install && npx wrangler deploy
```

### 5. Deploy Frontend

```bash
npm ci
VITE_API_BASE="https://your-worker.workers.dev/" VITE_ASSET_BASE=/ npm run build
npx wrangler pages deploy dist --project-name=infinite-servers-dashboard
```

> Custom domain? Add it to `cors-origins` in KV `config.json`.

---

## Agent Deployment

One-line install on each monitored server:

```bash
curl -fsSL https://raw.githubusercontent.com/zhojielun/infinite-servers-cloudflare/master/scripts/install-agent.sh | sudo bash
```

Interactive prompts (or skip with env vars):

| Prompt | Env Var | Description |
|--------|---------|-------------|
| Server name | `AGENT_NAME` | Must match key in servers.json |
| Dashboard URL | `DASHBOARD_URL` | Worker URL |
| Token | `AGENT_TOKEN` | Leave blank to auto-generate |
| Push interval | `AGENT_INTERVAL` | Seconds, default 15 |
| Report IP | `AGENT_REPORT_IP` | `y`/`n`, report public IP |
| Region | `AGENT_REGION` | Country code, e.g. `US` (optional) |
| Location | `AGENT_LOCATION` | Location name, default hostname (optional) |

Manage:

```bash
sudo systemctl status infinite-agent-{server-name}
sudo systemctl restart infinite-agent-{server-name}
sudo journalctl -u infinite-agent-{server-name} -f
```

---

## Configuration

### config.json

All config via KV, changes take effect immediately.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `password` | none | Login password; auth skipped if unset |
| `sse` | `false` | SSE real-time push |
| `interval` | `5` | SSE push interval (seconds) |
| `history-interval` | `1` | History write interval (minutes), min 0.5 |
| `history-days` | `30` | History retention days |
| `cors-origins` | `*.pages.dev,*.workers.dev` | CORS allowlist |
| `telegram.enabled` | `false` | Telegram expiry reminders |
| `telegram.bot_token` | `""` | Bot Token |
| `telegram.chat_id` | `""` | Chat ID |

### servers.json

| Field | Required | Description |
|-------|----------|-------------|
| `token` | Yes | Agent push token |
| `region` | No | Country code for flag display |
| `location` | No | Location name |
| `tags` | No | Tag array |
| `ip_mask` | No | IP mask, e.g. `x.x.*.*` |
| `expiry` | No | Expiry date `YYYY-MM-DD` |
| `purchase_date` | No | Purchase date `YYYY-MM-DD` |

> `expiry` and `purchase_date` can be set via Dashboard buttons (stored in `server_settings.json`) or edited directly in KV.

### server_settings.json

Auto-managed by Worker. Stores button-set expiry/purchase dates and Telegram notification state. No manual editing needed.

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status?sse=1` | GET | SSE real-time push |
| `/status` | GET | Current status JSON |
| `/servers` | GET | Hardware info |
| `/history` | GET | Historical data |
| `/availability` | GET | Availability stats |
| `/push` | POST | Agent push |
| `/set-expiry` | POST | Set expiry date |
| `/set-purchase-date` | POST | Set purchase date |
| `/login` | POST | Login |
| `/logout` | GET | Logout |

---

## Local Development

```bash
# Frontend
npm ci && npm run dev

# Worker (separate terminal)
cd worker && npm install && npx wrangler dev

# Worker type check
cd worker && npm run typecheck
```

---

## License

MIT License
