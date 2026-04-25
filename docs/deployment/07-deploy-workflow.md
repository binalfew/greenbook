# 07 — Deploy workflow

> **Phase**: bring-up + every deploy · **Run on**: App VM + (for Path B) build host · **Time**: ~30 min first time, ~5 min subsequent
>
> Two paths to get an image onto the VM (build-on-VM vs build-elsewhere-and-ship), the `prisma db push` vs `prisma migrate` schema decision, the two-file env model (`/etc/greenbook.env` for secrets vs `/opt/greenbook/.env` for the version pin), the promote step, rollback, systemd autostart, the annotated `deploy.sh`, and the one-time first-run seed.
>
> **Prev**: [06 — Nginx and TLS](06-app-vm-nginx-tls.md) · **Next**: [08 — Day-2 operations](08-day-2-operations.md) · **Index**: [README](README.md)

---

## 8. Deploy workflow

The goal of this workflow is that any deploy (including rollback) is: one command, fast, atomic-ish (clients either see the old version or the new one, not a broken one), and reversible without rebuilding.

### 8.1 Directory layout

```
/opt/greenbook/
├── docker-compose.yml        # checked-in compose file (§6.4)
├── .env                      # written by deploy.sh; pins APP_VERSION
├── releases/
│   ├── 2026-04-23-1430/      # git clone of the source, named by timestamp
│   ├── 2026-04-22-0930/
│   └── ...
└── deploy.sh                 # the deploy script (§8.5)
```

### 8.2 Deploy: build the image and stage it on the app VM

Greenbook can be deployed two ways. Pick the one that matches your network reality — they differ only in **where the image is built**; everything from §8.2.1 onward (schema, env, compose-up, healthcheck) is identical.

> **ℹ Which path should I use?**
>
> **Path A — Build on the VM** is simplest when the app VM has open outbound internet (or a working HTTPS proxy that reaches `github.com`, `registry.npmjs.org`, and `registry-1.docker.io`). The VM clones the repo, runs `docker build`, and the new image lands directly in the local Docker image store.
>
> **Path B — Build elsewhere, ship the image (recommended for AU intranet)** is what you need when the app VM is restricted-egress (typical for AU production VMs). The image is built on a host that DOES have internet — your laptop, a CI runner, or an internal build server — then transferred as a tarball over SSH and loaded into Docker on the app VM. The app VM only needs `docker load`, no git, no npm, no Docker Hub access.
>
> A quick test on the app VM tells you which path applies:
>
> ```
> # [auishqosrgbwbs01] as deployer
> curl -fsS --connect-timeout 10 https://github.com/ -o /dev/null && echo "Path A works"
> docker pull --quiet hello-world  >/dev/null 2>&1 && echo "Docker Hub reachable"
> ```
>
> If both lines print success, Path A is open. If either fails, use Path B.

#### Path A — Build on the VM (open-egress, simplest)

All commands as the `deployer` user.

```
# [auishqosrgbwbs01] as deployer
VERSION=$(date -u +%Y-%m-%d-%H%M)
#   VERSION=VALUE    shell variable (not exported).
#   $(CMD)           command substitution — captures stdout of CMD.
#   date -u +...     UTC timestamp. Use UTC so versions sort consistently
#                    regardless of the build host's timezone.
# Timestamp-based versions are monotonic, no duplicates, easy to sort.

cd /opt/greenbook/releases
git clone --depth 1 --branch main git@github.com:binalfew/greenbook.git $VERSION
#   git clone URL DIR      clone URL into a new directory DIR.
#   --depth 1              shallow clone — download only the latest commit,
#                          not the full history. Much faster for deploys.
#   --branch main          clone from the named branch (works for tags too).
# Assumes your SSH key is authorised on the git server and loaded in the
# local ssh-agent. Can also use an HTTPS URL with a deploy token.

cd $VERSION

docker build -t greenbook:$VERSION .
#   docker build    build an image from this directory's Dockerfile.
#   -t NAME:TAG     name the image. Version stays permanent; rollback
#                    works by pointing compose at an older tag.
#   .               build context — this dir.
# Runtime depends on cache state: cold build ~90-180 s, warm ~10-30 s.

docker tag greenbook:$VERSION greenbook:latest
# Optional: also tag as "latest". Useful as a safety default for compose
# when .env is missing. Not used by the deploy flow itself.
```

