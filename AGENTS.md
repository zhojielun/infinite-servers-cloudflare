# AGENTS.md — Infinite Servers (Cloudflare Edition)

## Architecture

Two workspaces, one repo:

| Workspace | Stack | Entry | Deploy |
|-----------|-------|-------|--------|
| `web/` | React + Vite | `web/src/dashboard.jsx` | Cloudflare Pages |
| `worker/` | TypeScript + Hono | `worker/src/index.ts` | Cloudflare Workers |

Data: D1 (SQLite) for server state/history, KV for config + auth tokens.

## Dev commands

```bash
# Frontend dev server (proxies API paths to API_TARGET, default http://localhost:8000)
npm ci && npm run dev

# Worker dev server (separate terminal, default port 8787)
cd worker && npm install && npx wrangler dev

# Worker typecheck only
cd worker && npm run typecheck
```

- Set `API_TARGET` to override the dev proxy backend (e.g. `API_TARGET=http://localhost:8787 npm run dev`).

## Build & deploy

```bash
# Build frontend (set API base for production)
VITE_API_BASE="https://your-worker.workers.dev/" npm run build

# Deploy Worker
cd worker && npx wrangler deploy

# Deploy frontend to Pages
npx wrangler pages deploy dist --project-name=infinite-servers-dashboard
```

- `VITE_ASSET_BASE=/` changes asset paths from `/dist/assets/` to `/` — required for Pages/GitHub builds.

> **Dashboard-only deployment?** See `docs/dashboard-deployment.md` for a CLI-free setup via Cloudflare Dashboard.

## Key gotchas

- **Vite root is `web/`**, not repo root. Build output goes to `../dist/`.
- `web/login.html` hardcodes `/dist/assets/` paths — designed to be served by the Worker, not the Vite dev server.
- Frontend API base comes from `import.meta.env.VITE_API_BASE` in `web/src/api.js`. Defaults to `"./"`.
- `configs/` directory is not in the repo (`.gitignore` excludes `configs/web-servers.json`). Template configs live in README/docs only.
- Auth tokens are UUIDs stored in KV (`auth_tokens` key), 7-day expiry. Password is set in KV `config.json` or via `wrangler secret put PASSWORD`.
- IP brute-force protection: 10 failed logins/hour → 30-day ban (D1 `ip_bans` table).
- No linter, formatter, or pre-commit hooks configured. No test suite.
- Worker Cron Trigger runs daily at UTC 00:00 (updates geo, checks expiry, sends Telegram alerts).

## File map

```
web/src/
  api.js           — data layer, auth, fetchers
  dashboard.jsx    — main fleet view
  detail.jsx       — per-server detail view
  charts.jsx       — charting (history)
  chrome.jsx       — layout shell, AppBar
  i18n.jsx         — i18n provider
  ErrorBoundary.jsx — React error boundary
  fonts.js         — font imports (IBM Plex Mono/Sans)
  styles/          — CSS per page

worker/src/
  index.ts         — Hono app, route wiring, cron export
  types.ts         — Env, ServerConfig, HistoryRow types
  auth.ts          — password verify, token gen/validate, IP ban
  db.ts            — D1 query helpers
  kv.ts            — KV config reads
  geo.ts           — Worker exit IP geo lookup
  cron.ts          — daily cron logic
  rate-limit.ts    — per-IP rate limiting (D1-backed)
  routes/*.ts      — one file per API route

scripts/
  migrate-to-d1.sql       — D1 schema (server_info, server_status, history, login_logs, ip_bans, rate_limits)
  install-agent.sh        — standalone agent installer (curl | bash)
  deploy-agent.sh         — wrapper that calls install-agent.sh
```

## Deployment resources

| Resource | Binding | Purpose |
|----------|---------|---------|
| D1 | `DB` | server_info, server_status, history |
| KV | `CONFIG` | servers.json, config.json, auth_tokens |
| Cron | `0 0 * * *` | daily maintenance |

## Cloudflare-specific

- `wrangler.toml` lives in `worker/` with `nodejs_compat` flag.
- Resource bindings (D1, KV) are managed via Cloudflare Dashboard, not hardcoded in `wrangler.toml`.
- Workers Builds (GitHub integration) injects Dashboard-configured bindings automatically.
- For local development, add your own resource IDs to `wrangler.toml` (see commented examples).
- All API routes handle CORS with configurable origins (defaults to `*.pages.dev,*.workers.dev`).
- Worker serves both fetch (HTTP) and scheduled (cron) handlers.
- KV changes take effect immediately — no redeploy needed.

## Installed skills (`.mimocode/skills/`)

| Skill | Source | Use when |
|-------|--------|----------|
| `cloudflare-basic-infra` | boxabirds/cloudflare-basic-infra-starter-skill | Worker architecture, D1 schemas, deploy scripts, testing patterns |
| `cloudflare-platform` | cloudflare/skills | Choosing the right Cloudflare product, platform-wide reference |
| `cloudflare-wrangler` | cloudflare/skills | Wrangler CLI commands, config, D1/KV/R2/Pages operations |
| `superpowers` | obra/superpowers | Structured brainstorming, planning, execution, verification workflows |
