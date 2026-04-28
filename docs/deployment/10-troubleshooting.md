# 10 — Troubleshooting

> **Phase**: incident · **Run on**: BOTH VMs (problem-dependent)
>
> Diagnostic playbooks for the most common failure modes: 502 from Nginx, container crash-looping, app-VM-cannot-reach-Postgres, TLS renewal failure, disk full, slow queries / high latency. Each entry isolates the failing layer first, then drills into the diagnostic commands that pinpoint the cause.
>
> **Prev**: [09 — Hardening checklist](09-hardening-checklist.md) · **Next**: [11 — Future Graylog](11-future-graylog.md) · **Index**: [README](README.md)

---

## Contents

- [§10.1 "502 Bad Gateway" from Nginx](#101-502-bad-gateway-from-nginx)
- [§10.2 Container keeps restarting](#102-container-keeps-restarting)
- [§10.3 Cannot connect from the app VM to Postgres](#103-cannot-connect-from-the-app-vm-to-postgres)
- [§10.4 TLS certificate did not renew](#104-tls-certificate-did-not-renew)
- [§10.5 Disk full](#105-disk-full)
- [§10.6 Slow queries / app latency](#106-slow-queries--app-latency)

## 10. Troubleshooting

A directed set of diagnostic commands for the most common failure modes. The pattern in each case is: isolate which layer is broken (app → compose → Docker → Nginx → network → DB), then drill in.

### 10.1 "502 Bad Gateway" from Nginx

Nginx could not reach the backend. Verify the container is up and healthy:

```bash
# [auishqosrgbwbs01]
$ docker compose -f /opt/greenbook/docker-compose.yml ps
# Look for STATE=running and HEALTH=healthy. Anything else explains the 502.

# If STATE is not running — look at logs:
$ docker compose -f /opt/greenbook/docker-compose.yml logs --tail=200 app

# If the container IS running but healthcheck is failing — probe directly:
$ curl -v http://127.0.0.1:3000/healthz
#   -v        verbose — shows request, response headers, TLS details. Tells
#             you WHY the connection fails (refused, timeout, 5xx, etc.).

# If nothing listens on 3000 — confirm the port map:
$ sudo ss -tlnp | grep 3000
# Expected: 127.0.0.1:3000 owned by com.docker.* or dockerd.
# If absent, the container either isn't running or its ports: line is wrong.
```

### 10.2 Container keeps restarting

```bash
# [auishqosrgbwbs01]
$ docker compose -f /opt/greenbook/docker-compose.yml logs --tail=100 app
# Usually reveals: misconfigured DATABASE_URL, missing env var, port in use,
# syntax error in built code, OOM kill.

$ docker inspect greenbook --format '{{.State.ExitCode}} {{.State.Error}}'
#   {{.State.ExitCode}}    numeric exit code from the container process.
#   {{.State.Error}}       Docker-side error string (e.g. "OOMKilled: true" implicit).
# Exit code 137 = SIGKILL; usually means OOMKilled. Raise deploy.resources.limits.memory
# in compose, or find the memory leak.

$ docker events --filter "container=greenbook" --since 30m
#   events       live-stream Docker daemon events.
#   --since 30m  include events from the last 30 minutes.
# Useful for tracking the sequence: create → start → die → restart.
```

### 10.3 Cannot connect from the app VM to Postgres

```bash
# 1. From the app VM, basic reachability:
$ nc -zv 10.111.11.50 5432
#   nc           netcat.
#   -z           scan mode (don't send any data, just check if the port is open).
#   -v           verbose — print "Connection succeeded" or the exact error.
# Connection refused = Postgres isn't listening on that IP, or there's a
#                      service firewall between them.
# Connection timed out = something between source and dest is silently dropping
#                        — UFW on the DB VM, or network ACLs.

# 2. Try to authenticate:
$ psql -h 10.111.11.50 -U appuser -d greenbook \
  -c "SELECT current_user, inet_server_addr(), pg_backend_pid();"
# If nc worked but psql says "no pg_hba.conf entry" or "password authentication
# failed", the pg_hba.conf rule or the password is wrong.

# 3. On the DB VM, check who's listening:
$ sudo ss -tlnp | grep 5432
# Must show 10.111.11.50:5432, not just 127.0.0.1. If only 127.0.0.1, the
# listen_addresses change in §2.4 didn't take — was Postgres restarted?

# 4. On the DB VM, check UFW:
$ sudo ufw status verbose | grep 5432
# Must show "5432/tcp ALLOW IN from 10.111.11.51". If "from Anywhere", you
# forgot the src filter — fix that immediately.

# 5. On the DB VM, check pg_hba.conf ordering:
$ sudo grep -v '^#' /etc/postgresql/16/main/pg_hba.conf | grep -v '^$'
# Shows only non-comment, non-blank lines. The 10.111.11.51 line must be
# present AND not shadowed by any earlier "host all all ..." reject rule.
```

### 10.4 TLS certificate did not renew

The AU wildcard does not auto-renew — renewal is a manual operation triggered by AU IT delivering a fresh PFX (annually, before `notAfter`). If the on-disk cert is approaching expiry without a renewal in flight:

```bash
# [auishqosrgbwbs01 — single-tier; auishqosrarp01 — two-tier]
$ sudo openssl x509 \
    -in /etc/ssl/greenbook/wildcard.africanunion.org.fullchain.pem \
    -noout -dates
# Single-tier path. For two-tier, the cert lives at
# /etc/ssl/au/wildcard.africanunion.org.fullchain.pem on the DMZ VM.
# Look at notAfter — anything inside ~14 days needs immediate action.

$ echo | openssl s_client -connect greenbook.africanunion.org:443 \
    -servername greenbook.africanunion.org 2>/dev/null \
  | openssl x509 -noout -subject -dates
# Confirms what nginx is actually serving — useful to catch
# "we replaced the file but never reloaded nginx".
```

Renewal procedure: re-run [06 §6.4.3](06-app-vm-nginx-tls.md#643-install-the-wildcard-certificate-from-a-pfx--p12-bundle-aus-actual-path) (single-tier) or [12 §12.4.2](12-dmz-reverse-proxy.md#1242-import-from-a-fresh-pfx) (two-tier) against the new PFX, then `sudo nginx -t && sudo systemctl reload nginx`. Wire alerting via [08 §8.3](08-day-2-operations.md#83-simple-monitoring-script) so an unrenewed cert pages well before it expires.

### 10.5 Disk full

```bash
# [any VM]
$ df -h /
# Shows overall usage. If >90%, drill in:

$ sudo du -h --max-depth=1 / 2>/dev/null | sort -hr | head -20
#   du              disk usage.
#   -h              human-readable.
#   --max-depth=1   don't recurse deeper than one level.
#   2>/dev/null     discard "Permission denied" noise on dirs du can't read.
#   sort -hr        sort by human-readable sizes, reverse (biggest first).
#   head -20        top 20 largest entries.

# Common culprits:
#   /var/lib/docker   old images (prune — §8.4)
#                     or excessive container logs if you skipped rotation
#   /var/log          service logs growing unbounded
#   /var/lib/pgbackrest  too many retained backups — lower retention or move offsite
#   /var/backups/postgres  pg_dump archive not rotated
#   /tmp              stale tmp files, user downloads

# Docker-specific:
$ docker system df
# Shows space used by images, containers, volumes, build cache.
```

### 10.6 Slow queries / app latency

```bash
# [auishqosrgbdbs01] — turn on slow query logging
$ sudo -u postgres psql -c "ALTER SYSTEM SET log_min_duration_statement = 250;"
$ sudo -u postgres psql -c "SELECT pg_reload_conf();"
#   log_min_duration_statement = 250    log any query that took >= 250 ms.
# Output appears in /var/log/postgresql/postgresql-16-main.log.

# Inspect currently running queries:
$ sudo -u postgres psql -c "SELECT pid, now() - query_start AS duration, state, query \
  FROM pg_stat_activity WHERE state != 'idle' ORDER BY duration DESC;"

# Install pg_stat_statements for aggregate query statistics:
# In postgresql.conf: shared_preload_libraries = 'pg_stat_statements'
# Then: CREATE EXTENSION pg_stat_statements;
# Query: SELECT query, calls, total_exec_time FROM pg_stat_statements
#          ORDER BY total_exec_time DESC LIMIT 20;
```

---
