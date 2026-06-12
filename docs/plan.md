# Tech Stack

## Overview

This is a distributed OTP rate-limiting and verification system built as a pnpm monorepo.

---

## Runtime & Language

| Layer    | Choice        | Reason                                                                 |
|----------|---------------|------------------------------------------------------------------------|
| Language | TypeScript 5  | Type safety, better DX, strict mode enabled                            |
| Runtime  | Node.js 22 LTS| Stable LTS, native `--watch`, ESM support                              |
| Package  | pnpm (v9+)    | Monorepo workspaces, fast installs, strict hoisting                    |

---

## Server — Hono

**Package:** `hono`

- Ultra-lightweight web framework (~14kb), runs on Node.js, Bun, Deno, Cloudflare Workers
- First-class TypeScript support with typed middleware and RPC-style routing
- Built-in middleware for rate limiting hooks, JSON parsing, error handling
- Ideal for high-throughput, low-latency API services like OTP delivery

---

## Load Balancer — NGINX

**Deployment:** Docker container (`nginx:alpine`)

- Industry-standard reverse proxy and load balancer
- Configured in **round-robin** mode across multiple API replicas
- Handles:
  - Upstream health checks (passive + active)
  - Connection keep-alive / upstream pooling
  - Rate limiting at the edge (`limit_req_zone`) as a first line of defense before app-level limits
  - TLS termination (if needed)
- Lightweight, battle-tested, zero Node.js overhead

```nginx
# sketch — nginx.conf
upstream otp_api {
    server api_1:3000;
    server api_2:3000;
    server api_3:3000;
}

server {
    listen 80;
    location / {
        proxy_pass http://otp_api;
    }
}
```

---

## Cache / State Store — Redis

**Package:** `ioredis`

- All OTP state, TTLs, rate-limit counters, and attempt tracking live in Redis
- Atomic operations via **Lua scripts** for concurrency correctness (no TOCTOU races)
- Key namespacing strategy:

| Key Pattern                        | Purpose                              | TTL        |
|------------------------------------|--------------------------------------|------------|
| `otp:{userId}:code`                | Current OTP value                    | 5 min      |
| `otp:{userId}:attempts`            | Attempt counter for active OTP       | 5 min      |
| `ratelimit:{userId}:minute`        | Generation count in current minute   | 60 s       |
| `ratelimit:{userId}:hour`          | Generation count in current hour     | 1 hr       |
| `ratelimit:{userId}:day`           | Generation count in current day      | 24 hr      |

- Single Redis node for the assignment; production would use Redis Cluster or Sentinel

---

## Tooling

| Tool        | Purpose                                        |
|-------------|------------------------------------------------|
| Biome       | Linting + formatting (replaces ESLint/Prettier)|
| Husky       | Git hooks (pre-commit runs lint-staged)        |
| lint-staged | Runs Biome only on staged files                |
| tsc         | Type checking (`noEmit`)                       |

---

## Monorepo Structure

```
otp-service/
├── apps/
│   └── api/          # Hono HTTP server
├── packages/
│   └── core/         # Shared logic — OTP gen, rate limiter, Redis client
├── docs/
│   ├── plan.md
│   └── tech-stack.md
├── biome.json
├── .nvmrc            # Node 22 LTS
├── .husky/
│   └── pre-commit
└── pnpm-workspace.yaml
```
