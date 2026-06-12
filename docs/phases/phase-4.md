# Phase 4 — HTTP API: Hono Server, Routes & Request Validation

## Goal

Wire the Phase 3 domain library to an HTTP surface using Hono. This phase
produces a fully-functional, self-contained API server that can receive
requests, validate them, invoke core services, and return structured JSON
responses — all without Docker or NGINX.

---

## Rationale

Hono was chosen (see `plan.md`) for its tiny footprint, first-class TypeScript
support, and Node.js compatibility. By the time we reach this phase, all the
hard logic is done — this layer is intentionally thin. Every route handler
should be readable as a mapping:
```
validate input → call service → map result to HTTP response
```
If any handler contains business logic, that logic belongs in `packages/core`.

---

## Deliverables

### 4.1 — Install Dependencies

Add to `apps/api/package.json`:

```json
"dependencies": {
  "@hono/node-server": "^1.x",
  "hono": "^4.x",
  "zod": "^3.x",
  "@otp-service/core":   "workspace:*",
  "@otp-service/logger": "workspace:*"
}
```

**Why Zod?**
Hono has built-in validators but they don't produce typed, structured error
objects out of the box. Zod gives us a schema that simultaneously validates and
infers TypeScript types, so the route body is typed the moment it's validated.

### 4.2 — `apps/api/src/constants.ts`

Already specified in Phase 2. No changes needed here.

### 4.3 — `apps/api/src/validation/schemas.ts`

Zod schemas for all request bodies. Centralised so both routes and tests use
the same schema.

```ts
import { z } from 'zod';

export const generateRequestSchema = z.object({
  userId: z.string().min(1).max(128),
});

export const verifyRequestSchema = z.object({
  userId: z.string().min(1).max(128),
  code:   z.string().length(6).regex(/^\d{6}$/),
});

export type GenerateRequest = z.infer<typeof generateRequestSchema>;
export type VerifyRequest   = z.infer<typeof verifyRequestSchema>;
```

**Why validate `code` as exactly 6 digits?**
Rejecting malformed codes at the boundary prevents unnecessary Redis reads.
It also ensures `candidateCode` is always a clean string when it reaches the
Lua script — no injection risk from weird inputs.

### 4.4 — `apps/api/src/middleware/error-handler.ts`

A Hono `onError` handler that normalises all errors into a consistent JSON
envelope before sending to the client.

**Response shape (all errors):**
```json
{
  "ok":     false,
  "code":   "INTERNAL_ERROR",
  "message": "An unexpected error occurred"
}
```

**Behaviour:**
- If the error has a known `AppErrorCode` attached, use it.
- Otherwise, log the full error (with stack) at `error` level via `logger`.
- Always respond `Content-Type: application/json`.
- Never leak internal error details (stack traces, Redis messages) to the
  client in production (`APP.IS_PROD`).

### 4.5 — `apps/api/src/routes/otp.ts` — Route Handlers

A Hono `Router` mounted at `/otp`.

#### `POST /otp/generate`

**Request body:** `{ userId: string }`

**Flow:**
1. Parse + validate body with `generateRequestSchema`. On failure → `400` with
   `VALIDATION_ERROR` response.
2. Call `generateOtp(userId)` from `@otp-service/core`.
3. Map result:
   | `GenerateResult`                   | HTTP Status | Body |
   |------------------------------------|-------------|------|
   | `{ ok: true, otpTtlSeconds }`      | `200`       | `{ ok: true, otpTtlSeconds }` |
   | `{ ok: false, reason: 'RATE_LIMITED', window, retryAfterSeconds }` | `429` | `{ ok: false, code: 'RATE_LIMITED', window, retryAfterSeconds }` |

**Why 200 for generate, not 201?**
No resource is being created from the caller's perspective — an OTP is not
a persistent entity they can address. `201` implies a Location header and a
created resource. `200` is semantically cleaner.

#### `POST /otp/verify`

**Request body:** `{ userId: string, code: string }`

