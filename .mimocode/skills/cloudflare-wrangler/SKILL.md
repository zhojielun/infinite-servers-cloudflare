---
name: cloudflare-wrangler
description: >
  Cloudflare Workers CLI for deploying, developing, and managing Workers, KV, R2, D1,
  Vectorize, Hyperdrive, Workers AI, Containers, Queues, Workflows, Pipelines, and
  Secrets Store. Load before running wrangler commands to ensure correct syntax and
  best practices. Biases towards retrieval from Cloudflare docs over pre-trained knowledge.
---

# Wrangler CLI

Your knowledge of Wrangler CLI flags, config fields, and subcommands may be outdated. **Prefer retrieval over pre-training** for any Wrangler task.

## FIRST: Check if Wrangler is installed, and if not, install it

```bash
wrangler --version  # Requires v4.x+
```

If not installed:
```bash
npm install -D wrangler@latest
```

Wherever possible, use Wrangler instead of manually constructing API requests.

## Key Guidelines

- **Use `wrangler.jsonc`**: Prefer JSON config over TOML. Newer features are JSON-only.
- **Set `compatibility_date`**: Use a recent date (within 30 days). Check https://developers.cloudflare.com/workers/configuration/compatibility-dates/
- **Generate types after config changes**: Run `wrangler types` to update TypeScript bindings.
- **Local dev defaults to local storage**: Bindings use local simulation unless `remote: true`.
- **Profile Worker startup**: Run `wrangler check startup` to measure startup time.
- **Use environments for staging/prod**: Define `env.staging` and `env.production` in config.

## Quick Reference: Core Commands

| Task | Command |
|------|---------|
| Start local dev server | `wrangler dev` |
| Deploy to Cloudflare | `wrangler deploy` |
| Deploy dry run | `wrangler deploy --dry-run` |
| Generate TypeScript types | `wrangler types` |
| Profile Worker startup time | `wrangler check startup` |
| View live logs | `wrangler tail` |
| Delete Worker | `wrangler delete` |
| Auth status | `wrangler whoami` |

## Configuration (wrangler.jsonc)

### Minimal Config

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-01-01"
}
```

### Full Config with Bindings

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-01-01",
  "compatibility_flags": ["nodejs_compat"],
  "vars": { "ENVIRONMENT": "production" },
  "kv_namespaces": [{ "binding": "KV", "id": "<KV_NAMESPACE_ID>" }],
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "my-bucket" }],
  "d1_databases": [{ "binding": "DB", "database_name": "my-db", "database_id": "<DB_ID>" }],
  "ai": { "binding": "AI" },
  "vectorize": [{ "binding": "VECTOR_INDEX", "index_name": "my-index" }],
  "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<HYPERDRIVE_ID>" }],
  "durable_objects": {
    "bindings": [{ "name": "COUNTER", "class_name": "Counter" }]
  },
  "triggers": { "crons": ["0 * * * *"] },
  "env": {
    "staging": {
      "name": "my-worker-staging",
      "vars": { "ENVIRONMENT": "staging" }
    }
  }
}
```

## Local Development

```bash
# Local mode (default) - uses local storage simulation
wrangler dev

# With specific environment
wrangler dev --env staging

# Custom port
wrangler dev --port 8787

# Test scheduled/cron handlers
wrangler dev --test-scheduled
# Then visit: http://localhost:8787/__scheduled
```

### Remote Bindings for Local Dev

Use `remote: true` in binding config to connect to real resources while running locally:

```jsonc
{
  "r2_buckets": [
    { "binding": "BUCKET", "bucket_name": "my-bucket", "remote": true }
  ],
  "ai": { "binding": "AI", "remote": true }
}
```

### Local Secrets

Create `.dev.vars` for local development secrets:
```
API_KEY=local-dev-key
DATABASE_URL=postgres://localhost:5432/dev
```

## Deployment

```bash
# Deploy to production
wrangler deploy

# Deploy specific environment
wrangler deploy --env staging

# Dry run (validate without deploying)
wrangler deploy --dry-run

# Minify code
wrangler deploy --minify
```

### Manage Secrets

> **Security**: Never pass secret values as command arguments or pipe them via `echo`.
> Use the interactive prompt (preferred), pipe from a file, or use `secret bulk`.

```bash
# Set secret -- interactive prompt (preferred)
wrangler secret put API_KEY

# Set secret from a file
wrangler secret put PRIVATE_KEY < path/to/private-key.pem

# List secrets
wrangler secret list

# Delete secret
wrangler secret delete API_KEY
```

### Versions and Rollback

```bash
wrangler versions list
wrangler rollback
wrangler rollback <VERSION_ID>
```

## D1 (SQL Database)

```bash
# Create database
wrangler d1 create my-database

# Execute SQL command (remote)
wrangler d1 execute my-database --remote --command "SELECT * FROM users"

# Execute SQL file (remote)
wrangler d1 execute my-database --remote --file ./schema.sql

# Create migration
wrangler d1 migrations create my-database create_users_table

# Apply migrations locally
wrangler d1 migrations apply my-database --local

# Apply migrations to remote
wrangler d1 migrations apply my-database --remote

# Export schema and data
wrangler d1 export my-database --remote --output backup.sql
```

## KV (Key-Value Store)

```bash
# Create namespace
wrangler kv namespace create MY_KV

# Put value
wrangler kv key put --namespace-id <ID> "key" "value"

# Put with expiration (seconds)
wrangler kv key put --namespace-id <ID> "key" "value" --expiration-ttl 3600

# Get value
wrangler kv key get --namespace-id <ID> "key"

# List keys
wrangler kv key list --namespace-id <ID>

# Delete key
wrangler kv key delete --namespace-id <ID> "key"
```

## R2 (Object Storage)

```bash
# Create bucket
wrangler r2 bucket create my-bucket

# Upload object
wrangler r2 object put my-bucket/path/file.txt --file ./local-file.txt

# Download object
wrangler r2 object get my-bucket/path/file.txt
```

## Pages (Frontend Deployment)

```bash
# Create Pages project
wrangler pages project create my-site

# Deploy directory to Pages
wrangler pages deploy ./dist

# Deploy with specific branch
wrangler pages deploy ./dist --branch main
```

## Observability

```bash
# Stream live logs
wrangler tail

# Tail specific Worker
wrangler tail my-worker

# Filter by status
wrangler tail --status error

# JSON output
wrangler tail --format json
```

## Testing

```bash
npm install -D @cloudflare/vitest-pool-workers vitest
```

`vitest.config.ts`:
```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
  },
});
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `command not found: wrangler` | Install: `npm install -D wrangler` |
| Auth errors | Run `wrangler login` |
| Startup time limit exceeded | Run `wrangler check startup` |
| Type errors after config change | Run `wrangler types` |
| Binding undefined in Worker | Verify binding name matches config exactly |

## Best Practices

1. Version control `wrangler.jsonc` -- treat as source of truth
2. Use automatic provisioning -- omit resource IDs for auto-creation on deploy
3. Run `wrangler types` in CI -- catch binding mismatches
4. Use environments -- separate staging/production
5. Set `compatibility_date` -- update quarterly
6. Use `.dev.vars` for local secrets -- never commit secrets to config
7. Test locally first -- `wrangler dev` with local bindings before deploying
8. Use `--dry-run` before major deploys
9. Never embed secrets in commands -- use interactive prompts or file-based input
