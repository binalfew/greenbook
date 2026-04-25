# 05 — Application container

> **Phase**: bring-up · **Run on**: App VM (`auishqosrgbwbs01`) · **Time**: ~30 min
>
> The hardened multi-stage Dockerfile (Node 22 alpine, non-root, dumb-init, openssl, pruned production deps), `.dockerignore`, the runtime env file at `/etc/greenbook.env`, the production `docker-compose.yml`, and the `/healthz` resource route greenbook needs but doesn't ship by default.
>
> **Prev**: [04 — App VM Docker setup](04-app-vm-docker.md) · **Next**: [06 — Nginx and TLS](06-app-vm-nginx-tls.md) · **Index**: [README](README.md)

---

## 6. The application container

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
# long-running handlers; §6.4 extends it to 30s via stop_grace_period.

EXPOSE 3000
# Documentation — does NOT publish the port. See compose "ports:" in §6.4.

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
# on the host in /etc/greenbook.env and enter via env_file in compose (§6.4).

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

### 6.3 The environment file

Runtime secrets live outside the image and outside the repository. Store them in `/etc/greenbook.env` on the host, readable only by root and the deployer group.

Greenbook's env validation (`app/utils/config/env.server.ts`) uses Zod to enforce the required set at boot; if any required var is missing, the server throws "Invalid environment variables" and does not start. Optional vars are listed below with their defaults and where they're consumed.

#### Required

| Variable          | Consumer                                                                                                                                                                                                         | Notes                                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`        | everywhere                                                                                                                                                                                                       | Must be `production` in prod. Flips pino transport, Express error pages, and react-router defaults.                                                                                        |
| `DATABASE_URL`    | `app/utils/db/db.server.ts` (via `@prisma/adapter-pg`); `prisma.config.ts`                                                                                                                                       | Standard postgres:// URL. URL-encode special chars in password.                                                                                                                            |
| `SESSION_SECRET`  | `app/utils/auth/session.server.ts`, `app/utils/auth/csrf.server.ts`, `app/utils/auth/verification.server.ts`, `app/utils/auth/sso-state.server.ts`, `app/utils/toast.server.ts`, `app/utils/auth/auth.server.ts` | **Comma-separated list** (`new,old`) — greenbook signs with the first secret and verifies against all of them, so you can rotate without invalidating live sessions. See "Rotation" below. |
| `HONEYPOT_SECRET` | `app/utils/auth/honeypot.server.ts`                                                                                                                                                                              | Used as the encryption seed for the honeypot anti-bot form field. Independent from SESSION_SECRET by design.                                                                               |
| `RESEND_API_KEY`  | `app/utils/email/email.server.ts`                                                                                                                                                                                | Auth token for the Resend transactional email API. Verification emails, password resets, DSAR exports, tenant invites all flow through this.                                               |

#### Optional (operational knobs)

| Variable                    | Default                 | Consumer                               | Notes                                                                                                                                                          |
| --------------------------- | ----------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                      | `3000`                  | `server.js`                            | Only change if you also change the compose publish line + nginx upstream.                                                                                      |
| `APP_URL`                   | `http://localhost:5173` | `app/utils/config/env.server.ts`       | **Must** match the HTTPS URL nginx serves. Used to construct OIDC/SAML callback URLs and transactional-email links. Getting this wrong silently breaks SSO.    |
| `APP_NAME`                  | `app`                   | `server/logger.js`                     | Appears as `service` in every pino log line + as a Sentry tag. Set to something identifying (`greenbook-prod`).                                                |
| `APP_VERSION`               | `dev`                   | `server/logger.js`, `server/sentry.js` | Appears as `version` in pino + as the Sentry `release`. The deploy script in §8 sets it to the release timestamp automatically.                                |
| `LOG_LEVEL`                 | `info`                  | `server/logger.js`                     | One of `fatal`, `error`, `warn`, `info`, `debug`, `trace`. Lower the threshold only temporarily during debugging — `debug`/`trace` are very chatty.            |
| `SENTRY_DSN`                | _(unset)_               | `server/sentry.js`, `app/root.tsx`     | Leave empty to disable error tracking. If set, also exposed to the browser bundle via `getEnv()`.                                                              |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1`                   | `server/sentry.js`                     | Fraction (0.0–1.0) of transactions sampled. Keep low in prod.                                                                                                  |
| `CORS_ORIGINS`              | `http://localhost:3000` | `server/security.ts`                   | Comma-separated allowlist. **Set this to the public HTTPS origin** (e.g. `https://greenbook.au.int`) or cookie-authed API calls from the PWA will be rejected. |
| `RATE_LIMIT_WINDOW_MS`      | `900000` (15 min)       | `server/security.ts`                   | Window for the general rate limiter.                                                                                                                           |
| `RATE_LIMIT_MAX_REQUESTS`   | `300`                   | `server/security.ts`                   | Per-user (authenticated) or per-IP limit in the window.                                                                                                        |

