# 05 — Application container

> **Phase**: bring-up · **Run on**: App VM (`auishqosrgbwbs01`) · **Time**: ~30 min
>
> The hardened multi-stage Dockerfile (Node 22 alpine, non-root, dumb-init, openssl, pruned production deps), `.dockerignore`, the runtime env file at `/etc/greenbook.env`, the production `docker-compose.yml`, and the `/healthz` resource route greenbook needs but doesn't ship by default.
>
> **Prev**: [04 — App VM Docker setup](04-app-vm-docker.md) · **Next**: [06 — Nginx and TLS](06-app-vm-nginx-tls.md) · **Index**: [README](README.md)

---

## 6. The application container

This file covers the **repo-side artefacts** that have to be in greenbook's source tree before any deploy can succeed: the Dockerfile, the `.dockerignore`, and the `/healthz` route. After this file you should be able to build a working image; what runs on the app VM (the env file, the compose file, the deploy cycle) is in [07-deploy-workflow.md](07-deploy-workflow.md).

Greenbook runs as a container built from a multi-stage Dockerfile. The build stage compiles the TypeScript and produces the React Router `build/` output; the runtime stage contains only Node, production dependencies, the build output, and the root-level `server.js` Express bootstrap — nothing else.

**Important**: greenbook ships its own Express server (`server.js` → `server/app.ts`) that layers correlation IDs, pino logging, CORS, session extraction, three rate-limit tiers, the in-process job-queue tick, and Sentry init. It does **not** use `react-router-serve`. The Dockerfile `CMD` therefore invokes `npm run start`, which runs `node server.js`. Treat the `server/` directory and `server.js` as ship-critical — both must land in the runtime image.

### 6.1 The Dockerfile

Replace the existing `Dockerfile` at the repo root with the hardened multi-stage version below. The current in-repo Dockerfile is functional for local docker compose use but doesn't set a non-root user, doesn't drop capabilities, doesn't install a PID-1 init, and omits the `server/` directory from the runtime image. The version below lands on the same multi-stage shape but fixes all four gaps.

