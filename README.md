# OTP-service

A distributed OTP (one-time password) generation and verification system. Built as a pnpm monorepo with a focus on correctness under concurrency, multi-window rate limiting, and horizontal scalability.

---

## What It Does

Two HTTP endpoints:

- `**POST /otp/generate**` — generates a 6-digit OTP for a given user and stores it in Redis with a 5-minute TTL. Enforces per-user rate limits across three independent time windows before issuing.
- `**POST /otp/verify**` — validates a submitted code against what's stored in Redis. The code is single-use and expires after 5 failed attempts.

Everything is stateless at the application layer. All OTP state, attempt counts, and rate-limit counters live exclusively in Redis.

---

## Architecture

```
Client
  │
  ▼
NGINX (port 80)
  │  Round-robin load balancer + IP-level edge rate limiting
  │
  ├── api_1 (Hono, port 3000)
  ├── api_2 (Hono, port 3000)
  └── api_3 (Hono, port 3000)
        │
        ▼
      Redis (port 6379)
```

Three API replicas run behind NGINX in round-robin. All replicas share the same Redis instance, so rate-limit counters and OTP state are consistent regardless of which replica handles a request.

---

## Monorepo Structure

```
otp-service/
├── apps/
│   └── api/                    # Hono HTTP server
│       └── src/
│           ├── index.ts         # Server entrypoint + graceful shutdown
│           ├── app.ts           # Hono app factory (importable in tests)
│           ├── constants.ts     # APP + SERVER env vars
│           ├── validation/      # Zod request schemas
│           ├── middleware/      # Error handler + request logger
│           ├── routes/          # /otp and /health route handlers
│           └── __tests__/       # Integration test suite (Vitest)
├── packages/
│   ├── core/                   # All domain logic
│   │   └── src/
│   │       ├── constants.ts     # REDIS + OTP + RATE_LIMIT env vars
│   │       ├── types.ts         # Shared domain types + discriminated unions
│   │       ├── redis-keys.ts    # Centralised Redis key factory
│   │       ├── redis/
│   │       │   ├── client.ts    # ioredis singleton
│   │       │   └── scripts.ts   # Atomic Lua scripts
│   │       ├── otp/
│   │       │   └── generate.ts  # Pure OTP code generator
│   │       └── services/
│   │           ├── generateOtp.ts
│   │           └── verifyOtp.ts
│   └── logger/                 # Shared pino logger
├── nginx/
│   └── nginx.conf
├── docker-compose.yml
├── apps/api/Dockerfile
├── biome.json
├── tsconfig.base.json
└── pnpm-workspace.yaml
```

---

## Rate Limiting

Every generate request checks three independent counters per user before issuing an OTP:


| Window | Limit | Redis Key                   | TTL  |
| ------ | ----- | --------------------------- | ---- |
| Minute | 3     | `ratelimit:{userId}:minute` | 60s  |
| Hour   | 10    | `ratelimit:{userId}:hour`   | 1hr  |
| Day    | 20    | `ratelimit:{userId}:day`    | 24hr |


All three must pass. A request blocked at any window returns `429` with the window name and how many seconds until that window resets.

Counters are incremented atomically via a Lua script. The TTL is set only on the first increment (`EXPIRE ... NX`), locking the window to when the first request in that window arrived — subsequent requests within the window do not extend it.

---

## Redis Key Schema


| Key                         | Value          | TTL   | Purpose                             |
| --------------------------- | -------------- | ----- | ----------------------------------- |
| `otp:{userId}:code`         | 6-digit string | 5 min | The active OTP                      |
| `otp:{userId}:attempts`     | integer        | 5 min | Failed verification attempt counter |
| `ratelimit:{userId}:minute` | integer        | 60s   | Generate requests in current minute |
| `ratelimit:{userId}:hour`   | integer        | 1hr   | Generate requests in current hour   |
| `ratelimit:{userId}:day`    | integer        | 24hr  | Generate requests in current day    |


All keys are namespaced by the `REDIS_KEY_PREFIX` env var (default: `otp`), applied via ioredis `keyPrefix`.

---

## OTP Lifecycle

**Generate:**

