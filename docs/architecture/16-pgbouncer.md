# 16 — PgBouncer

> **Phase**: 3 (app scaling + edge HA) · **Run on**: 2× dedicated PgBouncer VMs (`auishqosrpgb01-02`) · **Time**: ~2 hours
>
> Connection pooling between apps and the chapter 13 Postgres cluster. Apps stop direct-connecting to Postgres; they go through PgBouncer, which multiplexes thousands of short-lived client connections onto a small fixed pool of long-lived server connections. Postgres' `max_connections` ceiling becomes a non-issue.
>
> Phase 3 chapter 4 of 6.
>
> **Prev**: [15 — MinIO](15-minio.md) · **Next**: [17 — HAProxy HA pair](17-haproxy.md) · **Index**: [README](README.md)

---

## Contents

- [§16.1 Role + threat model](#161-role-threat-model)
- [§16.2 Pre-flight (2 dedicated PgBouncer VMs)](#162-pre-flight-2-dedicated-pgbouncer-vms)
- [§16.3 Install PgBouncer 1.22+](#163-install-pgbouncer-122)
- [§16.4 PgBouncer configuration](#164-pgbouncer-configuration)
- [§16.5 Authentication via auth_query](#165-authentication-via-auth_query)
- [§16.6 TLS — both client-side and server-side](#166-tls-both-client-side-and-server-side)
- [§16.7 Apps switch over to PgBouncer](#167-apps-switch-over-to-pgbouncer)
- [§16.8 pgbouncer_exporter for Prometheus](#168-pgbouncer_exporter-for-prometheus)
- [§16.9 UFW + firewall rules](#169-ufw-firewall-rules)
- [§16.10 Verification](#1610-verification)
- [§16.11 Phase 5 path (Patroni-aware backend rerouting)](#1611-phase-5-path-patroni-aware-backend-rerouting)

## 16. PgBouncer

### 16.1 Role + threat model

Postgres allocates ~10 MB of process memory per backend connection and hard-caps the total at `max_connections` (300 in chapter 13). At Phase 3 scale — apps with built-in connection pools running multiple instances — that ceiling fills fast:

- A single greenbook instance with a 20-connection app-side pool: 20 connections.
- Run 5 instances of greenbook on Nomad: 100 connections.
- Run 3 different apps with similar pools: 300 connections.
- Now add ad-hoc psql sessions, the postgres_exporter, pg_dump for backups: over budget.

The fix isn't to raise `max_connections` (linear memory cost; degrades query planner; breaks under burst load). The fix is **PgBouncer**, which sits between apps and Postgres:

```
                ┌─────────────────────────────────────────────────────┐
                │  Apps (thousands of short-lived client connections) │
                └────────────────────┬────────────────────────────────┘
                                     │
                                     ▼
                ┌─────────────────────────────────────────────────────┐
                │  PgBouncer ×2 (active-active behind DNS / HAProxy)  │
                │  ─ multiplex N clients onto K << N server conns ─   │
                │  ─ transaction-mode pooling by default ─            │
                └────────────────────┬────────────────────────────────┘
                                     │
                                     ▼  ~50 long-lived server connections
                ┌─────────────────────────────────────────────────────┐
                │  Postgres primary (auishqosrpdb01) — chapter 13      │
                └─────────────────────────────────────────────────────┘
```

The **pool mode** decides how aggressively connections are shared. PgBouncer offers three:

| Mode          | Server connection held while…   | Best for                                 | Breaks                                                                                                   |
| ------------- | ------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `session`     | client is connected             | Apps using LISTEN/NOTIFY, advisory locks | Worst pool efficiency — least multiplexing                                                               |
| `transaction` | client has an open transaction  | Most web apps (greenbook, future apps)   | Session-scoped features: prepared stmts (Phase 3 limitation), `SET SESSION`, temp tables, advisory locks |
| `statement`   | a single statement is in flight | Read-only stateless workloads            | Multi-statement transactions, cursors, prepared stmts                                                    |

**Phase 3 default is `transaction` mode.** Apps that need session-mode features connect to a separate database name (`<app>_session`) that's pool-mode-scoped to `session`. Statement mode is opt-in only and rarely justified.

Three consequences:

1. **Compromise = full DB access through the pool.** PgBouncer holds the credentials for every per-app role; an attacker who reads its config or memory has every app's DB password. Defence: `auth_query` pattern (PgBouncer doesn't store passwords; queries Postgres at connect time); per-app TLS client certs (Phase 5); audit log streaming via syslog → Loki.
2. **Outage = every app loses DB connectivity.** PgBouncer is on the critical path. Mitigation: 2 instances active-active, either can serve all traffic; apps reconnect to the surviving instance within seconds.
3. **Pool exhaustion is the most likely failure.** A long-running query that doesn't release the server connection blocks the pool; eventually `default_pool_size` is hit and new clients hang. Defence: tight `query_wait_timeout`, `query_timeout`, `idle_transaction_timeout`; alert on `cl_waiting > 0` for 5+ minutes.

**Threat model — what we defend against:**

| Threat                                          | Mitigation                                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Stolen PgBouncer config → all app DB creds      | `auth_type = scram-sha-256` + `auth_query` (PgBouncer doesn't store passwords; reads from Postgres `pg_shadow`)      |
| MITM on app → PgBouncer connection              | TLS required by `client_tls_sslmode = require`; cert is the AU wildcard (same as ch07/ch15)                          |
| MITM on PgBouncer → Postgres connection         | TLS required by `server_tls_sslmode = verify-ca`; verifies AU internal CA                                            |
| Pool exhaustion from runaway query              | `query_timeout`, `idle_transaction_timeout`; per-pool size limits; cloudwatch via `SHOW POOLS` exporter              |
| One bad app starves others' connections         | Per-database `pool_size`; reserve pool for emergency admin connections                                               |
| PgBouncer compromised → DDoS the DB             | UFW only allows App VLAN; rate-limit at chapter 17 HAProxy; per-pool max_client_conn caps                            |
| Misrouted traffic to old primary after failover | `pg-primary.au-internal` CNAME repoints on failover (chapter 13 §13.10 procedure); PgBouncer reconnects on next conn |

**Phase 3 deliberate non-goals:**

- **Read/write split** — PgBouncer can route to different backends per database, but Phase 3 chapter 13 doesn't expose replicas for reads. Chapter 17 (HAProxy with TCP health-check) introduces the rw / ro split.
- **Prepared statement support in transaction mode** — PgBouncer 1.21+ supports protocol-level prepared statements in transaction mode (huge for ORM-using apps), but it's per-app opt-in and several drivers still don't handle it cleanly. Phase 3 leaves it off; Phase 5 enables it once apps verify their drivers.
- **Per-app TLS client certs** — Phase 3 uses scram-sha-256 passwords; per-app mTLS lands with Phase 5 chapter 22 (dynamic Vault secrets).
- **Backend reconfiguration without restart** — `pgbouncer.ini`'s `RELOAD` reloads most settings, but database backend changes (host, port) need a restart. Patroni-aware rerouting in Phase 5 fixes this via `dbname = host=auto`.

### 16.2 Pre-flight (2 dedicated PgBouncer VMs)

Why **2** specifically: PgBouncer is stateless — every connection is independent. Two instances active-active behind chapter 17's HAProxy give one-node-loss tolerance with full capacity remaining (each instance is sized to handle full prod traffic alone).

Why **dedicated** VMs (not colocated with Postgres): a runaway PgBouncer (memory leak, fork bomb on connection burst) shouldn't share a kernel with the database it's protecting. Hard separation.

| Role        | Hostname         | IP           | vCPU | RAM  | Disk      | Notes                      |
| ----------- | ---------------- | ------------ | ---- | ---- | --------- | -------------------------- |
| PgBouncer 1 | `auishqosrpgb01` | 10.111.20.60 | 4    | 8 GB | 40 GB SSD | Stateless; small footprint |
| PgBouncer 2 | `auishqosrpgb02` | 10.111.20.61 | 4    | 8 GB | 40 GB SSD | Same shape                 |

```bash
# [each PgBouncer VM]
$ lsb_release -d
$ sudo systemctl is-active unattended-upgrades fail2ban
$ groups | grep operators

# Set generous file descriptor limits — PgBouncer holds one fd per client + per server conn
$ sudo tee /etc/security/limits.d/pgbouncer.conf > /dev/null <<'EOF'
postgres soft nofile 65536
postgres hard nofile 65536
EOF
$ ulimit -n
```

DNS sanity check: `pg-primary.au-internal` should resolve to the current Postgres primary IP (10.111.20.30 = `auishqosrpdb01` in normal state). Chapter 13 §13.10 documents repointing this CNAME during failover.

```bash
$ getent hosts pg-primary.au-internal
# Expected: 10.111.20.30 pg-primary.au-internal
```

### 16.3 Install PgBouncer 1.22+

```bash
# [auishqosrpgb01-02]

# (1) PGDG apt repo (same source as chapter 13's PG16; gives latest PgBouncer)
$ sudo install -d /usr/share/postgresql-common/pgdg
$ sudo curl -fsSLo /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    https://www.postgresql.org/media/keys/ACCC4CF8.asc
$ echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
    https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    | sudo tee /etc/apt/sources.list.d/pgdg.list

# (2) Install
$ sudo apt update
$ sudo apt install -y pgbouncer
$ sudo apt-mark hold pgbouncer

# (3) Stop the auto-started service — config goes in next
$ sudo systemctl stop pgbouncer
$ sudo systemctl disable pgbouncer

# (4) Verify version (need ≥1.22 for SCRAM-SHA-256 client + server simultaneously)
$ pgbouncer --version
```

### 16.4 PgBouncer configuration

```bash
# [auishqosrpgb01-02 — same config on both]

$ sudo tee /etc/pgbouncer/pgbouncer.ini > /dev/null <<'EOF'
;; ─────────────────────────  Databases  ─────────────────────────────
;; The connection-string each client uses to "select a backend." We
;; route by database name. `host=pg-primary.au-internal` is a CNAME
;; that ops repoints during Postgres failover (chapter 13 §13.10).
[databases]

;; Default: transaction-mode pool to the primary
* = host=pg-primary.au-internal port=5432 auth_user=pgbouncer_authuser

;; Per-app session-mode databases (opt-in for apps that need
;; LISTEN/NOTIFY, advisory locks, or session GUCs).
;; Naming convention: <app>_session
greenbook_session = host=pg-primary.au-internal port=5432 dbname=greenbook \
                    auth_user=pgbouncer_authuser \
                    pool_mode=session

;; Internal admin database (no app-server traffic; for SHOW commands)
pgbouncer = auth_user=pgbouncer_authuser

;; ─────────────────────────  Listener  ──────────────────────────────
[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
unix_socket_dir = /var/run/postgresql

;; ─────────────────────────  Authentication  ────────────────────────
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt        ;; only contains pgbouncer_authuser
auth_user = pgbouncer_authuser                  ;; used by auth_query
auth_query = SELECT usename, passwd FROM pg_shadow WHERE usename = $1
auth_dbname = postgres

;; ─────────────────────────  Pool sizing  ───────────────────────────
;; Each app database gets its own slice; the totals below cap aggregate use.
default_pool_size = 25                          ;; per-database server connections
min_pool_size = 5                                ;; warm pool to reduce cold-start latency
reserve_pool_size = 5                            ;; emergency overflow per pool
reserve_pool_timeout = 3                         ;; seconds before reserve kicks in
max_client_conn = 5000                           ;; total client connections this PgBouncer accepts
max_db_connections = 80                          ;; aggregate cap across all pools (≤ pg max_connections - headroom)
max_user_connections = 50                        ;; per-user cap

;; ─────────────────────────  Pool mode  ─────────────────────────────
pool_mode = transaction                          ;; default; per-db override above for session

;; Server connection lifecycle
server_lifetime = 3600                           ;; recycle every 1h
server_idle_timeout = 600                        ;; close idle servers after 10 min
server_connect_timeout = 5
server_login_retry = 3

;; ─────────────────────────  Client lifecycle / safety  ─────────────
client_login_timeout = 30                        ;; how long a slow client has to authenticate
client_idle_timeout = 0                          ;; 0 = no client idle kick (apps manage their own)
query_timeout = 60                                ;; kill any query >60s — matches ch13's statement_timeout
query_wait_timeout = 30                          ;; kill clients waiting >30s for a server
idle_transaction_timeout = 300                   ;; kill clients holding txns idle >5 min

;; ─────────────────────────  TLS — client side  ─────────────────────
client_tls_sslmode = require
client_tls_key_file = /etc/pgbouncer/server.key
client_tls_cert_file = /etc/pgbouncer/server.crt
client_tls_protocols = secure                    ;; TLS 1.2+

;; ─────────────────────────  TLS — server side  ─────────────────────
server_tls_sslmode = verify-ca
server_tls_ca_file = /etc/postgresql/ca/au-internal-ca.pem
server_tls_protocols = secure

;; ─────────────────────────  Admin / monitoring  ────────────────────
admin_users = pgbouncer_admin
stats_users = pgbouncer_admin, pgbouncer_stats   ;; stats_users can SHOW but not RECONFIG

;; ─────────────────────────  Logging  ───────────────────────────────
logfile = /var/log/pgbouncer/pgbouncer.log
pidfile = /var/run/pgbouncer/pgbouncer.pid
syslog = 0                                        ;; let Promtail tail logfile directly
log_connections = 1
log_disconnections = 1
log_pooler_errors = 1
verbose = 0                                       ;; bump to 1 only when debugging — verbose is loud

;; ─────────────────────────  Performance  ───────────────────────────
listen_backlog = 4096
sbuf_loopcnt = 5
tcp_keepalive = 1
tcp_keepidle = 30
tcp_keepintvl = 10

;; ─────────────────────────  Server reset  ──────────────────────────
;; What to run on every server connection that's returned to the pool.
;; In transaction mode, PgBouncer auto-runs DISCARD ALL between transactions —
;; nothing to add here.
server_reset_query =
server_reset_query_always = 0
EOF

# (1) Permissions
$ sudo chown postgres:postgres /etc/pgbouncer/pgbouncer.ini
$ sudo chmod 640 /etc/pgbouncer/pgbouncer.ini

# (2) Log + pid + run dirs
$ sudo install -d -m 750 -o postgres -g postgres /var/log/pgbouncer
$ sudo install -d -m 755 -o postgres -g postgres /var/run/pgbouncer
```

### 16.5 Authentication via auth_query

The naive way to put creds in PgBouncer is `userlist.txt` with one row per app user:

```
"app_greenbook" "SCRAM-SHA-256$..."
"app_keycloak"  "SCRAM-SHA-256$..."
```

This works but means every per-app password rotation requires editing the file on both PgBouncers. The better pattern is **auth_query**: PgBouncer holds _one_ credential (a tiny privileged user that can read `pg_shadow`), and looks up app credentials at connect time directly from Postgres.

```bash
# [auishqosrpdb01] — create the auth_user role in Postgres

$ sudo -u postgres psql <<'SQL'
CREATE ROLE pgbouncer_authuser WITH LOGIN PASSWORD 'BOOTSTRAP';

-- Wrapper function that exposes only the lookup we need
-- (pg_shadow is restricted to SUPERUSER by default).
CREATE OR REPLACE FUNCTION public.user_lookup(in i_username text,
                                              out uname text,
                                              out phash text)
  RETURNS record AS $$
BEGIN
  SELECT usename, passwd FROM pg_catalog.pg_shadow
   WHERE usename = i_username INTO uname, phash;
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Lock down: only pgbouncer_authuser can call it
REVOKE ALL ON FUNCTION public.user_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_lookup(text) TO pgbouncer_authuser;
SQL

# Set + stash the auth_user password in Vault
$ AUTH_PASS=$(openssl rand -base64 32)
$ sudo -u postgres psql -c "ALTER ROLE pgbouncer_authuser PASSWORD '$AUTH_PASS';"
$ vault kv put kv/platform/pgbouncer/authuser \
    username='pgbouncer_authuser' password="$AUTH_PASS" \
    rotated_at="$(date -Iseconds)" rotation_period_days=180
```

Now update PgBouncer's `auth_query` to use the wrapper instead of `pg_shadow` directly, and seed the auth_user into `userlist.txt`:

```bash
# [auishqosrpgb01-02]
$ sudo sed -i 's|^auth_query = .*|auth_query = SELECT uname, phash FROM public.user_lookup($1)|' \
    /etc/pgbouncer/pgbouncer.ini

# userlist.txt holds ONE row — the auth_user PgBouncer uses to call the lookup
$ AUTH_PASS=$(vault kv get -field=password kv/platform/pgbouncer/authuser)
$ AUTH_HASH=$(printf 'SCRAM-SHA-256$4096:salt$stored_key:server_key' )   # placeholder
# Easier: get the SCRAM hash from Postgres after rotation
$ AUTH_HASH=$(sudo -u postgres psql -h auishqosrpdb01 -tAc \
    "SELECT passwd FROM pg_shadow WHERE usename='pgbouncer_authuser';")

$ sudo tee /etc/pgbouncer/userlist.txt > /dev/null <<EOF
"pgbouncer_authuser" "$AUTH_HASH"
"pgbouncer_admin" "$(sudo -u postgres psql -h auishqosrpdb01 -tAc \
    "SELECT passwd FROM pg_shadow WHERE usename='pgbouncer_admin';")"
"pgbouncer_stats" "$(sudo -u postgres psql -h auishqosrpdb01 -tAc \
    "SELECT passwd FROM pg_shadow WHERE usename='pgbouncer_stats';")"
EOF
$ sudo chown postgres:postgres /etc/pgbouncer/userlist.txt
$ sudo chmod 600 /etc/pgbouncer/userlist.txt
```

The `pgbouncer_admin` role on Postgres is a separate operator account for `SHOW POOLS`, `RELOAD`, etc. Create it the same way as `pgbouncer_authuser` (without the user_lookup grant — admin doesn't need it).

### 16.6 TLS — both client-side and server-side

```bash
# [auishqosrpgb01-02]

# Client-facing: AU wildcard (same as every other public-facing chapter)
$ sudo install -m 644 -o postgres -g postgres \
    /etc/ssl/au-internal/pgbouncer.crt \
    /etc/pgbouncer/server.crt
$ sudo install -m 600 -o postgres -g postgres \
    /etc/ssl/au-internal/pgbouncer.key \
    /etc/pgbouncer/server.key

# Server-facing CA (Postgres uses the AU internal CA, same as ch13 §13.4)
$ sudo install -d -m 755 /etc/postgresql/ca
$ sudo install -m 644 -o postgres -g postgres \
    /etc/ssl/au-internal/au-internal-ca.pem \
    /etc/postgresql/ca/au-internal-ca.pem

# Verify both ends will negotiate TLS
$ openssl x509 -in /etc/pgbouncer/server.crt -noout -dates -subject
$ openssl verify -CAfile /etc/postgresql/ca/au-internal-ca.pem \
    /etc/postgresql/ca/au-internal-ca.pem
```

PgBouncer's TLS is asymmetric on purpose:

- **Client side**: `client_tls_sslmode = require` — apps MUST connect with TLS. The cert is the public AU wildcard so any internal client trusts it.
- **Server side**: `server_tls_sslmode = verify-ca` — PgBouncer verifies that the Postgres backend it's connecting to has a cert signed by the AU internal CA. Prevents a rogue Postgres impersonator from being slotted into the backend.

### 16.7 Apps switch over to PgBouncer

Apps that direct-connected to `auishqosrpdb01:5432` now connect to `pgbouncer.au-internal:6432` instead. The DSN change is the only app-side work; the Postgres-side per-app role stays exactly as chapter 13 §13.8 created it.

**Rollout per app (greenbook is the first adopter):**

```bash
# (1) Update the per-app credentials in Vault — host + port change only
$ vault kv patch kv/apps/greenbook/database \
    host='pgbouncer.au-internal' \
    port='6432' \
    sslmode='require'

# (2) Restart the app on Nomad — it reads Vault on startup, picks up new DSN
$ nomad job restart greenbook

# (3) Verify the connection is going through PgBouncer
$ ssh -J au-bastion auishqosrpgb01.au-internal \
    'sudo -u postgres psql -p 6432 pgbouncer -U pgbouncer_admin -c "SHOW POOLS;"'
# Expected: a row for greenbook database with cl_active > 0
```

DNS: `pgbouncer.au-internal` is an A record with both PgBouncer IPs (10.111.20.60 + .61). Plain DNS round-robin in Phase 3 §16; chapter 17 swaps it for HAProxy with health-check.

**Watch-outs apps must know about** (chapter 30 onboarding will enforce):

- **No `LISTEN/NOTIFY`** on the default DSN — switch to `<app>_session` for that.
- **No advisory locks** held across transactions — same.
- **No `SET SESSION foo = bar`** that's expected to persist across statements — same.
- **Prepared statements**: server-side prepared statements may fail in transaction mode (driver-dependent). Either disable them, or use the protocol-level prepared-statement support (PgBouncer 1.21+; opt-in per app driver after testing).
- **Temporary tables**: `CREATE TEMP TABLE` inside a transaction is fine; outside, transaction mode loses them.

These are the standard transaction-mode caveats — every PgBouncer-using shop hits them once. The `<app>_session` escape hatch covers the rest.

### 16.8 pgbouncer_exporter for Prometheus

```bash
# [auishqosrpgb01-02]

# pgbouncer_exporter is a Go binary not in apt — install from upstream release
$ EXP_VERSION=0.10.0
$ curl -fsSLO https://github.com/prometheus-community/pgbouncer_exporter/releases/download/v${EXP_VERSION}/pgbouncer_exporter-${EXP_VERSION}.linux-amd64.tar.gz
$ tar xvf pgbouncer_exporter-${EXP_VERSION}.linux-amd64.tar.gz
$ sudo install -o root -g root -m 755 \
    pgbouncer_exporter-${EXP_VERSION}.linux-amd64/pgbouncer_exporter \
    /usr/local/bin/

# Service user + DSN
$ STATS_PASS=$(vault kv get -field=password kv/platform/pgbouncer/stats)
$ sudo tee /etc/default/pgbouncer-exporter > /dev/null <<EOF
PGBOUNCER_EXPORTER_DSN="postgres://pgbouncer_stats:$STATS_PASS@127.0.0.1:6432/pgbouncer?sslmode=disable"
ARGS="--web.listen-address=:9127"
EOF
$ sudo chmod 600 /etc/default/pgbouncer-exporter

# systemd unit
$ sudo tee /etc/systemd/system/pgbouncer-exporter.service > /dev/null <<'EOF'
[Unit]
Description=PgBouncer Prometheus exporter
After=pgbouncer.service
Wants=pgbouncer.service

[Service]
Type=simple
User=postgres
Group=postgres
EnvironmentFile=/etc/default/pgbouncer-exporter
ExecStart=/usr/local/bin/pgbouncer_exporter --pgBouncer.connectionString="$PGBOUNCER_EXPORTER_DSN" $ARGS
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF

$ sudo systemctl daemon-reload
$ sudo systemctl enable --now pgbouncer-exporter
$ curl -s http://127.0.0.1:9127/metrics | head -10
```

Add to chapter 10's scrape config:

```bash
# [each obs VM]
$ sudo tee /etc/prometheus/scrapes.d/pgbouncer.yml > /dev/null <<'EOF'
scrape_configs:
  - job_name: pgbouncer
    static_configs:
      - targets:
          - auishqosrpgb01:9127
          - auishqosrpgb02:9127
        labels:
          role: pgbouncer
EOF
$ sudo -u prometheus promtool check config /etc/prometheus/prometheus.yml
$ curl -X POST http://127.0.0.1:9090/-/reload
```

PgBouncer-specific alert rules added to chapter 12's ruleset:

```bash
# [auishqosrobs01]
$ sudo -u mimir tee -a /var/lib/mimir/rules/anonymous/platform.yaml > /dev/null <<'EOF'

  # ─────────────────────────────  Phase 3: PgBouncer  ───────────────────────────
  - name: pgbouncer
    interval: 60s
    rules:
      - alert: PgBouncerDown
        expr: up{job="pgbouncer"} == 0
        for: 2m
        labels:
          severity: critical
          service: pgbouncer
        annotations:
          summary: 'PgBouncer on {{ $labels.instance }} is down'

      - alert: PgBouncerClientsWaiting
        expr: pgbouncer_pools_client_waiting_connections > 5
        for: 5m
        labels:
          severity: warning
          service: pgbouncer
        annotations:
          summary: '{{ $labels.database }}: {{ $value }} clients waiting on a server connection'
          description: 'Pool exhausted; raise default_pool_size or investigate slow queries'

      - alert: PgBouncerServerErrors
        expr: rate(pgbouncer_servers_login_failures_total[5m]) > 0
        for: 5m
        labels:
          severity: warning
          service: pgbouncer
        annotations:
          summary: 'PgBouncer login failures to backend Postgres'

      - alert: PgBouncerHighConnectionCount
        expr: |
          pgbouncer_pools_client_active_connections /
          on(database) group_left() pgbouncer_databases_pool_size > 0.85
        for: 10m
        labels:
          severity: warning
          service: pgbouncer
        annotations:
          summary: '{{ $labels.database }} pool is {{ $value | humanizePercentage }} full'
EOF

$ for h in 01 02 03; do
    ssh -J au-bastion auishqosrobs${h}.au-internal \
      'curl -s -X POST http://127.0.0.1:9009/ruler/reload'
  done
```

### 16.9 UFW + firewall rules

```bash
# [auishqosrpgb01-02]

# Apps from the App VLAN — only port 6432 (PgBouncer)
$ sudo ufw allow from 10.111.10.0/24 to any port 6432 proto tcp comment 'PgBouncer ← App VLAN'

# Operations VLAN for ops tooling
$ sudo ufw allow from 10.111.40.0/24 to any port 6432 proto tcp comment 'PgBouncer ← Ops'

# pgbouncer_exporter scraped from obs VMs
$ sudo ufw allow from 10.111.30.0/24 to any port 9127 proto tcp comment 'Prometheus → pgbouncer_exporter'

# [auishqosrpdb01-02] — chapter 13's pg_hba already allows 10.111.10.0/24 for app traffic;
# now add the PgBouncer VMs explicitly
$ # On each Postgres host, edit pg_hba.conf:
#   hostssl all  all  10.111.20.60/32  scram-sha-256
#   hostssl all  all  10.111.20.61/32  scram-sha-256
#   And: SELECT pg_reload_conf();
```

Apps stop needing direct access to Postgres on 5432; chapter 13's `hostssl all all 10.111.10.0/24 ...` line in pg_hba.conf gets tightened later (Phase 5) to allow only the PgBouncer IPs. Phase 3 leaves it permissive while apps migrate.

### 16.10 Verification

```bash
# (1) Both PgBouncers up
$ for h in 01 02; do
    ssh -J au-bastion auishqosrpgb${h}.au-internal \
      'sudo systemctl is-active pgbouncer'
  done
# Expected: active from each

# (2) admin SHOW commands work
$ ssh -J au-bastion auishqosrpgb01.au-internal \
    'sudo -u postgres psql -p 6432 pgbouncer -U pgbouncer_admin -c "SHOW VERSION;"'
# Expected: PgBouncer version >= 1.22

$ ssh -J au-bastion auishqosrpgb01.au-internal \
    'sudo -u postgres psql -p 6432 pgbouncer -U pgbouncer_admin -c "SHOW POOLS;"'
# Expected: rows for each database; cl_active=0 initially, sv_active=0 too

# (3) auth_query works — connect as a real app role through PgBouncer
$ APP_PASS=$(vault kv get -field=password kv/apps/greenbook/database)
$ PGPASSWORD=$APP_PASS psql -h auishqosrpgb01.au-internal -p 6432 \
    -U app_greenbook -d greenbook -c "SELECT 1;"
# Expected: 1

# (4) TLS enforced both ways
$ PGPASSWORD=$APP_PASS psql "host=auishqosrpgb01.au-internal port=6432 \
    dbname=greenbook user=app_greenbook sslmode=disable" -c "SELECT 1;"
# Expected: error "SSL is required" — proves client-side enforcement

# (5) Connection to Postgres is using TLS
$ ssh -J au-bastion auishqosrpdb01.au-internal \
    'sudo -u postgres psql -c "SELECT ssl, client_addr FROM pg_stat_ssl JOIN pg_stat_activity USING(pid) WHERE backend_type = \"client backend\";"'
# Expected: rows with ssl=t and client_addr=10.111.20.60 or .61

# (6) Pool is doing its job — apps see persistent low connection count to Postgres
#     even with many app instances
$ ssh -J au-bastion auishqosrpdb01.au-internal \
    'sudo -u postgres psql -tAc "SELECT count(*) FROM pg_stat_activity WHERE backend_type = \"client backend\";"'
# Expected: roughly equal to (number of databases × default_pool_size) — ~25 even with many apps

# (7) Active-active failover drill: stop pgb01, verify apps still work via pgb02
$ ssh -J au-bastion auishqosrpgb01.au-internal 'sudo systemctl stop pgbouncer'
# Apps should reconnect within seconds (DNS round-robin retries)
$ for i in {1..10}; do
    PGPASSWORD=$APP_PASS psql -h pgbouncer.au-internal -p 6432 \
      -U app_greenbook -d greenbook -c "SELECT $i;" -tA
  done
# Expected: 10 outputs of integers, possibly with one or two retries on the first calls
$ ssh -J au-bastion auishqosrpgb01.au-internal 'sudo systemctl start pgbouncer'

# (8) Prometheus sees both exporters
$ ssh -J au-bastion auishqosrobs01.au-internal \
    'curl -sG http://127.0.0.1:9090/api/v1/query \
      --data-urlencode "query=up{job=\"pgbouncer\"}" | jq ".data.result[] | {instance:.metric.instance, value:.value[1]}"'
# Expected: 2 results, both "1"
```

**Common failures and remedies:**

| Symptom                                               | Cause                                                                | Fix                                                                                                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `psql: error: server certificate does not match host` | TLS cert SAN doesn't include `pgbouncer.au-internal`                 | Re-issue cert with the correct SAN; or apps use `sslmode=require` (no host check) instead of `verify-full`                                                      |
| `password authentication failed` for app role         | `auth_query` not finding the user — wrapper function permission lost | Verify `pgbouncer_authuser` has EXECUTE on `public.user_lookup`; test the function manually                                                                     |
| `cl_waiting > 0` and growing                          | Pool exhausted (slow queries) or backend Postgres slow               | `SHOW POOLS;` to see which database; check `pg_stat_activity` on Postgres for long queries; raise `default_pool_size` only after fixing the cause               |
| Apps see "the database system is shutting down"       | Postgres restart while PgBouncer holds idle servers                  | Set `server_check_query = SELECT 1` and `server_check_delay = 30` so PgBouncer probes idle servers                                                              |
| Prepared statement errors                             | App driver using server-side prepared stmts in transaction mode      | Disable prepared statements in the app (`statement_cache_capacity=0` for asyncpg, etc.); or upgrade to PgBouncer 1.21+ protocol-level support and verify driver |
| `pg_dump` fails through PgBouncer                     | pg_dump uses session features (server-side cursors, etc.)            | Connect pg_dump direct to Postgres on 5432 (it's an admin tool, not subject to PgBouncer)                                                                       |
| `RELOAD` doesn't pick up backend host change          | Backend definition changes need a restart                            | `systemctl restart pgbouncer`; future Patroni integration in Phase 5 fixes this                                                                                 |

### 16.11 Phase 5 path (Patroni-aware backend rerouting)

In Phase 3, Postgres failover means an operator runs the chapter 13 §13.10 procedure, which includes "update the `pg-primary.au-internal` CNAME." DNS TTL governs how fast PgBouncer picks up the new primary — typically 30-60 seconds.

Phase 5 [chapter 24 — Patroni for Postgres] (slot reserved) introduces:

- Patroni-managed Postgres cluster with etcd consensus
- A **Patroni REST API** on each node exposing `/primary`, `/replica`, `/leader` endpoints
- HAProxy (chapter 17) doing TCP-level health-checks against `/primary` to identify the current writer
- PgBouncer's `databases.* host=` line points at HAProxy's writer-VIP (`pg-rw.au-internal`) instead of the static CNAME
- Failover RTO drops from "DNS TTL + operator action" to "<10 sec automatic"

What carries over unchanged: the auth_query pattern, per-app role design, pool sizing, TLS configuration, the alert rules. The single config-line change is the `host=` value in `[databases]`.

Migration cost: ~30 min per PgBouncer (rolling restart with the new backend address). The HAProxy + Patroni layer is the heavy lift — chapter 17 prepares half of it (HAProxy with TCP health-checks); chapter 24 adds the Patroni half.

---