```
# syntax=docker/dockerfile:1.7
# The "syntax" comment selects the Dockerfile frontend used by BuildKit.
# "1.7" gives us cache mounts, build secrets, and newer COPY semantics.
# It MUST be the first line (above any ARG / FROM).

ARG NODE_VERSION=22
# Pinned to the Node major used by greenbook (CLAUDE.md recommends 22 so the
# tooling can leverage native TypeScript type-stripping). The runtime image
# ships compiled JS — the version primarily matters for lib/v8/glibc parity
# with dev. Change here in ONE place to bump; every FROM line references it.
#
# alpine is chosen to match greenbook's current Dockerfile and keep the runtime
# image tiny. Every greenbook runtime dependency (bcryptjs, pg, pino, express,
# @prisma/adapter-pg, @sentry/node, samlify, openid-client, etc.) is either
# pure JS or publishes musl-compatible prebuilds, so alpine is safe. If you
# ever add a native dep without an alpine prebuild (e.g. node-canvas),
# switch the base to node:${NODE_VERSION}-bookworm-slim.

# ---------------------------------------------------------------------------
# Stage 1: install ALL dependencies (for the build)
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app

# Prisma's generated client needs openssl available during `prisma generate`
# (which runs on npm ci via greenbook's postinstall hook).
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
# Copy the manifest, lockfile, and the Prisma schema+config BEFORE running
# `npm ci`. greenbook's package.json has:  "postinstall": "prisma generate"
# which needs the schema file physically present. prisma.config.ts resolves
# the datasource URL at generate time; pass a dummy URL below because
# `prisma generate` reads the env var at load even though it doesn't connect.

ARG DUMMY_DATABASE_URL=postgres://dummy:dummy@localhost:5432/dummy?schema=public
ENV DATABASE_URL=${DUMMY_DATABASE_URL}

RUN npm ci --include=dev
#   npm ci              clean install: installs exact versions from
#                        package-lock.json. Fails if the lockfile does not
#                        agree with package.json. USE THIS in CI and
#                        production — never "npm install", which may update
#                        the lockfile unexpectedly.
#   --include=dev       include devDependencies. We need build-time tools
#                        (typescript, vite, @react-router/dev, @tailwindcss/vite,
#                        etc.) for `npm run build`.
# Side effect via postinstall: `prisma generate` produces
#   /app/app/generated/prisma/*   — the greenbook-specific client output path
# declared in prisma/schema.prisma. This directory is later copied into the
# runtime stage as part of app/generated/.

# ---------------------------------------------------------------------------
# Stage 2: build the app
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/app/generated ./app/generated
# Pre-generated Prisma client (from the deps stage). Saves re-running
# `prisma generate` in this stage.

COPY . .
# Now copy the entire source tree. Anything in .dockerignore is excluded
# (see §6.2). This is the last layer that changes when source code changes.

RUN npm run build
# react-router-build emits:
#   - /app/build/server/index.js   — SSR entry (loaders/actions/components)
#   - /app/build/client/**         — hashed client assets
# server.js imports the server bundle at runtime via
# `import("./build/server/index.js").then(m => m.app)`.

RUN npm prune --omit=dev
#   npm prune           remove packages not required by the current tree.
#   --omit=dev          also remove devDependencies.
# Shrinks node_modules by removing vite, vitest, typescript, @faker-js/faker,
# @playwright/test, and other build/test-only packages.

# ---------------------------------------------------------------------------
# Stage 3: lean runtime image
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app

# openssl — needed by @prisma/adapter-pg on some connection paths at runtime.
# dumb-init — a tiny PID-1 supervisor that forwards signals AND reaps zombies
#             so SIGTERM actually reaches node. Without this `docker stop`
#             hangs until the default 10-second grace expires because PID 1
#             (node, by default) ignores signals it doesn't have handlers for.
RUN apk add --no-cache openssl dumb-init

ENV NODE_ENV=production
ENV PORT=3000
# NODE_ENV=production makes Express hide stack traces, flips the pino
# transport from pino-pretty (dev) to line-delimited JSON (prod — see
# server/logger.js), and gates a few React Router production defaults.
# PORT matches greenbook's server.js default and the compose publish line.

USER node
# Switch to the "node" user (uid 1000) pre-created in the official image.
# Any RUN/COPY from here runs as node, not root, and the container process
# inherits this uid. A compromise of the Node process cannot escalate to
# root via file writes.

COPY --from=build --chown=node:node /app/package.json      ./package.json
COPY --from=build --chown=node:node /app/package-lock.json ./package-lock.json
COPY --from=build --chown=node:node /app/node_modules      ./node_modules
COPY --from=build --chown=node:node /app/build             ./build
COPY --from=build --chown=node:node /app/server.js         ./server.js
COPY --from=build --chown=node:node /app/server            ./server
COPY --from=build --chown=node:node /app/app/generated     ./app/generated
# Five things must land in the runtime image, in order of importance:
#   1. server.js         — root-level Express bootstrap (npm run start target)
#   2. server/           — correlation, logger, rate-limit, security, sentry,
#                           shutdown, request-logger — all imported by server.js
#                           and server/app.ts
#   3. build/            — compiled SSR bundle + hashed client assets
#   4. node_modules/     — production deps (pruned via npm prune --omit=dev)
#   5. app/generated/    — Prisma 7 client (output path declared in schema)
# package.json is needed so `npm run start` resolves. package-lock.json is
# not strictly required at runtime but keeps `npm rebuild` usable for diag.

STOPSIGNAL SIGTERM
# Signal Docker sends on `docker stop`. greenbook's server/app.ts installs
# SIGTERM + SIGINT handlers that:
#   1. flush the rate-limit audit buffer (server/rate-limit-audit.ts)
#   2. stop the job processor (app/utils/events/job-queue.server.ts)
#   3. flush pending Sentry events when SENTRY_DSN is set
# The 10-second default Docker grace can be tight when the job queue has
# long-running handlers; the compose file in 07 §8.2.3 extends it to 30s via stop_grace_period.

EXPOSE 3000
# Documentation — does NOT publish the port. See compose "ports:" in 07 §8.2.3.

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["npm", "run", "start"]
#   ENTRYPOINT is the fixed PID 1. dumb-init -- execs its args as PID 2 under
#   the dumb-init supervisor: SIGTERM from Docker reaches node, zombies are
#   reaped, Ctrl+C works in `docker run -it`.
#
#   CMD resolves to:  node server.js  (greenbook's "start" script).
#   server.js under NODE_ENV=production imports ./build/server/index.js and
#   listens on process.env.PORT || 3000.
```

