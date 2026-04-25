# Greenbook — Production Deployment Guide

**Greenbook (AU Blue Book directory) on Ubuntu VMs with Docker, Nginx, and PostgreSQL**
_An on-premises, two-VM deployment reference, validated against the greenbook codebase — with every command explained._

Prepared for: **Binalfew** — Senior Solutions & System Architect, MISD / AUC
Version 1.3 · April 2026 · Greenbook-specific · Multi-file edition

---

## Where do I start?

| If you're…                                      | Read these, in order                                                                                                                                                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bringing up production for the first time**   | [01](01-pre-flight.md) → [02](02-db-vm-setup.md) → [03](03-db-vm-backups.md) → [04](04-app-vm-docker.md) → [05](05-app-vm-container.md) → [06](06-app-vm-nginx-tls.md) → [07](07-deploy-workflow.md) → [09](09-hardening-checklist.md) |
| **Doing a routine deploy after launch**         | [07](07-deploy-workflow.md) only                                                                                                                                                                                                       |
| **Operating a running production deployment**   | [08](08-day-2-operations.md) — bookmark it                                                                                                                                                                                             |
| **Investigating an incident**                   | [10](10-troubleshooting.md) — drilldowns by symptom                                                                                                                                                                                    |
| **Adding centralised log search**               | [11](11-future-graylog.md) (planning only, not yet built)                                                                                                                                                                              |
| **Looking up a config file's full content**     | [Appendix B](appendix/B-config-files.md)                                                                                                                                                                                               |
| **Scrolling for a one-liner you've run before** | [Appendix A](appendix/A-command-cheatsheet.md)                                                                                                                                                                                         |

---

## File index

| #   | File                                             | What's in it                                                                                                             | Where it runs         |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| 01  | [Pre-flight](01-pre-flight.md)                   | Ubuntu hardening, SSH key-only auth, UFW, fail2ban, deploy user                                                          | BOTH VMs              |
| 02  | [Database VM setup](02-db-vm-setup.md)           | PostgreSQL 16, SCRAM-SHA-256, `greenbook` DB + `appuser`, pg_hba, tuning                                                 | DB VM                 |
| 03  | [Database VM backups](03-db-vm-backups.md)       | nightly pg_dump, pgBackRest physical+WAL, offsite replication                                                            | DB VM                 |
| 04  | [App VM Docker setup](04-app-vm-docker.md)       | Docker Engine + Compose v2 + buildx, `deployer` in docker group                                                          | App VM                |
| 05  | [Application container](05-app-vm-container.md)  | Hardened Dockerfile, `.dockerignore`, `/etc/greenbook.env`, compose, `/healthz`, checkpoint, common-failures playbook    | App VM                |
| 06  | [Nginx and TLS](06-app-vm-nginx-tls.md)          | Nginx reverse proxy, streaming SSR / SSE / PWA tuning, Let's Encrypt or internal CA                                      | App VM                |
| 07  | [Deploy workflow](07-deploy-workflow.md)         | First-deploy linear walkthrough, build path A/B, schema (`db push` vs `migrate`), env files, `deploy.sh`, rollback, seed | App VM (+ build host) |
| 08  | [Day-2 operations](08-day-2-operations.md)       | Logs (pino + jq), restart playbook, monitoring script, image prune, OS / Docker / Postgres updates                       | BOTH VMs              |
| 09  | [Hardening checklist](09-hardening-checklist.md) | Pre-go-live audit and quarterly review                                                                                   | BOTH VMs              |
| 10  | [Troubleshooting](10-troubleshooting.md)         | 502 / restart loop / DB unreachable / cert / disk / latency                                                              | BOTH VMs              |
| 11  | [Future Graylog](11-future-graylog.md)           | Architecture + sizing + install outline (planning only)                                                                  | future 3rd VM         |

### Appendices

|     | File                                                    | What's in it                                    |
| --- | ------------------------------------------------------- | ----------------------------------------------- |
| A   | [Command cheat sheet](appendix/A-command-cheatsheet.md) | The one-liners you'll repeat most often         |
| B   | [Config files reference](appendix/B-config-files.md)    | Every config file in full, no surrounding prose |
| C   | [References](appendix/C-references.md)                  | Authoritative external sources                  |

---

## 1. Introduction

