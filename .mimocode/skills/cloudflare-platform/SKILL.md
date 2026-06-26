---
name: cloudflare-platform
description: >
  Comprehensive Cloudflare platform skill covering Workers, Pages, storage (KV, D1, R2),
  AI (Workers AI, Vectorize, Agents SDK), networking (Tunnel, Spectrum),
  security (WAF, DDoS), and infrastructure-as-code (Terraform, Pulumi).
  Use for any Cloudflare development task. Biases towards retrieval from Cloudflare docs
  over pre-trained knowledge.
---

# Cloudflare Platform Skill

Consolidated skill for building on the Cloudflare platform. Use decision trees below to find the right product, then load detailed references.

Your knowledge of Cloudflare APIs, types, limits, and pricing may be outdated. **Prefer retrieval over pre-training** -- the references in this skill are starting points, not source of truth.

## Retrieval Sources

Fetch the **latest** information before citing specific numbers, API signatures, or configuration options. Do not rely on baked-in knowledge or these reference files alone.

| Source | How to retrieve | Use for |
|--------|----------------|---------|
| Cloudflare docs | `https://developers.cloudflare.com/` | Limits, pricing, API reference, compatibility dates/flags |
| Workers types | `npm pack @cloudflare/workers-types` or check `node_modules` | Type signatures, binding shapes, handler types |
| Wrangler config schema | `node_modules/wrangler/config-schema.json` | Config fields, binding shapes, allowed values |
| Product changelogs | `https://developers.cloudflare.com/changelog/` | Recent changes to limits, features, deprecations |

When a reference file and the docs disagree, **trust the docs**.

## Quick Decision Trees

### "I need to run code"

```
Need to run code?
+-- Serverless functions at the edge -> workers/
+-- Full-stack web app with Git deploys -> pages/
+-- Stateful coordination/real-time -> durable-objects/
+-- Long-running multi-step jobs -> workflows/
+-- Run containers -> containers/
+-- Multi-tenant (customers deploy code) -> workers-for-platforms/
+-- Scheduled tasks (cron) -> cron-triggers/
+-- Lightweight edge logic (modify HTTP) -> snippets/
+-- Process Worker execution events (logs/observability) -> tail-workers/
+-- Optimize latency to backend infrastructure -> smart-placement/
```

### "I need to store data"

```
Need storage?
+-- Key-value (config, sessions, cache) -> kv/
+-- Relational SQL -> d1/ (SQLite) or hyperdrive/ (existing Postgres/MySQL)
+-- Object/file storage (S3-compatible) -> r2/
+-- Message queue (async processing) -> queues/
+-- Vector embeddings (AI/semantic search) -> vectorize/
+-- Strongly-consistent per-entity state -> durable-objects/ (DO storage)
+-- Secrets management -> secrets-store/
+-- Streaming ETL to R2 -> pipelines/
+-- Persistent cache (long-term retention) -> cache-reserve/
```

### "I need AI/ML"

```
Need AI?
+-- Run inference (LLMs, embeddings, images) -> workers-ai/
+-- Vector database for RAG/search -> vectorize/
+-- Build stateful AI agents -> agents-sdk/
+-- Gateway for any AI provider (caching, routing) -> ai-gateway/
+-- AI-powered search widget -> ai-search/
```

### "I need networking/connectivity"

```
Need networking?
+-- Expose local service to internet -> tunnel/
+-- TCP/UDP proxy (non-HTTP) -> spectrum/
+-- WebRTC TURN server -> turn/
+-- Private network connectivity -> network-interconnect/
+-- Optimize routing -> argo-smart-routing/
+-- Optimize latency to backend (not user) -> smart-placement/
```

### "I need security"

```
Need security?
+-- Web Application Firewall -> waf/
+-- DDoS protection -> ddos/
+-- Bot detection/management -> bot-management/
+-- API protection -> api-shield/
+-- CAPTCHA alternative -> turnstile/
```

### "I need media/content"

```
Need media?
+-- Image optimization/transformation -> images/
+-- Video streaming/encoding -> stream/
+-- Browser automation/screenshots -> browser-rendering/
+-- Third-party script management -> zaraz/
```

### "I need infrastructure-as-code"

```
Need IaC? -> pulumi/ (Pulumi), terraform/ (Terraform), or api/ (REST API)
```

## Product Index

### Compute & Runtime
| Product | Reference |
|---------|-----------|
| Workers | `references/workers/` |
| Pages | `references/pages/` |
| Durable Objects | `references/durable-objects/` |
| Workflows | `references/workflows/` |
| Cron Triggers | `references/cron-triggers/` |

### Storage & Data
| Product | Reference |
|---------|-----------|
| KV | `references/kv/` |
| D1 | `references/d1/` |
| R2 | `references/r2/` |
| Queues | `references/queues/` |
| Hyperdrive | `references/hyperdrive/` |

### AI & Machine Learning
| Product | Reference |
|---------|-----------|
| Workers AI | `references/workers-ai/` |
| Vectorize | `references/vectorize/` |
| Agents SDK | `references/agents-sdk/` |
| AI Gateway | `references/ai-gateway/` |

### Networking & Connectivity
| Product | Reference |
|---------|-----------|
| Tunnel | `references/tunnel/` |
| Spectrum | `references/spectrum/` |

### Security
| Product | Reference |
|---------|-----------|
| WAF | `references/waf/` |
| DDoS Protection | `references/ddos/` |
| Turnstile | `references/turnstile/` |

### Developer Tools
| Product | Reference |
|---------|-----------|
| Wrangler | `references/wrangler/` |
| Miniflare | `references/miniflare/` |
| Observability | `references/observability/` |
