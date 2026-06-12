# Phase 2 — Domain Contracts: Types, Constants & Redis Key Schema

## Goal

Define every TypeScript type, every environment constant, and every Redis key
pattern that the system will ever touch — **before any implementation**.
Phase 2 produces no runnable logic; it produces the authoritative
vocabulary that all later phases speak.

---

## Rationale

Spec-driven development works because consumers of a module can be written
against its interface before its implementation exists. If the types are wrong,
compilation fails immediately — not at runtime, not in production. Getting
contracts right here means:

- Phase 3 (Redis + OTP engine) implements exactly these types.
- Phase 4 (Hono API) validates requests against exactly these types.
- There is one canonical location to look up "what does a verify result look
  like?" instead of hunting across files.

---

## Deliverables

### 2.1 — `packages/core/src/constants.ts`

All env vars consumed by core logic (Redis, OTP rules, rate-limit windows)
live here. No other file in `packages/core` may reference `process.env`.

```ts
// ─── Redis ───────────────────────────────────────────────────────────────────
export const REDIS = {
  URL:        process.env.REDIS_URL        ?? 'redis://localhost:6379',
  KEY_PREFIX: process.env.REDIS_KEY_PREFIX ?? 'otp',
} as const;

// ─── OTP ─────────────────────────────────────────────────────────────────────
export const OTP = {
  TTL_SECONDS:  Number(process.env.OTP_TTL_SECONDS  ?? 300),  // 5 min
  MAX_ATTEMPTS: Number(process.env.OTP_MAX_ATTEMPTS ?? 5),
  DIGITS:       6,
} as const;

// ─── Rate Limit ───────────────────────────────────────────────────────────────
export const RATE_LIMIT = {
  PER_MINUTE: Number(process.env.RATE_LIMIT_MINUTE ?? 3),
  PER_HOUR:   Number(process.env.RATE_LIMIT_HOUR   ?? 10),
  PER_DAY:    Number(process.env.RATE_LIMIT_DAY    ?? 20),
} as const;
```

### 2.2 — `apps/api/src/constants.ts`

All env vars consumed by the HTTP server live here. Must not reach into
`packages/core`'s constants.

```ts
// ─── App ─────────────────────────────────────────────────────────────────────
export const APP = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  IS_PROD:  process.env.NODE_ENV === 'production',
} as const;

// ─── Server ──────────────────────────────────────────────────────────────────
export const SERVER = {
  PORT: Number(process.env.PORT ?? 3000),
  HOST: process.env.HOST ?? '0.0.0.0',
} as const;
```

### 2.3 — `packages/core/src/types.ts`

All shared domain types. This is the single source of truth for data shapes.

#### OTP Record (what lives in Redis)

```ts
export type OtpRecord = {
  readonly code:     string;   // 6-digit string e.g. "482031"
  readonly attempts: number;   // mutable attempt counter
};
```

#### Rate Limit Window

```ts
export type RateLimitWindow = 'minute' | 'hour' | 'day';
```

#### Service Results — use discriminated unions, never throw for domain errors

```ts
// Generate OTP
export type GenerateResult =
  | { ok: true;  otpTtlSeconds: number }
  | { ok: false; reason: 'RATE_LIMITED'; window: RateLimitWindow; retryAfterSeconds: number };

// Verify OTP
export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'INVALID_CODE' | 'MAX_ATTEMPTS_EXCEEDED' | 'OTP_NOT_FOUND' };
```

#### App Error (for HTTP layer — Phase 4)

```ts
export type AppErrorCode =
  | 'RATE_LIMITED'
  | 'INVALID_CODE'
  | 'MAX_ATTEMPTS_EXCEEDED'
  | 'OTP_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

export type AppError = {
  readonly code:    AppErrorCode;
  readonly message: string;
  readonly details?: unknown;
};
```

### 2.4 — `packages/core/src/redis-keys.ts`

Centralises the Redis key construction. No magic string interpolation anywhere
else in the codebase — every Redis key must come from here.

```ts
// Key patterns (from plan.md):
//   otp:{userId}:code          → 5 min TTL
//   otp:{userId}:attempts      → 5 min TTL (same as OTP TTL)
//   ratelimit:{userId}:minute  → 60 s TTL
//   ratelimit:{userId}:hour    → 3600 s TTL
//   ratelimit:{userId}:day     → 86400 s TTL

export const RedisKeys = {
  otpCode:     (userId: string): string => `otp:${userId}:code`,
  otpAttempts: (userId: string): string => `otp:${userId}:attempts`,
  rateLimit:   (userId: string, window: RateLimitWindow): string =>
                 `ratelimit:${userId}:${window}`,
} as const;
```

> Import `RateLimitWindow` from `@/types` within this file.

### 2.5 — Export barrel update

After creating the above files, update `packages/core/src/index.ts` to
re-export the public API:

```ts
export type {
  OtpRecord,
  RateLimitWindow,
  GenerateResult,
  VerifyResult,
  AppError,
  AppErrorCode,
} from '@/types';

export { RedisKeys } from '@/redis-keys';

// Constants are NOT re-exported — consumers of @otp-service/core
// should not reach into core's env config.
```

---

## Key Design Decisions & Why

### Discriminated unions over exceptions for domain errors

`GenerateResult` and `VerifyResult` use `{ ok: true } | { ok: false; reason: ... }`
rather than throwing. This forces callers to handle every outcome at compile time.
Exceptions are reserved for truly unexpected failures (Redis connection down,
programmer errors). This pattern makes the HTTP layer in Phase 4 trivial: it
just maps `result.reason` to an HTTP status — no try/catch needed for domain
paths.

### `AppError` lives in `core`, not `api`

The HTTP layer translates domain results into HTTP responses. For that
translation to be type-safe, the error vocabulary must live in the domain layer.
`apps/api` imports `AppError`; it doesn't define it.

### Redis keys are functions, not template strings

Spreading key construction across multiple files makes key collisions and
typos invisible. A centralised factory with typed parameters means `userId` is
always a `string`, the prefix is always consistent, and a rename requires
touching exactly one file.

### Constants are not re-exported from `core`'s barrel

If `apps/api` could import `OTP.TTL_SECONDS` from `@otp-service/core`, it
would create invisible coupling: a change to `packages/core/src/constants.ts`
could silently affect the API. Each package owns its own constants.

---

## Exit Criteria

- [x] `packages/core/src/constants.ts` exists with `REDIS`, `OTP`, `RATE_LIMIT` groups
- [x] `apps/api/src/constants.ts` exists with `APP`, `SERVER` groups
- [x] `packages/core/src/types.ts` exists with all types listed above
- [x] `packages/core/src/redis-keys.ts` exists with `RedisKeys` factory
- [x] `packages/core/src/index.ts` re-exports all public types and `RedisKeys`
- [x] `pnpm -r typecheck` still passes (no logic to break yet)
- [x] No file outside `constants.ts` files references `process.env`

---

## What This Phase Does NOT Do

- No Redis connection
- No OTP generation or verification logic
- No HTTP routes
- No Lua scripts
- No Docker
