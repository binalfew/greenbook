# 13 — Postgres HA

> **Phase**: 3 (app scaling + edge HA) · **Run on**: 2× new app DB VMs (`auishqosrpdb01-02`); pattern also applied to chapter 07's Keycloak DB · **Time**: ~4 hours
>
> Streaming replication for the application Postgres cluster. Phase 2 used a single-VM Postgres for Keycloak with manual recovery from backups; Phase 3 introduces a primary + replica pair with WAL archiving for PITR and a documented failover drill. PgBouncer (chapter 16) and HAProxy (chapter 17) sit on top later in the phase.
>
> Phase 3 chapter 1 of 6.
>
> **Prev**: [12 — Alertmanager](12-alertmanager.md) — _closes Phase 2_ · **Next**: [14 — Redis Sentinel](14-redis-sentinel.md) · **Index**: [README](README.md)

---

## Contents

- [§13.1 Role + threat model](#131-role-threat-model)
- [§13.2 Pre-flight (2 dedicated DB VMs)](#132-pre-flight-2-dedicated-db-vms)
- [§13.3 Install PostgreSQL 16 on both nodes](#133-install-postgresql-16-on-both-nodes)
- [§13.4 Primary configuration](#134-primary-configuration)
- [§13.5 Bootstrap the replica via pg_basebackup](#135-bootstrap-the-replica-via-pg_basebackup)
- [§13.6 Verify replication is healthy](#136-verify-replication-is-healthy)
- [§13.7 WAL archiving + PITR with pgBackRest](#137-wal-archiving-pitr-with-pgbackrest)
- [§13.8 Application roles + credentials in Vault](#138-application-roles-credentials-in-vault)
- [§13.9 postgres_exporter for Prometheus](#139-postgres_exporter-for-prometheus)
- [§13.10 Manual failover procedure (with drill cadence)](#1310-manual-failover-procedure-with-drill-cadence)
- [§13.11 UFW + firewall rules](#1311-ufw-firewall-rules)
- [§13.12 Verification](#1312-verification)
- [§13.13 Applying the pattern to Keycloak's DB](#1313-applying-the-pattern-to-keycloaks-db)
- [§13.14 Phase 5 path (Patroni + etcd for automated failover)](#1314-phase-5-path-patroni-etcd-for-automated-failover)

## 13. Postgres HA

### 13.1 Role + threat model

Phase 3 introduces a **shared application database cluster**. Every app deployed to the platform from now on points its `DATABASE_URL` at this cluster (one logical database per app, namespaced; same physical Postgres). Keycloak keeps its own dedicated Postgres for operational independence (Keycloak SSO going down vs apps going down should be independent failures) — but receives the same HA pattern in §13.13.

The cluster is **active-passive with asynchronous streaming replication**:

```
                              ┌─────────────────────────────────┐
                              │ App  ──writes/reads──▶  Primary │
                              │                          (rw)   │
                              │                            │    │
                              │                            │ async WAL stream
                              │                            ▼    │
                              │                         Replica │
                              │                          (ro)   │
                              └─────────────────────────────────┘
```

The primary accepts all writes. The replica receives a continuous WAL stream and stays seconds behind. Apps connect only to the primary in Phase 3 — chapter 16 (PgBouncer) and chapter 17 (HAProxy with TCP health-check) introduce read/write split later.

Three consequences:

1. **Compromise = full data exposure.** Postgres holds every app's primary state. Defence: pg_hba.conf restricts to the App VLAN only; per-app roles with least privilege; TLS in transit; pgcrypto for sensitive columns at rest; audit via pgaudit.
2. **Outage = every app down.** Single primary means every app loses writes during failover. Mitigation: replica is hot and ready to promote (~30 sec failover); PITR via pgBackRest covers data-loss scenarios; Phase 5 Patroni reduces RTO to <10 sec automatic.
3. **Replication lag is the most likely silent failure.** Async replication means the replica can drift indefinitely if a long transaction or network blip stalls it. Defence: alert on `pg_replication_lag_seconds > 60` (already in chapter 12's ruleset); weekly drift check; `synchronous_standby_names` available for critical apps that opt in.

**Threat model — what we defend against:**

| Threat                                      | Mitigation                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Compromised app role used to dump all data  | Per-app roles with `GRANT` only on that app's schema; no `SUPERUSER` for app code; `REVOKE ALL ON ALL TABLES FROM PUBLIC` |
| SQL injection from app                      | App layer responsibility (parameterised queries); pgaudit logs every statement for forensic review                        |
| Replica diverges silently from primary      | Replication-lag alert (ch12); weekly checksum comparison; `wal_log_hints` enabled for pg_rewind on failover               |
| Backup corruption discovered during DR      | pgBackRest verifies blocks on every backup; weekly `pgbackrest verify`; quarterly restore drill                           |
| Failover causes split-brain (both writable) | Promotion procedure includes hard-fence step; `recovery.signal` is removed atomically; old primary refuses to restart     |
| WAL archive disk fills, replication breaks  | pgBackRest expires old WAL on a retention schedule; alert on archive-disk usage; pg_xlog/pg_wal sizing headroom           |
| Long-running query on primary blocks vacuum | `idle_in_transaction_session_timeout`; `statement_timeout` per role; `lock_timeout`; weekly `pg_stat_activity` review     |

**Phase 3 deliberate non-goals:**

- **Automated failover** — Phase 3 is manual-with-drill. Patroni (Phase 5 chapter) automates. Manual is acceptable when the failover step is rehearsed and the RTO target is "minutes."
- **Multi-AZ replication** — single-DC for Phase 3; chapter 20 (DR site) adds an off-site streaming standby.
- **Logical replication / CDC** — out of scope; if a future app needs change-data-capture (e.g., to push to a search index), revisit then.
- **Connection pooling at the DB layer** — PgBouncer lands in chapter 16. Phase 3 starts with apps direct-connecting; this works at low connection counts (≤200 across all apps).
- **Read scaling** — replicas exist for failover, not for read offloading in Phase 3. Chapter 17 (HAProxy with read/write split) opens that door later.

### 13.2 Pre-flight (2 dedicated DB VMs)

Two new Ubuntu 24.04 VMs hardened to AU base. Skip §1.8. Operator account membership.

| Role       | Hostname         | IP           | vCPU | RAM   | Disk                     | Notes                                  |
| ---------- | ---------------- | ------------ | ---- | ----- | ------------------------ | -------------------------------------- |
| DB primary | `auishqosrpdb01` | 10.111.20.30 | 8    | 32 GB | 200 GB SSD + 500 GB data | Phase 3 sizing for ~10 apps            |
| DB replica | `auishqosrpdb02` | 10.111.20.31 | 8    | 32 GB | 200 GB SSD + 500 GB data | Same shape — replica must be ≥ primary |

Why same shape: a replica that's promoted to primary must handle full production load. Asymmetric sizing (a smaller replica) is a common cost-saving mistake that bites you on the day failover happens.

```bash
# [each DB VM] sanity check
$ lsb_release -d
$ sudo systemctl is-active unattended-upgrades fail2ban
$ groups | grep operators

# Mount the data volume separately from the OS volume
$ sudo lsblk
$ sudo mkfs.ext4 -L pgdata /dev/sdb        # adjust per-VM device name
$ sudo mkdir /var/lib/postgresql
$ echo 'LABEL=pgdata /var/lib/postgresql ext4 defaults,noatime 0 2' | sudo tee -a /etc/fstab
$ sudo mount -a
$ df -h /var/lib/postgresql
```

`noatime` matters — Postgres re-writes hot pages constantly and atime updates double the write IO for no benefit.

### 13.3 Install PostgreSQL 16 on both nodes

```bash
# [auishqosrpdb01-02]

# (1) PGDG apt repo (matches chapter 07's Keycloak DB; same major version)
$ sudo install -d /usr/share/postgresql-common/pgdg
$ sudo curl -fsSLo /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    --user-agent "au-platform/1.0" \
    https://www.postgresql.org/media/keys/ACCC4CF8.asc
$ sudo sh -c 'echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
    https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list'

# (2) Install PG16 + extensions
$ sudo apt update
$ sudo apt install -y postgresql-16 postgresql-contrib-16 postgresql-16-pgaudit
$ sudo apt-mark hold postgresql-16 postgresql-contrib-16 postgresql-16-pgaudit

# (3) Stop the auto-started cluster — we'll re-init on the data volume
$ sudo systemctl stop postgresql@16-main
$ sudo systemctl disable postgresql@16-main
$ sudo pg_dropcluster 16 main --stop

# (4) Recreate cluster pointed at the data volume
$ sudo pg_createcluster 16 main \
    --datadir=/var/lib/postgresql/16/main \
    --port=5432 \
    --locale=en_US.UTF-8 \
    --start-conf=manual

# (5) Verify
$ pg_lsclusters
$ ls -la /var/lib/postgresql/16/main
```

### 13.4 Primary configuration

All edits below are on **`auishqosrpdb01`** (the primary).

```bash
# [auishqosrpdb01]

$ sudo -u postgres tee /etc/postgresql/16/main/conf.d/00-platform.conf > /dev/null <<'EOF'
# ───────── Listen + connection limits ─────────
listen_addresses = '*'
port = 5432
max_connections = 300

# ───────── Memory (8 vCPU / 32 GB RAM tuning) ─────────
shared_buffers = 8GB              # ~25% RAM
effective_cache_size = 24GB       # ~75% RAM
work_mem = 32MB
maintenance_work_mem = 1GB
wal_buffers = 16MB

# ───────── WAL + replication ─────────
wal_level = replica
archive_mode = on
archive_command = 'pgbackrest --stanza=app archive-push %p'
archive_timeout = 60s             # force WAL switch every minute (caps RPO at ~1m)
max_wal_senders = 10
max_replication_slots = 10
wal_log_hints = on                # required for pg_rewind on the old primary after failover
wal_keep_size = 1GB               # buffer for replica reconnect
hot_standby = on

# ───────── Checkpoints (disk write tuning) ─────────
checkpoint_timeout = 15min
checkpoint_completion_target = 0.9
max_wal_size = 4GB
min_wal_size = 1GB

# ───────── Logging (Loki picks up via Promtail) ─────────
logging_collector = on
log_destination = 'stderr'
log_directory = 'log'
log_filename = 'postgresql-%a.log'
log_rotation_age = 1d
log_truncate_on_rotation = on
log_line_prefix = '%t [%p] %u@%d/%a '
log_min_duration_statement = 500ms
log_checkpoints = on
log_connections = on
log_disconnections = on
log_lock_waits = on
log_temp_files = 10MB
log_autovacuum_min_duration = 1s

# ───────── pgaudit (statement-level audit) ─────────
shared_preload_libraries = 'pg_stat_statements,pgaudit'
pgaudit.log = 'role,ddl,write'
pgaudit.log_catalog = off
pgaudit.log_relation = on
pgaudit.log_parameter = off       # off — parameters can include PII

# ───────── Statement budgets ─────────
statement_timeout = 60s           # per-role override available
idle_in_transaction_session_timeout = 5min
lock_timeout = 30s

# ───────── pg_stat_statements ─────────
pg_stat_statements.track = all
pg_stat_statements.max = 10000

# ───────── TLS ─────────
ssl = on
ssl_cert_file = '/etc/postgresql/16/main/server.crt'
ssl_key_file  = '/etc/postgresql/16/main/server.key'
ssl_min_protocol_version = 'TLSv1.2'
EOF

# (1) TLS certificate — AU wildcard (same source as ch04, ch07)
$ sudo install -m 644 -o postgres -g postgres \
    /etc/ssl/au-internal/postgres-pdb01.crt \
    /etc/postgresql/16/main/server.crt
$ sudo install -m 600 -o postgres -g postgres \
    /etc/ssl/au-internal/postgres-pdb01.key \
    /etc/postgresql/16/main/server.key

# (2) pg_hba.conf — only App VLAN, only TLS, only password auth
$ sudo -u postgres tee /etc/postgresql/16/main/pg_hba.conf > /dev/null <<'EOF'
# TYPE      DATABASE     USER         ADDRESS            METHOD     OPTIONS
local       all          postgres                        peer
local       all          all                             scram-sha-256
hostssl     all          all          10.111.10.0/24     scram-sha-256
hostssl     replication  replicator   10.111.20.31/32    scram-sha-256   # replica only
host        all          all          0.0.0.0/0          reject
EOF

# (3) Start the cluster
$ sudo systemctl enable postgresql@16-main
$ sudo systemctl start postgresql@16-main
$ sudo systemctl status postgresql@16-main --no-pager | head -5

# (4) Create the replication role + slot
$ sudo -u postgres psql <<'EOF'
CREATE ROLE replicator WITH REPLICATION LOGIN
  PASSWORD 'BOOTSTRAP_PASSWORD';
SELECT pg_create_physical_replication_slot('replica_pdb02');
EOF

# (5) Replication password into Vault — operators on the replica fetch it
$ vault kv put kv/platform/postgres/replication \
    username='replicator' \
    password='BOOTSTRAP_PASSWORD' \
    rotated_at="$(date -Iseconds)" \
    rotation_period_days=180

# (6) Reset the in-DB password to match Vault (rotation step)
$ ROTATED=$(openssl rand -base64 32)
$ vault kv put kv/platform/postgres/replication \
    username='replicator' password="$ROTATED" \
    rotated_at="$(date -Iseconds)" rotation_period_days=180
$ sudo -u postgres psql -c "ALTER ROLE replicator PASSWORD '$ROTATED';"
```

### 13.5 Bootstrap the replica via pg_basebackup

All steps on **`auishqosrpdb02`** (the replica).

```bash
# [auishqosrpdb02]

# (1) Stop the cluster + clear the data dir
$ sudo systemctl stop postgresql@16-main
$ sudo -u postgres rm -rf /var/lib/postgresql/16/main/*

# (2) Pull base backup from the primary, streaming WAL
$ REPL_PASS=$(vault kv get -field=password kv/platform/postgres/replication)
$ sudo -u postgres PGPASSWORD="$REPL_PASS" pg_basebackup \
    --host=auishqosrpdb01 \
    --username=replicator \
    --pgdata=/var/lib/postgresql/16/main \
    --wal-method=stream \
    --slot=replica_pdb02 \
    --progress \
    --verbose \
    --checkpoint=fast
# This takes minutes-to-hours depending on data size.

# (3) Mirror the primary's TLS cert into place (same wildcard)
$ sudo install -m 644 -o postgres -g postgres \
    /etc/ssl/au-internal/postgres-pdb02.crt \
    /etc/postgresql/16/main/server.crt
$ sudo install -m 600 -o postgres -g postgres \
    /etc/ssl/au-internal/postgres-pdb02.key \
    /etc/postgresql/16/main/server.key

# (4) Mirror the conf.d (any setting that's safe on either role)
$ sudo cp /etc/postgresql/16/main/conf.d/00-platform.conf /tmp/
$ scp -J au-bastion auishqosrpdb01.au-internal:/etc/postgresql/16/main/conf.d/00-platform.conf /tmp/
$ sudo install -m 644 -o postgres -g postgres /tmp/00-platform.conf \
    /etc/postgresql/16/main/conf.d/00-platform.conf

# (5) Replica-specific overrides — the primary_conninfo + standby signal
$ sudo -u postgres tee /etc/postgresql/16/main/conf.d/10-replica.conf > /dev/null <<EOF
primary_conninfo = 'host=auishqosrpdb01 port=5432 user=replicator password=$REPL_PASS application_name=pdb02 sslmode=require'
primary_slot_name = 'replica_pdb02'
hot_standby = on
hot_standby_feedback = on
EOF
$ sudo chmod 600 /etc/postgresql/16/main/conf.d/10-replica.conf

# (6) The standby signal file — Postgres 12+ uses this in place of recovery.conf
$ sudo -u postgres touch /var/lib/postgresql/16/main/standby.signal

# (7) Start
$ sudo systemctl start postgresql@16-main
$ sudo journalctl -u postgresql@16-main --no-pager | tail -20
# Expected: "started streaming WAL from primary at <LSN>"
```

### 13.6 Verify replication is healthy

```bash
# [auishqosrpdb01] — check primary's view
$ sudo -u postgres psql -c "
  SELECT application_name, client_addr, state, sync_state,
         pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS lag_bytes,
         write_lag, replay_lag
  FROM pg_stat_replication;"
# Expected: 1 row, state=streaming, sync_state=async, lag_bytes near 0

# [auishqosrpdb02] — check replica's view
$ sudo -u postgres psql -c "
  SELECT pg_is_in_recovery(),
         pg_last_wal_receive_lsn(),
         pg_last_wal_replay_lsn(),
         (now() - pg_last_xact_replay_timestamp())::interval AS lag_seconds;"
# Expected: pg_is_in_recovery=t, lag_seconds < 5s

# (Round-trip test — write to primary, read on replica)
$ sudo -u postgres psql -c "CREATE DATABASE _replcheck; \c _replcheck \
  CREATE TABLE t(v int); INSERT INTO t VALUES (42);" -h auishqosrpdb01

$ sleep 2

$ sudo -u postgres psql -c "SELECT * FROM t;" -h auishqosrpdb02 -d _replcheck
# Expected: 42

$ sudo -u postgres psql -c "DROP DATABASE _replcheck;" -h auishqosrpdb01
```

### 13.7 WAL archiving + PITR with pgBackRest

`archive_command` in §13.4 ships every WAL segment into pgBackRest. We need pgBackRest itself + a backup target.

```bash
# [auishqosrpdb01-02]

$ sudo apt install -y pgbackrest
$ sudo install -d -m 750 -o postgres -g postgres \
    /var/lib/pgbackrest \
    /var/log/pgbackrest

$ sudo tee /etc/pgbackrest/pgbackrest.conf > /dev/null <<'EOF'
[global]
repo1-path=/var/lib/pgbackrest
repo1-retention-full=2          # keep 2 full backups
repo1-retention-diff=6          # keep 6 diff between full
repo1-retention-archive=14      # 14-day WAL retention
process-max=4
log-level-console=info
log-level-file=detail
compress-type=zst
compress-level=3
backup-standby=y                # take physical backups from the replica when possible

[app]
pg1-host=auishqosrpdb01
pg1-host-user=postgres
pg1-path=/var/lib/postgresql/16/main
pg1-port=5432
pg2-host=auishqosrpdb02
pg2-host-user=postgres
pg2-path=/var/lib/postgresql/16/main
pg2-port=5432
EOF
$ sudo chown postgres:postgres /etc/pgbackrest/pgbackrest.conf
$ sudo chmod 640 /etc/pgbackrest/pgbackrest.conf

# Initialise the stanza (run once, on the primary)
# [auishqosrpdb01]
$ sudo -u postgres pgbackrest --stanza=app stanza-create
$ sudo -u postgres pgbackrest --stanza=app check
# Expected: "completed successfully"

# First full backup — taken from replica per backup-standby=y
$ sudo -u postgres pgbackrest --stanza=app --type=full backup
# Expected: "backup completed successfully"

# Schedule periodic backups via systemd timer (no cron)
$ sudo tee /etc/systemd/system/pgbackrest-full.service > /dev/null <<'EOF'
[Unit]
Description=pgBackRest weekly full backup
After=postgresql.service

[Service]
Type=oneshot
User=postgres
ExecStart=/usr/bin/pgbackrest --stanza=app --type=full --log-level-console=warn backup
EOF

$ sudo tee /etc/systemd/system/pgbackrest-full.timer > /dev/null <<'EOF'
[Unit]
Description=pgBackRest weekly full backup timer

[Timer]
OnCalendar=Sun 02:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

$ sudo tee /etc/systemd/system/pgbackrest-diff.service > /dev/null <<'EOF'
[Unit]
Description=pgBackRest daily differential backup
After=postgresql.service

[Service]
Type=oneshot
User=postgres
ExecStart=/usr/bin/pgbackrest --stanza=app --type=diff --log-level-console=warn backup
EOF

$ sudo tee /etc/systemd/system/pgbackrest-diff.timer > /dev/null <<'EOF'
[Unit]
Description=pgBackRest daily differential backup timer

[Timer]
OnCalendar=Mon..Sat 02:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

$ sudo systemctl daemon-reload
$ sudo systemctl enable --now pgbackrest-full.timer pgbackrest-diff.timer
$ sudo systemctl list-timers pgbackrest-*
```

**PITR drill** — quarterly. Restore to a third VM (or a temporary VM provisioned for the drill), recover to a target time, verify, destroy.

```bash
# [drill VM] — bring up an empty Postgres pointed at the same pgbackrest repo
$ sudo -u postgres pgbackrest --stanza=app --delta \
    --type=time --target="2026-05-02 14:30:00" \
    --target-action=promote restore
$ sudo systemctl start postgresql@16-main
# Verify the data state matches what was true at the target time
```

### 13.8 Application roles + credentials in Vault

Per-app database role pattern. Reproduce per app:

```bash
# [auishqosrpdb01] — for each app, create a role + database + grant
$ sudo -u postgres psql <<'EOF'
-- Per-app role with statement timeout override
CREATE ROLE app_greenbook LOGIN PASSWORD 'BOOTSTRAP';
ALTER ROLE app_greenbook SET statement_timeout = '30s';
ALTER ROLE app_greenbook SET idle_in_transaction_session_timeout = '2min';

-- Per-app database
CREATE DATABASE greenbook OWNER app_greenbook ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' TEMPLATE template0;

-- Lock down the public schema
\c greenbook
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO app_greenbook;

-- Optional: read-only role for analytics / reporting
CREATE ROLE app_greenbook_ro LOGIN PASSWORD 'BOOTSTRAP_RO';
GRANT CONNECT ON DATABASE greenbook TO app_greenbook_ro;
GRANT USAGE ON SCHEMA public TO app_greenbook_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_greenbook_ro;
EOF

# Stash creds in Vault — apps fetch via Nomad workload identity (chapter 05 §5.9 pattern)
$ APP_PASS=$(openssl rand -base64 32)
$ vault kv put kv/apps/greenbook/database \
    host='auishqosrpdb01' \
    port='5432' \
    database='greenbook' \
    username='app_greenbook' \
    password="$APP_PASS" \
    sslmode='require' \
    rotated_at="$(date -Iseconds)" \
    rotation_period_days=90

$ sudo -u postgres psql -c "ALTER ROLE app_greenbook PASSWORD '$APP_PASS';"
```

The convention `kv/apps/<app>/database` maps to a single Vault policy that the app's Nomad job is bound to via JWT workload identity. Phase 5 [chapter 22 — Dynamic Vault secrets](22-dynamic-secrets.md) replaces these static rotated passwords with on-demand generated credentials per Vault lease.

### 13.9 postgres_exporter for Prometheus

Chapter 10's scrape config already references `postgres_exporter` on `auishqosrkdb01:9187` for the Keycloak DB. Same exporter, new hosts:

```bash
# [auishqosrpdb01-02]

$ sudo apt install -y prometheus-postgres-exporter
$ sudo apt-mark hold prometheus-postgres-exporter

# Service account inside Postgres
$ sudo -u postgres psql <<'EOF'
CREATE ROLE postgres_exporter LOGIN PASSWORD 'METRICS_PASSWORD';
GRANT pg_monitor TO postgres_exporter;
ALTER ROLE postgres_exporter SET statement_timeout = '5s';
EOF

$ METRICS_PASS=$(openssl rand -base64 32)
$ sudo -u postgres psql -c "ALTER ROLE postgres_exporter PASSWORD '$METRICS_PASS';"
$ vault kv put kv/platform/postgres/exporter \
    username='postgres_exporter' password="$METRICS_PASS" \
    rotated_at="$(date -Iseconds)" rotation_period_days=180

# Configure exporter
$ sudo tee /etc/default/prometheus-postgres-exporter > /dev/null <<EOF
DATA_SOURCE_NAME="postgresql://postgres_exporter:$METRICS_PASS@127.0.0.1:5432/postgres?sslmode=disable"
ARGS="--web.listen-address=:9187 --collector.stat_statements --collector.long_running_transactions"
EOF
$ sudo chmod 600 /etc/default/prometheus-postgres-exporter

$ sudo systemctl restart prometheus-postgres-exporter
$ sudo systemctl enable prometheus-postgres-exporter
$ curl -s http://127.0.0.1:9187/metrics | head -10
```

Add to chapter 10's scrape config:

```bash
# [each obs VM — auishqosrobs01-03]
$ sudo tee /etc/prometheus/scrapes.d/postgres.yml > /dev/null <<'EOF'
scrape_configs:
  - job_name: postgres
    static_configs:
      - targets: [auishqosrkdb01:9187]
        labels: { role: postgres, instance_role: keycloak-db }
      - targets: [auishqosrpdb01:9187]
        labels: { role: postgres, instance_role: app-db-primary }
      - targets: [auishqosrpdb02:9187]
        labels: { role: postgres, instance_role: app-db-replica }
EOF

$ sudo -u prometheus promtool check config /etc/prometheus/prometheus.yml
$ curl -X POST http://127.0.0.1:9090/-/reload
```

The `pg_replication_lag_seconds` alert in chapter 12 §12.6 is generic — it now fires on the new app DB cluster as well, no rule changes needed.

### 13.10 Manual failover procedure (with drill cadence)

Phase 3 failover is manual. The procedure must be **rehearsed quarterly** — a procedure that's never been run is a procedure that doesn't work.

**Detection** — ops sees `PostgresDown` (CRITICAL) for `auishqosrpdb01` in Alertmanager, plus app errors in Loki.

**Decision** — declare the primary lost only after:

1. SSH to `auishqosrpdb01` failed
2. Ping fails, or VM is hung in hypervisor
3. Disk corruption / OS-level failure confirmed

If the primary is up but Postgres is just slow, **do not failover** — fix Postgres in place. Failover is for hard failures.

**Promotion** — on `auishqosrpdb02`:

```bash
# (1) Verify replica is caught up enough — if lag is high, decide:
#     accept data loss, or wait for catch-up before promoting
$ sudo -u postgres psql -c "SELECT pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn(), \
    now() - pg_last_xact_replay_timestamp() AS lag;"

# (2) Promote
$ sudo -u postgres pg_ctl promote -D /var/lib/postgresql/16/main
# Or via SQL: SELECT pg_promote();

# (3) Verify it's now primary
$ sudo -u postgres psql -c "SELECT pg_is_in_recovery();"
# Expected: f

# (4) Update DNS / config — apps were pointed at auishqosrpdb01.au-internal;
#     repoint that A record (or the Consul service in chapter 17) at .31
$ ssh dns-admin "update-record auishqosrpdb01.au-internal A 10.111.20.31"

# (5) Apps reconnect on next attempt (their connection pools cycle within ~30s)
```

**Hard fence the old primary** — before letting `auishqosrpdb01` come back, prevent split-brain:

```bash
# On the old primary (when it returns)
$ sudo systemctl stop postgresql@16-main
$ sudo touch /var/lib/postgresql/16/main/recovery.signal
# DO NOT start until rebuilt as a replica via pg_rewind or fresh pg_basebackup
```

**Rebuild old primary as new replica** — once the original is back:

```bash
# [auishqosrpdb01]
$ sudo -u postgres pg_rewind \
    --target-pgdata=/var/lib/postgresql/16/main \
    --source-server="host=auishqosrpdb02 port=5432 user=replicator password=$REPL_PASS" \
    --progress

$ sudo -u postgres tee /etc/postgresql/16/main/conf.d/10-replica.conf > /dev/null <<EOF
primary_conninfo = 'host=auishqosrpdb02 port=5432 user=replicator password=$REPL_PASS application_name=pdb01 sslmode=require'
primary_slot_name = 'replica_pdb01'
EOF
$ sudo -u postgres touch /var/lib/postgresql/16/main/standby.signal
$ sudo -u postgres psql -h auishqosrpdb02 -c \
    "SELECT pg_create_physical_replication_slot('replica_pdb01');"
$ sudo systemctl start postgresql@16-main
```

**Drill cadence**: schedule quarterly; document each drill's `start → promote → repoint → rebuild → done` timing in the runbook. RTO target: <30 min for a deliberate, drilled failover. Phase 5 Patroni reduces this to <30 sec automatic.

### 13.11 UFW + firewall rules

```bash
# [auishqosrpdb01-02]

# App connections from the App VLAN
$ sudo ufw allow from 10.111.10.0/24 to any port 5432 proto tcp comment 'Postgres ← App VLAN'

# Replication: primary accepts from replica, replica accepts from primary (pg_rewind needs both directions)
$ sudo ufw allow from 10.111.20.30 to any port 5432 proto tcp comment 'Postgres ← peer pdb01'
$ sudo ufw allow from 10.111.20.31 to any port 5432 proto tcp comment 'Postgres ← peer pdb02'

# Operations VLAN for ops tooling (psql via bastion)
$ sudo ufw allow from 10.111.40.0/24 to any port 5432 proto tcp comment 'Postgres ← Ops VLAN'

# postgres_exporter scraped from obs VMs (chapter 10)
$ sudo ufw allow from 10.111.30.0/24 to any port 9187 proto tcp comment 'Prometheus → postgres_exporter'

# pgBackRest control connection (we run backup commands from the primary, talking to itself + replica)
# Already covered by the peer-to-peer 5432 rules above.
```

### 13.12 Verification

```bash
# (1) Both nodes up
$ for h in 01 02; do
    ssh -J au-bastion auishqosrpdb${h}.au-internal \
      'sudo systemctl is-active postgresql@16-main'
  done
# Expected: active from each

# (2) Replication healthy (ran in §13.6 — re-run here for the verification ladder)
$ ssh -J au-bastion auishqosrpdb01.au-internal \
    'sudo -u postgres psql -tAc "SELECT count(*) FROM pg_stat_replication WHERE state=\"streaming\";"'
# Expected: 1

# (3) Lag is sane
$ ssh -J au-bastion auishqosrpdb02.au-internal \
    'sudo -u postgres psql -tAc "SELECT extract(epoch from now() - pg_last_xact_replay_timestamp())"'
# Expected: <5

# (4) WAL archive working
$ ssh -J au-bastion auishqosrpdb01.au-internal \
    'sudo -u postgres pgbackrest --stanza=app info'
# Expected: shows last full + diff backups, WAL archive range covers the last 14 days

# (5) Prometheus sees both exporters
$ ssh -J au-bastion auishqosrobs01.au-internal \
    'curl -sG http://127.0.0.1:9090/api/v1/query \
      --data-urlencode "query=up{job=\"postgres\"}" | jq ".data.result[] | {instance:.metric.instance, value:.value[1]}"'
# Expected: 3 results (kdb01, pdb01, pdb02), all value="1"

# (6) Alertmanager rule fires on synthetic primary down
#     Stop pdb01: sudo systemctl stop postgresql@16-main
#     Wait 2 min → "PostgresDown" CRITICAL alert in email DL
#     Restart: sudo systemctl start postgresql@16-main
#     Wait 2 min → "PostgresDown" resolved

# (7) Failover drill — quarterly; record timing per the §13.10 runbook

# (8) PITR drill — quarterly; restore to a throwaway VM
```

**Common failures and remedies:**

| Symptom                                                | Cause                                                             | Fix                                                                                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Replica won't start: "replication slot does not exist" | Slot was dropped on primary while replica was disconnected        | Recreate slot on primary; restart replica                                                                                       |
| Lag grows without bound                                | Long-running query on primary, or replica disk slow               | Identify offender on primary via `pg_stat_activity`; check replica disk IO; raise alert threshold only after the cause is fixed |
| `archive_command` failing — disk fills with WAL        | pgBackRest target unreachable; retention misconfigured            | `journalctl -u postgresql@16-main` for the actual error; verify pgbackrest reachable; `pgbackrest expire`                       |
| `pg_basebackup` fails with "max_wal_senders exceeded"  | Other replicas/clones holding sender slots                        | `SELECT * FROM pg_stat_replication;` — drop stale clients; raise `max_wal_senders`                                              |
| Apps see "FATAL: too many connections"                 | Primary's `max_connections` exhausted; PgBouncer not yet in front | Phase 3 ch16 (PgBouncer) is the proper fix; emergency: raise `max_connections` (memory cost: ~10MB per connection)              |
| Promotion succeeded but old primary still has writes   | Hard fence skipped                                                | Stop old primary immediately; rebuild via pg_rewind; investigate which writes happened post-failover                            |
| `pgaudit` log volume overwhelms Loki                   | `pgaudit.log = 'all'` instead of `'role,ddl,write'`               | Tune the level; restart                                                                                                         |

### 13.13 Applying the pattern to Keycloak's DB

Chapter 07 deployed `auishqosrkdb01` as a single-VM Postgres for Keycloak. With the pattern above proven for the app DB cluster, retrofit it:

1. Provision `auishqosrkdb02` (10.111.20.21; same 4 vCPU / 8 GB RAM / 100 GB disk shape as kdb01).
2. Install PG16 per §13.3.
3. Add the streaming-replication config to kdb01 per §13.4 (rolling restart with brief downtime — schedule a maintenance window).
4. Bootstrap kdb02 from kdb01 per §13.5.
5. Add a separate pgBackRest stanza `[keycloak]` in `/etc/pgbackrest/pgbackrest.conf` pointing at `kdb01` + `kdb02`.
6. Run `stanza-create` and the first full backup.
7. Add kdb02 to the Prometheus scrape config from §13.9.
8. Add kdb01 → kdb02 to the §13.11 UFW rules.

Result: Keycloak SSO availability matches the app cluster's. The Phase 5 Patroni upgrade applies to both clusters with one runbook.

### 13.14 Phase 5 path (Patroni + etcd for automated failover)

Phase 5 [chapter 22 — Dynamic Vault secrets](22-dynamic-secrets.md) covers credential rotation; **automated Postgres failover** is a separate Phase 5 concern (provisionally chapter 24 — slot reserved when Phase 5 detail lands).

The migration target:

- **Patroni** runs on each Postgres node, manages start/stop/promote, holds the cluster topology in **etcd** (3-node consensus store; can colocate with Consul or stand alone)
- Patroni handles leader election, fencing, automated failover (<30 sec RTO)
- **HAProxy** in chapter 17 already fronts the cluster; its TCP health-check switches the writer endpoint without app changes
- Manual `pg_ctl promote` is replaced by `patronictl failover`; the §13.10 procedure becomes "click a button or wait for it to happen"

Migration cost: ~1 day of effort per cluster (app + Keycloak), zero schema impact, brief downtime per node during initial Patroni adoption.

The streaming-replication pattern, pgBackRest setup, and per-app role design **all carry over unchanged**. Patroni layers on top — it doesn't replace the foundation laid here.

---
