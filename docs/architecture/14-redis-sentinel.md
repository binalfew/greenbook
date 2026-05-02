# 14 — Redis Sentinel

> **Phase**: 3 (app scaling + edge HA) · **Run on**: 3× Redis VMs (`auishqosrred01-03`); each runs both a Redis instance and a Sentinel · **Time**: ~3 hours
>
> Highly-available Redis for sessions, cache, rate limits, and queues. One master, two replicas, three Sentinels. Apps connect via a Sentinel-aware client and follow master flips automatically.
>
> Phase 3 chapter 2 of 6.
>
> **Prev**: [13 — Postgres HA](13-postgres-ha.md) · **Next**: [15 — MinIO](15-minio.md) · **Index**: [README](README.md)

---

## Contents

- [§14.1 Role + threat model](#141-role-threat-model)
- [§14.2 Pre-flight (3 dedicated Redis VMs)](#142-pre-flight-3-dedicated-redis-vms)
- [§14.3 Install Redis 7 on all 3 nodes](#143-install-redis-7-on-all-3-nodes)
- [§14.4 Redis configuration (master + replicas)](#144-redis-configuration-master-replicas)
- [§14.5 Sentinel configuration](#145-sentinel-configuration)
- [§14.6 Bootstrap the cluster + verify](#146-bootstrap-the-cluster-verify)
- [§14.7 Application access pattern (Sentinel-aware clients)](#147-application-access-pattern-sentinel-aware-clients)
- [§14.8 Persistence + backup strategy](#148-persistence-backup-strategy)
- [§14.9 redis_exporter for Prometheus](#149-redis_exporter-for-prometheus)
- [§14.10 Failover behaviour + drill](#1410-failover-behaviour-drill)
- [§14.11 UFW + firewall rules](#1411-ufw-firewall-rules)
- [§14.12 Verification](#1412-verification)
- [§14.13 Phase 5 path (Redis Cluster for sharding)](#1413-phase-5-path-redis-cluster-for-sharding)

## 14. Redis Sentinel

### 14.1 Role + threat model

Redis is the platform's in-memory key-value store. Apps use it for:

- **Session storage** (Express sessions, signed cookies; greenbook will move from Postgres-backed sessions to Redis here)
- **Cache** (rate-limit counters, idempotency keys, computed views)
- **Queues + pub/sub** (BullMQ-style job queues, real-time event fanout to SSE)

The HA pattern is **Redis Sentinel** — async replication from a master to N replicas, with a separate consensus group (the Sentinels) that watches the master and triggers failover when it dies.

```
                ┌────────────────────────────────────────┐
                │  red01 (master)                        │
                │   Redis ────async replication────▶     │
                │   Sentinel #1                          │
                └────────────────┬───────────────────────┘
                                 │
                ┌────────────────┴───────────────────────┐
                ▼                                        ▼
        ┌──────────────────┐                   ┌──────────────────┐
        │ red02 (replica)  │                   │ red03 (replica)  │
        │   Redis          │                   │   Redis          │
        │   Sentinel #2    │◀──── gossip ─────▶│   Sentinel #3    │
        └──────────────────┘                   └──────────────────┘
```

Three Sentinels (one per VM) gives `quorum=2`: at least 2 Sentinels must agree before declaring the master dead and electing a new one. With 3, the cluster tolerates losing 1 Sentinel and still functions; losing 2 stops failover (but Redis itself keeps serving from whichever node is still up).

Three consequences:

1. **Compromise = session theft + cache poisoning.** Redis holds session tokens for every authenticated user; a read attacker can hijack sessions, a write attacker can inject cache entries that flow back into the app. Defence: bind to internal interfaces only; `requirepass` (Phase 3) → ACLs per app (Phase 5); TLS in transit (Phase 5); never store data that can't be reconstructed.
2. **Outage = apps lose sessions and rate-limit state.** Sessions invalidate (users log back in); rate limits reset (small window of unrestricted traffic). Mitigation: Sentinel failover is fast (~10-30 sec, mostly governed by `down-after-milliseconds`); apps with sticky sessions in cookies + DB-backed user state recover transparently; queue consumers with idempotent handlers replay safely.
3. **Replication lag + split-brain are the realistic failure modes.** Async replication means a write to the master can be lost if the master dies before replicating; a network partition can leave both sides thinking they're master. Defence: `min-replicas-to-write 1` (refuse writes if no replica is online); Sentinel quorum > N/2 prevents split-brain failover; apps treat Redis as cache, not source of truth.

**Threat model — what we defend against:**

| Threat                                        | Mitigation                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Compromised app reads other apps' keys        | Per-app key-prefix convention (`<app>:*`); ACLs + per-app passwords in Phase 5; today: trust boundary at the app role   |
| Replay of old session tokens after compromise | Apps must validate sessions against a server-side TTL; session keys carry creation timestamps                           |
| Master dies before replicating last write     | `min-replicas-to-write 1`; apps treat Redis as cache, not source of truth (canonical data lives in Postgres)            |
| Split-brain (network partition)               | Sentinel quorum=2 of 3; only the partition holding majority can fail over; minority side becomes read-only on reconnect |
| Eviction surprises during memory pressure     | `maxmemory-policy allkeys-lru` for caches; `noeviction` for queues + sessions (let writes fail rather than lose data)   |
| Sentinel itself becomes unreachable           | 3 Sentinels colocated with Redis; losing 1 still leaves quorum                                                          |
| Backup tampering / loss                       | RDB snapshot every 5 min; offsite copy via the Phase 3 ch15 MinIO once it lands                                         |

**Phase 3 deliberate non-goals:**

- **Redis Cluster (sharding)** — Sentinel handles HA; clustering handles horizontal scale. We don't need horizontal scale at Phase 3 RAM sizes. Phase 5 [chapter 26 — Redis Cluster](26-redis-cluster.md) (slot reserved) covers the migration when one node's RAM isn't enough.
- **TLS in transit** — Redis 6+ supports TLS, but the cert distribution + sentinel-TLS interaction adds complexity. Phase 3 stays plain-text on the internal VLAN; Phase 5 turns it on.
- **ACLs (per-app users)** — Redis 6+ supports per-user ACLs, but Phase 3 uses one shared `requirepass`. Phase 5 ch22 (dynamic Vault secrets) introduces per-app ACL users.
- **Redis Stack modules** (RedisJSON, RediSearch, RedisGraph) — out of scope; if a future app needs document search, it goes in Postgres + pg_trgm or Loki.
- **Multi-region replication** — single-DC for Phase 3; Phase 4 ch20 (DR) adds an off-site replica.

### 14.2 Pre-flight (3 dedicated Redis VMs)

Three new Ubuntu 24.04 VMs hardened to AU base. Skip §1.8. Operator account membership.

| Role            | Hostname         | IP           | vCPU | RAM   | Disk       | Notes                                                 |
| --------------- | ---------------- | ------------ | ---- | ----- | ---------- | ----------------------------------------------------- |
| Redis master    | `auishqosrred01` | 10.111.20.40 | 4    | 16 GB | 100 GB SSD | ~12 GB usable for Redis data; rest for OS + AOF + RDB |
| Redis replica 1 | `auishqosrred02` | 10.111.20.41 | 4    | 16 GB | 100 GB SSD | Same shape — must absorb full load on promotion       |
| Redis replica 2 | `auishqosrred03` | 10.111.20.42 | 4    | 16 GB | 100 GB SSD | Same                                                  |

Same-shape rule from chapter 13 applies: any replica might become master, so they need to be sized identically.

```bash
# [each Redis VM]
$ lsb_release -d
$ sudo systemctl is-active unattended-upgrades fail2ban
$ groups | grep operators

# Disable Transparent Huge Pages — Redis docs explicitly require this
$ sudo tee /etc/systemd/system/disable-thp.service > /dev/null <<'EOF'
[Unit]
Description=Disable Transparent Huge Pages
DefaultDependencies=no
After=sysinit.target local-fs.target
Before=basic.target redis-server.service redis-sentinel.service

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'echo never > /sys/kernel/mm/transparent_hugepage/enabled'
ExecStart=/bin/sh -c 'echo never > /sys/kernel/mm/transparent_hugepage/defrag'
RemainAfterExit=yes

[Install]
WantedBy=basic.target
EOF
$ sudo systemctl enable --now disable-thp
$ cat /sys/kernel/mm/transparent_hugepage/enabled   # expected: [never]

# overcommit_memory=1 — Redis docs require this for fork-based BGSAVE
$ echo 'vm.overcommit_memory=1' | sudo tee /etc/sysctl.d/99-redis.conf
$ sudo sysctl --system

# somaxconn for high-concurrency clients
$ echo 'net.core.somaxconn=1024' | sudo tee -a /etc/sysctl.d/99-redis.conf
$ sudo sysctl --system
```

The THP disable + overcommit_memory + somaxconn tuning are non-optional — Redis logs warnings on every startup if they're missing, and BGSAVE / BGREWRITEAOF can hang or OOM under pressure without them.

### 14.3 Install Redis 7 on all 3 nodes

```bash
# [auishqosrred01-03]

# (1) Redis apt repo (gives 7.x LTS — Ubuntu 24.04 ships 7.0, the apt repo is current)
$ curl -fsSL https://packages.redis.io/gpg | sudo gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg
$ echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" \
    | sudo tee /etc/apt/sources.list.d/redis.list

# (2) Install
$ sudo apt update
$ sudo apt install -y redis
$ sudo apt-mark hold redis redis-server redis-sentinel redis-tools

# (3) Stop both — we'll reconfigure before starting
$ sudo systemctl stop redis-server redis-sentinel
$ sudo systemctl disable redis-server redis-sentinel    # we'll re-enable after config

# (4) Verify
$ redis-server --version
$ redis-sentinel --version
```

### 14.4 Redis configuration (master + replicas)

The Redis config is _almost_ identical on all 3 nodes; the only difference is which one starts as the initial master (the other two are bootstrapped as replicas, then Sentinel takes over).

```bash
# [each Redis VM — same config]

$ sudo tee /etc/redis/redis.conf > /dev/null <<'EOF'
# ───────── Networking ─────────
bind 0.0.0.0 -::0
port 6379
protected-mode yes
tcp-keepalive 300
tcp-backlog 511
timeout 0

# ───────── Authentication ─────────
# Both requirepass + masterauth use the same Vault-stored secret.
# requirepass: clients must AUTH this password.
# masterauth:  this Redis (when acting as a replica) authenticates to the master with it.
requirepass REPLACE_ME_FROM_VAULT
masterauth  REPLACE_ME_FROM_VAULT

# ───────── Memory + eviction ─────────
maxmemory 12gb
maxmemory-policy allkeys-lru
maxmemory-samples 5

# ───────── Persistence: AOF (durability) + RDB (snapshots) ─────────
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec                # default; trades 1s of data on crash for performance
no-appendfsync-on-rewrite no
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
aof-load-truncated yes
aof-use-rdb-preamble yes

save 900 1                          # RDB snapshot if 1 key changed in 900s
save 300 10                         # OR 10 keys in 300s
save 60 10000                       # OR 10000 keys in 60s
stop-writes-on-bgsave-error yes
rdbcompression yes
rdbchecksum yes
dbfilename dump.rdb
dir /var/lib/redis

# ───────── Replication ─────────
replica-serve-stale-data yes
replica-read-only yes
repl-diskless-sync yes
repl-diskless-sync-delay 5
repl-backlog-size 256mb
repl-backlog-ttl 3600

# Refuse writes if no replicas are online — protects against silent data loss
min-replicas-to-write 1
min-replicas-max-lag 10

# ───────── Logging ─────────
loglevel notice
logfile /var/log/redis/redis-server.log
syslog-enabled no                   # let Promtail tail the file directly

# ───────── Slow log ─────────
slowlog-log-slower-than 10000       # microseconds — log queries >10ms
slowlog-max-len 128

# ───────── Latency monitoring ─────────
latency-monitor-threshold 100       # ms — events that took longer go in the latency event log

# ───────── Client output buffers ─────────
client-output-buffer-limit normal 0 0 0
client-output-buffer-limit replica 256mb 64mb 60
client-output-buffer-limit pubsub 32mb 8mb 60

# ───────── Misc ─────────
databases 16
hz 10
dynamic-hz yes
EOF

# (1) Pull the shared password from Vault (or create + stash it on first run)
$ REDIS_PASS=$(openssl rand -base64 48 | tr -d '/+=' | head -c 48)
$ vault kv put kv/platform/redis/auth \
    password="$REDIS_PASS" \
    rotated_at="$(date -Iseconds)" \
    rotation_period_days=180

# (2) Substitute into config (placeholder → real value)
$ sudo sed -i "s|REPLACE_ME_FROM_VAULT|$REDIS_PASS|g" /etc/redis/redis.conf

# (3) Lock the config file — it now contains a secret
$ sudo chown redis:redis /etc/redis/redis.conf
$ sudo chmod 640 /etc/redis/redis.conf

# (4) Data + log dirs
$ sudo install -d -m 750 -o redis -g redis /var/lib/redis /var/log/redis
```

**Bootstrap the master** — only on `auishqosrred01`:

```bash
# [auishqosrred01]
$ sudo systemctl enable --now redis-server
$ sudo systemctl status redis-server --no-pager | head -5
$ redis-cli -a "$REDIS_PASS" ping
# Expected: PONG
$ redis-cli -a "$REDIS_PASS" info server | grep redis_version
```

**Bootstrap the replicas** — on `auishqosrred02` and `auishqosrred03`:

```bash
# [auishqosrred02 + auishqosrred03]
$ sudo tee -a /etc/redis/redis.conf > /dev/null <<EOF

# ───────── Initial replica configuration ─────────
# Sentinel will rewrite this stanza after first failover; that's expected.
replicaof auishqosrred01 6379
EOF

$ sudo systemctl enable --now redis-server
$ sudo systemctl status redis-server --no-pager | head -5

# Verify replication on the master
$ ssh -J au-bastion auishqosrred01.au-internal \
    "redis-cli -a $REDIS_PASS info replication"
# Expected: role:master, connected_slaves:2, slave0/slave1 with state=online
```

### 14.5 Sentinel configuration

Sentinel runs on each of the 3 nodes (alongside Redis). It needs to know:

- The initial master address
- The shared `requirepass` (so Sentinel can monitor a password-protected master)
- The quorum threshold (= 2 with 3 sentinels)

```bash
# [each Redis VM — same Sentinel config]

$ sudo tee /etc/redis/sentinel.conf > /dev/null <<EOF
port 26379
bind 0.0.0.0 -::0
daemonize no
pidfile /var/run/redis/redis-sentinel.pid
logfile /var/log/redis/redis-sentinel.log
dir /var/lib/redis-sentinel

# Monitor the master named "platform" with quorum=2
sentinel monitor platform 10.111.20.40 6379 2

# Auth — Sentinel needs the password to talk to Redis
sentinel auth-pass platform $REDIS_PASS

# Failover tuning
sentinel down-after-milliseconds platform 5000     # consider master down after 5s of no PONG
sentinel parallel-syncs platform 1                 # promote replicas one at a time after failover
sentinel failover-timeout platform 60000           # 60s total failover budget

# Don't auto-rewrite Sentinel script paths (security: prevents config injection)
sentinel deny-scripts-reconfig yes

# This Sentinel's announce IP — used in gossip (REPLACE per node)
sentinel announce-ip 10.111.20.40                   # red01 → .40, red02 → .41, red03 → .42
sentinel announce-port 26379
EOF

# Per-node IP fix
$ HOSTSHORT=$(hostname -s)
$ case "$HOSTSHORT" in
    auishqosrred02) sudo sed -i 's/announce-ip 10.111.20.40/announce-ip 10.111.20.41/' /etc/redis/sentinel.conf ;;
    auishqosrred03) sudo sed -i 's/announce-ip 10.111.20.40/announce-ip 10.111.20.42/' /etc/redis/sentinel.conf ;;
  esac
$ grep '^sentinel announce-ip' /etc/redis/sentinel.conf

# Sentinel will rewrite this file after the first failover (recording new master + replicas).
# That's expected — DO NOT manage sentinel.conf via Ansible drift checks; instead, source-control
# the bootstrap version and accept that the running file diverges.
$ sudo chown redis:redis /etc/redis/sentinel.conf
$ sudo chmod 640 /etc/redis/sentinel.conf
$ sudo install -d -m 750 -o redis -g redis /var/lib/redis-sentinel

# Start Sentinel on all 3 nodes
$ sudo systemctl enable --now redis-sentinel
$ sudo systemctl status redis-sentinel --no-pager | head -5
```

> **ℹ Why Sentinel rewrites its own config**
>
> Sentinel persists discovered topology back into `sentinel.conf` (which replicas it knows about, last-seen master, leader-of-the-moment). After a failover, the file no longer matches what was deployed. This is by design — Sentinel needs that state across restarts. Treat the bootstrap file as the **initial state**, not the **canonical state**.

### 14.6 Bootstrap the cluster + verify

```bash
# (1) Sentinel sees the master + 2 replicas
$ ssh -J au-bastion auishqosrred01.au-internal \
    "redis-cli -p 26379 sentinel master platform"
# Expected: name=platform, ip=10.111.20.40, num-slaves=2, num-other-sentinels=2, quorum=2

$ ssh -J au-bastion auishqosrred01.au-internal \
    "redis-cli -p 26379 sentinel replicas platform"
# Expected: 2 entries, ip=10.111.20.41, 10.111.20.42, status=ok

$ ssh -J au-bastion auishqosrred01.au-internal \
    "redis-cli -p 26379 sentinel sentinels platform"
# Expected: 2 entries (the OTHER 2 sentinels — gossip excludes self)

# (2) Round-trip write/read test
$ ssh -J au-bastion auishqosrred01.au-internal \
    "redis-cli -a $REDIS_PASS SET _replcheck 'hello' EX 60"
# Expected: OK

$ sleep 1

$ ssh -J au-bastion auishqosrred02.au-internal \
    "redis-cli -a $REDIS_PASS GET _replcheck"
# Expected: hello (the replica served the read)

$ ssh -J au-bastion auishqosrred02.au-internal \
    "redis-cli -a $REDIS_PASS SET _badwrite 'should-fail'"
# Expected: (error) READONLY You can't write against a read only replica.
```

### 14.7 Application access pattern (Sentinel-aware clients)

Apps must use a **Sentinel-aware client library** — they connect to the Sentinel set, ask "who's the current master?", and reconnect when Sentinel announces a failover. This is fundamentally different from Postgres (where apps use a fixed primary IP and DNS / HAProxy handles failover).

| Language | Library               | Sentinel pattern                                                                    |
| -------- | --------------------- | ----------------------------------------------------------------------------------- |
| Node.js  | `ioredis` (preferred) | `new Redis({ sentinels: [...], name: 'platform', password: ... })`                  |
| Python   | `redis-py`            | `Sentinel([...]).master_for('platform', password=...)`                              |
| Java     | Lettuce or Jedis      | `RedisSentinelConfiguration` with master name + sentinel addresses                  |
| Go       | `go-redis/redis`      | `redis.NewFailoverClient(&redis.FailoverOptions{ MasterName, SentinelAddrs, ... })` |
| Ruby     | `redis-rb`            | `Redis.new(name: 'platform', sentinels: [...])`                                     |

**Connection details apps fetch from Vault** (`kv/apps/<app>/redis`):

```bash
$ vault kv put kv/apps/greenbook/redis \
    sentinels='auishqosrred01:26379,auishqosrred02:26379,auishqosrred03:26379' \
    master_name='platform' \
    password="$REDIS_PASS" \
    rotated_at="$(date -Iseconds)" \
    rotation_period_days=180
```

> **⚠ Key namespacing convention**
>
> Until per-app ACLs land in Phase 5, all apps share one Redis with one password. Apps **must** namespace their keys with their app name as a prefix:
>
> - `greenbook:session:<sid>` ✓
> - `greenbook:rate-limit:<ip>` ✓
> - `session:<sid>` ✗ (no prefix — collides with other apps)
>
> The chapter 30 onboarding workflow enforces this in code review.

> **ℹ Avoid `KEYS *` in production**
>
> `KEYS` is O(n) over the entire keyspace and blocks the single-threaded server. Use `SCAN` with a cursor instead. The `slowlog-log-slower-than 10000` setting in §14.4 will catch slow `KEYS` calls; chapter 12's `RedisSlowQuery` alert (added in §14.10) will fire on them.

### 14.8 Persistence + backup strategy

Redis persists in two complementary ways:

**RDB (Redis Database)** — periodic point-in-time snapshots written to `dump.rdb`. Fast to load on restart; small files; loses up to N seconds of writes between snapshots.

**AOF (Append-Only File)** — every write command appended to `appendonly.aof`. Slower to load (replay-based); larger; loses at most 1 second of writes (with `appendfsync everysec`).

The §14.4 config enables **both** — RDB for fast-recovery, AOF for durability. Modern Redis writes a hybrid file: RDB header for fast load, then AOF tail for the recent writes. `aof-use-rdb-preamble yes` enables this.

**Backup target:**

Phase 3 ships local-only backups. Once chapter 15 (MinIO) lands, add an offsite copy:

```bash
# [auishqosrred01 — runs only on whoever is currently master]
$ sudo tee /usr/local/bin/redis-backup.sh > /dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
REDIS_PASS=$(vault kv get -field=password kv/platform/redis/auth)
DATE=$(date -u +%Y%m%dT%H%M%SZ)
HOST=$(hostname -s)

# Trigger a synchronous BGSAVE
redis-cli -a "$REDIS_PASS" BGSAVE
sleep 5

# Wait for it to finish
while [[ $(redis-cli -a "$REDIS_PASS" --no-auth-warning LASTSAVE) == \
         $(redis-cli -a "$REDIS_PASS" --no-auth-warning LASTSAVE) ]]; do
  sleep 2
done

# Copy snapshot to MinIO (Phase 3 ch15)
mc cp /var/lib/redis/dump.rdb \
   au-minio/redis-backups/${HOST}/dump-${DATE}.rdb
EOF
$ sudo chmod 750 /usr/local/bin/redis-backup.sh

# Run only if we're the current master (idempotent — can run on all 3, only master backs up)
$ sudo tee /etc/systemd/system/redis-backup.service > /dev/null <<'EOF'
[Unit]
Description=Redis BGSAVE + offsite copy
After=redis-server.service

[Service]
Type=oneshot
ExecCondition=/bin/sh -c 'redis-cli -a $(vault kv get -field=password kv/platform/redis/auth) info replication | grep -q "^role:master"'
ExecStart=/usr/local/bin/redis-backup.sh
EOF

$ sudo tee /etc/systemd/system/redis-backup.timer > /dev/null <<'EOF'
[Unit]
Description=Hourly Redis backup

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
EOF

$ sudo systemctl daemon-reload
$ sudo systemctl enable --now redis-backup.timer
```

The `ExecCondition` check ensures that even though the timer fires on all 3 nodes, only the current master actually performs the backup — the other two skip cleanly. After a failover, the new master starts backing up automatically.

### 14.9 redis_exporter for Prometheus

```bash
# [auishqosrred01-03]

$ sudo apt install -y prometheus-redis-exporter
$ sudo apt-mark hold prometheus-redis-exporter

# Exporter needs the Redis password
$ REDIS_PASS=$(vault kv get -field=password kv/platform/redis/auth)
$ sudo tee /etc/default/prometheus-redis-exporter > /dev/null <<EOF
ARGS="--redis.addr=redis://127.0.0.1:6379 \
      --redis.password=$REDIS_PASS \
      --web.listen-address=:9121 \
      --include-system-metrics"
EOF
$ sudo chmod 600 /etc/default/prometheus-redis-exporter

$ sudo systemctl restart prometheus-redis-exporter
$ sudo systemctl enable prometheus-redis-exporter
$ curl -s http://127.0.0.1:9121/metrics | head -5
```

Add to chapter 10's scrape config:

```bash
# [each obs VM — auishqosrobs01-03]
$ sudo tee /etc/prometheus/scrapes.d/redis.yml > /dev/null <<'EOF'
scrape_configs:
  - job_name: redis
    static_configs:
      - targets:
          - auishqosrred01:9121
          - auishqosrred02:9121
          - auishqosrred03:9121
        labels:
          role: redis
EOF

$ sudo -u prometheus promtool check config /etc/prometheus/prometheus.yml
$ curl -X POST http://127.0.0.1:9090/-/reload
```

Add Redis-specific alert rules to Mimir's ruleset (extends chapter 12 §12.6):

```bash
# [auishqosrobs01]
$ sudo -u mimir tee -a /var/lib/mimir/rules/anonymous/platform.yaml > /dev/null <<'EOF'

  # ─────────────────────────────  Phase 3: Redis  ───────────────────────────────
  - name: redis
    interval: 60s
    rules:
      - alert: RedisDown
        expr: redis_up == 0
        for: 2m
        labels:
          severity: critical
          service: redis
        annotations:
          summary: 'Redis on {{ $labels.instance }} is down'

      - alert: RedisReplicationBroken
        expr: redis_connected_slaves{role="redis"} < 2
        for: 5m
        labels:
          severity: warning
          service: redis
        annotations:
          summary: 'Master has {{ $value }} replicas (expected 2)'

      - alert: RedisMemoryHigh
        expr: |
          redis_memory_used_bytes / redis_memory_max_bytes > 0.85
        for: 10m
        labels:
          severity: warning
          service: redis
        annotations:
          summary: 'Redis on {{ $labels.instance }} using {{ $value | humanizePercentage }} of maxmemory'

      - alert: RedisRejectedConnections
        expr: rate(redis_rejected_connections_total[5m]) > 0
        for: 5m
        labels:
          severity: warning
          service: redis
        annotations:
          summary: 'Redis rejecting connections — maxclients hit'

      - alert: RedisSlowQuery
        expr: rate(redis_slowlog_length[5m]) > 1
        for: 5m
        labels:
          severity: warning
          service: redis
        annotations:
          summary: 'Redis slow log growing — investigate via SLOWLOG GET'
EOF

$ for h in 01 02 03; do
    ssh -J au-bastion auishqosrobs${h}.au-internal \
      'curl -s -X POST http://127.0.0.1:9009/ruler/reload'
  done
```

### 14.10 Failover behaviour + drill

Sentinel's failover sequence when the master dies:

```
T+0s    master stops responding to one Sentinel's PING
T+5s    that Sentinel marks the master "subjectively down" (sdown)
T+~5s   Sentinel asks others "do you see master as down?"
        If quorum (≥2) agrees → "objectively down" (odown)
T+~6s   Sentinels elect a leader among themselves
T+~6s   Leader picks the most-up-to-date replica as new master
T+~7s   Leader issues SLAVEOF NO ONE on the chosen replica
T+~8s   Leader rewrites all sentinels' config + reconfigures other replicas to follow new master
T+~10s  Apps' Sentinel-aware clients receive +switch-master pubsub event,
        reconnect to new master, resume work
```

Total: ~10 seconds of write unavailability under default tuning. `down-after-milliseconds 5000` is the dominant lever — lower it for faster failover, higher for tolerance of brief network blips.

**Manual failover drill** — quarterly, mirrors chapter 13's discipline:

```bash
# (1) Note current master
$ redis-cli -p 26379 sentinel master platform | head -3
# Expected: name, ip=10.111.20.40 (red01)

# (2) Trigger a controlled failover (no actual master kill — Sentinel just demotes + promotes)
$ redis-cli -p 26379 sentinel failover platform
# Expected: OK

# (3) Verify new master picked
$ sleep 15
$ redis-cli -p 26379 sentinel master platform | head -3
# Expected: ip=10.111.20.41 or 10.111.20.42

# (4) Verify apps recovered
#     greenbook: SET request, observe new master's IP in logs
$ ssh -J au-bastion auishqosrnmc01.au-internal \
    "nomad alloc logs <greenbook-alloc> | grep 'redis: connected'"

# (5) Hard failover drill — actually stop the master (more realistic)
$ ssh -J au-bastion auishqosrred41.au-internal \
    "sudo systemctl stop redis-server"
#     Wait 10s, verify a different node became master, time the recovery
#     Then restart the stopped node and verify it rejoins as a replica
```

### 14.11 UFW + firewall rules

```bash
# [auishqosrred01-03]

# Redis from App VLAN
$ sudo ufw allow from 10.111.10.0/24 to any port 6379 proto tcp comment 'Redis ← App VLAN'

# Sentinel from App VLAN (apps connect to Sentinel for master discovery)
$ sudo ufw allow from 10.111.10.0/24 to any port 26379 proto tcp comment 'Sentinel ← App VLAN'

# Inter-node — Redis replication + Sentinel gossip
$ sudo ufw allow from 10.111.20.40 to any port 6379 proto tcp comment 'Redis ← red01'
$ sudo ufw allow from 10.111.20.41 to any port 6379 proto tcp comment 'Redis ← red02'
$ sudo ufw allow from 10.111.20.42 to any port 6379 proto tcp comment 'Redis ← red03'
$ sudo ufw allow from 10.111.20.40 to any port 26379 proto tcp comment 'Sentinel ← red01'
$ sudo ufw allow from 10.111.20.41 to any port 26379 proto tcp comment 'Sentinel ← red02'
$ sudo ufw allow from 10.111.20.42 to any port 26379 proto tcp comment 'Sentinel ← red03'

# Operations VLAN for ops tooling
$ sudo ufw allow from 10.111.40.0/24 to any port 6379 proto tcp comment 'Redis ← Ops'
$ sudo ufw allow from 10.111.40.0/24 to any port 26379 proto tcp comment 'Sentinel ← Ops'

# redis_exporter scraped from obs VMs (chapter 10)
$ sudo ufw allow from 10.111.30.0/24 to any port 9121 proto tcp comment 'Prometheus → redis_exporter'
```

### 14.12 Verification

```bash
# (1) All 3 Redis instances healthy
$ for h in 01 02 03; do
    ssh -J au-bastion auishqosrred${h}.au-internal \
      "redis-cli -a $REDIS_PASS ping"
  done
# Expected: PONG from each

# (2) All 3 Sentinels see the same master + agree
$ for h in 01 02 03; do
    ssh -J au-bastion auishqosrred${h}.au-internal \
      "redis-cli -p 26379 sentinel master platform | grep -E '^(name|ip|num-other-sentinels|quorum)$' -A1"
  done
# Expected: same ip from each; num-other-sentinels=2; quorum=2

# (3) Replication topology
$ ssh -J au-bastion auishqosrred01.au-internal \
    "redis-cli -a $REDIS_PASS info replication"
# Expected (on master): role:master, connected_slaves:2, slave0/slave1 with state=online + offset matching

# (4) Round-trip with failover (the §14.10 drill)

# (5) Backup ran
$ ssh -J au-bastion auishqosrred01.au-internal \
    "ls -la /var/lib/redis/dump.rdb && stat -c '%y' /var/lib/redis/dump.rdb"
# Expected: file exists, mtime within the last hour

# (6) Prometheus sees all 3 exporters
$ ssh -J au-bastion auishqosrobs01.au-internal \
    'curl -sG http://127.0.0.1:9090/api/v1/query \
      --data-urlencode "query=up{job=\"redis\"}" | jq ".data.result[] | {instance:.metric.instance, value:.value[1]}"'
# Expected: 3 results, all "1"

# (7) Alert rules loaded
$ ssh -J au-bastion auishqosrobs01.au-internal \
    'curl -s http://127.0.0.1:9009/ruler/rule_groups | jq ".[] | .name"' | grep redis
# Expected: redis
```

**Common failures and remedies:**

| Symptom                                               | Cause                                                          | Fix                                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Replica logs `MASTER aborted replication`             | `requirepass` set but `masterauth` not, or mismatched          | Verify both are present and identical on all 3 nodes; restart replica                                             |
| Sentinel keeps reporting `+sdown` then `-sdown`       | Network blip or `down-after-milliseconds` too aggressive       | Raise to 10000 if blips are normal; investigate the network if not                                                |
| `min-replicas-to-write 1` blocks writes during outage | One replica down + master refuses writes by design             | This is correct behaviour — bring the replica back. To temporarily disable: `CONFIG SET min-replicas-to-write 0`  |
| Redis OOM during BGSAVE                               | `vm.overcommit_memory != 1`; or insufficient RAM               | Check sysctl; verify maxmemory leaves ≥ 4 GB headroom for the fork; reduce maxmemory if needed                    |
| Sentinel-aware client hangs after master fails        | Client-side `connectTimeout` / `commandTimeout` not configured | Set `connectTimeout: 5000, commandTimeout: 1000` in the client; verify it follows `+switch-master` events         |
| Failover happens but apps don't reconnect             | Apps using a non-Sentinel client (just `redis://` URL)         | Switch app to Sentinel client per §14.7; verify Vault `kv/apps/<app>/redis` has `sentinels` and `master_name` set |
| RDB file mtime not advancing                          | BGSAVE failing silently                                        | `tail /var/log/redis/redis-server.log` for "Background saving error"; check disk space + overcommit_memory        |
| Slow log full of `KEYS *` from one app                | App not following the §14.7 namespacing + scan rules           | File a bug against the app; chapter 12's `RedisSlowQuery` alert flags it                                          |
| Sentinel rewrites config and `chmod` resets to 600    | Sentinel runs as `redis` user but parent dir owned differently | `chown redis:redis /etc/redis/sentinel.conf`; verify `redis` user has write to `/etc/redis/`                      |

### 14.13 Phase 5 path (Redis Cluster for sharding)

When one node's RAM (12 GB usable in Phase 3) isn't enough — typically when active session count + cache footprint exceed ~5 GB — sharding becomes worth the complexity.

**Phase 5 [chapter 26 — Redis Cluster]** (slot reserved) introduces:

- 6+ Redis nodes (3 master shards + 3 replica shards minimum; can scale linearly)
- Hash-slot-based key distribution (16384 slots; Redis decides which shard owns which slot)
- Cluster-aware client libraries (most modern clients support it transparently — `ioredis` switches modes via the `Redis.Cluster` constructor)
- No more Sentinel — Cluster has its own gossip + failover machinery
- Config changes apps face: connect to _any_ cluster node, get redirected to the right shard automatically; `MULTI` / Lua scripts must touch keys that hash to the same slot (use `{tag}` syntax)

What carries over unchanged: the per-app key-prefix convention, the Vault custody pattern, redis_exporter, the alert rules.

What stops working: cross-key transactions across different prefixes (greenbook session + greenbook rate-limit on the same MULTI). Apps that need this stay on Sentinel, or restructure to put related keys in the same hash tag.

Migration cost: ~1 day per app for the client-library switch, plus the cluster bring-up. Apps that don't need the scale stay on Sentinel — Cluster is opt-in.

---
