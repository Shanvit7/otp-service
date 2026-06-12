# Phase 3 — Core Domain: Redis Client, OTP Engine & Rate Limiter

## Goal

Implement all domain logic inside `packages/core`. At the end of this phase
the OTP system is fully functional as a library — generate and verify OTPs
with correct rate-limiting and concurrency safety — even though it has no HTTP
surface yet.

---

## Rationale

Separating domain logic from transport (HTTP) is the most important
architectural decision in the system. By building and testing the core library
independently:

- The logic can be reasoned about without HTTP noise.
- Phase 4 (Hono API) becomes a thin mapping layer, not a logic layer.
- The same `core` package could power a gRPC service, a queue consumer, or a
  CLI with zero changes.

---

## Deliverables

### 3.1 — Add `ioredis` to `packages/core`

```json
// packages/core/package.json — add to "dependencies"
"ioredis": "^5.x"
```

### 3.2 — `packages/core/src/redis/client.ts` — Redis Singleton

A single, lazily-initialised Redis connection shared across the process.

**Spec:**

```
createRedisClient(): Redis
  - reads REDIS.URL and REDIS.KEY_PREFIX from @/constants
  - sets keyPrefix on the ioredis client so all keys are namespaced automatically
  - on 'error' event: logs via logger (child logger tagged { module: 'redis' })
  - on 'connect' event: logs info
  - returns the ioredis Redis instance

redis (named export): Redis
  - module-level singleton, created once on first import
```

**Why a singleton?**
ioredis connections are expensive. A new connection per request would exhaust
file descriptors under load. A singleton means one TCP connection multiplexed
across all concurrent requests.

**Why `keyPrefix`?**
Setting `keyPrefix` on the ioredis client rather than concatenating it in
`RedisKeys` means the prefix is applied to every command — including the Lua
scripts' `KEYS[]` array. This ensures nothing ever accidentally writes without
the namespace.

> **Note:** `keyPrefix` in ioredis prepends to every key argument. When using
> Lua scripts, keys passed via `KEYS` are *not* automatically prefixed — the
> prefix must be applied manually inside the Lua script or prepended in the
> JS call site. Spec the Lua scripts accordingly (see §3.4).

### 3.3 — `packages/core/src/otp/generate.ts` — OTP Number Generator

```
generateOtpCode(): string
  - returns a random 6-digit string, zero-padded
  - uses Math.floor(100_000 + Math.random() * 900_000).toString()
  - export as named const arrow function
```

This is a pure function — no Redis, no side effects. It can be unit-tested
in isolation without any infrastructure.

### 3.4 — `packages/core/src/redis/scripts.ts` — Lua Scripts

All concurrent Redis operations must use Lua scripts to guarantee atomicity.
Node.js is single-threaded but multiple API replicas run behind NGINX — without
Lua, a check-then-set pattern (read counter → increment → compare) is a race.

#### Script 1: `generateOtpScript`

**Purpose:** Enforce rate limits then atomically write a new OTP.

**Inputs:**
```
KEYS[1]  = rateLimit:minute key  (with prefix)
KEYS[2]  = rateLimit:hour key
KEYS[3]  = rateLimit:day key
KEYS[4]  = otp:code key
KEYS[5]  = otp:attempts key
ARGV[1]  = new OTP code (string)
ARGV[2]  = rate limit per minute (number)
ARGV[3]  = rate limit per hour
ARGV[4]  = rate limit per day
ARGV[5]  = OTP TTL in seconds
```

**Logic (pseudocode):**
```lua
local minute_count = tonumber(redis.call('GET', KEYS[1])) or 0
local hour_count   = tonumber(redis.call('GET', KEYS[2])) or 0
local day_count    = tonumber(redis.call('GET', KEYS[3])) or 0

if minute_count >= tonumber(ARGV[2]) then
  local ttl = redis.call('TTL', KEYS[1])
  return { 'RATE_LIMITED', 'minute', tostring(ttl) }
end
if hour_count >= tonumber(ARGV[3]) then
  local ttl = redis.call('TTL', KEYS[2])
  return { 'RATE_LIMITED', 'hour', tostring(ttl) }
end
if day_count >= tonumber(ARGV[4]) then
  local ttl = redis.call('TTL', KEYS[3])
  return { 'RATE_LIMITED', 'day', tostring(ttl) }
end

-- Increment counters; set TTL only on first increment (NX flag)
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], 60, 'NX')
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], 3600, 'NX')
redis.call('INCR', KEYS[3])
redis.call('EXPIRE', KEYS[3], 86400, 'NX')

-- Overwrite any existing OTP (resend invalidates previous)
redis.call('SET', KEYS[4], ARGV[1], 'EX', tonumber(ARGV[5]))
redis.call('SET', KEYS[5], '0',     'EX', tonumber(ARGV[5]))

return { 'OK' }
```

**Return shape (as JS array):**
- `['RATE_LIMITED', 'minute' | 'hour' | 'day', '<seconds>']`
- `['OK']`

**Why `EXPIRE ... NX`?**
Setting TTL with `NX` (only if no TTL exists) preserves the original window
boundary. Without `NX`, every new generation within the window would reset the
counter's expiry, letting a user generate indefinitely as long as they keep
generating at least once per window.

#### Script 2: `verifyOtpScript`

