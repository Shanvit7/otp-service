# Phase Roadmap — OTP Rate-Limiting & Verification Service

Spec-driven development: every phase is fully specified before any code is written.
Implementation follows the phase order strictly — no phase starts until the previous
phase's exit criteria are fully met.

---

## Phase Overview

| # | Phase | What it produces | Key concern |
|---|---|---|---|
| [1](./phase-1.md) | **Monorepo Foundation** | `apps/api` scaffold, path alias audit, empty barrels | Deterministic toolchain |
| [2](./phase-2.md) | **Domain Contracts** | Types, constants, Redis key schema | Vocabulary before implementation |
| [3](./phase-3.md) | **Core Domain** | Redis client, OTP engine, Lua scripts, service functions | Business logic, concurrency safety |
| [4](./phase-4.md) | **HTTP API** | Hono server, routes, Zod validation, error handling | Transport layer |
| [5](./phase-5.md) | **Containerisation** | Dockerfile, NGINX config, docker-compose | Deployment topology |
| [6](./phase-6.md) | **Hardening** | Structured logging, startup validation, graceful shutdown, integration tests | Production readiness |

---

## Dependency Graph

```
Phase 1 (scaffold)
    └── Phase 2 (contracts)
            └── Phase 3 (core domain)
                    ├── Phase 4 (HTTP API)
                    │       └── Phase 5 (Docker/NGINX)
                    │               └── Phase 6 (hardening + tests)
                    └── Phase 6 (tests also test core directly)
```

Phases 1–3 are pure infrastructure and domain — no HTTP, no containers.
Phases 4–6 layer on top and can be revisited without touching core logic.

---

## Requirements Traceability

Every requirement from `objectives.md` maps to a specific phase:

| Requirement | Phase |
|---|---|
| 6-digit OTP | 3 (generateOtpCode) |
| 5-minute TTL | 3 (Lua script — `EX` argument) |
| Single-use OTP | 3 (Lua DEL on success) |
| Rate limit: 3/min, 10/hr, 20/day | 3 (generateOtpScript) |
| Max 5 verification attempts | 3 (verifyOtpScript) |
| Resend invalidates previous | 3 (SET overwrites existing code) |
| Concurrency correctness | 3 (all state changes in Lua) |
| HTTP endpoints | 4 |
| Multiple API replicas | 5 (docker-compose 3× api) |
| NGINX load balancing | 5 |
| Structured logging | 2 (logger package) + 6 (middleware) |
| Integration tests | 6 |
