---
name: cloudflare-basic-infra
description: >
  USE WHEN building or scaffolding a Cloudflare Workers project.
  USE WHEN creating D1 database schemas or writing migrations.
  USE WHEN setting up wrangler.toml, deployment scripts, or testing infrastructure.
  USE WHEN deploying to Cloudflare Pages or configuring multi-environment Workers.
  Patterns: worker architecture, D1 schema design, Wrangler multi-env config,
  deploy scripts with safety checks, Miniflare local dev, Pages frontend,
  auth middleware, security headers.
---

# Cloudflare Workers Infrastructure Patterns

Proven patterns for Cloudflare Workers projects. Apply these when starting a new project or reviewing existing infrastructure.

## Worker Architecture

Structure your worker with a typed `Env` interface declaring all Cloudflare bindings (D1, KV, secrets) with optional markers for graceful degradation. Use a single `handleRequest(request, env, ctx)` entry point with this flow:

1. **Validate** -- check method, content-type, body size before routing
2. **Route** -- match URL path prefixes, declare auth requirements per path group
3. **Authenticate** -- API key hash lookup or session cookie, fall through to 401
4. **Dispatch** -- route to handler
5. **Finalize** -- add security headers + request ID to every response

Use `ctx.waitUntil()` for async cleanup (analytics flush, logging) that shouldn't block the response.

## D1 Database Patterns

- **IDs**: `TEXT PRIMARY KEY DEFAULT (hex(randomblob(16)))` -- 16-byte random hex, not autoincrement
- **Timestamps**: `TEXT DEFAULT (datetime('now'))` -- ISO 8601 UTC strings
- **Soft delete**: Add `deleted INTEGER DEFAULT 0` and `deleted_at TEXT` columns. Filter with `AND deleted = 0`
- **Never use CHECK constraints** -- they're immutable in SQLite/D1. Dropping them requires recreating the entire table. Validate enums and ranges in application code instead
- **Migration naming**: `NNNN_snake_case_description.sql` (sequential from 0001)
- **User-facing IDs**: Use an atomic counter table (`UPDATE counters SET value = value + 1 ... RETURNING value`) rather than exposing internal hex IDs
- **Index FK columns** and common filter columns. Create composite indexes for frequent query patterns

## Wrangler Multi-Environment Config

Structure `wrangler.toml` with three sections:

1. **Base** (top-level) -- local development defaults, `ENVIRONMENT = "local"`
2. **`[env.staging]`** -- staging overrides with separate D1 database, logpush enabled
3. **`[env.production]`** -- production overrides with route patterns, observability enabled

Each environment gets its own D1 database binding, KV namespaces, and environment variables. Secrets (API keys, OAuth credentials) use `wrangler secret put` per environment, never `[vars]`.

## Deployment Scripts

Build deploy scripts with these safety mechanisms:

- **Migration safety scan**: Before deploying, grep pending migrations for dangerous patterns (`CHECK (`, `DROP TABLE`, `ALTER TABLE...MODIFY`, `ADD CONSTRAINT`). Block production deploys, warn on staging
- **Idempotency**: Query the `/health` endpoint for the deployed SHA. Skip deployment if it matches the tag being deployed and no migrations are pending
- **Retry with backoff**: Wrap `wrangler deploy` in a retry helper (3 attempts, exponential delay)
- **Health verification**: After each service deploys, hit `/health` and verify the response
- **Version tagging**: Semantic version tags (`v1.2.0`) for releases, timestamp tags (`deploy/prod/20250220-153000`) for deployment records
- **Deploy logging**: Append to a CSV log (`deploy_id, operator, git_sha, timestamp, status, version`)

## Testing Workers

- **Local dev**: `wrangler dev` starts Miniflare on port 8787 with local SQLite
- **Test endpoints**: Gate all `/test/*` routes on `ENVIRONMENT !== "production"`. Use them for seeding test data, creating test sessions, and API key provisioning
- **E2E setup**: Load `.env.test` with `MCP_TEST_ENDPOINT` pointing to local or staging URL
- **Unit tests**: Use `@cloudflare/vitest-pool-workers` for isolated tests with Miniflare bindings. Unit tests must never connect to real databases
- **Test data seeding**: Dedicated endpoints that create projects, users, and seed data for E2E test setup

## Pages Frontend Deployment

Deploy Vite SPA to Cloudflare Pages:

1. Build with environment-specific variables: `VITE_API_URL`, `VITE_ENABLE_TEST_ROUTES`
2. Deploy: `wrangler pages deploy dist --project-name=my-app --branch=main`
3. Use branch-based deploys: `--branch=staging` for preview environments

## Auth and Security

- **Auth middleware**: Check `X-Api-Key` header first (hash with SHA-256, look up hash in DB), then fall back to session cookie. Return 401 if neither succeeds
- **No-auth paths**: Declare upfront which path prefixes bypass auth (health checks, OAuth callbacks, setup flows)
- **Security headers**: Apply to every response -- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cache-Control: no-store`, `Content-Security-Policy: frame-ancestors 'none'`
- **Request validation**: Check HTTP method, Content-Type for POST, body size (1MB max), suspicious header values
- **CORS**: Compute allowed origin from an environment variable (`WEB_APP_URL`), not hardcoded
- **Request ID**: Generate per-request, propagate in response header for tracing

## Local Development

Get from zero to running locally without touching staging or production:

1. Copy `assets/wrangler.toml.template`, fill in your project name
2. Write your initial migration in `migrations/0001_initial_schema.sql`
3. Apply locally: `wrangler d1 migrations apply DB --local`
4. Start worker: `wrangler dev` (Miniflare on port 8787, local SQLite)
5. Start frontend: Vite dev server proxying API calls to localhost:8787
6. Verify: `curl http://localhost:8787/health`
7. Run tests: unit tests with vitest pool workers, E2E against localhost

## Health and Operations

- **Health endpoint**: Return JSON with `status`, `version`, `environment`, `git_sha`, `deployed_at`. Support both `/health` and `/<prefix>/health` paths
- **Version injection**: Set `APP_VERSION`, `GIT_SHA`, `DEPLOYED_AT` as build-time variables via Wrangler `[define]` or `[vars]`
- **Deploy log**: CSV file tracking every deployment (who, when, which SHA, success/failure)
- **Observability**: Enable `logpush` and `observability.logs` in staging and production wrangler config