### 6.2 The .dockerignore

Without a .dockerignore, the build context (everything sent to the Docker daemon) includes node_modules, .git, .env files, and previous build output — slow, wasteful, and a secret-leak risk.

```
# .dockerignore — lives at the root of the project, next to Dockerfile.

node_modules
# Huge. We re-install inside the image anyway.

build
# Stale local build output. We rebuild inside the image.

.git
.gitignore
# Don't leak commit history into the image.

.env
.env.*
# Local dev secrets. Must not reach the image. Production secrets live
# on the host in /etc/greenbook.env and enter via env_file in compose (07 §8.2.3).

.dockerignore
Dockerfile
docker-compose.yml
# The Dockerfile / compose file are used by the build but don't need to
# be IN the image. Keep prisma.config.ts — the Dockerfile COPYs it explicitly.

# ─── Greenbook-specific excludes ────────────────────────
tests
playwright.config.ts
vitest.config.ts
vitest.integration.config.ts
tsconfig.vite.tsbuildinfo
tsconfig.node.tsbuildinfo
mocks
# Tests, MSW mocks, and build-info cruft never need to ship.

app/generated
# Prisma client is re-generated inside the deps stage (postinstall fires
# automatically on npm ci). Shipping a locally-generated client risks OS-
# or version-skew between the host's Prisma build and the image's.

docs
# Docs live in git; no need for them inside a runtime container.

*.md
.vscode
.idea
.github
coverage
.nyc_output
tmp
npm-debug.log*
# Editor configs, test artefacts, docs, noise.
```

> **⚠ `app/generated` must be in `.dockerignore`**
>
> Prisma 7 embeds absolute-path metadata into the generated client. If you build a locally-generated client on macOS (`/Users/...`) and ship it to a Linux container, you'll see obscure `ENOENT` errors on first query. Always let `prisma generate` run inside the deps stage — §6.1's postinstall hook takes care of this as long as the local client is ignored.

### 6.3 Adding a /healthz route to greenbook

The container healthcheck (07 §8.2.3) and operational monitoring (08 §9) both probe `GET /healthz`. Greenbook's `server/security.ts` already marks `/healthz` and `/up` as "skip rate-limit" paths, but no route handler exists yet — you need to add one.

Add a resource route at `app/routes/healthz.tsx`. The file-system router picks it up automatically on the next `npm run build`:

```tsx
// app/routes/healthz.tsx
//
// Liveness + readiness probe.
//   · 200 {"status":"ok", ...}       process is up AND Postgres reachable
//   · 503 {"status":"degraded", ...} process is up but Postgres failed
//
// Used by:
//   · Docker container healthcheck (compose healthcheck block — 07 §8.2.3)
//   · /usr/local/bin/greenbook-health.sh (§9.3)
//   · Uptime monitors / external probes
//   · Nginx's `skipHealthCheck` in server/security.ts so this route is
//     never rate-limited.

import type { Route } from "./+types/healthz";
import { prisma } from "~/utils/db/db.server";

export async function loader(_args: Route.LoaderArgs) {
  const started = Date.now();
  const checks: Record<string, "ok" | string> = { process: "ok" };

  // Cheap DB probe via the Prisma adapter. "SELECT 1" is <1 ms and doesn't
  // touch any table. DO NOT extend this to real queries — every container
  // hits this every 30s and you don't want to pay for N+1 "is the DB
  // healthy" roundtrips.
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = "ok";
  } catch (err) {
    checks.db = err instanceof Error ? err.message : "unknown";
  }

  const allOk = Object.values(checks).every((v) => v === "ok");

  return Response.json(
    {
      status: allOk ? "ok" : "degraded",
      uptime_ms: Math.round(process.uptime() * 1000),
      timestamp: new Date().toISOString(),
      service: process.env.APP_NAME ?? "greenbook",
      version: process.env.APP_VERSION ?? "dev",
      checks,
      took_ms: Date.now() - started,
    },
    {
      status: allOk ? 200 : 503,
      headers: {
        // Never cache health probes — otherwise a 5-minute CDN cache would
        // keep reporting "ok" after the DB went down.
        "Cache-Control": "no-store",
      },
    },
  );
}

// No default export — this route has no UI, just the loader.
```

