# Phase 6 — Observability, Hardening & Integration Tests

## Goal

Make the system production-honest: structured logging wired end-to-end,
startup environment validation, graceful shutdown, and a suite of integration
tests that exercise every requirement from `objectives.md` through the full
stack — HTTP → core → Redis.

---

## Rationale

A service that works but can't be observed is incomplete. When something goes
wrong at 3 AM, the only tools available are logs and metrics. Getting
observability right before declaring the system done means:

- Every request leaves an audit trail with enough context to diagnose failures.
- Misconfigured environments fail loudly at startup, not silently mid-request.
- A clean shutdown prevents data corruption when a container is replaced.
- Integration tests codify the requirements as executable proofs — if a
  requirement changes, the test breaks, which is exactly what should happen.

---

## Deliverables

### 6.1 — Request-Scoped Logging Middleware (`apps/api/src/middleware/logger.ts`)

A Hono middleware that attaches a child logger to every request and logs
request/response pairs.

**Behaviour:**
- On each request: create a child logger with `{ requestId, method, path }`.
  `requestId` = `X-Request-ID` header if present, otherwise a generated UUID.
- Attach the child logger to Hono's context (`c.set('logger', childLogger)`).
- After the handler resolves: log at `info` level with `{ requestId, status, durationMs }`.
- On errors (caught by `onError`): log at `error` level with `{ requestId, err }`.

**Why request-scoped child loggers?**
All log lines for a single request share the same `requestId`. When debugging
a production issue, you can filter by `requestId` and see the complete
lifecycle of that request — validation, Redis call, response — in one view.

**Why forward `X-Request-ID`?**
NGINX (or any upstream proxy/load balancer) can inject `X-Request-ID` headers.
Honouring that header means the same ID flows through proxy logs, app logs, and
client-side traces — full distributed traceability without a tracing backend.

### 6.2 — Startup Environment Validation (`apps/api/src/startup.ts`)

A function called once before `serve()` that validates critical env vars and
fails fast if the environment is misconfigured.

**Checks:**
- `SERVER.PORT` is a valid integer in range `1024–65535`.
- `REDIS.URL` is parseable as a URL (basic check — `new URL(REDIS_URL)` does not throw).
- If any check fails: `logger.fatal({ check }, 'Startup validation failed')` then `process.exit(1)`.

**Why `process.exit(1)` and not throw?**
On startup, there is no HTTP server listening yet — throwing would just
propagate to the top-level and produce an ugly uncaught exception dump.
`process.exit(1)` signals to the container orchestrator (Docker, Kubernetes)
that the container failed to start, which triggers a restart policy.

**Why do this at all?**
Without startup validation, a typo in `REDIS_URL` (e.g. `redis//localhost`)
produces a cryptic ioredis error on the first request, minutes after the
container "started successfully". A startup check surfaces the issue
immediately, in the right place, with a clear message.

### 6.3 — Graceful Shutdown (`apps/api/src/index.ts` update)

Listen for `SIGTERM` and `SIGINT`. On signal:

1. Stop accepting new connections (close the HTTP server).
2. Wait for in-flight requests to complete (with a 10-second timeout).
3. Quit the Redis client (`redis.quit()`).
4. `logger.info('Graceful shutdown complete')` then `process.exit(0)`.

**Why SIGTERM?**
`docker stop` sends `SIGTERM` to PID 1. Without a handler, Node.js exits
immediately — potentially mid-request, mid-Lua-script, leaving Redis in an
inconsistent state. Graceful shutdown ensures every in-flight request either
completes or is safely abandoned before the process exits.

**Why 10-second timeout?**
A request that takes longer than 10 seconds is almost certainly stuck (a Redis
timeout should fire well before that). Waiting indefinitely would stall
container replacement during a rolling deploy.

### 6.4 — Integration Test Suite

**Test runner:** Vitest (fast, native ESM, no transpilation needed with `moduleResolution: Bundler`).

**Setup:** Tests use `createApp()` from Phase 4 and Hono's test client
(`app.request()`). A real Redis instance is required — use the Docker Compose
`redis` service or a local Redis for local runs. Tests are NOT mocked for
Redis: they test the full stack.

**Add to `apps/api/package.json`:**
```json
"devDependencies": {
  "vitest": "^2.x"
}
```

**File:** `apps/api/src/__tests__/otp.test.ts`

#### Test Cases

**OTP Generation:**

```
✓ POST /otp/generate with valid userId returns 200 { ok: true, otpTtlSeconds: 300 }
✓ POST /otp/generate with missing userId returns 400 VALIDATION_ERROR
✓ POST /otp/generate with userId="" returns 400 VALIDATION_ERROR
✓ POST /otp/generate 3 times in a row succeeds (3/min limit not yet hit)
✓ POST /otp/generate 4th time in same minute returns 429 RATE_LIMITED { window: 'minute' }
```

**OTP Verification:**

```
✓ POST /otp/verify with correct code returns 200 { ok: true }
✓ POST /otp/verify with wrong code returns 422 INVALID_CODE
✓ POST /otp/verify with non-existent userId returns 404 OTP_NOT_FOUND
✓ POST /otp/verify after 5 wrong attempts returns 429 MAX_ATTEMPTS_EXCEEDED
✓ POST /otp/verify after successful verify returns 404 OTP_NOT_FOUND (single-use)
```

**Resend (invalidation):**

```
✓ Generate OTP, then generate again for same userId — second generate succeeds
✓ Verifying original code after resend returns 422 INVALID_CODE (old code invalidated)
```

**Health:**

```
✓ GET /health returns 200 { ok: true, uptime: <number> }
```

**Why real Redis, not mocks?**
The most critical behaviours — atomicity, TTL expiry, attempt counting — are
implemented in Lua scripts running inside Redis. Mocking Redis means mocking
the implementation. A mock that returns `'OK'` regardless of the inputs proves
nothing. Only a real Redis call validates that the Lua script is correct.

**Why `createApp()` in tests?**
No port binding, no network calls — tests run in-process. This is faster than
spinning up a real HTTP server and avoids port conflicts.

### 6.5 — `apps/api/package.json` Test Script

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Root `package.json` already has `"test": "pnpm -r test"`, so
`pnpm test` from the root runs the full suite.

---

## File Map

```
apps/api/src/
├── middleware/
│   ├── error-handler.ts    (Phase 4 — already done)
│   └── logger.ts           ← 6.1
├── startup.ts              ← 6.2
├── index.ts                (updated — 6.3 graceful shutdown)
└── __tests__/
    └── otp.test.ts         ← 6.4
```

---

## Exit Criteria

- [ ] Every request log line contains `requestId`, `method`, `path`, `status`, `durationMs`
- [ ] Starting the server with an invalid `REDIS_URL` exits with code `1` and a `fatal` log message
- [ ] `docker stop <api_container>` results in a `Graceful shutdown complete` log line (no mid-request kill)
- [ ] `pnpm test` runs all test cases in §6.4
- [ ] All test cases pass against a live Redis instance
- [ ] `pnpm -r typecheck` still passes
- [ ] `pnpm lint` reports no errors

---

## What This Phase Does NOT Do

- No metrics (Prometheus, StatsD) — would require additional infrastructure
- No distributed tracing (OpenTelemetry) — out of scope for this assignment
- No load tests — functional correctness is the goal here
- No TLS
