# 08 — Day-2 operations

> **Phase**: post-go-live · **Run on**: BOTH VMs · **Time**: ongoing
>
> The commands you'll actually run after launch: viewing logs (including pino JSON pretty-print recipes), restarting services with their downtime profiles, a simple bash health-monitor script, weekly image pruning, and OS / Docker / Postgres update procedures.
>
> **Prev**: [07 — Deploy workflow](07-deploy-workflow.md) · **Next**: [09 — Hardening checklist](09-hardening-checklist.md) · **Index**: [README](README.md)

---

## Contents

- [§8.1 Viewing logs](#81-viewing-logs)
- [§8.2 Restarting services](#82-restarting-services)
  - [§8.2.1 Reading pino JSON logs](#821-reading-pino-json-logs)
- [§8.3 Simple monitoring script](#83-simple-monitoring-script)
- [§8.4 Pruning old images](#84-pruning-old-images)
- [§8.5 OS and Docker updates](#85-os-and-docker-updates)
- [§8.6 PostgreSQL updates](#86-postgresql-updates)

## 8. Day-2 operations

### 8.1 Viewing logs

```bash
# [auishqosrgbwbs01] as deployer

# Follow the container's stdout/stderr in real time:
$ docker compose -f /opt/greenbook/docker-compose.yml logs -f app
#   -f       follow — stream new lines as they appear. Ctrl+C to exit.

# Last 200 lines, without following:
$ docker compose -f /opt/greenbook/docker-compose.yml logs --tail=200 app

# From a specific time (ISO 8601):
$ docker compose -f /opt/greenbook/docker-compose.yml logs --since 2026-04-23T13:00:00 app

# Nginx access / error logs (owned by root):
$ sudo tail -F /var/log/nginx/greenbook.access.log
#   -F       like -f but re-opens the file if logrotate rotates it mid-stream.

$ sudo tail -F /var/log/nginx/greenbook.error.log
```

### 8.2 Restarting services

| Thing               | Command                                                         | Side effect                                           |
| ------------------- | --------------------------------------------------------------- | ----------------------------------------------------- |
| App container       | docker compose -f /opt/greenbook/docker-compose.yml restart app | ~5s downtime; connections dropped; job queue re-ticks |
| Nginx               | sudo systemctl reload nginx                                     | Zero downtime for config changes                      |
| Nginx (full)        | sudo systemctl restart nginx                                    | <1s downtime; connections dropped                     |
| Docker daemon       | sudo systemctl restart docker                                   | ALL containers restart; ~5-10s app downtime           |
| Postgres (on DB VM) | sudo systemctl restart postgresql@16-main                       | ~2s downtime; Prisma pool reconnects                  |

### 8.2.1 Reading pino JSON logs

In production greenbook emits one JSON object per line via pino. Piping through `jq` gives you a readable view. Save these one-liners as shell aliases or use directly:

```bash
# Pretty-print every log line
$ docker compose -f /opt/greenbook/docker-compose.yml logs -f app \
  | jq -R 'try fromjson catch .'

# Only errors and above
$ docker compose -f /opt/greenbook/docker-compose.yml logs -f app \
  | jq -R 'try fromjson catch empty | select(.level==\"error\" or .level==\"fatal\")'

# Tail requests with >500ms latency
$ docker compose -f /opt/greenbook/docker-compose.yml logs -f app \
  | jq -R 'try fromjson catch empty | select(.responseTime > 500) | {time, method, url, status, responseTime, correlationId}'

# Follow a single request end-to-end (needs the correlation ID from a user report)
$ CID=01HXYZ... # paste the correlation ID from the response header or error page
$ docker compose -f /opt/greenbook/docker-compose.yml logs --since 10m app \
  | jq -R 'try fromjson catch empty | select(.correlationId==\"'\"$CID\"'\")'
```

### 8.3 Simple monitoring script

Before investing in Prometheus + Grafana, even a bash script on cron covers the basics. Save as `/usr/local/bin/greenbook-health.sh`:

```bash
#!/usr/bin/env bash
# /usr/local/bin/greenbook-health.sh
# Quick health snapshot — run from cron, post to Slack / email on failure.

set -e

$ FAIL=0

# ----- container running? --------------------------------------------------
$ if ! docker ps --filter "name=^greenbook$" --filter "status=running" --format '{{.Names}}' | grep -q greenbook; then
  # --filter "name=^greenbook$"  EXACT match for the container name.
  # --filter "status=running"    only list containers currently running.
  # --format '{{.Names}}'        emit just the Names field (one per line).
  # ! ... | grep -q PATTERN      exit 0 if grep found NOTHING, else exit 1.
  # If the grep finds nothing, we negate with ! — container is NOT running.
  echo "FAIL: container 'greenbook' not running"
  FAIL=1
fi

# ----- HTTPS healthcheck ---------------------------------------------------
$ if ! curl -fsS -m 5 https://greenbook.africanunion.org/healthz -o /dev/null; then
  # -f      fail on HTTP errors (exit non-zero on 4xx/5xx).
  # -s      silent.
  # -S      show errors despite -s.
  # -m 5    max 5 seconds for the WHOLE request.
  # -o /dev/null   discard response body.
  echo "FAIL: HTTPS healthcheck failed"
  FAIL=1
fi

# ----- certificate expiry --------------------------------------------------
$ DAYS_LEFT=$(echo | openssl s_client -connect greenbook.africanunion.org:443 -servername greenbook.africanunion.org 2>/dev/null \
  | openssl x509 -noout -enddate \
  | cut -d= -f2 \
  | xargs -I{} date -d {} +%s \
  | xargs -I{} echo $(( ({} - $(date +%s)) / 86400 )))
# The pipeline:
#   openssl s_client ...          open a TLS connection (empty stdin: echo |)
#   -servername NAME               SNI
#   2>/dev/null                    discard progress on stderr
#   | openssl x509 -noout -enddate return "notAfter=..." line
#   | cut -d= -f2                  take text after the '='
#   | xargs -I{} date -d {} +%s    convert to Unix timestamp
#   | xargs -I{} echo $(( ... ))   compute days = (end - now) / 86400

$ if [ "$DAYS_LEFT" -lt 14 ]; then
  echo "WARN: TLS cert expires in $DAYS_LEFT days"
  FAIL=1
fi

# ----- disk space ----------------------------------------------------------
$ USED=$(df -P / | awk 'NR==2 {print $5}' | tr -d %)
#   df -P            POSIX-portable output (fixed columns).
#   / (the root FS)
#   awk 'NR==2 {print $5}'   second line, fifth field (the %Used column).
#   tr -d %                  strip the % so we have just a number.

$ if [ "$USED" -gt 85 ]; then
  echo "WARN: root filesystem at ${USED}%"
  FAIL=1
fi

$ exit $FAIL
```

```bash
# Install:
$ sudo install -m 755 greenbook-health.sh /usr/local/bin/greenbook-health.sh
#   -m 755    rwxr-xr-x — executable by everyone, writable by root.

# Run every 5 minutes from cron, alert via email if anything fails:
$ sudo tee /etc/cron.d/greenbook-health <<'EOF'
*/5 * * * * root /usr/local/bin/greenbook-health.sh 2>&1 | \
  mail -s '[greenbook-health] problem' -E ops@africanunion.org
EOF
#   */5 * * * *    every 5 minutes.
#   root            cron user — needed for the mail command and docker access.
#   2>&1            merge stderr into stdout so both are piped.
#   mail -s SUBJ -E ADDR
#     -s SUBJECT    subject of the mail.
#     -E            don't send empty mail. The health script produces no
#                    output on success — so cron doesn't spam you.
#   Requires a working MTA on the box (postfix, msmtp). On a fresh VM you'll
#   need to install and configure one for this to actually send mail.
```

### 8.4 Pruning old images

Each build leaves a new image on disk. Docker never deletes them automatically. Run a weekly prune to stop the disk filling up.

```bash
# [auishqosrgbwbs01] as a user with docker rights (deployer or root)
$ docker image prune -a --filter "until=168h" -f
#   image prune             remove unused (dangling or untagged) images.
#   -a                       ALSO remove images not used by any container.
#                            Without -a, prune only removes dangling images.
#   --filter "until=168h"   only remove images older than 168h = 7 days.
#   -f                       force — skip "Are you sure?" prompt.

$ docker builder prune --filter "until=168h" -f
#   builder prune           remove BuildKit's build cache (layer cache, etc.)
#                            Different from image prune — builder cache can
#                            be huge and isn't cleaned by image prune.
```

Safe cadence: weekly. Add to `/etc/cron.weekly/greenbook-prune`.

### 8.5 OS and Docker updates

```bash
# Security-only apt updates happen automatically (§1.4). For a full dist upgrade:
$ sudo apt update
$ sudo apt full-upgrade -y
#   full-upgrade    like upgrade but CAN add/remove packages to satisfy new
#                    dependencies. "upgrade" won't remove anything.

# Kernel updates show up here; reboot if told to:
$ if [ -f /var/run/reboot-required ]; then
  echo "reboot required"
  # Schedule a reboot during a maintenance window:
  # sudo shutdown -r +5 "maintenance reboot in 5 minutes"
fi

# Docker updates itself when docker-ce is upgraded by apt. Restart the
# daemon if the upgrade didn't prompt one:
$ sudo systemctl restart docker
# All containers briefly stop, then restart (restart: unless-stopped).
```

### 8.6 PostgreSQL updates

```bash
# [auishqosrgbdbs01]
$ sudo apt update
$ sudo apt upgrade -y postgresql-16 postgresql-client-16 postgresql-contrib-16
#   Upgrading within the same MAJOR version (16.x → 16.y) is routine —
#   binary compatible, no dump/restore required.

# Restart to actually run the new binary:
$ sudo systemctl restart postgresql

# MAJOR version upgrades (16 → 17) are a separate procedure, involving
# pg_upgrade or a pg_dump/pg_restore cycle. Plan and test carefully.
# Tools: pg_upgradecluster (Debian wrapper around pg_upgrade) is the
# recommended path on Ubuntu.
```

---