### 1.1 Purpose of this document

This document is a complete, step-by-step reference for deploying greenbook (the AU Blue Book directory — a multi-tenant React Router 7 SaaS app backed by PostgreSQL) onto two on-premises Ubuntu virtual machines. It is written to be followed end-to-end on a fresh pair of VMs, and to serve as an authoritative reference during day-2 operations.

Every command, configuration file, path, and env var has been validated against the actual greenbook repository (`/Users/binalfew/Projects/greenbook` at the time of writing). Where generic deployment advice would not match the codebase, this document picks the shape that does and flags it.

Every command is followed by an explanation of what it does and why. Where a command has multiple non-obvious flags, each flag is broken out individually. The goal is that you should never have to paste a line into a production shell without understanding what it will do.

### 1.2 What this document covers

- Hardened base OS configuration for both VMs (Ubuntu 24.04 LTS), with a line-by-line explanation of each hardening step.
- PostgreSQL 16 installation from the official PGDG repository, with production-grade authentication (SCRAM-SHA-256), firewall isolation, and tuning guidance.
- Docker Engine (CE) installation from Docker's official apt repository, and deployment of greenbook (custom Express + React Router 7 SSR + Prisma 7 + pino + Sentry) as a containerised workload running as non-root with read-only root filesystem and dropped Linux capabilities.
- Greenbook-specific environment matrix: the five required env vars validated by `app/utils/config/env.server.ts` plus the ten optional operational ones, with rotation and provenance notes.
- The Prisma `db push` schema workflow greenbook ships today, plus the upgrade path to `prisma migrate` when the schema stabilises.
- The first-run seed (`npm run db:seed`) that creates roles, permissions, feature flags, reference data, and the system tenant.
- A greenbook-compatible `/healthz` resource route (none exists yet in the repo) and the container + external probes that use it.
- Nginx installed directly on the host (not containerised) as the TLS-terminating reverse proxy, tuned for React Router's streaming SSR, Server-Sent Events, and greenbook's PWA service worker.
- TLS certificates via Let's Encrypt (HTTP-01 and DNS-01 challenges), with guidance for using an internal CA on a closed AU intranet.
- A release-directory deployment workflow, rollback procedure, and systemd integration for boot-time startup.
- Backups: daily logical (pg_dump) plus a production-grade physical + WAL strategy using pgBackRest, so point-in-time recovery is possible.
- A planning section for adding Graylog (MongoDB + OpenSearch + Graylog Server) as a separate log-aggregation VM. Greenbook's pino JSON output drops straight into Graylog with no reformatting.
- Hardening checklist, troubleshooting guide, and full config-file appendix.

### 1.3 Assumptions

- Two Ubuntu 24.04 LTS (Noble Numbat) VMs are already provisioned, reachable over SSH, and have sudo-enabled non-root user accounts.
- The VMs can reach each other on an internal network. Examples use **10.111.11.51** for the app VM (`auishqosrgbwbs01`) and **10.111.11.50** for the DB VM (`auishqosrgbdbs01`) — substitute your actual addresses.
- You have (or will acquire) a DNS name that resolves to the app VM. The examples use `greenbook.au.int`; substitute your actual host. The public URL **must** match `APP_URL` in the env file — SSO callbacks and email links are constructed from it.
- Greenbook is at or ahead of commit `4a01def` (the template-extraction phases 1–15 merged, the AU Blue Book directory module shipped at `/$tenant/directory/*`, and the public unified directory shipped at `/directory/*`).
- Node 22 is the target runtime (per `CLAUDE.md`). The hardened Dockerfile pins `node:22-alpine`.
- The team is comfortable with Docker conceptually but wants the guardrails of an explicit, reviewed procedure.

### 1.4 Conventions used

- Commands prefixed with `sudo` must be run as a user with sudo rights.
- Placeholder values appear in `ALL_CAPS` (for example `STRONG_PASSWORD_HERE`). Replace every occurrence before running a command.
- Commands intended to run on the DB VM are labelled `[auishqosrgbdbs01]`; those for the app VM are labelled `[auishqosrgbwbs01]`. Unlabelled commands are generic.
- File paths shown like `/etc/greenbook.env` refer to absolute paths on the target VM.
- Shell comments (`#` lines) inside code blocks annotate what each part of the command does. They are there for your reading benefit; they do not need to be typed when you actually run the command.

