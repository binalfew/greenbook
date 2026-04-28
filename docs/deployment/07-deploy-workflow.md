# 07 — Deploy workflow

> **Phase**: bring-up + every deploy · **Run on**: App VM + (for Path B) build host · **Time**: ~45 min first time, ~5 min subsequent
>
> **Initial app VM setup (one-time)**: `/etc/greenbook.env`, `/opt/greenbook/docker-compose.yml`, directory layout — §8.2.
>
> **Deploy cycle (every deploy)**: two paths to get an image onto the VM (build-on-VM vs build-elsewhere-and-ship), the `prisma db push` vs `prisma migrate` schema decision, env-file lifecycle, the promote step, rollback, systemd autostart, the annotated `deploy.sh`, and the one-time first-run seed — §8.3 onward.
>
> **Prev**: [06 — Nginx and TLS](06-app-vm-nginx-tls.md) · **Next**: [08 — Day-2 operations](08-day-2-operations.md) · **Index**: [README](README.md)

---

## Contents

- [§8.1 App VM directory layout](#81-app-vm-directory-layout)
- [§8.2 Initial app VM setup (one-time)](#82-initial-app-vm-setup-one-time)
  - [§8.2.1 Create the deploy directory structure](#821-create-the-deploy-directory-structure)
  - [§8.2.2 The environment file: /etc/greenbook.env](#822-the-environment-file-etcgreenbookenv)
  - [§8.2.3 The compose file: /opt/greenbook/docker-compose.yml](#823-the-compose-file-optgreenbookdocker-composeyml)
- [§8.3 Deploy: build the image and stage it on the app VM](#83-deploy-build-the-image-and-stage-it-on-the-app-vm)
  - [§8.3.1 Apply schema changes — the greenbook reality check](#831-apply-schema-changes--the-greenbook-reality-check)
  - [§8.3.2 Env file lifecycle across deploys](#832-env-file-lifecycle-across-deploys)
  - [§8.3.3 Promote the new image](#833-promote-the-new-image)
  - [§8.3.4 Post-deploy verification — what should be true now](#834-post-deploy-verification--what-should-be-true-now)
- [§8.4 Rollback](#84-rollback)
- [§8.5 Autostart on boot (systemd)](#85-autostart-on-boot-systemd)
- [§8.6 Annotated deploy.sh](#86-annotated-deploysh)
- [§8.7 First-run bootstrap (one-time)](#87-first-run-bootstrap-one-time)

## 8. Deploy workflow

The goal of this workflow is that any deploy (including rollback) is: one command, fast, atomic-ish (clients either see the old version or the new one, not a broken one), and reversible without rebuilding.

### 8.1 App VM directory layout

```
/opt/greenbook/
├── docker-compose.yml        # one-time setup, see §8.2.3
├── .env                      # written by deploy.sh; pins APP_VERSION
├── releases/
│   ├── 2026-04-23-1430/      # git clone of the source, named by timestamp
│   ├── 2026-04-22-0930/
│   └── ...
└── deploy.sh                 # the deploy script (§8.6)
```

### 8.2 Initial app VM setup (one-time)

Three host-side files have to exist on the app VM before any deploy can succeed. These are configured ONCE per VM (or after a fresh provision); subsequent deploys read them but don't touch them. If you're past initial bring-up, skim and skip ahead to §8.3.

| Step   | What                                                             | Where             |
| ------ | ---------------------------------------------------------------- | ----------------- |
| §8.2.1 | Create `/opt/greenbook/` with the right ownership                | App VM filesystem |
| §8.2.2 | Write `/etc/greenbook.env` with all required + optional env vars | App VM filesystem |
| §8.2.3 | Place `/opt/greenbook/docker-compose.yml`                        | App VM filesystem |

When all three are done, you're ready for §8.3 (the first deploy).

#### 8.2.1 Create the deploy directory structure

[01 §3.8](01-pre-flight.md) already created `/opt/greenbook/` with `deployer:deployer` ownership. The release-directory subtree is the only thing left:

```bash
# [auishqosrgbwbs01] as deployer
$ mkdir -p /opt/greenbook/releases
#   Each deploy lands under releases/<timestamp>/. /opt/greenbook holds the
#   compose file, .env (APP_VERSION pin), and deploy.sh.

$ ls -la /opt/greenbook/
# Expected: drwxr-xr-x deployer deployer ... releases
```

#### 8.2.2 The environment file: /etc/greenbook.env

Runtime secrets live outside the image and outside the repository. Store them in `/etc/greenbook.env` on the host, readable only by root and the deployer group.

Greenbook's env validation (`app/utils/config/env.server.ts`) uses Zod to enforce the required set at boot; if any required var is missing, the server throws "Invalid environment variables" and does not start. Optional vars are listed below with their defaults and where they're consumed.

##### Required

| Variable          | Consumer                                                                                                                                                                                                         | Notes                                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`        | everywhere                                                                                                                                                                                                       | Must be `production` in prod. Flips pino transport, Express error pages, and react-router defaults.                                                                                        |
| `DATABASE_URL`    | `app/utils/db/db.server.ts` (via `@prisma/adapter-pg`); `prisma.config.ts`                                                                                                                                       | Standard postgres:// URL. URL-encode special chars in password.                                                                                                                            |
| `SESSION_SECRET`  | `app/utils/auth/session.server.ts`, `app/utils/auth/csrf.server.ts`, `app/utils/auth/verification.server.ts`, `app/utils/auth/sso-state.server.ts`, `app/utils/toast.server.ts`, `app/utils/auth/auth.server.ts` | **Comma-separated list** (`new,old`) — greenbook signs with the first secret and verifies against all of them, so you can rotate without invalidating live sessions. See "Rotation" below. |
| `HONEYPOT_SECRET` | `app/utils/auth/honeypot.server.ts`                                                                                                                                                                              | Used as the encryption seed for the honeypot anti-bot form field. Independent from SESSION_SECRET by design.                                                                               |
| `RESEND_API_KEY`  | `app/utils/email/email.server.ts`                                                                                                                                                                                | Auth token for the Resend transactional email API. Verification emails, password resets, DSAR exports, tenant invites all flow through this.                                               |

##### Optional (operational knobs)

| Variable                    | Default                 | Consumer                               | Notes                                                                                                                                                                    |
| --------------------------- | ----------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                      | `3000`                  | `server.js`                            | Only change if you also change the compose publish line + nginx upstream.                                                                                                |
| `APP_URL`                   | `http://localhost:5173` | `app/utils/config/env.server.ts`       | **Must** match the HTTPS URL nginx serves. Used to construct OIDC/SAML callback URLs and transactional-email links. Getting this wrong silently breaks SSO.              |
| `APP_NAME`                  | `app`                   | `server/logger.js`                     | Appears as `service` in every pino log line + as a Sentry tag. Set to something identifying (`greenbook-prod`).                                                          |
| `APP_VERSION`               | `dev`                   | `server/logger.js`, `server/sentry.js` | Appears as `version` in pino + as the Sentry `release`. The deploy script in §8.6 sets it to the release timestamp automatically.                                        |
| `LOG_LEVEL`                 | `info`                  | `server/logger.js`                     | One of `fatal`, `error`, `warn`, `info`, `debug`, `trace`. Lower the threshold only temporarily during debugging — `debug`/`trace` are very chatty.                      |
| `SENTRY_DSN`                | _(unset)_               | `server/sentry.js`, `app/root.tsx`     | Leave empty to disable error tracking. If set, also exposed to the browser bundle via `getEnv()`.                                                                        |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1`                   | `server/sentry.js`                     | Fraction (0.0–1.0) of transactions sampled. Keep low in prod.                                                                                                            |
| `CORS_ORIGINS`              | `http://localhost:3000` | `server/security.ts`                   | Comma-separated allowlist. **Set this to the public HTTPS origin** (e.g. `https://greenbook.africanunion.org`) or cookie-authed API calls from the PWA will be rejected. |
| `RATE_LIMIT_WINDOW_MS`      | `900000` (15 min)       | `server/security.ts`                   | Window for the general rate limiter.                                                                                                                                     |
| `RATE_LIMIT_MAX_REQUESTS`   | `300`                   | `server/security.ts`                   | Per-user (authenticated) or per-IP limit in the window.                                                                                                                  |

> **ℹ The legacy `MICROSOFT_*` variables in `.env.example`**
>
> Greenbook's `.env.example` still lists `MICROSOFT_CLIENT_ID` / `_SECRET` / `_TENANT_ID` / `_REDIRECT_URI`. Per the file's comment block, these are carried over from the pre-template implementation — **the current code does not read them**. SSO is configured per-tenant in the DB (`SSOConfiguration` table) via the admin UI at `/$tenant/settings/security/sso`. Do not wire them into `/etc/greenbook.env` unless you are re-enabling the legacy org-chart sync.

##### Generate the secrets first

Three secrets are needed before you can write `/etc/greenbook.env`. Generate each one **on the app VM** so it never lives on your laptop or in shell history elsewhere. Print them once, copy each into the env file in the next step, and don't share them anywhere else.

```bash
# [auishqosrgbwbs01] — generate all three at once and print

$ echo "── SESSION_SECRET (cookie signing, 48 bytes / 64 base64 chars) ──"
$ openssl rand -base64 48
#   openssl rand    cryptographically secure random bytes (uses the kernel CSPRNG).
#   -base64         emit base64-encoded — safe for env files / connection strings.
#   48              raw byte count BEFORE base64 expansion. Base64 expands 3 bytes
#                    into 4 characters, so 48 bytes → 64 characters.
# Why 48 bytes? @epic-web/totp + the cookie session library accept anything ≥ 32
# bytes; 48 gives you 384 bits of entropy with headroom for rotation (you can
# concatenate two of these as a comma-separated list — see "rotation" below).

$ echo ""
$ echo "── HONEYPOT_SECRET (honeypot encryption seed, 32 bytes / 44 base64 chars) ──"
$ openssl rand -base64 32
# 32 bytes / 256 bits — matches the seed-length expectation of @nichtsam/helmet's
# honeypot field encryption. Independent from SESSION_SECRET by design (different
# subsystem, different rotation cadence).

$ echo ""
$ echo "── DB password (postgres role, 32 bytes / 44 base64 chars) ──"
$ openssl rand -base64 32
# Use this for the `appuser` Postgres role created in 02 §4.3 — if you didn't
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
> ```bash
> $ openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
> ```
>
> `tr '+/' '-_'` swaps the URL-unsafe characters for URL-safe equivalents (RFC 4648 base64url alphabet). `tr -d '='` strips the trailing padding that some libraries don't expect. The resulting string still has 256 bits of entropy and drops straight into the connection URL with no escaping.

> **⚠ Don't reuse a secret across environments**
>
> Generate fresh values for each environment (dev / staging / prod). Sharing a `SESSION_SECRET` between environments means a session cookie minted in dev would validate against prod, defeating environment isolation. The local-dev `.env` placeholder (`change-me-in-production`) is fine for dev because it's documented as a placeholder; production must always be a freshly-generated random.

##### Now write the file

```bash
# [auishqosrgbwbs01] — run as a user with sudo
$ sudo tee /etc/greenbook.env <<'EOF'
# ─── Required ────────────────────────────────────────────
NODE_ENV=production
PORT=3000

# Postgres connection string. Replace STRONG_PASSWORD_HERE with the value
# you generated above. URL-encode the password if it contains reserved
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
APP_URL=https://greenbook.africanunion.org
APP_NAME=greenbook-prod
# APP_VERSION is written by deploy.sh — leave blank here.

# ─── Logging / observability ────────────────────────────
LOG_LEVEL=info

# Leave SENTRY_DSN empty to disable error tracking.
SENTRY_DSN=
SENTRY_TRACES_SAMPLE_RATE=0.1

# ─── CORS + rate limiting ───────────────────────────────
# CRITICAL: set CORS_ORIGINS to the exact public origin (no trailing slash).
CORS_ORIGINS=https://greenbook.africanunion.org

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=300
EOF

$ sudo chown root:deployer /etc/greenbook.env
#   Ownership: root (can write), deployer (can read). Regular users cannot.

$ sudo chmod 640 /etc/greenbook.env
#   640 = rw for owner (root), r for group (deployer), nothing for others.
#         The deployer user can read it (needed to run compose); others cannot.

$ ls -l /etc/greenbook.env
# Expected: -rw-r----- 1 root deployer
```

##### SESSION_SECRET rotation (zero-downtime)

Greenbook parses `SESSION_SECRET` as a comma-separated list and treats the first entry as the active signing key. Other entries validate existing cookies. This lets you rotate without logging everyone out:

1. Generate a new secret: `openssl rand -base64 48`
2. Prepend it: `SESSION_SECRET=<new>,<current>` in `/etc/greenbook.env`
3. Re-create the container: `docker compose -f /opt/greenbook/docker-compose.yml up -d --force-recreate`
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

#### 8.2.3 The compose file: /opt/greenbook/docker-compose.yml

This is a separate compose file for production (do **not** reuse the repo root `docker-compose.yml`, which is tuned for local Postgres dev on ports 5432/5433). The canonical source is shipped as a standalone file in [appendix/docker-compose.yml](appendix/docker-compose.yml) — copy it to the app VM with:

```bash
# From your laptop, with this repo cloned:
$ scp docs/deployment/appendix/docker-compose.yml \
      deployer@10.111.11.51:/opt/greenbook/docker-compose.yml
```

The full annotated content (also in the appendix file):

```yaml
# /opt/greenbook/docker-compose.yml
# Compose V2 format. Do not include a top-level 'version:' key — it is
# ignored by Compose V2 and triggers a deprecation warning.

services:
  app:
    image: greenbook:${APP_VERSION:-latest}
    # ${VAR:-DEFAULT}    substitute VAR if set, otherwise DEFAULT.
    # ${APP_VERSION}     set via /opt/greenbook/.env (deploy.sh writes it).
    #                     "latest" is a safety fallback — normally the .env
    #                     file pins the exact dated tag.

    container_name: greenbook
    # Fixed container name so operations commands (logs, exec) don't need
    # to discover the ID. Means only one instance can run at a time — fine
    # for a single-VM deployment.

    restart: unless-stopped
    # Automatically restart the container if it exits, UNLESS a human
    # explicitly ran "docker compose stop". Survives VM reboots.

    init: true
    # Belt-and-braces with the dumb-init ENTRYPOINT in 05 §6.1. Compose's
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
    # commit to git. See §8.2.2 for the full env matrix.

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
      test:
        [
          "CMD-SHELL",
          'node -e "fetch(''http://127.0.0.1:3000/healthz'').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" || exit 1',
        ]
      # Runs INSIDE the container. The node:22-alpine image doesn't ship
      # curl, so we use Node itself (global fetch is available since v18).
      # Node exits 0 on healthy, 1 on unhealthy; Docker reads the exit code
      # to set the "healthy" / "unhealthy" state.
      #
      # REQUIRES greenbook to expose GET /healthz returning 200. The
      # `/healthz` and `/up` paths are already marked "skip rate-limit" in
      # server/security.ts, but no route handler exists yet. 05 §6.3 includes
      # a drop-in resource route that you MUST add before rolling this
      # compose file — otherwise the healthcheck will permanently fail
      # and the container will be marked unhealthy.
      interval: 30s # time between checks after the container is running
      timeout: 5s # fail a check that takes longer than this
      retries: 3 # consecutive failures before marking unhealthy
      start_period:
        45s # grace window after start — greenbook does a Prisma
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

> **✓ Checkpoint: app VM is ready for first deploy**
>
> After §8.2.1–8.2.3 you should have:
>
> ```bash
> $ ls -la /opt/greenbook/
> # Expected: -rw-r--r-- deployer deployer ... docker-compose.yml
> #           drwxr-xr-x deployer deployer ... releases
> $ ls -l /etc/greenbook.env
> # Expected: -rw-r----- 1 root deployer
> ```
>
> If both pass, move on to §8.3.

### 8.3 Deploy: build the image and stage it on the app VM

Greenbook can be deployed two ways. Pick the one that matches your network reality — they differ only in **where the image is built**; everything from §8.3.1 onward (schema, env, compose-up, healthcheck) is identical.

#### First-time deploy — the linear walkthrough

If this is your first deploy and you don't want to bounce between Path A/B, schema, env, promote, and seed sections to figure out the order, use this single-sequence walkthrough. It assumes you've completed [01–06](README.md) and the DB is empty.

```bash
# ────────────────────────────────────────────────────────────────
# STEP 1. On the app VM as deployer — pick a version tag.
# ────────────────────────────────────────────────────────────────
$ ssh deployer@10.111.11.51
$ VERSION=$(date -u +%Y-%m-%d-%H%M)
$ echo "Building greenbook:$VERSION"

# ────────────────────────────────────────────────────────────────
# STEP 2. Get the image onto the VM. Choose A or B based on
#         whether `curl https://github.com/` works on this VM.
# ────────────────────────────────────────────────────────────────

# (Path A — open egress)
$ cd /opt/greenbook/releases
$ git clone --depth 1 --branch main git@github.com:binalfew/greenbook.git $VERSION
# sudo git clone --depth 1 --branch main https://github.com/binalfew/greenbook.git $VERSION
$ cd $VERSION
$ docker build -t greenbook:$VERSION .

# (Path B — restricted egress: build on your laptop, then on the VM:)
# $ scp greenbook-$VERSION.tar.gz deployer@10.111.11.51:/tmp/
# $ ssh deployer@10.111.11.51
# $ gunzip -c /tmp/greenbook-$VERSION.tar.gz | docker load
# $ rm /tmp/greenbook-$VERSION.tar.gz

# Either way, after this step:
$ docker image ls greenbook:$VERSION
# Expected: one row, ~700-900 MB.

# ────────────────────────────────────────────────────────────────
# STEP 3. Apply the schema (db push for greenbook today).
# ────────────────────────────────────────────────────────────────
$ docker run --rm \
    --env-file /etc/greenbook.env \
    greenbook:$VERSION \
    npx prisma db push
# Expected: "The database is already in sync with the Prisma schema." (re-deploy)
#       or  "🚀  Your database is now in sync with your schema." (first time)
#
# Prisma 7 note: `--skip-generate` was removed in Prisma 7 — it's now
# the default behaviour for `db push` (no auto-generate). Don't add it.

# ────────────────────────────────────────────────────────────────
# STEP 4. Seed the DB (FIRST DEPLOY ONLY — skip on re-deploys).
# ────────────────────────────────────────────────────────────────
$ docker run --rm \
    --env-file /etc/greenbook.env \
    greenbook:$VERSION \
    npx tsx prisma/seed.ts
# Expected runtime: 5-30s. Creates roles, permissions, feature flags,
# the system tenant, and demo AUC leadership data.

# ────────────────────────────────────────────────────────────────
# STEP 5. Pin the version compose will use.
# ────────────────────────────────────────────────────────────────
$ echo "APP_VERSION=$VERSION" > /opt/greenbook/.env

# ────────────────────────────────────────────────────────────────
# STEP 6. Bring the container up.
# ────────────────────────────────────────────────────────────────
$ docker compose -f /opt/greenbook/docker-compose.yml up -d
$ docker compose -f /opt/greenbook/docker-compose.yml ps
# Expected: STATE=running. HEALTH starts as "starting" for ~45s, then "healthy".

# ────────────────────────────────────────────────────────────────
# STEP 7. Verify.
# ────────────────────────────────────────────────────────────────
$ curl -s http://127.0.0.1:3000/healthz | head -1
# Expected JSON: "status":"ok", "checks":{"process":"ok","db":"ok"},
# "version":"<your VERSION>"
$ curl -sI https://greenbook.africanunion.org/  | grep -E "HTTP|strict-transport"
# Expected: "HTTP/2 200" and an HSTS header.

# ────────────────────────────────────────────────────────────────
# STEP 8. Rotate the seeded demo passwords (FIRST DEPLOY ONLY).
# ────────────────────────────────────────────────────────────────
# Log into the admin UI as admin@africanunion.org / admin123,
# IMMEDIATELY change the admin password, then delete the three demo
# users (manager@, focal@, user@) before opening the URL to anyone
# else. See §8.7 for details.
```

That's it. From here on, re-deploys skip steps 4 and 8 — six commands instead of eight.

> **⚠ Don't skip step 4 on a fresh database**
>
> Greenbook's auth refuses every login until roles + permissions exist (no implicit "admin" role). Step 4 is the only thing that creates them. If you skip it, you can't log in to fix it — you'd have to seed manually via psql.

> **ℹ "Where do I get the env file from?" — STEP 0 if you haven't already**
>
> Steps 3, 4, and 6 all rely on `/etc/greenbook.env` existing on the VM. If you didn't create it during [05 — Application container §6.3](05-app-vm-container.md), do that BEFORE step 1: it's a 5-minute openssl + tee sequence.

The remaining sections in §8 (Path A/B detailed walk-throughs, schema-deploy variants, env-file model, deploy.sh, rollback) are the reference material that step 1–8 above abstracts over. Read on if you want to know WHY each step exists.

> **ℹ Which path should I use?**
>
> **Path A — Build on the VM** is simplest when the app VM has open outbound internet (or a working HTTPS proxy that reaches `github.com`, `registry.npmjs.org`, and `registry-1.docker.io`). The VM clones the repo, runs `docker build`, and the new image lands directly in the local Docker image store.
>
> **Path B — Build elsewhere, ship the image (recommended for AU intranet)** is what you need when the app VM is restricted-egress (typical for AU production VMs). The image is built on a host that DOES have internet — your laptop, a CI runner, or an internal build server — then transferred as a tarball over SSH and loaded into Docker on the app VM. The app VM only needs `docker load`, no git, no npm, no Docker Hub access.
>
> A quick test on the app VM tells you which path applies:
>
> ```bash
> # [auishqosrgbwbs01] as deployer
> $ curl -fsS --connect-timeout 10 https://github.com/ -o /dev/null && echo "Path A works"
> $ docker pull --quiet hello-world  >/dev/null 2>&1 && echo "Docker Hub reachable"
> ```
>
> If both lines print success, Path A is open. If either fails, use Path B.

> **⚠ Recognising Path A failure on a restricted-egress VM**
>
> If you skipped the test above and ran `docker build` directly, here are the exact failure modes you'll see — every one means outbound HTTPS to the named endpoint is blocked. **None of them are Dockerfile bugs**; don't waste time editing the Dockerfile. Switch to Path B.
>
> | Build step                        | Endpoint that times out                                     | Error pattern                                                                                                                                                                                  |
> | --------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | BuildKit frontend pull            | `production.cloudfront.docker.com`                          | `ERROR resolve image config for docker-image://docker.io/docker/dockerfile:1.7 ... DeadlineExceeded ... Get "https://production.cloudfront.docker.com/...": dial tcp X.X.X.X:443: i/o timeout` |
> | Base image pull (`FROM ...`)      | `registry-1.docker.io` / `production.cloudfront.docker.com` | `ERROR [internal] load metadata for docker.io/library/node:22-alpine ... i/o timeout`                                                                                                          |
> | `git clone` (in the Path A flow)  | `github.com:22` (ssh) or `github.com:443` (https)           | `ssh: connect to host github.com port 22: Connection timed out` / `Could not resolve host: github.com`                                                                                         |
> | `npm ci` (during the build stage) | `registry.npmjs.org`                                        | `npm error code ETIMEDOUT ... npm error errno ETIMEDOUT ... npm error network request to https://registry.npmjs.org/...`                                                                       |
>
> Path B (build on your laptop, ship the tarball, `docker load` on the VM) sidesteps all four — the VM only needs to run `docker load`, with no outbound HTTPS to GitHub, npm, or Docker Hub. **For AU production VMs, treat Path B as the default; only use Path A on a fork where the test above passes.**

#### Path A — Build on the VM (open-egress, simplest)

All commands as the `deployer` user.

```bash
# [auishqosrgbwbs01] as deployer
$ VERSION=$(date -u +%Y-%m-%d-%H%M)
#   VERSION=VALUE    shell variable (not exported).
#   $(CMD)           command substitution — captures stdout of CMD.
#   date -u +...     UTC timestamp. Use UTC so versions sort consistently
#                    regardless of the build host's timezone.
# Timestamp-based versions are monotonic, no duplicates, easy to sort.

$ cd /opt/greenbook/releases
$ git clone --depth 1 --branch main git@github.com:binalfew/greenbook.git $VERSION
#   git clone URL DIR      clone URL into a new directory DIR.
#   --depth 1              shallow clone — download only the latest commit,
#                          not the full history. Much faster for deploys.
#   --branch main          clone from the named branch (works for tags too).
# Assumes your SSH key is authorised on the git server and loaded in the
# local ssh-agent. Can also use an HTTPS URL with a deploy token.

$ cd $VERSION

$ docker build -t greenbook:$VERSION .
#   docker build    build an image from this directory's Dockerfile.
#   -t NAME:TAG     name the image. Version stays permanent; rollback
#                    works by pointing compose at an older tag.
#   .               build context — this dir.
# Runtime depends on cache state: cold build ~90-180 s, warm ~10-30 s.

$ docker tag greenbook:$VERSION greenbook:latest
# Optional: also tag as "latest". Useful as a safety default for compose
# when .env is missing. Not used by the deploy flow itself.
```

The image is now in the local Docker store. Continue at §8.3.1 (schema changes) below.

#### Path B — Build elsewhere, ship the image (restricted-egress)

The app VM ends up with: a loaded image, ready to `docker compose up`. It never sees the source code, npm, or git. Three machines are involved:

```
[your laptop / build host]              [app VM, no internet]
   ├─ git clone greenbook                docker load < image.tar.gz
   ├─ docker build                       docker compose up -d
   ├─ docker save | gzip
   └─ scp to app VM ──────────────────────►
```

**Step B1 — On your laptop (or build host)** — anywhere with internet, Docker, and your GitHub SSH key:

```bash
# Pick a stable artefacts directory outside the repo
$ mkdir -p ~/greenbook-builds && cd ~/greenbook-builds

# Fresh shallow clone at the ref you're shipping
$ rm -rf src
$ git clone --depth 1 --branch main git@github.com:binalfew/greenbook.git src
$ cd src

# Tag the build (UTC for consistent sort across machines/timezones)
$ VERSION=$(date -u +%Y-%m-%d-%H%M)
$ echo "Building greenbook:$VERSION"
```

**Step B2 — Build for the VM's architecture.** The greenbook VMs are x86_64 (amd64). If your laptop is also x86_64, plain `docker build` works. If you're on Apple Silicon (arm64), use `buildx` with `--platform linux/amd64` to cross-build, or you'll get "exec format error" on the VM:

```bash
# Check your local arch:
$ uname -m
#   x86_64  → use plain `docker build`
#   arm64   → use buildx with the platform flag (slower, ~3-5x via emulation)

# x86_64 host:
$ docker build -t greenbook:$VERSION .

# Apple Silicon (arm64) host:
$ docker buildx build --platform linux/amd64 -t greenbook:$VERSION --load .
#   --platform linux/amd64    target architecture
#   --load                    drop the result into the local docker store
#                              (default buildx behaviour pushes to a registry)
```

**Step B3 — Verify the image before shipping.** A 30-second sanity check on your laptop catches most "the build looked fine but the image is broken" failures:

```bash
# Image exists and has reasonable size:
$ docker image ls greenbook:$VERSION
# Expected: ~700-900 MB. Anything under 200 MB means COPY paths
# in the Dockerfile didn't pick up server.js / build / node_modules.

# Critical files are present in the runtime image:
$ docker run --rm --entrypoint sh greenbook:$VERSION -c \
  'ls /app/server.js /app/server/app.ts /app/build/server/index.js /app/app/generated/prisma/client.js'
# All four must exist; any "No such file" means the runtime stage
# is missing a COPY.

# Container starts as the node user (uid 1000), not root:
$ docker run --rm --entrypoint id greenbook:$VERSION
# Expected: uid=1000(node) gid=1000(node) groups=1000(node)
```

**Step B4 — Save and compress the image:**

```bash
$ cd ..
$ docker save greenbook:$VERSION | gzip > greenbook-$VERSION.tar.gz
$ ls -lh greenbook-$VERSION.tar.gz
# Expected: ~250-400 MB compressed. The raw save is ~700-900 MB; gzip
# typically gets it to a third of that.
```

**Step B5 — Ship to the app VM:**

```bash
$ scp greenbook-$VERSION.tar.gz deployer@10.111.11.51:/tmp/
# Transfer time is bounded by your VPN bandwidth. ~250 MB over a 50 Mbps
# link = ~40 s; over a 5 Mbps link = ~7 minutes. Plan accordingly.
```

**Step B6 — On the app VM (deployer):**

```bash
# [auishqosrgbwbs01] as deployer
$ VERSION=2026-04-25-1030    # match what you set in step B1

# Load the image into the local Docker store:
$ gunzip -c /tmp/greenbook-$VERSION.tar.gz | docker load
# Expected: "Loaded image: greenbook:<VERSION>"
# Runtime: 10-30 s depending on disk speed; this is the slowest step.

# Verify the image is registered locally and tagged correctly:
$ docker image ls greenbook
# Should show greenbook:<VERSION> with size ~700-900 MB.
# Note the IMAGE ID — useful if compose ever caches a stale layer.

# Optional: also tag as latest for the compose default:
$ docker tag greenbook:$VERSION greenbook:latest

# Clean up the tarball — it's redundant now:
$ rm /tmp/greenbook-$VERSION.tar.gz
```

The image is now in the local Docker store. Continue at §8.3.1 (schema changes) below — exactly the same as Path A from this point on.

> **⚠ Don't fight the version skew**
>
> If you build on your laptop with `VERSION=2026-04-25-1030` and the app VM was last deployed at `VERSION=2026-04-23-1430`, the on-VM Docker image store still has the old image. Both will appear in `docker image ls greenbook`. That's fine and intentional — see §8.4 (rollback). Just make sure `/opt/greenbook/.env` (which §8.3.3 writes) points at the version you actually want compose to use.

> **ℹ When Path B becomes painful — switch to a private registry**
>
> The save → scp → load loop works perfectly for the first ~5 deploys. Past that, it gets old: every deploy ships a 250 MB tarball over your VPN, and the build host (laptop) has to be online when you want to deploy. Once you're doing more than one deploy a week, stand up a private container registry the app VM CAN reach (Harbor, GitLab CR, AWS ECR, plain `registry:2` on a build host inside `10.111.11.0/24`). Path B then collapses to:
>
> ```
> # Build host: docker push registry.africanunion.org/greenbook:$VERSION
> # App VM:     docker pull registry.africanunion.org/greenbook:$VERSION
> ```
>
> No tarballs, no scp. Defer this to post-MVP — don't hold up first production deploy on registry standup.

### 8.3.1 Apply schema changes — the greenbook reality check

Greenbook currently uses **`prisma db push`** as its schema workflow — no `prisma/migrations/` directory exists at this commit, and `npm run db:push` is the canonical way to get the schema into a new database. The deployment guide therefore ships TWO paths; pick the one that matches your current operational maturity.

> **ℹ Which path should I use?**
>
> `prisma db push` is great for template-phase development (where the schema is still shifting). It syncs the declared schema to the DB by running `CREATE`/`ALTER` statements directly, no migration history. Trade-off: no versioned, reviewable changeset; `db push` **will drop data if it sees data loss as inevitable** unless you pass `--accept-data-loss` (or approve interactively — which isn't possible in a non-TTY deploy).
>
> `prisma migrate` is the right tool once the schema stabilises. It generates versioned SQL in `prisma/migrations/`, records each application in a `_prisma_migrations` table, and refuses to run a migration that would lose data. This is the standard for long-lived production databases.
>
> The CLAUDE.md explicitly says: "Apps adopting the template should generate their own migration baseline (`npx prisma migrate dev --create-only --name init`) when they're ready to lock down schema changes." **Plan the cutover.**

**Path A — `prisma db push` (current greenbook default)**

```bash
# [auishqosrgbwbs01] as deployer — still in $VERSION directory
$ docker run --rm \
  --env-file /etc/greenbook.env \
  greenbook:$VERSION \
  npx prisma db push
#   docker run IMAGE CMD          run a new container for IMAGE, execute CMD.
#   --rm                           delete the container when CMD finishes.
#   --env-file /etc/greenbook.env  load env vars (DATABASE_URL, etc.) from file.
#                                   Same file used by the main compose service.
#   npx prisma db push             sync prisma/schema.prisma to the DB.
#                                   (Prisma 7 dropped `--skip-generate`;
#                                    not auto-generating is now the default.)
#
# Network note: we do NOT pass --network host. The default Docker bridge
# network is sufficient. When the container opens a TCP connection to
# 10.111.11.50:5432, Docker's iptables MASQUERADE rule rewrites the source
# IP to the host's main interface IP (10.111.11.51). From Postgres's view,
# the connection comes from 10.111.11.51 — which matches the pg_hba rule
# we set up in §4.5.
```

> **⚠ `db push` can drop data under your feet**
>
> If a schema change is detected as data-destructive (dropped column, narrowed column type, removed table), `prisma db push` refuses in an interactive terminal and REFUSES AND EXITS in a non-TTY deploy like this one. It will NOT silently drop data. If it refuses, you have three choices:
>
> 1. Generate a migration baseline NOW and move to path B.
> 2. Back-port the change into code so the old shape is preserved (recommended).
> 3. Pass `--accept-data-loss` — only for development / test DBs, NEVER for production with real rows.

**Path B — `prisma migrate deploy` (once you have a migrations dir)**

```bash
# [auishqosrgbwbs01] as deployer
$ docker run --rm \
  --env-file /etc/greenbook.env \
  greenbook:$VERSION \
  npx prisma migrate deploy
# Applies every unapplied migration in prisma/migrations/ in order.
# Idempotent (skips migrations already recorded in _prisma_migrations).
# Exits non-zero if any migration fails — set -e in deploy.sh aborts here.
```

> **⚠ Backward-compatible migrations only**
>
> Between the migration finishing and the new container starting, the OLD container is still serving traffic against the NEW schema. Always write migrations that the old code can tolerate. Add columns as nullable, then deploy code that writes to them, then backfill, then tighten the constraint in a later migration. Do NOT drop columns or rename them in a single step while the old code is still running — use the "expand → migrate code → contract" pattern.

### 8.3.2 Env file lifecycle across deploys

§8.2.2 covered the **initial setup** of `/etc/greenbook.env`. This subsection covers the **ongoing operations** — what happens during a re-deploy when env vars change, how the two env files relate, and the gotchas to watch for.

#### The two-file model (recap)

Greenbook's deploy uses **two env files for two different jobs**. Confusing them is the source of most "why isn't the new env var taking effect?" debug sessions.

| File            | Lives at              | Purpose                                                                              | Who writes it                                                       | Who reads it                                                                   |
| --------------- | --------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Runtime env** | `/etc/greenbook.env`  | The application's config: DB URL, secrets, log level, CORS origins, Sentry DSN, etc. | You — manually, root-owned, deployer-readable (`640 root:deployer`) | The container at runtime, via compose's `env_file:`                            |
| **Compose env** | `/opt/greenbook/.env` | The `${APP_VERSION}` substitution that picks which image tag compose uses            | `deploy.sh` writes it                                               | Compose itself, automatically loaded from the same dir as `docker-compose.yml` |

These are different files, in different directories, with different threat models:

- `/etc/greenbook.env` contains **secrets**. It's never copied to or from any other machine. It's not in git. It has tight perms.
- `/opt/greenbook/.env` contains **only the version pin**. It's safe to read, deploy.sh overwrites it each deploy, and there are no secrets in it.

Two separate files instead of one merged file is deliberate — compose's automatic `.env` loading is convenient for `${VAR}` substitution but would be a bad place to store secrets (it's world-readable by default unless you're careful).

#### What ships across machines vs what stays local

| File                  | Laptop (dev)                            | App VM (prod)                     | Git               | Travels with `docker save`?                              |
| --------------------- | --------------------------------------- | --------------------------------- | ----------------- | -------------------------------------------------------- |
| `.env` (project root) | ✓ dev secrets, points at local Postgres | ✗ never exists here               | ✗ in `.gitignore` | ✗ excluded by `.dockerignore` — does NOT enter the image |
| `.env.example`        | ✓ committed template                    | ✗ not used                        | ✓ committed       | ✗ not relevant — template only                           |
| `/etc/greenbook.env`  | ✗ doesn't exist                         | ✓ the real production config      | ✗ never           | ✗ host-only, not in image                                |
| `/opt/greenbook/.env` | ✗                                       | ✓ written by deploy.sh per deploy | ✗                 | ✗                                                        |

The most important consequence: **secrets never leave the app VM**. The image tarball you scp'd in Path B has no secrets. The dev `.env` on your laptop has dev-only values that wouldn't work in prod anyway. The only place production secrets exist on disk is `/etc/greenbook.env` on the app VM, which `chmod 640 root:deployer` protects.

#### Adding a new env var (the safe sequence)

When greenbook's code introduces a new env var (say `FEATURE_X_API_KEY`), you'll touch four places in this order:

1. **`.env.example` in the repo** — document the variable + a placeholder value. Commit and push. This is the contract everyone reads to know what env greenbook needs.
2. **Your laptop `.env`** — fill in a dev value if you need to test locally.
3. **`/etc/greenbook.env` on the app VM** — add the prod value. Edit with `sudoedit /etc/greenbook.env` (so you don't need to remember the perms — sudoedit preserves them).
4. **Recreate the container** so it picks up the new env. `docker compose up -d` alone is NOT enough if no other compose-relevant input changed — compose decides nothing's different and skips the recreation. Force it:
   ```bash
   $ docker compose -f /opt/greenbook/docker-compose.yml up -d --force-recreate
   ```

Or just rerun `deploy.sh` with the same image — the version pin write triggers a recreate.

> **⚠ Common gotcha: edited the env file but the container still has the old value**
>
> Compose reads `env_file:` AT CONTAINER CREATION ONLY. Restarting the existing container doesn't re-read the file:
>
> ```bash
> $ docker compose restart app                       # ❌ keeps old env
> $ docker compose up -d                             # ❌ no-op if nothing else changed
> $ docker compose up -d --force-recreate            # ✓ rebuilds the container with new env
> ```
>
> Verify the new var is actually visible to the container:
>
> ```bash
> $ docker exec greenbook printenv FEATURE_X_API_KEY
> # Empty/missing → file edit didn't take, or container wasn't recreated.
> # Wrong value   → check for stray quotes or whitespace in /etc/greenbook.env.
> ```

#### Validating /etc/greenbook.env before bringing the container up

A typo in `DATABASE_URL` or a missing `HONEYPOT_SECRET` causes greenbook to throw "Invalid environment variables" at boot (per `app/utils/config/env.server.ts`). Catch this BEFORE recreating the production container:

```bash
# Run a one-shot container with the env file applied and just print the
# parsed env. Doesn't connect to the DB, doesn't open ports — just boots
# the env validator and exits.
$ docker run --rm --env-file /etc/greenbook.env greenbook:$VERSION \
  node -e "require('./build/server/index.js'); console.log('env OK')"
# Successful exit → env file parses, all required vars present.
# "Invalid environment variables" → fix /etc/greenbook.env before deploying.
```

Or simpler — boot the container with healthcheck and watch for the env-validation throw in logs:

```bash
$ docker compose -f /opt/greenbook/docker-compose.yml up -d
$ docker compose -f /opt/greenbook/docker-compose.yml logs --tail=50 app
# Look for a clean "Server is running on http://localhost:3000".
# If you see "Invalid environment variables" near the top, the container
# crashes immediately — fix the env file and re-recreate.
```

### 8.3.3 Promote the new image

Now that the image is loaded (Path A or Path B), the schema is up to date (§8.3.1), and `/etc/greenbook.env` is present + correct (§8.2.2), pin the version and bring up the container:

```bash
# [auishqosrgbwbs01] as deployer
$ echo "APP_VERSION=$VERSION" > /opt/greenbook/.env
#   Writes the compose env file that docker compose reads automatically.
#   Overwrites any previous value. After this, compose resolves
#   ${APP_VERSION} (used in docker-compose.yml) to the new version tag.
#   This is the file from §8.3.2's "two-file model" recap — the version-
#   pin file, not the secrets file.

$ docker compose -f /opt/greenbook/docker-compose.yml up -d
#   -f FILE     explicit path to the compose file. Works from ANY directory.
#   up          create and start services. For services that already exist
#               with the same image & config, this is a no-op; for services
#               whose image tag changed, compose recreates them.
#   -d          detached.
# Compose stops the old container, starts the new one, waits for the
# healthcheck to pass. Downtime is typically 2-5 seconds — the recreation
# gap. The job queue drains during stop_grace_period (30 s ceiling).

$ docker compose -f /opt/greenbook/docker-compose.yml ps
# Check that STATE=running and HEALTH=healthy.
# If HEALTH=starting longer than ~45 s, the healthcheck loop hasn't passed
# yet — see §12.1 (502 Bad Gateway from Nginx) for diagnosis.

# Confirm the right version is actually serving:
$ curl -s http://127.0.0.1:3000/healthz | grep -E '"version"'
# Expected: "version":"<your VERSION>"
```

### 8.3.4 Post-deploy verification — what should be true now

After §8.3.3 promotes the new version, run all seven checks below on the app VM. Each one verifies a different production guarantee from [05 §6](05-app-vm-container.md) + [§8.2.3](#823-the-compose-file-optgreenbookdocker-composeyml); if any fails, the deploy is broken even if compose reports `running`.

```bash
# [auishqosrgbwbs01] as deployer

# 1. The image built (Path A) or was loaded (Path B) and is in the local Docker store.
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
# revisit pg_hba (02 §4.5), DATABASE_URL in /etc/greenbook.env (§8.2.2),
# and the firewall rule on the DB VM (02 §4.7).

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

If all seven pass, the deploy is production-ready. On a first deploy continue to [§8.7 First-run bootstrap](#87-first-run-bootstrap-one-time) to seed the database; on a re-deploy you're done — see [08 — Day-2 operations](08-day-2-operations.md).

### 8.4 Rollback

```bash
# [auishqosrgbwbs01] as deployer — tags are still on disk from previous builds
$ docker image ls greenbook
#   Lists all greenbook images. The TAG column shows every version you've built.
#   Retention depends on whether you prune (§9.4).

# Pick the previous version — e.g. 2026-04-22-0930 — and switch back:
$ PREV=2026-04-22-0930
$ echo "APP_VERSION=$PREV" > /opt/greenbook/.env
$ docker compose -f /opt/greenbook/docker-compose.yml up -d
# That's the whole rollback. No rebuild needed — we're reusing an image
# that's already on disk.
```

> **⚠ Rollback does not undo database migrations**
>
> Rolling back the container to a previous image brings back only the previous CODE. Any schema changes applied in §8.3.1 are still in the DB. If the schema change is incompatible with the old code (a column was dropped, a constraint added, etc.), the rolled-back container will fail at runtime. This is the single biggest reason to favour the "expand → migrate code → contract" pattern for any schema change that needs to be reversible.

### 8.5 Autostart on boot (systemd)

Docker already restarts containers on daemon start (thanks to `restart: unless-stopped` in compose). But if you want an explicit systemd unit that runs "docker compose up" on boot — useful for correct ordering relative to other services — create the unit:

```bash
# [auishqosrgbwbs01]
$ sudo tee /etc/systemd/system/greenbook.service <<'EOF'
[Unit]
Description=Greenbook (docker compose)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target
#   Requires=X      if X fails, this unit fails too (stronger than Wants).
#   After=X         start ordering — this unit starts AFTER X has started.
#   network-online.target    guarantees actual network connectivity, not just
#                             that the interface exists.

[Service]
Type=oneshot
RemainAfterExit=yes
#   oneshot            the service "runs a command and exits"; systemd
#                       doesn't expect a long-running process.
#   RemainAfterExit=yes  treat the service as "active" even after the exec
#                       commands finish, so dependent units can Order on it.

WorkingDirectory=/opt/greenbook
ExecStart=/usr/bin/docker compose -f /opt/greenbook/docker-compose.yml up -d
ExecStop=/usr/bin/docker compose -f /opt/greenbook/docker-compose.yml down
# Full paths in systemd unit files — systemd doesn't read the user's PATH.
# Note: `docker compose down` sends SIGTERM + waits stop_grace_period (30s
# from §8.2.3) so in-flight jobs finish.

[Install]
WantedBy=multi-user.target
# Start with the standard multi-user runlevel (normal boot).
EOF

$ sudo systemctl daemon-reload
#   daemon-reload   tell systemd to pick up the new unit file.

$ sudo systemctl enable greenbook.service
#   enable          create the WantedBy symlink. Unit will auto-start on boot.
# Note: do NOT use --now, since "docker compose up -d" was already run
# manually in §8.3 and the container is running.
```

### 8.6 Annotated deploy.sh

Save as `/opt/greenbook/deploy.sh`, chmod +x. Usage: `./deploy.sh <git-ref>`.

```bash
#!/usr/bin/env bash
# /opt/greenbook/deploy.sh
#
# Build, apply schema changes, and promote a new version of greenbook.
# Usage:
#     ./deploy.sh <git-ref>          # ref can be a branch, tag, or commit

set -euo pipefail
#   -e      exit immediately on any non-zero command.
#   -u      treat undefined variables as errors.
#   -o pipefail   a pipeline exits non-zero if ANY command in it failed,
#                  not just the last. Without this, "false | true" returns 0.
# These three flags together make bash actually safe for production scripts.

$ RELEASE_BASE=/opt/greenbook/releases
$ COMPOSE_FILE=/opt/greenbook/docker-compose.yml
$ ENV_FILE=/opt/greenbook/.env
$ ENV_RUNTIME=/etc/greenbook.env
$ REPO_URL=git@github.com:binalfew/greenbook.git
# Schema workflow: "push" (current greenbook) or "migrate" (after baseline).
$ SCHEMA_MODE=${SCHEMA_MODE:-push}

$ if [ $# -lt 1 ]; then
  echo "usage: $0 <git-ref>"
  exit 1
fi
#   $#            number of positional arguments.
#   [ $# -lt 1 ]   true if fewer than 1 argument was given.
# Every deploy requires an explicit ref — no "just deploy whatever's latest".

$ REF="$1"
#   $1            first positional argument.

$ VERSION=$(date +%Y-%m-%d-%H%M)
$ RELEASE_DIR="$RELEASE_BASE/$VERSION"

$ echo "==> cloning $REF into $RELEASE_DIR"
$ git clone --depth 1 --branch "$REF" "$REPO_URL" "$RELEASE_DIR"
#   Shallow clone of the specified ref. If $REF is a branch or tag, this
#   works directly. For a specific COMMIT SHA, clone the repo first and
#   checkout the SHA separately — git clone --branch doesn't take SHAs.

$ cd "$RELEASE_DIR"

$ echo "==> building image greenbook:$VERSION"
$ docker build -t "greenbook:$VERSION" .

$ echo "==> applying schema changes ($SCHEMA_MODE)"
$ if [ "$SCHEMA_MODE" = "migrate" ]; then
  docker run --rm --env-file "$ENV_RUNTIME" \
    "greenbook:$VERSION" npx prisma migrate deploy
else
  # Prisma 7 dropped `--skip-generate` (the no-auto-generate behaviour
  # it controlled is now the default). Do NOT add --accept-data-loss
  # without human review — that flag tells db push to drop columns /
  # tables without prompting.
  docker run --rm --env-file "$ENV_RUNTIME" \
    "greenbook:$VERSION" npx prisma db push
fi
# Exits non-zero on failure — set -e aborts the deploy here.

$ echo "==> promoting to $VERSION"
$ echo "APP_VERSION=$VERSION" > "$ENV_FILE"
$ docker compose -f "$COMPOSE_FILE" up -d

$ echo "==> waiting for healthy status (max 90s)"
# 90s because start_period is 45s + the DB probe adds a little latency on
# first query after container recreation.
$ for i in {1..18}; do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' greenbook 2>/dev/null || echo "starting")
  if [ "$STATUS" = "healthy" ]; then
    echo "==> healthy — done."
    exit 0
  fi
  echo "    ...status=$STATUS (attempt $i/18)"
  sleep 5
done

$ echo "!! still not healthy after 90s. investigate with:"
$ echo "     docker compose -f $COMPOSE_FILE logs --tail=100 app"
$ exit 1
```

Give it the execute bit and run:

```bash
# [auishqosrgbwbs01] as deployer
$ chmod +x /opt/greenbook/deploy.sh

$ /opt/greenbook/deploy.sh main
#   Clones main, builds greenbook:<timestamp>, applies schema (push or
#   migrate per SCHEMA_MODE), promotes the new version, and waits for health.

# Once you migrate to versioned migrations:
$ SCHEMA_MODE=migrate /opt/greenbook/deploy.sh v1.3.0
```

### 8.7 First-run bootstrap (one-time)

Greenbook ships a seed script (`prisma/seed.ts`) that creates the baseline data the app refuses to run without: roles, permissions, system tenant, feature-flag defaults, reference data (regional groups, member states, countries), directory types, and the demo AU Commission leadership structure. **Until seed runs, no user can log in.**

Run this ONCE against a fresh database, before the first real deploy:

```bash
# [auishqosrgbwbs01] as deployer — after §8.3 built the first image
$ VERSION=<your-first-image-tag>

# Step 1 — apply the schema:
$ docker run --rm --env-file /etc/greenbook.env \
  greenbook:$VERSION npx prisma db push
# Prisma 7: no `--skip-generate` flag any more; not generating is now default.

# Step 2 — seed:
$ docker run --rm --env-file /etc/greenbook.env \
  greenbook:$VERSION npx tsx prisma/seed.ts
# Runtime: ~5-30 seconds. Creates the system tenant, the "admin" / "manager" /
# "focal" / "user" roles with permissions, the FF_DIRECTORY + FF_PUBLIC_DIRECTORY
# feature flags opted-in for the system tenant, and AUC demo leadership.

# Step 3 — verify (optional):
$ docker run --rm --env-file /etc/greenbook.env \
  greenbook:$VERSION \
  node -e "import('./app/generated/prisma/client.js').then(async ({PrismaClient}) => {
    const p = new PrismaClient();
    console.log({
      tenants: await p.tenant.count(),
      roles: await p.role.count(),
      users: await p.user.count(),
    });
    await p.\$disconnect();
  })"
# Expected: tenants >= 1, roles >= 4, users >= 4 (admin/manager/focal/user demos).
```

The seed script is idempotent in the sense that re-running it overwrites the demo data (by design — see `wipeDirectoryData` in seed.ts). **Do not re-run seed against a production DB with real user edits** unless you're intentionally resetting demo content.

> **⚠ Seed uses `@africanunion.org` email addresses for demo users**
>
> `prisma/seed.ts` creates four demo users (`admin@africanunion.org`, `manager@africanunion.org`, `focal@africanunion.org`, `user@africanunion.org`) with fixed demo passwords. **Rotate or delete these accounts immediately** before exposing the deployment to anyone outside the deployment team. The safest sequence: seed → log in as admin → change admin's password → delete the other three demo users.

---
