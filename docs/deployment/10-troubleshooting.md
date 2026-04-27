# 10 — Troubleshooting

> **Phase**: incident · **Run on**: BOTH VMs (problem-dependent)
>
> Diagnostic playbooks for the most common failure modes: 502 from Nginx, container crash-looping, app-VM-cannot-reach-Postgres, TLS renewal failure, disk full, slow queries / high latency. Each entry isolates the failing layer first, then drills into the diagnostic commands that pinpoint the cause.
>
> **Prev**: [09 — Hardening checklist](09-hardening-checklist.md) · **Next**: [11 — Future Graylog](11-future-graylog.md) · **Index**: [README](README.md)

---

## Contents

- [§12.1 "502 Bad Gateway" from Nginx](#121-502-bad-gateway-from-nginx)
- [§12.2 Container keeps restarting](#122-container-keeps-restarting)
- [§12.3 Cannot connect from the app VM to Postgres](#123-cannot-connect-from-the-app-vm-to-postgres)
- [§12.4 TLS certificate did not renew](#124-tls-certificate-did-not-renew)
- [§12.5 Disk full](#125-disk-full)
- [§12.6 Slow queries / app latency](#126-slow-queries--app-latency)

## 12. Troubleshooting

A directed set of diagnostic commands for the most common failure modes. The pattern in each case is: isolate which layer is broken (app → compose → Docker → Nginx → network → DB), then drill in.

### 12.1 "502 Bad Gateway" from Nginx

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

### 12.2 Container keeps restarting

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

### 12.3 Cannot connect from the app VM to Postgres

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
# listen_addresses change in §4.4 didn't take — was Postgres restarted?

# 4. On the DB VM, check UFW:
$ sudo ufw status verbose | grep 5432
# Must show "5432/tcp ALLOW IN from 10.111.11.51". If "from Anywhere", you
# forgot the src filter — fix that immediately.

# 5. On the DB VM, check pg_hba.conf ordering:
$ sudo grep -v '^#' /etc/postgresql/16/main/pg_hba.conf | grep -v '^$'
# Shows only non-comment, non-blank lines. The 10.111.11.51 line must be
# present AND not shadowed by any earlier "host all all ..." reject rule.
```

### 12.4 TLS certificate did not renew

```bash
# [auishqosrgbwbs01]
$ sudo certbot certificates
# Lists every cert certbot manages with expiry and status. "VALID: <7 days"
# is late for renewal; hunt for why.

$ sudo journalctl -u snap.certbot.renew.service --since '7 days ago'
#   journalctl -u UNIT         show logs for a specific systemd unit.
#   --since 'EXPRESSION'        filter by time — accepts relative expressions.
# Look for the most recent renewal attempt and its error message. Typical
# causes: port 80 blocked by a new firewall rule (HTTP-01), API token expired
# (DNS-01), DNS record removed, rate limited by LE.

$ sudo certbot renew --dry-run
# Try a renewal now without persisting. Will reproduce the error.
```

### 12.5 Disk full

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
#   /var/lib/docker   old images (prune — §9.4)
#                     or excessive container logs if you skipped rotation
#   /var/log          service logs growing unbounded
#   /var/lib/pgbackrest  too many retained backups — lower retention or move offsite
#   /var/backups/postgres  pg_dump archive not rotated
#   /tmp              stale tmp files, user downloads

# Docker-specific:
$ docker system df
# Shows space used by images, containers, volumes, build cache.
```

### 12.6 Slow queries / app latency

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