Also consider adding `app/routes/up.tsx` with just the process check (no DB query) for the cheap liveness probe:

```tsx
// app/routes/up.tsx — cheap liveness probe (no DB touch).
// Used by monitors that only need to know Node is responding.
import type { Route } from "./+types/up";

export async function loader(_args: Route.LoaderArgs) {
  return Response.json(
    { status: "ok", uptime_ms: Math.round(process.uptime() * 1000) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
```

Both routes are already listed in `skipHealthCheck()` (`server/security.ts:63-65`), so no rate-limiter tweaks are needed. After adding the files, rebuild the image — the auto-routes package picks up the file-name → URL mapping automatically.

> **ℹ Liveness vs readiness**
>
> Docker has one healthcheck concept. Kubernetes distinguishes liveness (is the process alive?) from readiness (is it ready to receive traffic?). For our single-container VM deployment one `/healthz` is enough; the split above (`/up` cheap / `/healthz` DB-aware) is defensive and will save you work if you later move to K8s.

> **⚠ Why the DB probe matters for greenbook specifically**
>
> Greenbook's Prisma adapter is lazy — the first query after boot opens the pool. Without the `SELECT 1` probe, the healthcheck would report "ok" before any route has touched the DB. A misconfigured `DATABASE_URL` would then only surface when a real request came in. The probe catches this at container start.

### 6.4 Checkpoint — what should be true now

Before moving on to [06 — Nginx and TLS](06-app-vm-nginx-tls.md), every item below should pass. If any fails, the next section will not work — fix before continuing.