1. Rate limit check (Lua script — atomic across all three windows)
2. New 6-digit code generated
3. `otp:{userId}:code` written with 5-min TTL — overwrites any existing OTP (resend invalidates the previous one)
4. `otp:{userId}:attempts` reset to `0` with 5-min TTL

**Verify:**

1. Check `otp:{userId}:code` exists — if not, `OTP_NOT_FOUND`
2. Check attempts < 5 — if not, `MAX_ATTEMPTS_EXCEEDED`
3. Increment attempts counter
4. Compare submitted code against stored code — if mismatch, `INVALID_CODE`
5. On match — delete both keys immediately (single-use enforcement)

---

## Concurrency

Multiple API replicas processing requests simultaneously against the same Redis keys would cause race conditions without atomicity guarantees. All check-then-mutate operations run as Lua scripts via ioredis, which Redis executes as single atomic units. No other command can interleave between the read and write steps.

---

## HTTP API

### `POST /otp/generate`

```json
// Request
{ "userId": "user_42" }

// 200 — success
{ "ok": true, "otpTtlSeconds": 300 }

// 429 — rate limited
{ "ok": false, "code": "RATE_LIMITED", "window": "minute", "retryAfterSeconds": 34 }

// 400 — validation error
{ "ok": false, "code": "VALIDATION_ERROR", "message": "..." }
```

### `POST /otp/verify`

```json
// Request
{ "userId": "user_42", "code": "847291" }

// 200 — correct
{ "ok": true }

// 422 — wrong code
{ "ok": false, "code": "INVALID_CODE" }

// 429 — too many attempts
{ "ok": false, "code": "MAX_ATTEMPTS_EXCEEDED" }

// 404 — expired or never existed
{ "ok": false, "code": "OTP_NOT_FOUND" }
```

### `GET /health`

```json
{ "ok": true, "uptime": 42.3 }
```

---

## Running Locally

**Prerequisites:** Docker + Docker Compose

```bash
# Start everything (Redis + 3 API replicas + NGINX)
docker compose up

# Smoke test
curl -X POST http://localhost/otp/generate \
  -H 'Content-Type: application/json' \
  -d '{"userId":"test1"}'

curl -X POST http://localhost/otp/verify \
  -H 'Content-Type: application/json' \
  -d '{"userId":"test1","code":"<code from above>"}'
```

**Without Docker:**

```bash
pnpm install
pnpm -r build

# Requires a local Redis on port 6379
pnpm --filter @otp-service/api dev
```

---

## Environment Variables


| Variable            | Default                  | Description                        |
| ------------------- | ------------------------ | ---------------------------------- |
| `PORT`              | `3000`                   | HTTP server port                   |
| `HOST`              | `0.0.0.0`                | HTTP server host                   |
| `NODE_ENV`          | `development`            | Environment                        |
| `REDIS_URL`         | `redis://localhost:6379` | Redis connection URL               |
| `REDIS_KEY_PREFIX`  | `otp`                    | Prefix applied to all Redis keys   |
| `OTP_TTL_SECONDS`   | `300`                    | OTP validity window (seconds)      |
| `OTP_MAX_ATTEMPTS`  | `5`                      | Max failed verify attempts per OTP |
| `RATE_LIMIT_MINUTE` | `3`                      | Max OTP generations per minute     |
| `RATE_LIMIT_HOUR`   | `10`                     | Max OTP generations per hour       |
| `RATE_LIMIT_DAY`    | `20`                     | Max OTP generations per day        |


---

## Tech Stack


| Layer                | Choice                |
| -------------------- | --------------------- |
| Language             | TypeScript 5 (strict) |
| Runtime              | Node.js 22 LTS        |
| HTTP Framework       | Hono                  |
| Redis Client         | ioredis               |
| Validation           | Zod                   |
| Logging              | pino                  |
| Load Balancer        | NGINX                 |
| Containerisation     | Docker + Compose      |
| Linting / Formatting | Biome                 |
| Testing              | Vitest (integration)  |
| Package Manager      | pnpm (workspaces)     |


---

## Testing

Integration tests run against a real Redis instance — Redis state and Lua script behaviour are not mocked.

```bash
# Requires Redis running (docker compose up redis)
pnpm test
```

Tests cover: generate success, rate limiting across all three windows, verify correct/incorrect codes, max attempts enforcement, single-use invalidation, resend invalidation, and validation errors.