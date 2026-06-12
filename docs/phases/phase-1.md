# Phase 1 — Monorepo Foundation & Toolchain Hardening

## Goal

Lock every piece of scaffolding so that every subsequent phase builds on a
deterministic, zero-surprise foundation. No business logic ships here — only
the structural skeleton that all future code will inhabit.

---

## What Already Exists

The repo already has a partially-assembled scaffold:

| Artefact | Status |
|---|---|
| `pnpm-workspace.yaml` | ✅ present |
| `tsconfig.base.json` | ✅ present |
| `biome.json` | ✅ present |
| `.husky/pre-commit` + `lint-staged` | ✅ wired |
| `packages/logger` — pino logger + constants | ✅ built & published |
| `packages/core` — re-exports logger only | ⚠️ skeleton, not real |
| `apps/api` directory | ❌ missing |
| `tsconfig.json` path aliases (`@/*`) per package | ⚠️ needs audit |
| `tsup.base.ts` shared build config | ✅ present |

Phase 1 closes every gap in the scaffold **before a single line of domain
logic is written**.

---

## Deliverables

### 1.1 — `apps/api` Package Scaffold

Create the package at `apps/api/` with the following structure:

```
apps/api/
├── src/
│   └── index.ts        # entry point — empty stub: export {}
├── package.json
├── tsconfig.json       # extends ../../tsconfig.base.json, adds @/* paths
└── tsup.config.ts      # extends ../../tsup.base.ts
```

`package.json` must declare:
- `name: "@otp-service/api"`
- `"type": "module"`
- dependency on `@otp-service/core` (`workspace:*`)
- dependency on `@otp-service/logger` (`workspace:*`)
- scripts: `build`, `dev`, `typecheck`, `clean`

### 1.2 — Path Alias Audit

Every package (`packages/core`, `packages/logger`, `apps/api`) must have in
its `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

Verify `packages/core/tsconfig.json` and `packages/logger/tsconfig.json` both
carry this block. Correct any that are missing.

### 1.3 — `packages/core` Reset

`packages/core/src/index.ts` currently re-exports logger — that is wrong.
`core` is the domain library. Logger is a peer dependency it *uses*, not
re-exports. Reset `index.ts` to `export {};` (empty barrel). Exports will be
added phase-by-phase.

### 1.4 — Workspace Dependency Graph Validation

Run `pnpm install` from root after all scaffold changes and confirm:
- No hoisting issues
- All `workspace:*` references resolve
- `pnpm -r typecheck` passes (even with empty stubs)
- `pnpm -r build` produces dist artefacts for all packages

### 1.5 — Biome Config Coverage

Confirm `biome.json` `include` / `ignore` covers `apps/api/src/**` in
addition to `packages/**/src/**`. If not, extend it.

---

## Why This Phase Exists

### Spec-first safety net
Writing all subsequent phase specs assumes a stable package graph. If `apps/api`
doesn't exist when Phase 4 is written, every file path and import in that spec
would be speculative. Closing the scaffold now makes Phase 4–6 specs precise.

### `@/*` aliases are load-bearing
`AGENTS.md` rule §4 bans relative imports inside a package's `src/`. If any
package is missing the `paths` block, `tsc --noEmit` will silently resolve
`@/foo` to nothing or to an unexpected location. Auditing this once, here, means
every future file can be written with confidence.

### `packages/core` is the domain boundary
Re-exporting `logger` from `core` would create a confusing API: consumers
of domain logic shouldn't be forced to receive a logger export they didn't ask
for. Keeping `core` clean now avoids an entangled public API that would require
a breaking change later.

### Build pipeline must be green before logic arrives
If `tsup` or `tsc` is broken at the scaffold level, errors surfaced in Phase 3
could be misattributed to domain logic bugs. Proving the pipeline green with
empty stubs gives us a true baseline.

---

## Exit Criteria

- [ ] `apps/api/` directory exists with `package.json`, `tsconfig.json`, `tsup.config.ts`, `src/index.ts`
- [ ] All three packages have `@/*` → `./src/*` path alias in `tsconfig.json`
- [ ] `packages/core/src/index.ts` is an empty barrel (`export {}`)
- [ ] `pnpm install` completes with no errors
- [ ] `pnpm -r typecheck` passes across all packages
- [ ] `pnpm -r build` produces `dist/` in all packages
- [ ] `pnpm lint` reports no errors

---

## What This Phase Does NOT Do

- No Redis client
- No OTP logic
- No HTTP routes
- No Docker / NGINX
- No environment variable definitions (those belong to Phase 2)