> **⚠ A note on precision**
>
> Several commands in this document write to system configuration files. **Read before you run.** Where a command appends or replaces a line, the expected before/after content is shown. If the file on your VM does not match the "before" state shown here, stop and investigate before modifying.
>
> Keep a terminal open on each VM with the previous configuration visible (e.g. in `vim` read-only mode) while you make changes elsewhere — this makes rollback trivial if something goes wrong.

---

## 2. Architecture overview

### 2.1 High-level diagram

```
                                   Internet / AU Intranet
                                           │
                                           │  443/tcp (HTTPS)
                                           │  80/tcp  (HTTP -> 301 HTTPS)
                                           ▼
    ┌──────────────────────────────────────────────────────────────────┐
    │                         APP VM  (10.111.11.51)                   │
    │                                                                  │
    │   ┌─────────────────────────────────────────────────────────┐    │
    │   │  Nginx  (host-installed, not containerised)             │    │
    │   │   · TLS termination (Let's Encrypt or internal CA)      │    │
    │   │   · Security headers, gzip                              │    │
    │   │   · Long cache on /assets/*, short on /sw.js            │    │
    │   │   · proxy_buffering off → streams SSR + SSE             │    │
    │   │   · Reverse-proxies to 127.0.0.1:3000                   │    │
    │   └───────────────────────────┬─────────────────────────────┘    │
    │                               │ HTTP                             │
    │                               ▼                                  │
    │   ┌─────────────────────────────────────────────────────────┐    │
    │   │  Docker container:  greenbook                           │    │
    │   │   · Node 22 (alpine)                                    │    │
    │   │   · Express (server.js) → React Router 7 SSR            │    │
    │   │   · Pino JSON logs to stdout                            │    │
    │   │   · Correlation ID middleware (AsyncLocalStorage)       │    │
    │   │   · Rate limiter (general / mutation / auth tiers)      │    │
    │   │   · In-process Postgres job queue (5 s tick)            │    │
    │   │   · Sentry (server SDK) — optional via SENTRY_DSN       │    │
    │   │   · Listens on 0.0.0.0:3000 inside the container;       │    │
    │   │     published as 127.0.0.1:3000 on the host             │    │
    │   │   · Runs as uid 1000 (node), read-only FS, no new privs │    │
    │   │   · init: true → dumb-init PID 1 for proper SIGTERM     │    │
    │   └───────────────────────────┬─────────────────────────────┘    │
    │                               │                                  │
    └───────────────────────────────┼──────────────────────────────────┘
                                    │ 5432/tcp (PostgreSQL protocol)
                                    │ scram-sha-256 auth
                                    │ @prisma/adapter-pg driver
                                    ▼
    ┌──────────────────────────────────────────────────────────────────┐
    │                         DB VM  (10.111.11.50)                    │
    │                                                                  │
    │   ┌─────────────────────────────────────────────────────────┐    │
    │   │  PostgreSQL 16  (native install, not containerised)     │    │
    │   │   · listen_addresses = 'localhost,10.111.11.50'         │    │
    │   │   · pg_hba.conf allows ONLY 10.111.11.51/32             │    │
    │   │   · UFW: port 5432 open only FROM 10.111.11.51          │    │
    │   │   · Schema managed by `prisma db push` (no migrations/  │    │
    │   │     dir yet); Prisma 7 + @prisma/adapter-pg client-side │    │
    │   └─────────────────────────────────────────────────────────┘    │
    │                                                                  │
    │   ┌─────────────────────────────────────────────────────────┐    │
    │   │  pgBackRest repository                                  │    │
    │   │   · Full weekly, differential daily, WAL continuous     │    │
    │   │   · Local:   /var/lib/pgbackrest                        │    │
    │   │   · Offsite: S3 / NFS / rsync target  ─ ─ ─ ─ ─ ─ ─ ┐   │    │
    │   └─────────────────────────────────────────────────────┼─┘    │
    │                                                         │      │
    └─────────────────────────────────────────────────────────┼──────┘
                                                              │
                                                              ▼
                              ┌──────────────────────────────────────────┐
                              │  OFFSITE BACKUP TARGET                   │
                              │   (S3 bucket, NFS mount, or rsync host)  │
                              │   Required for disaster recovery         │
                              └──────────────────────────────────────────┘
```

