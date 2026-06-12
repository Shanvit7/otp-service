# ─── Stage 1: builder ─────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Copy workspace manifests first — maximises layer cache hits
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/logger/package.json ./packages/logger/
COPY packages/core/package.json   ./packages/core/
COPY apps/api/package.json        ./apps/api/

# Install all deps (devDependencies required for build)
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json tsup.base.ts ./
COPY packages/logger/  ./packages/logger/
COPY packages/core/    ./packages/core/
COPY apps/api/         ./apps/api/

# Build all packages in dependency order
RUN pnpm -r build

# ─── Stage 2: runner ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Only manifests — production dep install only
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/logger/package.json ./packages/logger/
COPY packages/core/package.json   ./packages/core/
COPY apps/api/package.json        ./apps/api/

# Production deps only — no devDependencies, no lifecycle scripts (husky etc.)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Copy compiled artefacts from builder
COPY --from=builder /app/packages/logger/dist ./packages/logger/dist
COPY --from=builder /app/packages/core/dist   ./packages/core/dist
COPY --from=builder /app/apps/api/dist        ./apps/api/dist

# Non-root user for security
RUN addgroup -S otp && adduser -S otp -G otp
USER otp

EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
