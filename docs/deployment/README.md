# Greenbook — Production Deployment Guide

**Greenbook (AU Blue Book directory) on Ubuntu VMs with Docker, Nginx, and PostgreSQL**
_An on-premises deployment reference for a three-VM topology (DMZ + App + DB), validated against the greenbook codebase — with every command explained. TLS terminates at the DMZ; the App VM is unreachable from the public internet._

Prepared for: **Binalfew** — Senior Solutions & System Architect, MISD / AUC

---

## Where do I start?

| If you're…                                            | Read these, in order                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bringing up production from scratch**               | [01](01-pre-flight.md) → [02](02-db-vm-setup.md) → [03](03-db-vm-backups.md) → [04](04-app-vm-docker.md) → [05](05-app-vm-container.md) → [06](06-app-vm-nginx-tls.md) → [07](07-deploy-workflow.md) → [12](12-dmz-reverse-proxy.md) → [13](13-verification.md) → [09](09-hardening-checklist.md) |
| **Migrating from a legacy single-tier App VM**        | [12](12-dmz-reverse-proxy.md) → [13](13-verification.md) (verify DMZ green) → [06 §6.6](06-app-vm-nginx-tls.md#66-migrating-a-legacy-single-tier-app-vm) (drop TLS from App VM)                                                                                                                   |
| **Doing a routine deploy after launch**               | [07](07-deploy-workflow.md) only                                                                                                                                                                                                                                                                  |
| **Verifying a deployment end-to-end**                 | [13](13-verification.md) — layer-by-layer runbook, ~20 min for a clean run                                                                                                                                                                                                                        |
| **Operating a running production deployment**         | [08](08-day-2-operations.md) — bookmark it                                                                                                                                                                                                                                                        |
| **Investigating an incident**                         | [13 §13.9](13-verification.md#139-symptoms-to-layer-cheatsheet) (symptoms → layer) → [10](10-troubleshooting.md) (drilldowns)                                                                                                                                                                     |
| **Adding centralised log search**                     | [11](11-future-graylog.md) (planning only, not yet built)                                                                                                                                                                                                                                         |
| **Onboarding a new AU app behind the same DMZ proxy** | [06 §6.5](06-app-vm-nginx-tls.md#65-adding-a-second-app-on-the-app-vm) (App VM block) → [12 §12.7](12-dmz-reverse-proxy.md#127-adding-future-apps-behind-the-same-proxy) (DMZ block)                                                                                                              |
| **Looking up a config file's full content**           | [Appendix B](appendix/B-config-files.md)                                                                                                                                                                                                                                                          |
| **Scrolling for a one-liner you've run before**       | [Appendix A](appendix/A-command-cheatsheet.md)                                                                                                                                                                                                                                                    |

---

## File index

| #   | File                                                | What's in it                                                                                                                                                                                            | Where it runs           |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 01  | [Pre-flight](01-pre-flight.md)                      | Ubuntu hardening, SSH key-only auth, UFW, fail2ban, deploy user                                                                                                                                         | BOTH VMs                |
| 02  | [Database VM setup](02-db-vm-setup.md)              | PostgreSQL 16, SCRAM-SHA-256, `greenbook` DB + `appuser`, pg_hba, tuning                                                                                                                                | DB VM                   |
| 03  | [Database VM backups](03-db-vm-backups.md)          | nightly pg_dump, pgBackRest physical+WAL, offsite replication                                                                                                                                           | DB VM                   |
| 04  | [App VM Docker setup](04-app-vm-docker.md)          | Docker Engine + Compose v2 + buildx, `deployer` in docker group                                                                                                                                         | App VM                  |
| 05  | [Application container](05-app-vm-container.md)     | **Source-tree artefacts**: hardened Dockerfile, `.dockerignore`, `/healthz` route, post-build checkpoint, common build-failures playbook                                                                | Repo (laptop)           |
| 06  | [App VM nginx (inner tier)](06-app-vm-nginx-tls.md) | Multi-tenant inner-tier nginx (HTTP-only, source-pinned to DMZ), streaming SSR / SSE / PWA tuning, per-app onboarding, legacy single-tier migration                                                     | App VM                  |
| 07  | [Deploy workflow](07-deploy-workflow.md)            | **App-VM-side**: initial setup (`/etc/greenbook.env`, `docker-compose.yml`), first-deploy walkthrough, build path A/B, schema (`db push` vs `migrate`), env-file lifecycle, `deploy.sh`, rollback, seed | App VM (+ build host)   |
| 08  | [Day-2 operations](08-day-2-operations.md)          | Logs (pino + jq), restart playbook, monitoring script, image prune, OS / Docker / Postgres updates                                                                                                      | BOTH VMs                |
| 09  | [Hardening checklist](09-hardening-checklist.md)    | Pre-go-live audit and quarterly review                                                                                                                                                                  | BOTH VMs                |
| 10  | [Troubleshooting](10-troubleshooting.md)            | 502 / restart loop / DB unreachable / cert / disk / latency                                                                                                                                             | BOTH VMs                |
| 11  | [Future Graylog](11-future-graylog.md)              | Architecture + sizing + install outline (planning only)                                                                                                                                                 | future 3rd VM           |
| 12  | [DMZ shared reverse proxy](12-dmz-reverse-proxy.md) | Edge nginx in the AU DMZ that terminates TLS and reverse-proxies to internal app VMs. Multi-tenant by design — greenbook is the worked example, future apps onboard with three commands.                | DMZ VM `auishqosrarp01` |
| 13  | [Verification](13-verification.md)                  | Layer-by-layer runbook for confirming the full stack works (DB → App → DMZ → Internet). Used both before go-live and during incidents.                                                                  | varies                  |

### Appendices

|     | File                                                           | What's in it                                                           |
| --- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A   | [Command cheat sheet](appendix/A-command-cheatsheet.md)        | The one-liners you'll repeat most often                                |
| B   | [Config files reference](appendix/B-config-files.md)           | Every config file in full, no surrounding prose                        |
| —   | [Production `docker-compose.yml`](appendix/docker-compose.yml) | scp-able compose file template for `/opt/greenbook/docker-compose.yml` |
| C   | [References](appendix/C-references.md)                         | Authoritative external sources                                         |

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
- TLS certificates from the AU-procured wildcard for `*.africanunion.org`, delivered as a password-protected PFX bundle and installed on the DMZ VM (the only place TLS terminates).
- A release-directory deployment workflow, rollback procedure, and systemd integration for boot-time startup.
- Backups: daily logical (pg_dump) plus a production-grade physical + WAL strategy using pgBackRest, so point-in-time recovery is possible.
- A planning section for adding Graylog (MongoDB + OpenSearch + Graylog Server) as a separate log-aggregation VM. Greenbook's pino JSON output drops straight into Graylog with no reformatting.
- Hardening checklist, troubleshooting guide, and full config-file appendix.

### 1.3 Assumptions

- **Two or three** Ubuntu 24.04 LTS (Noble Numbat) VMs are already provisioned, reachable over SSH, and have sudo-enabled non-root user accounts. The minimum is two VMs (App + DB); the AU production topology adds a third — a DMZ reverse-proxy VM in front of the App VM (covered by [12 — DMZ shared reverse proxy](12-dmz-reverse-proxy.md)).
- The VMs can reach each other on an internal network. Examples use **10.111.11.51** for the app VM (`auishqosrgbwbs01`) and **10.111.11.50** for the DB VM (`auishqosrgbdbs01`); the DMZ VM (`auishqosrarp01`) is on a separate DMZ subnet at **172.16.177.50**, routed to the internal subnet — substitute your actual addresses.
- You have (or will acquire) a DNS name that resolves to **whichever VM is public-facing** — the DMZ VM in the three-VM topology, the App VM in the two-VM topology. The examples use `greenbook.africanunion.org`; substitute your actual host. The public URL **must** match `APP_URL` in the env file — SSO callbacks and email links are constructed from it.
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

The greenbook AU production deployment is a **three-VM topology**: a DMZ reverse-proxy VM at the public edge, an internal application VM running Docker, and a private database VM. TLS terminates only at the DMZ; everything between DMZ and App VM is plain HTTP across a trusted private LAN. Single-tier (no DMZ — App VM faces public directly) is also supported for simpler deployments — see the callout under the diagram and [chapter 06](06-app-vm-nginx-tls.md) for that shape.

```
                                Internet (DMZ public IP 196.188.248.25)
                                           │
                                           │  443/tcp (HTTPS)
                                           │  80/tcp  (HTTP → 301 HTTPS)
                                           ▼
    ┌──────────────────────────────────────────────────────────────────┐
    │            DMZ VM   auishqosrarp01   (172.16.177.50)             │
    │            Public-facing edge — multi-tenant TLS terminator      │
    │                                                                  │
    │   ┌─────────────────────────────────────────────────────────┐    │
    │   │  Nginx  (host-installed, not containerised)             │    │
    │   │   · TLS termination (AU wildcard *.africanunion.org)    │    │
    │   │   · Security headers (HSTS, X-Frame-Options, etc.)      │    │
    │   │   · Per-IP edge rate-limit zones (coarse + auth-strict) │    │
    │   │   · Routes by `server_name` — multi-tenant by design;   │    │
    │   │     greenbook today, future AU apps onboard with        │    │
    │   │     three commands (12 §12.7)                           │    │
    │   │   · Cert files at /etc/ssl/au/ (single source of truth) │    │
    │   └───────────────────────────┬─────────────────────────────┘    │
    └───────────────────────────────┼──────────────────────────────────┘
                                    │ HTTP across the private subnet
                                    │ (DMZ ⇄ internal LAN is the
                                    │  trust boundary; no TLS inside)
                                    ▼
    ┌──────────────────────────────────────────────────────────────────┐
    │           APP VM   auishqosrgbwbs01   (10.111.11.51)             │
    │           Internal — UFW pins :80 to DMZ source IP only          │
    │                                                                  │
    │   ┌─────────────────────────────────────────────────────────┐    │
    │   │  Nginx  (host-installed) — application-routing tier     │    │
    │   │   · No TLS (terminated at the DMZ)                      │    │
    │   │   · `set_real_ip_from 172.16.177.50` for accurate logs  │    │
    │   │   · Long cache /assets/*, short on /sw.js               │    │
    │   │   · proxy_buffering off → streams SSR + SSE             │    │
    │   │   · X-Correlation-Id forwarding                         │    │
    │   │   · Reverse-proxies to 127.0.0.1:3000                   │    │
    │   └───────────────────────────┬─────────────────────────────┘    │
    │                               │ HTTP (loopback)                  │
    │                               ▼                                  │
    │   ┌─────────────────────────────────────────────────────────┐    │
    │   │  Docker container:  greenbook                           │    │
    │   │   · Node 22 (alpine), uid 1000 (node), read-only FS     │    │
    │   │   · Express (server.js) → React Router 7 SSR            │    │
    │   │   · `trust proxy 2` (DMZ → App nginx → Express)         │    │
    │   │   · Pino JSON logs to stdout                            │    │
    │   │   · Correlation ID middleware (AsyncLocalStorage)       │    │
    │   │   · Rate limiter (general / mutation / auth tiers)      │    │
    │   │   · In-process Postgres job queue (5 s tick)            │    │
    │   │   · Sentry (server SDK) — optional via SENTRY_DSN       │    │
    │   │   · Listens on 0.0.0.0:3000 inside the container;       │    │
    │   │     published as 127.0.0.1:3000 on the host             │    │
    │   │   · init: dumb-init PID 1 for proper SIGTERM handling   │    │
    │   └───────────────────────────┬─────────────────────────────┘    │
    └───────────────────────────────┼──────────────────────────────────┘
                                    │ 5432/tcp (PostgreSQL protocol)
                                    │ scram-sha-256 auth
                                    │ @prisma/adapter-pg driver
                                    ▼
    ┌──────────────────────────────────────────────────────────────────┐
    │           DB VM   auishqosrgbdbs01   (10.111.11.50)              │
    │           Private — pg_hba pinned to APP VM /32 only             │
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

> **ℹ Migrating from a legacy single-tier App VM?**
>
> Earlier versions of this guide documented a two-VM single-tier shape (App VM nginx terminating TLS directly, no DMZ). The current docs assume three-VM with a DMZ tier. If your existing deployment was built single-tier, [06 §6.6](06-app-vm-nginx-tls.md#66-migrating-a-legacy-single-tier-app-vm) covers the conversion (drop TLS from App VM, source-pin UFW, bump TRUSTED_PROXIES, remove the cert) — run it AFTER [chapter 12](12-dmz-reverse-proxy.md) is up and the DMZ is verified serving end-to-end.

### 2.2 Why this split of responsibilities

**Three tiers, three concerns.** The DMZ owns "what the public internet sees" — TLS certificates, security headers, edge rate limiting, and per-host routing across multiple AU apps that may share the same wildcard domain. The App VM owns "the application" — Node, Docker, app-specific cache headers (`/sw.js`, `/assets/*`), SSR streaming, and the in-process job queue. The DB VM owns "the data" — PostgreSQL, pgBackRest repository, and the WAL archive. Each VM can be restarted, upgraded, or replaced without disturbing the others.

**Why a separate DMZ.** TLS terminator + multi-tenant edge proxy belongs at the network boundary, not on every backend VM. With the DMZ in place: the AU wildcard cert lives in exactly one place (renewals are one-VM operations); future AU apps onboard behind the same proxy with three commands (no second cert, no second TLS config); the App VM is a private host on the LAN with no public exposure (its UFW pins port 80 to the DMZ source IP only). The trade-off is one more VM to maintain, which is real but small.

**Why native Postgres on its own VM.** Running Postgres in a container saves nothing operationally and adds a layer to debug (volume drivers, container restarts, log routing). Native Postgres is simpler to back up (pgBackRest reads the data directory directly), has predictable I/O and memory, and decouples its lifecycle from the app entirely. The App VM stays stateless, which is what makes zero-downtime deploys and rollbacks easy.

**Why nginx on the host (both tiers).** Containerising nginx adds operational complexity (cert mounts, reload semantics, network_mode contortions) without operational benefit. Host nginx survives container restarts, integrates trivially with Certbot / systemd / fail2ban, and lets you `tail` access logs without `docker exec`.

**Offsite backup is non-optional.** The local pgBackRest repository on the DB VM protects against Postgres corruption and human error, but not against the VM itself being lost (disk failure, ransomware, accidental deletion). Configure a second repository — see [03 §3.3](03-db-vm-backups.md).

### 2.3 Port map

```
                      Internet              DMZ (172.16.177.0/24)         Internal LAN (10.111.11.0/24)
                          │                          │                              │
                          ▼                          ▼                              ▼
   DMZ VM auishqosrarp01:    22 (SSH, admin only)   80, 443 (public)
   App VM auishqosrgbwbs01:  22 (SSH, admin only)                            80 (DMZ source IP only)
                                                                              3000 (loopback only)
   DB VM auishqosrgbdbs01:   22 (SSH, admin only)                            5432 (App VM IP only)
```

| VM     | Port | Protocol | Accessible from             | Purpose                                                              |
| ------ | ---- | -------- | --------------------------- | -------------------------------------------------------------------- |
| DMZ VM | 22   | TCP      | Admin subnet only           | SSH                                                                  |
| DMZ VM | 80   | TCP      | Public Internet             | HTTP → 301 to HTTPS                                                  |
| DMZ VM | 443  | TCP      | Public Internet             | HTTPS (TLS terminator — the public face)                             |
| App VM | 22   | TCP      | Admin subnet only           | SSH                                                                  |
| App VM | 80   | TCP      | DMZ VM (172.16.177.50) only | HTTP from edge proxy (UFW source-pinned, plus `allow/deny` in nginx) |
| App VM | 3000 | TCP      | Loopback only (127.0.0.1)   | Docker → Node container (never exposed off-host)                     |
| DB VM  | 22   | TCP      | Admin subnet only           | SSH                                                                  |
| DB VM  | 5432 | TCP      | App VM (10.111.11.51) only  | PostgreSQL client protocol — UFW + pg_hba both source-pinned         |

> **ℹ Single-tier alternative**
>
> If you're running the two-VM (no DMZ) shape, drop the DMZ VM rows; the App VM rows for ports 80 and 443 widen to "Public Internet" instead of "DMZ VM only", and the App VM nginx terminates TLS itself.

### 2.4 Traffic flow of a single request

1. A browser resolves `greenbook.africanunion.org` to the **DMZ VM's public IP** and opens a TLS connection to port 443.
2. **Nginx on the DMZ VM** terminates TLS using the AU wildcard cert (`/etc/ssl/au/wildcard.africanunion.org.{fullchain.pem,key}`), applies edge security headers (HSTS / X-Frame-Options / X-Content-Type-Options / Referrer-Policy), runs the request through the per-IP edge rate-limit zones (coarse `edge_general` for general traffic, strict `edge_auth` on `/login` / `/forgot-password` / `/api/auth` / `/api/sso`), looks up the right backend by `server_name`, and forwards the now-decrypted request to `http://10.111.11.51:80` with `X-Forwarded-For` / `X-Forwarded-Proto` / `X-Correlation-Id` chained.
3. The App VM's UFW lets the connection in only because the source IP is `172.16.177.50` (the DMZ VM); any other source is dropped.
4. **Nginx on the App VM** sees the request, uses `set_real_ip_from 172.16.177.50` so its access log and rate-limiter key on the real client IP (not the DMZ's), applies the App-VM-tier rate limits (`greenbook_general` 30 r/s and `greenbook_auth` 5 r/s — these stack with the edge tier), sets long-cache headers on `/assets/*` / short-cache on `/sw.js`, and forwards to `http://127.0.0.1:3000` with `proxy_buffering off` so streamed SSR responses and SSE connections pass through unbuffered.
5. Docker's port mapping delivers the request from `127.0.0.1:3000` into the `greenbook` container's `0.0.0.0:3000`.
6. **Express** (`server.js` + `server/app.ts`, with `app.set("trust proxy", 2)` so Express knows there are two trusted upstream proxies and `req.ip` resolves to the real client) runs middleware in order: correlation ID → request logger (pino JSON) → CORS → session extraction → rate limiter (general / mutation / auth tier by route) → React Router handler (`@react-router/express` + `createRequestHandler`).
7. Route loaders/actions that need data call `prisma.*` through `@prisma/adapter-pg`, which opens a pooled TCP connection to `10.111.11.50:5432`. PostgreSQL authenticates the `appuser` role via SCRAM-SHA-256 and returns rows.
8. Rendered HTML (for initial load) streams back through the same path — DMZ → App VM nginx → DMZ → client. React Router 7 is streaming-first, which is why `proxy_buffering off` is critical at _both_ nginx tiers. Subsequent navigations return serialised loader data; SSE routes (notifications, real-time updates) keep the connection open all the way through.
9. Side effects — audit log rows, webhook fan-outs, `send-email` jobs, domain events — are enqueued into the in-process job queue and picked up by the 5-second tick. On `SIGTERM` the job processor drains, the rate-limit audit buffer flushes, and Sentry flushes pending events.

---

## Document conventions

These apply across every file in this guide:

- **Numbered files (`01-…` through `12-…`)** are read in order for first-time bring-up. Each file is self-contained for its operator session.
- **Section numbers inside files** match the file's two-digit prefix — chapter `0N` owns `§N.x`, chapter `1N` owns `§1N.x`. Cross-file links use the `[file.md#section-anchor]` convention with the file name as the disambiguator.
- **`[auishqosrgbwbs01]`, `[auishqosrgbdbs01]`, and `[auishqosrarp01]`** prefixes on commands indicate which VM to run them on (App VM, DB VM, DMZ VM respectively). Unlabelled commands are generic.
- **`⚠`** callouts mark things that will silently break a deployment if ignored. Read them.
- **`ℹ`** callouts add context, alternatives, or "if you ever need to do X, here's how" notes.
- **`✓`** callouts are checkpoints you should be at before continuing.