**Flow:**
1. Parse + validate body with `verifyRequestSchema`. On failure → `400`.
2. Call `verifyOtp(userId, code)` from `@otp-service/core`.
3. Map result:
   | `VerifyResult`                              | HTTP Status | Body |
   |---------------------------------------------|-------------|------|
   | `{ ok: true }`                              | `200`       | `{ ok: true }` |
   | `{ ok: false, reason: 'INVALID_CODE' }`     | `422`       | `{ ok: false, code: 'INVALID_CODE' }` |
   | `{ ok: false, reason: 'MAX_ATTEMPTS_EXCEEDED' }` | `429`  | `{ ok: false, code: 'MAX_ATTEMPTS_EXCEEDED' }` |
   | `{ ok: false, reason: 'OTP_NOT_FOUND' }`   | `404`       | `{ ok: false, code: 'OTP_NOT_FOUND' }` |

**Why 422 for wrong code?**
`401` implies authentication failure (wrong credentials for a session).
`403` implies authorisation (you're authenticated but forbidden).
`422` (Unprocessable Entity) is the correct status for "the request was
well-formed but the semantic validation failed" — i.e. the code is syntactically
valid but factually wrong.

**Why 429 for max-attempts?**
The caller has made too many requests. `429 Too Many Requests` is the standard
rate-limit status and is the one most API clients and proxies understand
natively (they can respect `Retry-After` headers if we add them later).

### 4.6 — `apps/api/src/routes/health.ts`

```
GET /health → 200 { ok: true, uptime: number }
```

No auth, no validation. Used by NGINX in Phase 5 for upstream health checks
and by Docker for container readiness.

### 4.7 — `apps/api/src/app.ts` — Hono Application Factory

```ts
// Creates and configures the Hono app.
// Exported separately from the server entrypoint so it can be imported
// in tests without starting a live HTTP server.

const createApp = (): Hono => {
  const app = new Hono();
  app.use('*', /* request-id / logging middleware */);
  app.route('/otp', otpRouter);
  app.route('/', healthRouter);
  app.onError(errorHandler);
  return app;
};

export { createApp };
```

**Why separate `createApp` from the server start?**
When writing integration tests, you import `createApp()` and pass it to a test
client — no actual port binding needed. Mixing app construction with
`serve(app, { port })` would make tests require teardown of live servers.

### 4.8 — `apps/api/src/index.ts` — Server Entrypoint

```ts
import { serve } from '@hono/node-server';
import { SERVER, APP } from '@/constants';
import { createApp } from '@/app';
import { logger } from '@otp-service/logger';

const app = createApp();

serve({ fetch: app.fetch, port: SERVER.PORT, hostname: SERVER.HOST }, () => {
  logger.info({ port: SERVER.PORT, env: APP.NODE_ENV }, 'API server started');
});
```

---

## File Map

```
apps/api/src/
├── constants.ts                  (Phase 2 — already done)
├── index.ts                      ← 4.8
├── app.ts                        ← 4.7
├── validation/
│   └── schemas.ts                ← 4.3
├── middleware/
│   └── error-handler.ts          ← 4.4
└── routes/
    ├── health.ts                 ← 4.6
    └── otp.ts                    ← 4.5
```

---

## HTTP Status Code Reference

| Scenario | Status |
|---|---|
| Generate success | 200 |
| Verify success | 200 |
| Validation error (bad body) | 400 |
| OTP not found | 404 |
| Wrong code | 422 |
| Rate limited (generation) | 429 |
| Max attempts exceeded | 429 |
| Unexpected server error | 500 |

---

## Exit Criteria

- [x] `hono`, `@hono/node-server`, `zod` added to `apps/api` dependencies
- [x] `validation/schemas.ts` exports `generateRequestSchema` and `verifyRequestSchema`
- [x] `middleware/error-handler.ts` exports the `onError` handler
- [x] `routes/health.ts` handles `GET /health`
- [x] `routes/otp.ts` handles `POST /otp/generate` and `POST /otp/verify` per status table above
- [x] `app.ts` exports `createApp()` with all routes and middleware wired
- [x] `index.ts` starts the server using `SERVER.PORT` and `SERVER.HOST`
- [x] `pnpm -r typecheck` passes
- [x] `pnpm -r build` succeeds
- [x] Manual smoke test: `pnpm dev` in `apps/api`, `curl -X POST localhost:3000/otp/generate -d '{"userId":"u1"}'` returns `200`

---

## What This Phase Does NOT Do

- No Docker or NGINX
- No load balancing
- No TLS
- No automated tests (those follow in Phase 6 hardening)
