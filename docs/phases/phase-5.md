# Phase 5 — Containerisation: Docker, NGINX & Compose Orchestration

## Goal

Package the API into a production-ready Docker image and orchestrate a
multi-replica deployment behind an NGINX reverse proxy with a shared Redis
instance — all runnable locally with a single `docker compose up`.

---

## Rationale

The system is designed to scale horizontally: multiple API replicas share the
same Redis state, and NGINX distributes load across them. Phase 5 proves this
design works end-to-end. It also closes the gap between "code that works on my
machine" and "code that works in a container" — catching issues like missing
`node_modules`, wrong env var assumptions, or non-zero exit codes before they
reach a real environment.

---

## Deliverables

### 5.1 — `apps/api/Dockerfile`

A multi-stage Dockerfile. Two stages:

#### Stage 1: `builder`

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests first (layer caching)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/logger/package.json  ./packages/logger/
COPY packages/core/package.json    ./packages/core/
COPY apps/api/package.json         ./apps/api/

# Install all deps (including devDependencies needed for build)
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json tsup.base.ts ./
COPY packages/logger/  ./packages/logger/
COPY packages/core/    ./packages/core/
COPY apps/api/         ./apps/api/

# Build all packages in dependency order
RUN pnpm -r build
```

#### Stage 2: `runner`

```dockerfile
FROM node:22-alpine AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Only copy manifests for production dep install
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/logger/package.json  ./packages/logger/
COPY packages/core/package.json    ./packages/core/
COPY apps/api/package.json         ./apps/api/

# Production deps only — no devDependencies
RUN pnpm install --frozen-lockfile --prod

# Copy compiled artefacts from builder
COPY --from=builder /app/packages/logger/dist ./packages/logger/dist
COPY --from=builder /app/packages/core/dist   ./packages/core/dist
COPY --from=builder /app/apps/api/dist        ./apps/api/dist

# Non-root user for security
RUN addgroup -S otp && adduser -S otp -G otp
USER otp

EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
```

**Why multi-stage?**
The builder stage includes TypeScript, tsup, and all devDependencies — the
compiled image would be ~400 MB. The runner stage starts fresh, installs only
production deps, and copies only compiled `dist/` — resulting in a ~120 MB
image.

**Why `--frozen-lockfile`?**
Ensures the container always uses the exact same dependency versions as the
developer's machine. No silent version drift between local and containerised.

**Why non-root user?**
Containers running as `root` are a security risk. If the process is compromised,
the attacker has full container root. Running as `otp` limits the blast radius.

### 5.2 — `nginx/nginx.conf`

```nginx
worker_processes auto;

events {
    worker_connections 1024;
}

http {
    # ── Upstream pool ───────────────────────────────────────────────────────
    upstream otp_api {
        server api_1:3000;
        server api_2:3000;
        server api_3:3000;
        keepalive 32;             # reuse TCP connections to upstream
    }

    # ── Edge rate limiting ──────────────────────────────────────────────────
    # First line of defence — coarse IP-level throttle before app-level limits.
    # 10 req/s per IP with a burst of 20.
    limit_req_zone $binary_remote_addr zone=otp_zone:10m rate=10r/s;

    server {
        listen 80;

        location / {
            limit_req zone=otp_zone burst=20 nodelay;

            proxy_pass         http://otp_api;
            proxy_http_version 1.1;
            proxy_set_header   Connection        "";   # enable keepalive
            proxy_set_header   Host              $host;
            proxy_set_header   X-Real-IP         $remote_addr;
            proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;

            # Health check: mark upstream down after 3 failures in 30s
            proxy_next_upstream     error timeout;
            proxy_connect_timeout   2s;
            proxy_read_timeout      10s;
        }

        location /health {
            # Health endpoint bypasses rate limiter
            proxy_pass http://otp_api;
        }
    }
}
```

**Why two rate limiters (NGINX + app-level)?**
They guard different things:
- NGINX's `limit_req` is IP-based and protects the infrastructure. It stops
  volumetric floods before they hit Node.js.
- The app-level limiter (`generateOtpScript`) is user-based and enforces
  business rules (3/min, 10/hour, 20/day per `userId`). IP-based limiting
  alone would fail for shared IPs (NAT, office networks).

**Why `keepalive 32` on the upstream?**
Without keepalive, NGINX opens a new TCP connection for every proxied request.
With 3 replicas under load, this creates thousands of short-lived connections,
increasing latency and exhausting ports. `keepalive 32` maintains a pool of 32
idle connections per worker to each upstream.

**Why `proxy_next_upstream error timeout`?**
If one API replica crashes mid-request, NGINX retries it on another replica
transparently. Without this, the client sees a `502`.

### 5.3 — `docker-compose.yml` (root level)

```yaml
version: '3.9'

services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - '6379:6379'          # exposed for local debugging only
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 3s
      retries: 5

  api_1: &api_base
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    restart: unless-stopped
    environment:
      NODE_ENV:     production
      PORT:         3000
      REDIS_URL:    redis://redis:6379
      REDIS_KEY_PREFIX: otp
    depends_on:
      redis:
        condition: service_healthy

  api_2:
    <<: *api_base

  api_3:
    <<: *api_base

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - '80:80'
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - api_1
      - api_2
      - api_3
```

**Why YAML anchors (`&api_base` / `<<: *api_base`)?**
All three API replicas are identical. Anchors DRY up the config — one place to
change env vars, image build args, or health check settings.

**Why `service_healthy` for Redis dependency?**
`depends_on: redis` without a condition only waits for the container to start,
not for Redis to be ready to accept connections. Without `service_healthy`, the
API replicas could start before Redis is accepting commands and crash on the
first Redis call.

**Why expose Redis port 6379 locally?**
Development convenience — allows `redis-cli` from the host for debugging.
In a real deployment this port would not be published.

### 5.4 — `.dockerignore` (root level)

```
node_modules
**/node_modules
**/dist
.git
**/.env
docs
*.md
```

Prevents large `node_modules` and git history from being sent to the Docker
build context, which would slow builds significantly.

---

## File Map

```
otp-service/
├── apps/api/
│   └── Dockerfile                ← 5.1
├── nginx/
│   └── nginx.conf                ← 5.2
├── docker-compose.yml            ← 5.3
└── .dockerignore                 ← 5.4
```

---

## Exit Criteria

- [ ] `docker build -f apps/api/Dockerfile .` completes successfully from repo root
- [ ] `docker compose up` starts all 5 containers (redis, api_1/2/3, nginx)
- [ ] `curl http://localhost/health` returns `{ "ok": true }`
- [ ] `curl -X POST http://localhost/otp/generate -H 'Content-Type: application/json' -d '{"userId":"test1"}'` returns `200`
- [ ] `curl -X POST http://localhost/otp/verify ...` with the correct code returns `200`
- [ ] Sending 4 consecutive generate requests returns `429` on the 4th (rate limit hit)
- [ ] Stopping one API container (`docker stop`) and re-running curl still succeeds (NGINX failover)
- [ ] Docker image size is under 200 MB (`docker image ls`)

---

## What This Phase Does NOT Do

- No TLS / HTTPS (would require cert provisioning — out of scope)
- No Redis persistence (AOF/RDB) — acceptable for this assignment
- No Redis Cluster or Sentinel — single node per spec
- No Kubernetes manifests
- No CI/CD pipeline