The image is now in the local Docker store. Continue at §8.2.1 (schema changes) below.

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

```
# Pick a stable artefacts directory outside the repo
mkdir -p ~/greenbook-builds && cd ~/greenbook-builds

# Fresh shallow clone at the ref you're shipping
rm -rf src
git clone --depth 1 --branch main git@github.com:binalfew/greenbook.git src
cd src

# Tag the build (UTC for consistent sort across machines/timezones)
VERSION=$(date -u +%Y-%m-%d-%H%M)
echo "Building greenbook:$VERSION"
```

**Step B2 — Build for the VM's architecture.** The greenbook VMs are x86_64 (amd64). If your laptop is also x86_64, plain `docker build` works. If you're on Apple Silicon (arm64), use `buildx` with `--platform linux/amd64` to cross-build, or you'll get "exec format error" on the VM:

```
# Check your local arch:
uname -m
#   x86_64  → use plain `docker build`
#   arm64   → use buildx with the platform flag (slower, ~3-5x via emulation)

# x86_64 host:
docker build -t greenbook:$VERSION .

# Apple Silicon (arm64) host:
docker buildx build --platform linux/amd64 -t greenbook:$VERSION --load .
#   --platform linux/amd64    target architecture
#   --load                    drop the result into the local docker store
#                              (default buildx behaviour pushes to a registry)
```

**Step B3 — Verify the image before shipping.** A 30-second sanity check on your laptop catches most "the build looked fine but the image is broken" failures:

```
# Image exists and has reasonable size:
docker image ls greenbook:$VERSION
# Expected: ~700-900 MB. Anything under 200 MB means COPY paths
# in the Dockerfile didn't pick up server.js / build / node_modules.

# Critical files are present in the runtime image:
docker run --rm --entrypoint sh greenbook:$VERSION -c \
  'ls /app/server.js /app/server/app.ts /app/build/server/index.js /app/app/generated/prisma/client.js'
# All four must exist; any "No such file" means the runtime stage
# is missing a COPY.

# Container starts as the node user (uid 1000), not root:
docker run --rm --entrypoint id greenbook:$VERSION
# Expected: uid=1000(node) gid=1000(node) groups=1000(node)
```

**Step B4 — Save and compress the image:**

```
cd ..
docker save greenbook:$VERSION | gzip > greenbook-$VERSION.tar.gz
ls -lh greenbook-$VERSION.tar.gz
# Expected: ~250-400 MB compressed. The raw save is ~700-900 MB; gzip
# typically gets it to a third of that.
```

**Step B5 — Ship to the app VM:**

```
scp greenbook-$VERSION.tar.gz deployer@10.111.11.51:/tmp/
# Transfer time is bounded by your VPN bandwidth. ~250 MB over a 50 Mbps
# link = ~40 s; over a 5 Mbps link = ~7 minutes. Plan accordingly.
```

**Step B6 — On the app VM (deployer):**

```
# [auishqosrgbwbs01] as deployer
VERSION=2026-04-25-1030    # match what you set in step B1

# Load the image into the local Docker store:
gunzip -c /tmp/greenbook-$VERSION.tar.gz | docker load
# Expected: "Loaded image: greenbook:<VERSION>"
# Runtime: 10-30 s depending on disk speed; this is the slowest step.

# Verify the image is registered locally and tagged correctly:
docker image ls greenbook
# Should show greenbook:<VERSION> with size ~700-900 MB.
# Note the IMAGE ID — useful if compose ever caches a stale layer.

# Optional: also tag as latest for the compose default:
docker tag greenbook:$VERSION greenbook:latest

# Clean up the tarball — it's redundant now:
rm /tmp/greenbook-$VERSION.tar.gz
```