```bash
# 1. The image built and is in the local Docker store.
$ docker image ls greenbook
# Pass: at least one row with TAG matching your VERSION (timestamp), SIZE ~700-900 MB.

# 2. The container is running and healthy.
$ docker compose -f /opt/greenbook/docker-compose.yml ps
# Pass: STATE=running, HEALTH=healthy. (HEALTH=starting for ~45s after recreation
# is normal — wait it out and re-check.)

# 3. The container runs as the node user (uid 1000), not root.
$ docker exec greenbook id
# Pass: "uid=1000(node) gid=1000(node) groups=1000(node)"

# 4. /healthz returns 200 with status "ok" AND the DB check passes.
$ curl -s http://127.0.0.1:3000/healthz | head -1
# Pass: JSON with "status":"ok" and "checks":{"process":"ok","db":"ok"}.
# "status":"degraded" with "db":"<error>" means Postgres is unreachable —
# revisit pg_hba (02 §4.5), DATABASE_URL in /etc/greenbook.env (07 §8.2.2),
# and the firewall rule on the DB VM (§4.7).

# 5. The published port is loopback only.
$ sudo ss -tlnp | grep ':3000'
# Pass: "127.0.0.1:3000". NOT "0.0.0.0:3000" or "*:3000".

# 6. Logs are pino JSON (one event per line, NOT pino-pretty colour).
$ docker logs --tail 5 greenbook | head -1
# Pass: starts with `{"level":"info"...` or similar JSON.
# If you see colourised text, NODE_ENV is not "production" inside the container —
# check the env file and recreate.

# 7. The image is read-only at the root, with /tmp as writable tmpfs.
$ docker exec greenbook touch /etc/test 2>&1 | grep -i "read-only"
# Pass: "Read-only file system" error.
$ docker exec greenbook touch /tmp/test && docker exec greenbook rm /tmp/test
# Pass: both succeed silently (writable tmpfs at /tmp).
```

If all seven pass, the application container is production-ready. Move on to nginx + TLS.

### 6.5 Common build and runtime failures

The four failures below account for ~80% of "I followed the guide but it didn't work" reports against §6. Recognise the symptom, jump to the fix.

#### Failure 1: `prisma generate` fails during `npm ci` with "Environment variable not found: DATABASE_URL"

**Symptom (build log)**:

```
> greenbook@0.0.0 postinstall
> prisma generate

Environment variables loaded from .env
Error: Environment variable not found: DATABASE_URL.
  -->  prisma/schema.prisma:NN
```

**Why**: `prisma.config.ts` reads `DATABASE_URL` at load time. Inside a Docker build there's no `.env` file (excluded by `.dockerignore`, correctly), so the variable is unset.

**Fix**: the Dockerfile in §6.1 already passes a `DUMMY_DATABASE_URL` build-arg specifically for this case:

```dockerfile
ARG DUMMY_DATABASE_URL=postgres://dummy:dummy@localhost:5432/dummy?schema=public
ENV DATABASE_URL=${DUMMY_DATABASE_URL}
```

If you're seeing this error, your Dockerfile is missing those two lines OR they're below the `RUN npm ci` instead of above it. Make sure the `ARG` + `ENV` come BEFORE `RUN npm ci` in the deps stage.

#### Failure 2: At runtime, Prisma throws "PrismaClientInitializationError: error reading certificate"

**Symptom (container logs)**:

```
PrismaClientInitializationError: error reading certificate file ".../node_modules/@prisma/engines/..."
```

or

```
Error opening a TLS connection: error:0A000086:SSL routines:tls_post_process_server_certificate:certificate verify failed
```

**Why**: alpine doesn't ship `openssl` by default. `@prisma/adapter-pg` uses `openssl` during connection setup on some code paths.

**Fix**: confirm the runtime stage of the Dockerfile has `apk add --no-cache openssl`:

```dockerfile
FROM node:${NODE_VERSION}-alpine AS runtime
...
RUN apk add --no-cache openssl dumb-init
```

If missing, add it, rebuild, redeploy.

#### Failure 3: At runtime, the container immediately exits with `Error: Cannot find module '/app/server.js'`

**Symptom (container logs)**:

```
Error: Cannot find module '/app/server.js'
    at Module._resolveFilename (...)
```

**Why**: the runtime stage didn't COPY the `server.js` from the build stage. Easy to forget when you start from a generic Dockerfile.

**Fix**: confirm the runtime stage has all five COPYs from §6.1:

```dockerfile
COPY --from=build --chown=node:node /app/package.json      ./package.json
COPY --from=build --chown=node:node /app/package-lock.json ./package-lock.json
COPY --from=build --chown=node:node /app/node_modules      ./node_modules
COPY --from=build --chown=node:node /app/build             ./build
COPY --from=build --chown=node:node /app/server.js         ./server.js   ← THIS
COPY --from=build --chown=node:node /app/server            ./server      ← AND THIS
COPY --from=build --chown=node:node /app/app/generated     ./app/generated
```

The two most-commonly-missed ones are `server.js` (the root-level Express bootstrap) and `server/` (the directory containing correlation, logger, security, sentry, shutdown helpers — all imported by server.js).

#### Failure 4: Container starts but Prisma queries fail with `ENOENT: no such file or directory, open '/Users/...'`

**Symptom (container logs at first DB query)**:

```
PrismaClientInitializationError: ENOENT: no such file or directory,
  open '/Users/binalfew/Projects/greenbook/app/generated/prisma/...'
```

**Why**: Prisma 7 bakes absolute host paths into its generated client when `prisma generate` runs. If the host filesystem layout is `/Users/...` (macOS), and the container runs Linux (where `/Users` doesn't exist), every query fails because the client tries to read its own metadata from a path that's not in the image.

**Fix**: the build must regenerate the Prisma client INSIDE the deps stage, NOT copy a locally-generated one in. Two checks:

```bash
# (1) `app/generated` IS in .dockerignore:
$ grep -E '^app/generated' /Users/binalfew/Projects/greenbook/.dockerignore
# Pass: "app/generated" present.

# (2) The deps stage runs `npm ci` (which fires postinstall → prisma generate)
# AFTER copying prisma/ schema. The §6.1 Dockerfile is correct on both counts.
```

If `app/generated` is missing from `.dockerignore`, your locally-generated client is shipping into the image. Add the line, delete `app/generated/` from your local repo (`rm -rf app/generated`), rebuild — the deps stage will regenerate cleanly inside the image.

> **ℹ When in doubt, check the runtime image directly**
>
> ```bash
> $ docker run --rm --entrypoint sh greenbook:VERSION -c \
>     'ls -la /app/server.js /app/server/app.ts /app/build/server/index.js /app/app/generated/prisma/client.js 2>&1 | head'
> ```
>
> All four paths must exist and be owned by `node:node`. Any "No such file or directory" tells you exactly which COPY is missing.

---