### 2.2 Why this split of responsibilities

Two VMs are the right granularity for this workload. Running Postgres on its own VM gives the database predictable I/O and memory, decouples its lifecycle from the app (you can restart, upgrade, or replace either side independently), and simplifies backup operations. The app VM stays stateless, which is what makes zero-downtime deploys and rollbacks easy.

Docker is used on the app VM only. PostgreSQL is installed natively on the DB VM rather than in a container. This is a deliberate choice: native Postgres is simpler to back up (pgBackRest reads the data directory directly), has no volume-driver surprises, and its performance is more predictable. You gain nothing operationally by containerising a single-tenant database — you only add a layer to debug.

Nginx is installed on the host of the app VM, also not containerised. This keeps TLS certificates on the host filesystem (simple to manage with Certbot), lets Nginx survive container restarts, and makes it trivial to add rate limiting, access logs, or additional backends later.

The offsite backup destination shown in the diagram is non-optional for a production deployment. The local pgBackRest repository on the DB VM protects against PostgreSQL corruption or human error, but not against the VM itself being lost (disk failure, ransomware, accidental deletion of the VM). [§4.10.3 in 03 — Database VM backups](03-db-vm-backups.md) covers how to configure a second repository.

### 2.3 Port map

| VM     | Port | Protocol | Accessible from            | Purpose                                 |
| ------ | ---- | -------- | -------------------------- | --------------------------------------- |
| App VM | 22   | TCP      | Admin subnet only          | SSH                                     |
| App VM | 80   | TCP      | Public / Intranet          | HTTP → 301 to HTTPS; ACME challenges    |
| App VM | 443  | TCP      | Public / Intranet          | HTTPS (terminated by Nginx)             |
| App VM | 3000 | TCP      | Loopback only (127.0.0.1)  | Docker → Node container (never exposed) |
| DB VM  | 22   | TCP      | Admin subnet only          | SSH                                     |
| DB VM  | 5432 | TCP      | App VM (10.111.11.51) only | PostgreSQL client protocol              |

### 2.4 Traffic flow of a single request

1. A browser resolves `greenbook.au.int` to 10.111.11.51 and opens a TLS connection to port 443.
2. Nginx on the app VM terminates TLS, applies security headers, sets long-cache headers on `/assets/*` / short-cache on `/sw.js`, and forwards the request to `http://127.0.0.1:3000` with `proxy_buffering off` so streamed SSR responses and SSE connections pass through unbuffered.
3. Docker's port mapping delivers the request from `127.0.0.1:3000` into the `greenbook` container's `0.0.0.0:3000`.
4. Express (`server.js` + `server/app.ts`) runs middleware in order: correlation ID → request logger (pino, JSON) → CORS → session extraction → rate limiter (general/mutation/auth tier by route) → React Router handler (`@react-router/express` + `createRequestHandler`).
5. Route loaders/actions that need data call `prisma.*` through `@prisma/adapter-pg`, which opens a pooled TCP connection to `10.111.11.50:5432`.
6. PostgreSQL authenticates the `appuser` role via SCRAM-SHA-256 and returns rows.
7. Rendered HTML (for initial load) streams back through the same path — React Router 7 is streaming-first, which is why `proxy_buffering off` matters. Subsequent navigations return serialised loader data; SSE routes (notifications, real-time updates) keep the connection open.
8. Side effects — audit log rows, webhook fan-outs, `send-email` jobs, domain events — are enqueued into the in-process job queue and picked up by the 5-second tick. On `SIGTERM` the job processor drains, the rate-limit audit buffer flushes, and Sentry flushes pending events.

---

## What changed in version 1.3 (multi-file edition)

Version 1.3 is a structural refactor of the v1.2 single-file guide. **No deployment guidance has changed** — the v1.2 content is preserved verbatim across the numbered files. The only change is organisation:

- The 4,200-line single-file `deployment-guide.md` is now 11 numbered files covering bring-up + ops + troubleshooting, plus 3 appendices, plus this README as the index.
- Files are grouped by **operator session**: a DBA can read [01](01-pre-flight.md) → [02](02-db-vm-setup.md) → [03](03-db-vm-backups.md) and never open the app-VM files. A platform engineer reads [04](04-app-vm-docker.md) → [07](07-deploy-workflow.md) for a deploy.
- Section numbering inside each file is unchanged ("§4.1", "§6.3", etc.) so existing cross-references and bookmarks continue to work.
- Every file has a nav header naming the phase, which VM, expected time, prev/next links, and a one-paragraph "what's in this file".
- The `deployment-guide.md` filename in this directory is now a redirect stub pointing at `README.md` and the numbered files.

## What changed in version 1.2 (greenbook pass)

Version 1.2 took the generic v1.1 single-file document and validated every command, path, env var, and code snippet against the actual greenbook repository. Generic deployment advice that didn't match the codebase was replaced with the real shape. The substantive corrections are:

- **Entrypoint**: v1.1 assumed `react-router-serve` (the default React Router framework server). Greenbook ships a custom Express server at `server.js` that wires correlation IDs, pino logging, rate limiting (3 tiers), CORS, Sentry, and an in-process Postgres-backed job queue. The Dockerfile `CMD` is `npm run start` → `node server.js`. [§6.1 in 05 — Application container](05-app-vm-container.md) is rewritten.
- **Node version**: `node:22-alpine` matches `CLAUDE.md`'s recommendation.
- **Environment variables**: greenbook's `app/utils/config/env.server.ts` validates five required (`NODE_ENV`, `DATABASE_URL`, `SESSION_SECRET`, `HONEYPOT_SECRET`, `RESEND_API_KEY`) plus ten optional via a Zod schema. [§6.3](05-app-vm-container.md) lists all of them with provenance and guidance.
- **Schema workflow**: greenbook currently runs on `prisma db push` (no `prisma/migrations/` directory). [§8.2.1](07-deploy-workflow.md) presents both `db push` and `migrate deploy` paths.
- **Seed / bootstrap**: greenbook's first-run requires `npm run db:seed`. [§8.6](07-deploy-workflow.md) covers it.
- **Healthcheck route**: `server/security.ts` skips `/up` and `/healthz` from rate limiting, but no route file exists. [§6.7](05-app-vm-container.md) contains a greenbook-compatible resource route.
- **SESSION_SECRET rotation**: greenbook parses it as a comma-separated list (`new,old`). [§6.3](05-app-vm-container.md) explains the rotation semantics.
- **Trust proxy**: `server/app.ts` calls `app.set("trust proxy", 1)` — keep nginx as the only hop or update the count.
- **Service Worker + static assets**: short Cache-Control on `sw.js`, immutable on `/assets/*` — [§7.3](06-app-vm-nginx-tls.md).
- **SSE / streaming SSR**: `proxy_buffering off` is required.
- **Graceful shutdown**: 30 s `stop_grace_period` for the in-process job queue.
- **PID 1 signal handling**: `dumb-init` ENTRYPOINT so `docker stop` reaches Node.
- **Prisma driver adapter**: `@prisma/adapter-pg` with `openssl` available at runtime.
- **Logger format**: pino line-delimited JSON — drops straight into Graylog with no reformatting.
- **Nginx HTTP/2**: `listen 443 ssl http2;` works on the nginx 1.24 that Ubuntu 24.04 ships.
- **Let's Encrypt intranet**: DNS-01 for internal IPs with public DNS; internal CA for air-gapped.
- **pgBackRest retention**: `repo1-retention-full=2 + repo1-retention-diff=7` ≈ 14 days of PITR.
- **Compose invocations**: every command uses the explicit `-f /opt/greenbook/docker-compose.yml` form.

---

## Document conventions

These apply across every file in this guide:

- **Numbered files (`01-…` through `11-…`)** are read in order for first-time bring-up. Each file is self-contained for its operator session.
- **Section numbers inside files** (e.g. `§4.3`, `§6.1`) are stable references; cross-file links use the `[file.md§section]` convention.
- **`[auishqosrgbwbs01]` and `[auishqosrgbdbs01]`** prefixes on commands indicate which VM to run them on. Unlabelled commands are generic.
- **`⚠`** callouts mark things that will silently break a deployment if ignored. Read them.
- **`ℹ`** callouts add context, alternatives, or "if you ever need to do X, here's how" notes.
- **`✓`** callouts are checkpoints you should be at before continuing.