The image is now in the local Docker store. Continue at §8.2.1 (schema changes) below — exactly the same as Path A from this point on.

> **⚠ Don't fight the version skew**
>
> If you build on your laptop with `VERSION=2026-04-25-1030` and the app VM was last deployed at `VERSION=2026-04-23-1430`, the on-VM Docker image store still has the old image. Both will appear in `docker image ls greenbook`. That's fine and intentional — see §8.3 (rollback). Just make sure `/opt/greenbook/.env` (which §8.2.3 writes) points at the version you actually want compose to use.

> **ℹ When Path B becomes painful — switch to a private registry**
>
> The save → scp → load loop works perfectly for the first ~5 deploys. Past that, it gets old: every deploy ships a 250 MB tarball over your VPN, and the build host (laptop) has to be online when you want to deploy. Once you're doing more than one deploy a week, stand up a private container registry the app VM CAN reach (Harbor, GitLab CR, AWS ECR, plain `registry:2` on a build host inside `10.111.11.0/24`). Path B then collapses to:
>
> ```
> # Build host: docker push registry.au.int/greenbook:$VERSION
> # App VM:     docker pull registry.au.int/greenbook:$VERSION
> ```
>
> No tarballs, no scp. Defer this to post-MVP — don't hold up first production deploy on registry standup.

### 8.2.1 Apply schema changes — the greenbook reality check

Greenbook currently uses **`prisma db push`** as its schema workflow — no `prisma/migrations/` directory exists at this commit, and `npm run db:push` is the canonical way to get the schema into a new database. The deployment guide therefore ships TWO paths; pick the one that matches your current operational maturity.