> **ℹ The legacy `MICROSOFT_*` variables in `.env.example`**
>
> Greenbook's `.env.example` still lists `MICROSOFT_CLIENT_ID` / `_SECRET` / `_TENANT_ID` / `_REDIRECT_URI`. Per the file's comment block, these are carried over from the pre-template implementation — **the current code does not read them**. SSO is configured per-tenant in the DB (`SSOConfiguration` table) via the admin UI at `/$tenant/settings/security/sso`. Do not wire them into `/etc/greenbook.env` unless you are re-enabling the legacy org-chart sync.

#### Generate the secrets first

Three secrets are needed before you can write `/etc/greenbook.env`. Generate each one **on the app VM** so it never lives on your laptop or in shell history elsewhere. Print them once, copy each into the env file in the next step, and don't share them anywhere else.

```
# [auishqosrgbwbs01] — generate all three at once and print

echo "── SESSION_SECRET (cookie signing, 48 bytes / 64 base64 chars) ──"
openssl rand -base64 48
#   openssl rand    cryptographically secure random bytes (uses the kernel CSPRNG).
#   -base64         emit base64-encoded — safe for env files / connection strings.
#   48              raw byte count BEFORE base64 expansion. Base64 expands 3 bytes
#                    into 4 characters, so 48 bytes → 64 characters.
# Why 48 bytes? @epic-web/totp + the cookie session library accept anything ≥ 32
# bytes; 48 gives you 384 bits of entropy with headroom for rotation (you can
# concatenate two of these as a comma-separated list — see "rotation" below).

echo ""
echo "── HONEYPOT_SECRET (honeypot encryption seed, 32 bytes / 44 base64 chars) ──"
openssl rand -base64 32
# 32 bytes / 256 bits — matches the seed-length expectation of @nichtsam/helmet's
# honeypot field encryption. Independent from SESSION_SECRET by design (different
# subsystem, different rotation cadence).

echo ""
echo "── DB password (postgres role, 32 bytes / 44 base64 chars) ──"
openssl rand -base64 32
# Use this for the `appuser` Postgres role created in §4.3 — if you didn't
# generate one there, generate it now and update the role:
#   On the DB VM:
#     sudo -u postgres psql -c "ALTER USER appuser WITH PASSWORD 'PASTE_HERE';"
# 32 bytes is plenty for a Postgres password — there's no key-exchange spec
# pushing you toward 48 here, just don't go below 24 chars of base64.
```

Copy the three printed lines into a private note. They go into the file in the next step:

| Placeholder in the template below          | Replace with                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `REPLACE_WITH_OPENSSL_RAND_BASE64_48`      | the 64-char SESSION_SECRET                                                                             |
| `REPLACE_WITH_OPENSSL_RAND_BASE64_32`      | the 44-char HONEYPOT_SECRET                                                                            |
| `STRONG_PASSWORD_HERE` (in `DATABASE_URL`) | the 44-char DB password (URL-encode `/` → `%2F`, `+` → `%2B`, `=` → `%3D` if present)                  |
| `re_REPLACE_WITH_REAL_KEY`                 | a real Resend API key from the Resend dashboard (https://resend.com/api-keys) — these start with `re_` |

> **⚠ URL-encode the DB password if it contains base64 special chars**
>
> `openssl rand -base64 32` can produce strings with `/`, `+`, or `=`. All three are reserved characters in a `postgres://` connection URL. Either regenerate until you get a clean string, or percent-encode in place. A one-liner that gives you a URL-safe password directly:
>
> ```
> openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
> ```
>
> `tr '+/' '-_'` swaps the URL-unsafe characters for URL-safe equivalents (RFC 4648 base64url alphabet). `tr -d '='` strips the trailing padding that some libraries don't expect. The resulting string still has 256 bits of entropy and drops straight into the connection URL with no escaping.

> **⚠ Don't reuse a secret across environments**
>
> Generate fresh values for each environment (dev / staging / prod). Sharing a `SESSION_SECRET` between environments means a session cookie minted in dev would validate against prod, defeating environment isolation. The local-dev `.env` placeholder (`change-me-in-production`) is fine for dev because it's documented as a placeholder; production must always be a freshly-generated random.

#### Now write the file

```
# [auishqosrgbwbs01] — run as a user with sudo
sudo tee /etc/greenbook.env <<'EOF'
# ─── Required ────────────────────────────────────────────
NODE_ENV=production
PORT=3000

# Postgres connection string. Replace STRONG_PASSWORD_HERE with the value
# you generated in §4.3. URL-encode the password if it contains reserved
# characters (@, /, :, ?, #) — many openssl-generated base64 strings include '/',
# which requires percent-encoding to %2F.
DATABASE_URL=postgres://appuser:STRONG_PASSWORD_HERE@10.111.11.50:5432/greenbook

# Cookie / session signing. Comma-separated list (first is active, rest
# validate legacy cookies). Generate with: openssl rand -base64 48
SESSION_SECRET=REPLACE_WITH_OPENSSL_RAND_BASE64_48

# Honeypot-field encryption seed. Generate with: openssl rand -base64 32
HONEYPOT_SECRET=REPLACE_WITH_OPENSSL_RAND_BASE64_32

# Resend transactional email. Create in the Resend dashboard.
RESEND_API_KEY=re_REPLACE_WITH_REAL_KEY

# ─── Public URL + service metadata ──────────────────────
APP_URL=https://greenbook.au.int
APP_NAME=greenbook-prod
# APP_VERSION is written by deploy.sh — leave blank here.

# ─── Logging / observability ────────────────────────────
LOG_LEVEL=info

# Leave SENTRY_DSN empty to disable error tracking.
SENTRY_DSN=
SENTRY_TRACES_SAMPLE_RATE=0.1

# ─── CORS + rate limiting ───────────────────────────────
# CRITICAL: set CORS_ORIGINS to the exact public origin (no trailing slash).
CORS_ORIGINS=https://greenbook.au.int

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=300
EOF

sudo chown root:deployer /etc/greenbook.env
#   Ownership: root (can write), deployer (can read). Regular users cannot.

sudo chmod 640 /etc/greenbook.env
#   640 = rw for owner (root), r for group (deployer), nothing for others.
#         The deployer user can read it (needed to run compose); others cannot.

ls -l /etc/greenbook.env
# Expected: -rw-r----- 1 root deployer
```

#### SESSION_SECRET rotation (zero-downtime)

Greenbook parses `SESSION_SECRET` as a comma-separated list and treats the first entry as the active signing key. Other entries validate existing cookies. This lets you rotate without logging everyone out:

1. Generate a new secret: `openssl rand -base64 48`
2. Prepend it: `SESSION_SECRET=<new>,<current>` in `/etc/greenbook.env`
3. Re-create the container: `docker compose -f /opt/greenbook/docker-compose.yml up -d`
4. Wait out your session TTL (typically 30 days).
5. Drop the old value: `SESSION_SECRET=<new>` and recreate again.

`HONEYPOT_SECRET` does not support rotation — change it and existing form tokens are invalidated (minor UX cost; users retry).

> **⚠ Secrets in /etc/greenbook.env are visible to the docker group**
>
> These secrets are NOT hidden from anyone in the docker group. They are visible via:
>
> · docker inspect greenbook — the "Env" field shows the expanded variables
>
> · docker compose config — prints the compose file with env_file merged in
>
> · /proc/PID/environ on the host for anyone who can read that process
>
> For stronger secret handling, the upgrade paths are (a) Docker secrets (file-based, mounted as tmpfs, only readable by the container), or (b) a secret manager (Vault, AWS Secrets Manager, 1Password Connect) injected at container start. For a single-tenant internal app, file-based secrets are typically fine — but do not imagine they are inaccessible to anyone on the host with docker rights.

> **⚠ Never commit this file (and what to do if you already did)**
>
> Add `/etc/greenbook.env`, `.env`, and `.env.*` to your repository's `.gitignore` BEFORE committing anything. If a secret has ever been committed to git, rotation alone is not enough — the old value remains in the repository history and is accessible to anyone who clones. To remove a secret from history:
>
> 1. Rotate the secret immediately (change it in the DB / app / service).
> 2. Assume it has already been captured in CI logs, build artefacts, and any backups made after the commit.
> 3. Rewrite history with `git filter-repo` or `BFG Repo-Cleaner` to purge the value from all commits.
> 4. Force-push, and coordinate with the team to re-clone — every local clone still contains the secret.
> 5. Audit access logs of the repository and the rotated service for any use of the leaked credential during the exposure window.

### 6.4 The docker-compose.yml

This is a separate compose file for production (do **not** reuse the repo root `docker-compose.yml`, which is tuned for local Postgres dev on ports 5432/5433). Save as `/opt/greenbook/docker-compose.yml`:

```
# /opt/greenbook/docker-compose.yml
# Compose V2 format. Do not include a top-level 'version:' key — it is
# ignored by Compose V2 and triggers a deprecation warning.

services:
  app:
    image: greenbook:${APP_VERSION:-latest}
    # ${VAR:-DEFAULT}    substitute VAR if set, otherwise DEFAULT.
    # ${APP_VERSION}     set via /opt/greenbook/.env (see §8). "latest" is a
    #                     safety fallback — normally the .env file pins
    #                     the exact dated tag.

    container_name: greenbook
    # Fixed container name so operations commands (logs, exec) don't need
    # to discover the ID. Means only one instance can run at a time — fine
    # for a single-VM deployment.

    restart: unless-stopped
    # Automatically restart the container if it exits, UNLESS a human
    # explicitly ran "docker compose stop". Survives VM reboots.

    init: true
    # Belt-and-braces with the dumb-init ENTRYPOINT in §6.1. Compose's
    # init: true runs docker-init (tini) as PID 1 if ENTRYPOINT is absent.
    # With our explicit dumb-init ENTRYPOINT this is redundant but harmless
    # and makes the behaviour visible to anyone skim-reading the compose file.

    stop_grace_period: 30s
    # Docker's default is 10s, which can be tight: on SIGTERM greenbook
    # drains the in-process job queue (app/utils/events/job-queue.server.ts),
    # flushes the rate-limit audit buffer, and (if SENTRY_DSN is set) flushes
    # pending Sentry events. Under heavy load those can exceed 10s. 30s gives
    # the shutdown hooks room without surprising operators.

    env_file:
      - /etc/greenbook.env
    # Loads VAR=value pairs from the file into the container's environment.
    # Variables here do NOT appear in compose.yml, keeping this file safe to
    # commit to git. See §6.3 for the full env matrix.

    environment:
      APP_VERSION: ${APP_VERSION:-dev}
    # The /etc/greenbook.env file leaves APP_VERSION blank; deploy.sh writes
    # the release timestamp into /opt/greenbook/.env which compose reads.
    # Injecting it here surfaces the version in pino logs and Sentry tags.

    ports:
      - "127.0.0.1:3000:3000"
    # "HOST_IP:HOST_PORT:CONTAINER_PORT"
    # Binding to 127.0.0.1 (NOT 0.0.0.0) is critical — Nginx on the host
    # reaches us here, and no outside machine can. UFW rules don't need
    # to cover 127.0.0.1.

    healthcheck:
      test: ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\" || exit 1"]
      # Runs INSIDE the container. The node:22-alpine image doesn't ship
      # curl, so we use Node itself (global fetch is available since v18).
      # Node exits 0 on healthy, 1 on unhealthy; Docker reads the exit code
      # to set the "healthy" / "unhealthy" state.
      #
      # REQUIRES greenbook to expose GET /healthz returning 200. The
      # `/healthz` and `/up` paths are already marked "skip rate-limit" in
      # server/security.ts, but no route handler exists yet. §6.7 includes
      # a drop-in resource route that you MUST add before rolling this
      # compose file — otherwise the healthcheck will permanently fail
      # and the container will be marked unhealthy.
      interval: 30s     # time between checks after the container is running
      timeout: 5s       # fail a check that takes longer than this
      retries: 3        # consecutive failures before marking unhealthy
      start_period: 45s # grace window after start — greenbook does a Prisma
                        # client probe on first query, which adds a few hundred
                        # ms; 45s gives comfortable headroom for slow boots.

    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
        tag: "greenbook"
    # json-file is Docker's default log driver. Without rotation settings,
    # logs grow unbounded and eventually fill the disk. 10m per file x 5
    # files = 50 MB cap per container.
    #
    # Greenbook's server/logger.js already emits line-delimited JSON in
    # production — a log shipper reading /var/lib/docker/containers/*/*.log
    # can forward each line to Graylog / ELK with zero re-structuring.

    deploy:
      resources:
        limits:
          memory: 1g
          cpus: "1.0"
    # Hard limits. If the container exceeds memory: 1g, it's killed (OOM).
    # 1.0 CPUs means it can use one full core at 100%.
    # The in-process job queue runs in the same Node event loop as request
    # handling — if you add heavy job handlers (PDF generation, image
    # processing), bump memory to 2g and consider dedicating a core.

    read_only: true
    # Root filesystem is read-only. Any write attempt returns EACCES.
    # Defence in depth: even if an attacker achieves code execution, they
    # can't drop persistent malware into the image.

    tmpfs:
      - /tmp:rw,noexec,nosuid,size=64m
    # Overlay a writable tmpfs at /tmp. Required because SOME libraries
    # need scratch space (uploads, sessions, node's JIT caches, the
    # @mjackson/form-data-parser working dir for multipart uploads).
    #   rw         read/write for the container user.
    #   noexec     files in /tmp can't be executed.
    #   nosuid     setuid bits on /tmp files are ignored.
    #   size=64m   cap the tmpfs at 64 MB so a bug can't fill RAM.

    security_opt:
      - no-new-privileges:true
    # Prevents any process in the container from gaining more privileges
    # via setuid binaries or file capabilities. A defense against a
    # whole class of privilege escalation bugs.

    cap_drop:
      - ALL
    # Drop ALL Linux capabilities (CAP_NET_RAW, CAP_SYS_ADMIN, etc.).
    # A Node web app needs none of them — network IO uses unprivileged
    # sockets (bound to port 3000 > 1024), file access uses normal uid
    # permissions. If the app later needs something specific (e.g. bind
    # to port 80 directly), add it back with cap_add:.
```

> **ℹ About read_only + tmpfs**
>
> Greenbook's hot paths don't write to disk — Express serves pre-built assets, Prisma writes go over the network to Postgres, pino logs go to stdout, and uploads are parsed in memory. The one exception is the 64 MB `/tmp` tmpfs, needed by the multipart form-data parser. If you add any feature that needs on-disk scratch (large file uploads, PDF rendering, image resizing), add another tmpfs mount or a named Docker volume. EACCES / "read-only file system" errors on startup point here.

### 6.5 The greenbook directory layout on the host

Before the first build, lay out the deploy root:

```
# [auishqosrgbwbs01] as deployer
mkdir -p /opt/greenbook/releases
#   Each deploy lands under releases/<timestamp>/. /opt/greenbook holds the
#   compose file, .env (APP_VERSION pin), and deploy.sh.
```

Copy the docker-compose.yml from §6.4 to `/opt/greenbook/docker-compose.yml` before continuing.

### 6.6 Initial build and run

Assume greenbook source lives at `/opt/greenbook/releases/2026-04-23-1430` (see §8 for the full release-directory workflow; for the first deploy you can clone it anywhere).

```
# [auishqosrgbwbs01] as deployer
VERSION=2026-04-23-1430
#   Shell variable — used several times below. Not exported; lives in this shell.

cd /opt/greenbook/releases/$VERSION
# Navigate to the source tree.

docker build -t greenbook:$VERSION .
#   docker build    build an image from a Dockerfile.
#   -t NAME:TAG     name and tag for the resulting image.
#   .               build context — Dockerfile must exist here, and
#                   everything not in .dockerignore gets sent to the daemon.
# Runtime: cold build ~90-180 s (downloads node:22-alpine + npm ci of ~900
# packages), warm cache ~15-30 s.

docker tag greenbook:$VERSION greenbook:latest
#   docker tag SOURCE TARGET   add an additional name to an existing image.
#   Now two tags point at the same image. Compose's APP_VERSION:-latest
#   default means a compose file with no .env still works.

echo "APP_VERSION=$VERSION" > /opt/greenbook/.env
#   Writes the compose environment file that docker compose reads
#   automatically when it's in the same directory as docker-compose.yml.

# Before starting the container for the very first time, the schema needs
# to exist. See §8.6 for the `prisma db push` + `npm run db:seed` bootstrap
# — skip ahead and run those steps, then return here.

cd /opt/greenbook
docker compose -f /opt/greenbook/docker-compose.yml up -d
#   docker compose -f FILE COMMAND   use FILE as the compose file.
#   up                                 create & start services defined in file.
#   -d                                 detached — run in background.

docker compose -f /opt/greenbook/docker-compose.yml ps
# Expected: service 'app' with STATE=running and (after start_period) HEALTH=healthy.

docker compose -f /opt/greenbook/docker-compose.yml logs -f app
#   logs -f SERVICE    follow (-f) the logs of SERVICE. Ctrl+C to exit.
# Expected in production (pino JSON, one event per line):
#   {"level":"info","time":"...","service":"greenbook-prod","msg":"Starting production server"}
#   {"level":"info","time":"...","msg":"[jobs] starting processor (interval=5000ms)"}
#   {"level":"info","time":"...","msg":"Server is running on http://localhost:3000"}
# In dev mode (or if NODE_ENV != production) pino-pretty formats the same
# events as colorised lines.
```

Probe from the host:

```
# [auishqosrgbwbs01]
curl -I http://127.0.0.1:3000/
#   curl -I URL     HEAD request — just the headers, not the body.
# Expected: HTTP/1.1 200 OK (or a redirect from greenbook's root — the
# public / renders the unified AU directory landing page via
# app/routes/_public/index.tsx).

curl -I http://127.0.0.1:3000/healthz
# Expected: HTTP/1.1 200 OK (assumes the §6.7 route is in place).

curl -sI http://127.0.0.1:3000/ | grep -i "x-correlation-id\|x-request-id"
# Confirms the correlation middleware is live — every response carries
# a correlation ID, even on the root route.
```

> **✓ If you can curl 127.0.0.1:3000**
>
> You have proven: the image built cleanly, the container started, Node is listening, the DATABASE_URL resolves and pg_hba accepts the connection (otherwise env validation would have thrown), and the published port works. The next step is putting Nginx in front of this to handle TLS and expose it publicly.

### 6.7 Adding a /healthz route to greenbook

The container healthcheck (§6.4) and operational monitoring (§9) both probe `GET /healthz`. Greenbook's `server/security.ts` already marks `/healthz` and `/up` as "skip rate-limit" paths, but no route handler exists yet — you need to add one.

Add a resource route at `app/routes/healthz.tsx`. The file-system router picks it up automatically on the next `npm run build`:

```tsx
// app/routes/healthz.tsx
//
// Liveness + readiness probe.
//   · 200 {"status":"ok", ...}       process is up AND Postgres reachable
//   · 503 {"status":"degraded", ...} process is up but Postgres failed
//
// Used by:
//   · Docker container healthcheck (compose healthcheck block — §6.4)
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

---
