# Agent Rules — otp-service

These rules apply to **all code** written in this repository by humans and AI agents alike.
Treat every rule as non-negotiable unless explicitly overridden in a file-level comment.

---

## 1. ES6+ Syntax Only

- Always use `const` / `let`. Never use `var`.
- Use template literals over string concatenation.
- Use destructuring for objects and arrays wherever it reduces noise.
- Use optional chaining (`?.`) and nullish coalescing (`??`) instead of verbose null checks.
- Use `import` / `export`. Never use `require()` or `module.exports`.
- Use spread (`...`) over `Object.assign` or `Array.prototype` mutations.

---

## 2. No `function` Keyword — Arrow Functions Only

Every callable must be written as an arrow function.
This includes top-level helpers, callbacks, formatters, and class methods where applicable.

**✅ Correct**
```ts
export const generateOtp = (): string => {
  return Math.floor(100_000 + Math.random() * 900_000).toString();
};

const users = list.filter((u) => u.active);

const formatters = {
  level: (label: string) => ({ level: label }),
};
```

**❌ Never**
```ts
export function generateOtp() { ... }

list.filter(function (u) { return u.active; });

const formatters = {
  level(label) { return { level: label }; },   // method shorthand — also banned
};
```

> **Method shorthand** (`{ foo() {} }`) is also banned — use `{ foo: () => {} }`.

---

## 3. Environment Variables — Dedicated Constants Files, Never Inline

`process.env` must **never** be referenced directly in business logic, services, middleware,
or utility files. All env access is centralised in a per-package `constants.ts` file.

### 3.1 File location

Every package / app that needs env vars owns exactly one file:

```
packages/logger/src/constants.ts
packages/core/src/constants.ts
apps/api/src/constants.ts
```

### 3.2 Organisation — group by concern level

Inside `constants.ts`, group variables into clearly labelled sections that match the
concern they configure. Each group is a `const` object.

```ts
// ─── App ────────────────────────────────────────────────────────────────────
export const APP = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  IS_PROD:  process.env.NODE_ENV === 'production',
} as const;

// ─── Server ─────────────────────────────────────────────────────────────────
export const SERVER = {
  PORT: Number(process.env.PORT ?? 3000),
  HOST: process.env.HOST ?? '0.0.0.0',
} as const;

// ─── Redis ───────────────────────────────────────────────────────────────────
export const REDIS = {
  URL:           process.env.REDIS_URL ?? 'redis://localhost:6379',
  KEY_PREFIX:    process.env.REDIS_KEY_PREFIX ?? 'otp',
} as const;

// ─── OTP ─────────────────────────────────────────────────────────────────────
export const OTP = {
  TTL_SECONDS:   Number(process.env.OTP_TTL_SECONDS   ?? 300),
  MAX_ATTEMPTS:  Number(process.env.OTP_MAX_ATTEMPTS  ?? 5),
} as const;

// ─── Rate Limit ───────────────────────────────────────────────────────────────
export const RATE_LIMIT = {
  PER_MINUTE: Number(process.env.RATE_LIMIT_MINUTE ?? 3),
  PER_HOUR:   Number(process.env.RATE_LIMIT_HOUR   ?? 10),
  PER_DAY:    Number(process.env.RATE_LIMIT_DAY    ?? 20),
} as const;
```

### 3.3 Consuming constants

Import from the local `constants.ts`, never reach into another package's constants.

```ts
// ✅
import { APP, REDIS } from './constants.js';

// ❌ — never do this anywhere outside constants.ts
const url = process.env.REDIS_URL;
```

### 3.4 Naming

- Group key: `SCREAMING_SNAKE_CASE` noun matching the concern (`REDIS`, `SERVER`, `OTP`).
- Property key: `SCREAMING_SNAKE_CASE` matching the env var suffix (`REDIS_URL` → `URL`).
- Add a unit suffix where it prevents ambiguity (`TTL_SECONDS`, `MAX_BYTES`).

---

## 4. Import Aliases — `@/` for Internal Imports

All intra-package imports use the `@/` alias. Relative paths (`./`, `../`) are **banned** for
imports within the same package's `src/`.

**✅ Correct**
```ts
import { APP, LOG } from '@/constants';
import { generateOtp } from '@/otp/generate';
```

**❌ Never**
```ts
import { APP } from './constants.js';
import { generateOtp } from '../otp/generate.js';
```

> Cross-package imports (workspace packages) still use the package name:
> `import { logger } from '@otp-service/logger'` — that's correct and expected.

### How it works

- Each package's `tsconfig.json` maps `@/*` → `./src/*`.
- `tsup` reads the tsconfig paths and resolves them at build time via esbuild.
- `tsc --noEmit` (typecheck) also uses the same paths for type resolution.
- No `.js` extensions needed on `@/` imports — `moduleResolution: "Bundler"` handles it.

### Every new package must add to its `tsconfig.json`
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

---

## 5. General Conventions


- All files use **tabs** for indentation (enforced by Biome).
- Max line width **100** characters (enforced by Biome).
- Single quotes for strings in TypeScript/JavaScript (enforced by Biome).
- Trailing commas on all multi-line structures (enforced by Biome).
- Organise imports: external → internal → relative (enforced by Biome assist).
- Prefer `type` imports (`import type { Foo }`) when importing only types.
- All exported functions / constants must have an explicit return type annotation.

---

## 6. Enforcement

| Tool        | What it guards                              |
|-------------|---------------------------------------------|
| Biome       | Formatting, import order, lint rules        |
| Husky       | Runs lint-staged on every commit            |
| lint-staged | Biome check --write on staged files only    |
| TypeScript  | Type correctness, strict mode               |