> **ℹ Which path should I use?**
>
> `prisma db push` is great for template-phase development (where the schema is still shifting). It syncs the declared schema to the DB by running `CREATE`/`ALTER` statements directly, no migration history. Trade-off: no versioned, reviewable changeset; `db push` **will drop data if it sees data loss as inevitable** unless you pass `--accept-data-loss` (or approve interactively — which isn't possible in a non-TTY deploy).
>
> `prisma migrate` is the right tool once the schema stabilises. It generates versioned SQL in `prisma/migrations/`, records each application in a `_prisma_migrations` table, and refuses to run a migration that would lose data. This is the standard for long-lived production databases.
>
> The CLAUDE.md explicitly says: "Apps adopting the template should generate their own migration baseline (`npx prisma migrate dev --create-only --name init`) when they're ready to lock down schema changes." **Plan the cutover.**

**Path A — `prisma db push` (current greenbook default)**

```
# [auishqosrgbwbs01] as deployer — still in $VERSION directory
docker run --rm \
  --env-file /etc/greenbook.env \
  greenbook:$VERSION \
  npx prisma db push --skip-generate
#   docker run IMAGE CMD          run a new container for IMAGE, execute CMD.
#   --rm                           delete the container when CMD finishes.
#   --env-file /etc/greenbook.env  load env vars (DATABASE_URL, etc.) from file.
#                                   Same file used by the main compose service.
#   npx prisma db push             sync prisma/schema.prisma to the DB.
#   --skip-generate                don't re-run prisma generate; the image
#                                   already has a generated client from build.
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

```
# [auishqosrgbwbs01] as deployer
docker run --rm \
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

### 8.2.2 Env files: the two-file model

Greenbook's deploy uses **two env files for two different jobs**. Confusing them is the source of most "why isn't the new env var taking effect?" debug sessions, so it's worth getting straight before you ever change one.

| File            | Lives at              | Purpose                                                                              | Who writes it                                                       | Who reads it                                                                   |
| --------------- | --------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Runtime env** | `/etc/greenbook.env`  | The application's config: DB URL, secrets, log level, CORS origins, Sentry DSN, etc. | You — manually, root-owned, deployer-readable (`640 root:deployer`) | The container at runtime, via compose's `env_file:`                            |
| **Compose env** | `/opt/greenbook/.env` | The `${APP_VERSION}` substitution that picks which image tag compose uses            | `deploy.sh` writes it                                               | Compose itself, automatically loaded from the same dir as `docker-compose.yml` |

These are different files, in different directories, with different threat models. Keep them straight:

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
   ```
   docker compose -f /opt/greenbook/docker-compose.yml up -d --force-recreate
   ```

Or just rerun `deploy.sh` with the same image — the version pin write triggers a recreate.

> **⚠ Common gotcha: edited the env file but the container still has the old value**
>
> Compose reads `env_file:` AT CONTAINER CREATION ONLY. Restarting the existing container doesn't re-read the file:
>
> ```
> docker compose restart app          # ❌ keeps old env
> docker compose up -d                # ❌ no-op if nothing else changed
> docker compose up -d --force-recreate   # ✓ rebuilds the container with new env
> ```
>
> Verify the new var is actually visible to the container:
>
> ```
> docker exec greenbook printenv FEATURE_X_API_KEY
> # Empty/missing → file edit didn't take, or container wasn't recreated.
> # Wrong value   → check for stray quotes or whitespace in /etc/greenbook.env.
> ```

#### Rotating a secret without breaking sessions

`SESSION_SECRET` supports zero-downtime rotation because greenbook parses it as a comma-separated list (covered in §6.3). The deploy-time motion is:

```
# 1. Generate the new secret on your laptop:
NEW_SECRET=$(openssl rand -base64 48)

# 2. SSH to the app VM, edit /etc/greenbook.env:
sudoedit /etc/greenbook.env
#    Change:  SESSION_SECRET=<current>
#    To:      SESSION_SECRET=<new>,<current>
#    Save and exit.

# 3. Recreate the container:
docker compose -f /opt/greenbook/docker-compose.yml up -d --force-recreate

# 4. After your session TTL has fully passed (typically 30 days), edit
#    again and drop the old value:
#    SESSION_SECRET=<new>
docker compose -f /opt/greenbook/docker-compose.yml up -d --force-recreate
```

`HONEYPOT_SECRET`, `RESEND_API_KEY`, and `DATABASE_URL` do NOT support graceful rotation — change them and live tokens / connections are invalidated. Plan a brief maintenance window for those.

#### Validating /etc/greenbook.env before bringing the container up

A typo in `DATABASE_URL` or a missing `HONEYPOT_SECRET` causes greenbook to throw "Invalid environment variables" at boot (per `app/utils/config/env.server.ts`). Catch this BEFORE recreating the production container:

```
# Run a one-shot container with the env file applied and just print the
# parsed env. Doesn't connect to the DB, doesn't open ports — just boots
# the env validator and exits.
docker run --rm --env-file /etc/greenbook.env greenbook:$VERSION \
  node -e "require('./build/server/index.js'); console.log('env OK')"
# Successful exit → env file parses, all required vars present.
# "Invalid environment variables" → fix /etc/greenbook.env before deploying.
```

Or simpler — boot the container with healthcheck and watch for the env-validation throw in logs:

```
docker compose -f /opt/greenbook/docker-compose.yml up -d
docker compose -f /opt/greenbook/docker-compose.yml logs --tail=50 app
# Look for a clean "Server is running on http://localhost:3000".
# If you see "Invalid environment variables" near the top, the container
# crashes immediately — fix the env file and re-recreate.
```

### 8.2.3 Promote the new image

Now that the image is loaded (Path A or Path B), the schema is up to date (§8.2.1), and `/etc/greenbook.env` is present + correct (§8.2.2), pin the version and bring up the container:

```
# [auishqosrgbwbs01] as deployer
echo "APP_VERSION=$VERSION" > /opt/greenbook/.env
#   Writes the compose env file that docker compose reads automatically.
#   Overwrites any previous value. After this, compose resolves
#   ${APP_VERSION} (used in docker-compose.yml) to the new version tag.
#   This is the file from §8.2.2's "two-file model" table — the version-
#   pin file, not the secrets file.

docker compose -f /opt/greenbook/docker-compose.yml up -d
#   -f FILE     explicit path to the compose file. Works from ANY directory.
#   up          create and start services. For services that already exist
#               with the same image & config, this is a no-op; for services
#               whose image tag changed, compose recreates them.
#   -d          detached.
# Compose stops the old container, starts the new one, waits for the
# healthcheck to pass. Downtime is typically 2-5 seconds — the recreation
# gap. The job queue drains during stop_grace_period (30 s ceiling).

docker compose -f /opt/greenbook/docker-compose.yml ps
# Check that STATE=running and HEALTH=healthy.
# If HEALTH=starting longer than ~45 s, the healthcheck loop hasn't passed
# yet — see §12.1 (502 Bad Gateway from Nginx) for diagnosis.

# Confirm the right version is actually serving:
curl -s http://127.0.0.1:3000/healthz | grep -E '"version"'
# Expected: "version":"<your VERSION>"
```

### 8.3 Rollback

```
# [auishqosrgbwbs01] as deployer — tags are still on disk from previous builds
docker image ls greenbook
#   Lists all greenbook images. The TAG column shows every version you've built.
#   Retention depends on whether you prune (§9.4).

# Pick the previous version — e.g. 2026-04-22-0930 — and switch back:
PREV=2026-04-22-0930
echo "APP_VERSION=$PREV" > /opt/greenbook/.env
docker compose -f /opt/greenbook/docker-compose.yml up -d
# That's the whole rollback. No rebuild needed — we're reusing an image
# that's already on disk.
```

> **⚠ Rollback does not undo database migrations**
>
> Rolling back the container to a previous image brings back only the previous CODE. Any schema changes applied in §8.2.1 are still in the DB. If the schema change is incompatible with the old code (a column was dropped, a constraint added, etc.), the rolled-back container will fail at runtime. This is the single biggest reason to favour the "expand → migrate code → contract" pattern for any schema change that needs to be reversible.

### 8.4 Autostart on boot (systemd)

Docker already restarts containers on daemon start (thanks to `restart: unless-stopped` in compose). But if you want an explicit systemd unit that runs "docker compose up" on boot — useful for correct ordering relative to other services — create the unit:

```
# [auishqosrgbwbs01]
sudo tee /etc/systemd/system/greenbook.service <<'EOF'
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
# from §6.4) so in-flight jobs finish.

[Install]
WantedBy=multi-user.target
# Start with the standard multi-user runlevel (normal boot).
EOF

sudo systemctl daemon-reload
#   daemon-reload   tell systemd to pick up the new unit file.

sudo systemctl enable greenbook.service
#   enable          create the WantedBy symlink. Unit will auto-start on boot.
# Note: do NOT use --now, since "docker compose up -d" was already run
# manually in §8.2 and the container is running.
```

### 8.5 Annotated deploy.sh

Save as `/opt/greenbook/deploy.sh`, chmod +x. Usage: `./deploy.sh <git-ref>`.

```
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

RELEASE_BASE=/opt/greenbook/releases
COMPOSE_FILE=/opt/greenbook/docker-compose.yml
ENV_FILE=/opt/greenbook/.env
ENV_RUNTIME=/etc/greenbook.env
REPO_URL=git@github.com:binalfew/greenbook.git
# Schema workflow: "push" (current greenbook) or "migrate" (after baseline).
SCHEMA_MODE=${SCHEMA_MODE:-push}

if [ $# -lt 1 ]; then
  echo "usage: $0 <git-ref>"
  exit 1
fi
#   $#            number of positional arguments.
#   [ $# -lt 1 ]   true if fewer than 1 argument was given.
# Every deploy requires an explicit ref — no "just deploy whatever's latest".

REF="$1"
#   $1            first positional argument.

VERSION=$(date +%Y-%m-%d-%H%M)
RELEASE_DIR="$RELEASE_BASE/$VERSION"

echo "==> cloning $REF into $RELEASE_DIR"
git clone --depth 1 --branch "$REF" "$REPO_URL" "$RELEASE_DIR"
#   Shallow clone of the specified ref. If $REF is a branch or tag, this
#   works directly. For a specific COMMIT SHA, clone the repo first and
#   checkout the SHA separately — git clone --branch doesn't take SHAs.

cd "$RELEASE_DIR"

echo "==> building image greenbook:$VERSION"
docker build -t "greenbook:$VERSION" .

echo "==> applying schema changes ($SCHEMA_MODE)"
if [ "$SCHEMA_MODE" = "migrate" ]; then
  docker run --rm --env-file "$ENV_RUNTIME" \
    "greenbook:$VERSION" npx prisma migrate deploy
else
  # --skip-generate because the image already has a generated client.
  # Do NOT add --accept-data-loss without human review.
  docker run --rm --env-file "$ENV_RUNTIME" \
    "greenbook:$VERSION" npx prisma db push --skip-generate
fi
# Exits non-zero on failure — set -e aborts the deploy here.

echo "==> promoting to $VERSION"
echo "APP_VERSION=$VERSION" > "$ENV_FILE"
docker compose -f "$COMPOSE_FILE" up -d

echo "==> waiting for healthy status (max 90s)"
# 90s because start_period is 45s + the DB probe adds a little latency on
# first query after container recreation.
for i in {1..18}; do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' greenbook 2>/dev/null || echo "starting")
  if [ "$STATUS" = "healthy" ]; then
    echo "==> healthy — done."
    exit 0
  fi
  echo "    ...status=$STATUS (attempt $i/18)"
  sleep 5
done

echo "!! still not healthy after 90s. investigate with:"
echo "     docker compose -f $COMPOSE_FILE logs --tail=100 app"
exit 1
```

Give it the execute bit and run:

```
# [auishqosrgbwbs01] as deployer
chmod +x /opt/greenbook/deploy.sh

/opt/greenbook/deploy.sh main
#   Clones main, builds greenbook:<timestamp>, applies schema (push or
#   migrate per SCHEMA_MODE), promotes the new version, and waits for health.

# Once you migrate to versioned migrations:
SCHEMA_MODE=migrate /opt/greenbook/deploy.sh v1.3.0
```

### 8.6 First-run bootstrap (one-time)

Greenbook ships a seed script (`prisma/seed.ts`) that creates the baseline data the app refuses to run without: roles, permissions, system tenant, feature-flag defaults, reference data (regional groups, member states, countries), directory types, and the demo AU Commission leadership structure. **Until seed runs, no user can log in.**

Run this ONCE against a fresh database, before the first real deploy:

```
# [auishqosrgbwbs01] as deployer — after §8.2 built the first image
VERSION=<your-first-image-tag>

# Step 1 — apply the schema:
docker run --rm --env-file /etc/greenbook.env \
  greenbook:$VERSION npx prisma db push --skip-generate

# Step 2 — seed:
docker run --rm --env-file /etc/greenbook.env \
  greenbook:$VERSION npx tsx prisma/seed.ts
# Runtime: ~5-30 seconds. Creates the system tenant, the "admin" / "manager" /
# "focal" / "user" roles with permissions, the FF_DIRECTORY + FF_PUBLIC_DIRECTORY
# feature flags opted-in for the system tenant, and AUC demo leadership.

# Step 3 — verify (optional):
docker run --rm --env-file /etc/greenbook.env \
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