**Purpose:** Atomically check the code and increment attempt counter.

**Inputs:**
```
KEYS[1]  = otp:code key
KEYS[2]  = otp:attempts key
ARGV[1]  = candidate code (string)
ARGV[2]  = max attempts (number)
```

**Logic (pseudocode):**
```lua
local stored = redis.call('GET', KEYS[1])
if not stored then
  return 'OTP_NOT_FOUND'
end

local attempts = tonumber(redis.call('GET', KEYS[2])) or 0
if attempts >= tonumber(ARGV[2]) then
  return 'MAX_ATTEMPTS_EXCEEDED'
end

redis.call('INCR', KEYS[2])

if stored ~= ARGV[1] then
  return 'INVALID_CODE'
end

-- Correct — delete both keys (single-use)
redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
return 'OK'
```

**Return shape:** single string — `'OK' | 'OTP_NOT_FOUND' | 'MAX_ATTEMPTS_EXCEEDED' | 'INVALID_CODE'`

**Why check attempts before comparing code?**
If we compared first, a brute-force attacker could keep guessing until
`MAX_ATTEMPTS_EXCEEDED` — but the last attempt that reached the limit
would have already revealed whether the code was correct. Checking attempts
first means the limit fires before the comparison.

**Why `DEL` both keys on success?**
The OTP is single-use. Deleting both keys immediately means a replay attack on
a just-verified code returns `OTP_NOT_FOUND`, not `OK`.

### 3.5 — `packages/core/src/services/generateOtp.ts`

Orchestrates the generate flow: calls `generateOtpCode()`, builds Redis keys,
runs `generateOtpScript`, maps the result to `GenerateResult`.

```
generateOtp(userId: string): Promise<GenerateResult>
```

**Flow:**
1. Call `generateOtpCode()` to get a fresh code.
2. Build the 5 Redis keys using `RedisKeys` + constants.
3. Run `generateOtpScript` with all KEYS and ARGV.
4. Parse the Lua return value:
   - `['OK']` → `{ ok: true, otpTtlSeconds: OTP.TTL_SECONDS }`
   - `['RATE_LIMITED', window, retryAfter]` → `{ ok: false, reason: 'RATE_LIMITED', window, retryAfterSeconds: Number(retryAfter) }`
5. Return the `GenerateResult`.

**No try/catch around Redis calls here.** Infrastructure errors (connection
lost) bubble up as unhandled rejections and are caught by the HTTP layer's
global error handler in Phase 4.

### 3.6 — `packages/core/src/services/verifyOtp.ts`

```
verifyOtp(userId: string, candidateCode: string): Promise<VerifyResult>
```

**Flow:**
1. Build the 2 Redis keys using `RedisKeys`.
2. Run `verifyOtpScript` with KEYS and ARGV.
3. Map the string return to `VerifyResult`:
   - `'OK'` → `{ ok: true }`
   - `'OTP_NOT_FOUND'` → `{ ok: false, reason: 'OTP_NOT_FOUND' }`
   - `'MAX_ATTEMPTS_EXCEEDED'` → `{ ok: false, reason: 'MAX_ATTEMPTS_EXCEEDED' }`
   - `'INVALID_CODE'` → `{ ok: false, reason: 'INVALID_CODE' }`

### 3.7 — Barrel export update

`packages/core/src/index.ts` must expose the two service functions and nothing
from the internal Redis or scripts modules:

```ts
export type { GenerateResult, VerifyResult, AppError, AppErrorCode, RateLimitWindow } from '@/types';
export { RedisKeys } from '@/redis-keys';
export { generateOtp } from '@/services/generateOtp';
export { verifyOtp }   from '@/services/verifyOtp';
// redis client is intentionally NOT exported — internal only
```

---

## File Map

```
packages/core/src/
├── constants.ts                  (Phase 2 — already done)
├── types.ts                      (Phase 2 — already done)
├── redis-keys.ts                 (Phase 2 — already done)
├── index.ts                      (updated this phase)
├── otp/
│   └── generate.ts               ← 3.3
├── redis/
│   ├── client.ts                 ← 3.2
│   └── scripts.ts                ← 3.4
└── services/
    ├── generateOtp.ts            ← 3.5
    └── verifyOtp.ts              ← 3.6
```

---

## Exit Criteria

- [x] `ioredis` added to `packages/core` dependencies, `pnpm install` clean
- [x] `redis/client.ts` exports a singleton `redis` of type `Redis`
- [x] `otp/generate.ts` exports `generateOtpCode(): string`
- [x] `redis/scripts.ts` defines and exports `generateOtpScript` and `verifyOtpScript` as ioredis `defineCommand`-compatible Lua strings
- [x] `services/generateOtp.ts` exports `generateOtp(userId: string): Promise<GenerateResult>`
- [x] `services/verifyOtp.ts` exports `verifyOtp(userId: string, candidateCode: string): Promise<VerifyResult>`
- [x] `index.ts` barrel exports match the spec above
- [x] `pnpm -r typecheck` passes
- [x] `pnpm -r build` succeeds and `packages/core/dist/index.js` contains compiled output

---

## What This Phase Does NOT Do

- No HTTP server
- No request validation
- No Docker / NGINX
- No integration tests (those come after the HTTP layer exists)
