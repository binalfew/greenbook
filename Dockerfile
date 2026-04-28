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
# alpine keeps the runtime image tiny. Every greenbook runtime dependency
# (bcryptjs, pg, pino, express, @prisma/adapter-pg, @sentry/node, samlify,
# openid-client, etc.) is either pure JS or publishes musl-compatible
# prebuilds, so alpine is safe. If you ever add a native dep without an
# alpine prebuild (e.g. node-canvas), switch the base to
# node:${NODE_VERSION}-bookworm-slim.

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

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# Suppress Playwright's postinstall — it would otherwise download
# ~500 MB of Chromium / Firefox / Webkit binaries to node_modules.
# The production runtime image never runs E2E tests; `npm prune
# --omit=dev` in the build stage removes Playwright entirely from the
# final image anyway. Skipping the download avoids one egress host
# (playwright.download.prss.microsoft.com) and shaves ~30 s off the
# build. This env var is per-Dockerfile and never escapes to local
# dev — `npm install` on your laptop still fetches browsers normally.

RUN npm ci --include=dev --legacy-peer-deps
#   npm ci                clean install: installs exact versions from
#                          package-lock.json. Fails if the lockfile does not
#                          agree with package.json.
#   --include=dev         include devDependencies. We need build-time tools
#                          (typescript, vite, @react-router/dev,
#                          @tailwindcss/vite, etc.) for `npm run build`.
#   --legacy-peer-deps    fall back to npm v6 peer-dep semantics (warn but
#                          don't fail). Required because greenbook is on
#                          React 19 but `use-resize-observer@9.x` declares
#                          `react@"16.8 - 18"` as its peer — that package
#                          hasn't shipped a release widening the range.
#                          `npm install` is forgiving about this; `npm ci`
#                          is strict, so without the flag the build fails:
#                            ERESOLVE could not resolve
#                            peer react@"16.8.0 - 18" from use-resize-observer@9.1.0
#                            Found: react@19.x
#                          Long-term fix is a `package.json` "overrides"
#                          block forcing use-resize-observer to accept the
#                          project's React (or replacing the package). The
#                          flag is a small ecosystem-wide blast radius —
#                          keep until the upstream peer-dep is widened.
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
# Now copy the entire source tree. Anything in .dockerignore is excluded.
# This is the last layer that changes when source code changes.

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

# openssl  — needed by @prisma/adapter-pg on some connection paths at runtime.
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
# long-running handlers; docker-compose.yml extends it via stop_grace_period.

EXPOSE 3000
# Documentation — does NOT publish the port. See compose "ports:".

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["npm", "run", "start"]
#   ENTRYPOINT is the fixed PID 1. dumb-init -- execs its args as PID 2 under
#   the dumb-init supervisor: SIGTERM from Docker reaches node, zombies are
#   reaped, Ctrl+C works in `docker run -it`.
#
#   CMD resolves to:  node server.js  (greenbook's "start" script).
#   server.js under NODE_ENV=production imports ./build/server/index.js and
#   listens on process.env.PORT || 3000.
