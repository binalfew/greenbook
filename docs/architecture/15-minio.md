# 15 — MinIO

> **Phase**: 3 (app scaling + edge HA) · **Run on**: 4× MinIO VMs (`auishqosrobj01-04`) in distributed mode with erasure coding · **Time**: ~4 hours
>
> S3-compatible object storage. Unlocks the cold tier for Loki (chapter 09), Mimir (chapter 10), and Tempo (chapter 11) — moves them from local-filesystem chunks to durable object storage. Offsite target for Postgres pgBackRest (chapter 13) and Redis RDB snapshots (chapter 14). Source for any future app that needs blob storage.
>
> Phase 3 chapter 3 of 6.
>
> **Prev**: [14 — Redis Sentinel](14-redis-sentinel.md) · **Next**: [16 — PgBouncer](16-pgbouncer.md) · **Index**: [README](README.md)

---

## Contents

- [§15.1 Role + threat model](#151-role-threat-model)
- [§15.2 Pre-flight (4 dedicated MinIO VMs)](#152-pre-flight-4-dedicated-minio-vms)
- [§15.3 Install MinIO on all 4 nodes](#153-install-minio-on-all-4-nodes)
- [§15.4 Distributed-mode cluster configuration](#154-distributed-mode-cluster-configuration)
- [§15.5 TLS termination via local nginx](#155-tls-termination-via-local-nginx)
- [§15.6 First-time bootstrap + root credential rotation](#156-first-time-bootstrap-root-credential-rotation)
- [§15.7 Buckets + lifecycle + retention policies](#157-buckets-lifecycle-retention-policies)
- [§15.8 Per-consumer service accounts in Vault](#158-per-consumer-service-accounts-in-vault)
- [§15.9 Migrate Phase 2 storage onto MinIO](#159-migrate-phase-2-storage-onto-minio)
- [§15.10 Prometheus integration](#1510-prometheus-integration)
- [§15.11 UFW + firewall rules](#1511-ufw-firewall-rules)
- [§15.12 Verification](#1512-verification)
- [§15.13 Phase 4 path (site replication for DR)](#1513-phase-4-path-site-replication-for-dr)

## 15. MinIO

### 15.1 Role + threat model

MinIO is the platform's S3-compatible object store. Unlike Postgres (structured) or Redis (in-memory key-value), MinIO is for **byte blobs at scale** — log chunks, metric blocks, trace blocks, database backups, application uploads. The S3 API is the lingua franca; every observability and backup tool we've installed already speaks it.

The HA pattern is **distributed mode with erasure coding**:

```
                ┌──────────────────────────────────────────────────────┐
                │  4-node distributed deployment                       │
                │                                                      │
                │  obj01  obj02  obj03  obj04                          │
                │   │      │      │      │                             │
                │   ▼      ▼      ▼      ▼                             │
                │  Each PUT splits into 4 stripes:                     │
                │    2 data shards + 2 parity shards (EC:2)            │
                │    Stored across all 4 nodes                         │
                │                                                      │
                │  Read = reassemble from any 2 of 4 stripes           │
                │  Tolerates: 1 node loss (or 2 disks across nodes)    │
                └──────────────────────────────────────────────────────┘
```

Erasure coding is the conceptual sibling of replication, with a different cost/durability tradeoff. **Replication** (3-replica writes in Loki/Mimir/Tempo) keeps 3 full copies — 3× storage cost, can lose 2 nodes. **Erasure coding** keeps 2 data + 2 parity (in our 4-node EC:2 config) — 2× storage cost, can lose 2 stripes. EC wins on storage efficiency at object-storage scale; replication wins on CPU efficiency for hot workloads.

Three consequences:

1. **Compromise = data exfiltration at platform scale.** Object storage is where every backup, every log archive, every trace history ends up. A read attacker can steal everything historical; a write attacker can plant data or delete entire buckets. Defence: per-consumer service accounts with least privilege; bucket-level retention lock for tamper-evident backups; audit log of every API call streamed to Loki.
2. **Outage = no archive writes, but recent data still served from local hot tiers.** Loki/Mimir/Tempo keep hot data on local disks; if MinIO is down, ingestion continues, queries return only the local window. Mitigation: 4-node EC tolerates 1 node fully down without write/read failure; rolling restarts during patch windows are seamless.
3. **Silent corruption from disk rot is the realistic non-failure failure mode.** A drive that's "up" but returning bad bytes is harder to detect than a drive that's gone. MinIO's erasure-coded scrubbing (BitRot protection via per-block hashes) catches this and self-heals from parity. Defence: run `mc admin heal` weekly; alert on heal-required objects.

**Threat model — what we defend against:**

| Threat                                          | Mitigation                                                                                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stolen consumer credentials → data exfiltration | Per-consumer service account with bucket-scoped policy; audit log; quarterly credential rotation                                                            |
| Ransomware writes to backup buckets             | Object versioning + bucket-level Object Lock (S3 retention) on `*-backups` buckets — even root can't delete locked                                          |
| Accidental delete of a backup                   | Versioning keeps tombstoned object recoverable for retention window                                                                                         |
| Silent data corruption (disk bit-rot)           | BitRot protection (per-block SHA256); weekly `mc admin heal --recursive`; alert on `minio_objects_offline`                                                  |
| Loss of a node                                  | EC:2 over 4 nodes — full availability with 1 node down; rebalance on rejoin                                                                                 |
| Loss of multiple drives across nodes            | EC:2 tolerates 2 stripes lost — equivalent to 2 drives failed simultaneously across different nodes                                                         |
| Loss of cluster (DC fire)                       | Phase 4 [chapter 20 — DR site](20-dr-site.md) introduces site replication to an off-site MinIO                                                              |
| Tampered audit trail                            | Audit log streams to Loki via webhook; Loki uses MinIO as backend — circular dependency broken by short-term retention on Loki disk before pushing to MinIO |

**Phase 3 deliberate non-goals:**

- **External KMS for at-rest encryption** — Phase 3 uses MinIO's built-in KES with a keyring stored on the cluster. Phase 5 ch22 (dynamic Vault secrets) introduces Vault Transit as the external KMS.
- **Multi-tenant deployments** — single tenancy; per-app isolation via bucket policies and service accounts, not separate clusters.
- **Geo-replication** — single-DC for Phase 3; off-site replica added in Phase 4 ch20.
- **Public read buckets** — every bucket is private; if a future app needs a public asset CDN, route it through Cloudflare (chapter 18) rather than expose MinIO directly.

### 15.2 Pre-flight (4 dedicated MinIO VMs)

Why **4** specifically: it's the minimum for distributed mode with erasure coding. EC needs ≥4 drives (one per node here, since we use one big data volume per VM). Three nodes would force `replicate` mode (3-way replication) — we want EC's storage efficiency.

Could you do 8 or 12 nodes? Yes — but Phase 3's working set (log/metric/trace archive + DB backups) easily fits in 4-node × 2 TB = 8 TB raw → 4 TB usable. Phase 5 chapter 25 (slot reserved) covers expansion when usable capacity falls below 50%.

| Role         | Hostname         | IP           | vCPU | RAM   | Disk                  | Notes                          |
| ------------ | ---------------- | ------------ | ---- | ----- | --------------------- | ------------------------------ |
| MinIO node 1 | `auishqosrobj01` | 10.111.20.50 | 8    | 16 GB | 100 GB OS + 2 TB data | Single big data drive per node |
| MinIO node 2 | `auishqosrobj02` | 10.111.20.51 | 8    | 16 GB | 100 GB OS + 2 TB data | Same shape (mandatory for EC)  |
| MinIO node 3 | `auishqosrobj03` | 10.111.20.52 | 8    | 16 GB | 100 GB OS + 2 TB data | Same                           |
| MinIO node 4 | `auishqosrobj04` | 10.111.20.53 | 8    | 16 GB | 100 GB OS + 2 TB data | Same                           |

The same-shape rule is **enforced** by MinIO — distributed mode with mismatched drive sizes runs at the smallest drive's capacity and rejects expansion.

```bash
# [each MinIO VM]
$ lsb_release -d
$ sudo systemctl is-active unattended-upgrades fail2ban
$ groups | grep operators

# Mount the data drive — XFS strongly recommended (MinIO docs spell this out)
$ sudo lsblk
$ sudo mkfs.xfs -L minio01 /dev/sdb        # adjust per-VM device + label (minio01..04)
$ sudo mkdir /mnt/data
$ echo 'LABEL=minio01 /mnt/data xfs defaults,noatime,nodiratime,attr2,inode64,logbufs=8,logbsize=256k,allocsize=131072k 0 2' \
    | sudo tee -a /etc/fstab
$ sudo mount -a
$ df -hT /mnt/data
# Expected: type=xfs, ~2 TB available
```

XFS isn't optional — MinIO sets sparse-file extent counts that ext4 has historical issues with at scale. The `attr2/inode64/logbufs/logbsize/allocsize` mount options are MinIO's published recommendations; they materially affect throughput on the underlying erasure-coded layout.

### 15.3 Install MinIO on all 4 nodes

```bash
# [auishqosrobj01-04]

# (1) Pin a known-stable release (current LTS at write time)
$ MINIO_VERSION=RELEASE.2025-04-08T15-41-24Z
$ curl -fsSLO "https://dl.min.io/server/minio/release/linux-amd64/archive/minio.${MINIO_VERSION}"
$ sudo install -o root -g root -m 755 "minio.${MINIO_VERSION}" /usr/local/bin/minio
$ minio --version

# (2) MinIO client (mc) — used for ops + bootstrapping
$ MC_VERSION=RELEASE.2025-04-08T15-39-49Z
$ curl -fsSLO "https://dl.min.io/client/mc/release/linux-amd64/archive/mc.${MC_VERSION}"
$ sudo install -o root -g root -m 755 "mc.${MC_VERSION}" /usr/local/bin/mc
$ mc --version

# (3) Service user
$ sudo useradd --system --no-create-home --shell /usr/sbin/nologin minio-user || true
$ sudo chown -R minio-user:minio-user /mnt/data

# (4) Environment file — same on all 4 nodes
$ sudo tee /etc/default/minio > /dev/null <<'EOF'
# Server endpoint format covers all 4 nodes; MinIO discovers peers via this URL spec.
MINIO_VOLUMES="https://auishqosrobj0{1...4}.au-internal:9000/mnt/data"
MINIO_OPTS="--console-address :9001 --address :9000"

# Root user (placeholder — rotated in §15.6)
MINIO_ROOT_USER="bootstrap-admin"
MINIO_ROOT_PASSWORD="REPLACE_ME_FROM_VAULT"

# Site identity
MINIO_SITE_REGION="au-platform"
MINIO_SERVER_URL="https://minio.africanunion.org"

# Audit log → Loki via webhook (configured in §15.6)
EOF
$ sudo chmod 640 /etc/default/minio
$ sudo chown root:minio-user /etc/default/minio

# (5) systemd unit (upstream-supplied)
$ sudo tee /etc/systemd/system/minio.service > /dev/null <<'EOF'
[Unit]
Description=MinIO
Documentation=https://min.io/docs/minio/linux/index.html
Wants=network-online.target
After=network-online.target
AssertFileIsExecutable=/usr/local/bin/minio
AssertFileNotEmpty=/etc/default/minio

[Service]
Type=notify
WorkingDirectory=/usr/local
User=minio-user
Group=minio-user
ProtectProc=invisible
EnvironmentFile=/etc/default/minio
ExecStart=/usr/local/bin/minio server $MINIO_OPTS $MINIO_VOLUMES
Restart=always
LimitNOFILE=1048576
TasksMax=infinity
TimeoutStopSec=infinity
SendSIGKILL=no
OOMScoreAdjust=-1000

[Install]
WantedBy=multi-user.target
EOF

$ sudo systemctl daemon-reload
# Don't enable yet — TLS cert + bootstrap password come first
```

### 15.4 Distributed-mode cluster configuration

The `MINIO_VOLUMES` line in `/etc/default/minio` is the cluster definition. The expansion `auishqosrobj0{1...4}.au-internal` means MinIO will form a cluster of those 4 hostnames — they must all resolve, and each must be reachable on port 9000 from the others. Erasure-coding parity is computed automatically based on node count: with 4 nodes, default is EC:2 (2 data + 2 parity stripes per object).

DNS sanity-check from each node:

```bash
# [each obj VM] — every node must resolve every other node
$ for n in 01 02 03 04; do
    getent hosts "auishqosrobj${n}.au-internal" || echo "MISSING: $n"
  done
# Expected: 4 IP/hostname rows; no MISSING

# Peer reachability
$ for n in 01 02 03 04; do
    nc -zv "auishqosrobj${n}.au-internal" 9000 2>&1
  done
```

If any line fails, MinIO will boot but refuse to form a cluster — fix DNS/firewall before proceeding.

### 15.5 TLS termination via local nginx

Two-tier pattern: nginx terminates TLS on each node, proxies to MinIO bound on `127.0.0.1:9000`. Same shape as Keycloak (chapter 07) and Nexus (chapter 06).

Why local nginx instead of MinIO's native TLS: same operational reasoning as everywhere else — one TLS surface (nginx) across the platform, one cert-rotation workflow, one HTTP-header normalisation point. MinIO's native TLS works fine; we just don't want a second TLS pattern to reason about.

```bash
# [auishqosrobj01-04]

# Override the env file to bind MinIO to the loopback (nginx fronts it)
$ sudo sed -i 's|^MINIO_OPTS=.*|MINIO_OPTS="--console-address 127.0.0.1:9001 --address 127.0.0.1:9000"|' \
    /etc/default/minio

$ sudo apt install -y nginx
$ sudo install -d -m 755 /etc/nginx/ssl
$ sudo install -m 644 -o root -g root \
    wildcard.africanunion.org.fullchain.pem \
    /etc/nginx/ssl/minio.crt
$ sudo install -m 600 -o root -g root \
    wildcard.africanunion.org.key \
    /etc/nginx/ssl/minio.key

$ sudo tee /etc/nginx/sites-available/minio > /dev/null <<'EOF'
upstream minio_s3 {
    least_conn;
    server 127.0.0.1:9000;
    keepalive 32;
}

upstream minio_console {
    server 127.0.0.1:9001;
    keepalive 16;
}

server {
    listen 80;
    server_name minio.africanunion.org minio-console.africanunion.org;
    return 301 https://$host$request_uri;
}

# S3 API
server {
    listen 443 ssl http2;
    server_name minio.africanunion.org;
    ssl_certificate     /etc/nginx/ssl/minio.crt;
    ssl_certificate_key /etc/nginx/ssl/minio.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # MinIO requires very large request bodies for multipart uploads
    client_max_body_size 0;
    proxy_buffering off;
    proxy_request_buffering off;

    chunked_transfer_encoding off;
    ignore_invalid_headers off;

    location / {
        proxy_pass http://minio_s3;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_connect_timeout 5s;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}

# Web console
server {
    listen 443 ssl http2;
    server_name minio-console.africanunion.org;
    ssl_certificate     /etc/nginx/ssl/minio.crt;
    ssl_certificate_key /etc/nginx/ssl/minio.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location / {
        proxy_pass http://minio_console;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;     # console uses websockets
        proxy_set_header Connection "upgrade";
    }
}
EOF
$ sudo ln -sf /etc/nginx/sites-available/minio /etc/nginx/sites-enabled/minio
$ sudo rm -f /etc/nginx/sites-enabled/default
$ sudo nginx -t
$ sudo systemctl reload nginx
```

DNS: point `minio.africanunion.org` and `minio-console.africanunion.org` at a round-robin of all 4 obj VMs (or at chapter 17's HAProxy when it lands; for Phase 3 §15 alone, plain DNS round-robin is enough).

### 15.6 First-time bootstrap + root credential rotation

Same dance as every other admin-password chapter (Vault ch03, GitLab ch04, Nomad ch05, Nexus ch06, Keycloak ch07, Grafana ch09).

```bash
# (1) Generate the bootstrap admin password and stash it in Vault
$ ROOT_PASS=$(openssl rand -base64 32)
$ vault kv put kv/platform/minio/root \
    username='root' \
    password="$ROOT_PASS" \
    rotated_at="$(date -Iseconds)" \
    rotation_period_days=90

# (2) Substitute into the env file on all 4 nodes
$ for n in 01 02 03 04; do
    ssh -J au-bastion "auishqosrobj${n}.au-internal" \
      "sudo sed -i 's|^MINIO_ROOT_USER=.*|MINIO_ROOT_USER=\"root\"|; \
                    s|^MINIO_ROOT_PASSWORD=.*|MINIO_ROOT_PASSWORD=\"$ROOT_PASS\"|' \
       /etc/default/minio"
  done

# (3) Start MinIO across all 4 nodes (in any order — they wait for quorum)
$ for n in 01 02 03 04; do
    ssh -J au-bastion "auishqosrobj${n}.au-internal" \
      'sudo systemctl enable --now minio'
  done

# (4) Wait for cluster to form
$ for n in 01 02 03 04; do
    ssh -J au-bastion "auishqosrobj${n}.au-internal" \
      'curl -sk https://127.0.0.1:9000/minio/health/cluster | head -1'
  done
# Expected: HTTP/1.1 200 OK from each (eventually — first start can take 30s)

# (5) Configure mc to point at the cluster
$ mc alias set au-platform https://minio.africanunion.org root "$ROOT_PASS"
$ mc admin info au-platform
# Expected: 4 nodes online, 4 drives online, each node ~2 TB

# (6) Wire audit log to Loki via webhook (chapter 09 endpoint)
$ mc admin config set au-platform audit_webhook:platform \
    endpoint="http://auishqosrobs01:3100/loki/api/v1/push" \
    auth_token="" \
    queue_dir="/var/log/minio-audit-queue" \
    queue_size="100000"
$ mc admin service restart au-platform

# (7) Enable per-API logging level
$ mc admin config set au-platform logger_webhook:platform \
    endpoint="http://auishqosrobs01:3100/loki/api/v1/push"
```

### 15.7 Buckets + lifecycle + retention policies

The bucket layout follows the consumer pattern — one bucket per consumer service. This makes per-consumer credential scoping trivial and prevents one consumer's lifecycle policy from affecting another's data.

```bash
# (1) Create buckets
$ for b in loki-chunks mimir-blocks tempo-traces \
           postgres-backups redis-backups platform-misc; do
    mc mb --with-versioning au-platform/$b
  done

# (2) Lifecycle: cold-tier rules per chapter's stated retention
# Loki — 30 days hot (filesystem on obs VMs), MinIO is the hot-and-warm + 1 year cold
$ mc ilm rule add au-platform/loki-chunks \
    --expire-days 365 \
    --noncurrent-expire-days 30

# Mimir — same shape, 1 year cold
$ mc ilm rule add au-platform/mimir-blocks \
    --expire-days 365 \
    --noncurrent-expire-days 30

# Tempo — 14 days hot is in Tempo; MinIO becomes the 90-day cold
$ mc ilm rule add au-platform/tempo-traces \
    --expire-days 90 \
    --noncurrent-expire-days 14

# Postgres backups — keep 90 days of full + diff (chapter 13's WAL retention is 14d at the source)
$ mc ilm rule add au-platform/postgres-backups \
    --expire-days 90

# Redis backups — keep 30 days hourly RDB
$ mc ilm rule add au-platform/redis-backups \
    --expire-days 30

# (3) Object Lock (S3 retention) on backup buckets — even root can't delete locked
$ mc retention set --default GOVERNANCE 30d au-platform/postgres-backups
$ mc retention set --default GOVERNANCE 30d au-platform/redis-backups

# Object Lock requires versioning enabled (set above with --with-versioning)
$ mc version info au-platform/postgres-backups
# Expected: "Enabled"

# (4) Encrypt-at-rest for all buckets — uses MinIO's built-in KES with auto-generated keys
$ mc encrypt set sse-s3 au-platform/loki-chunks
$ mc encrypt set sse-s3 au-platform/mimir-blocks
$ mc encrypt set sse-s3 au-platform/tempo-traces
$ mc encrypt set sse-s3 au-platform/postgres-backups
$ mc encrypt set sse-s3 au-platform/redis-backups
$ mc encrypt set sse-s3 au-platform/platform-misc
```

> **ℹ GOVERNANCE vs COMPLIANCE retention modes**
>
> `GOVERNANCE` lets users with `BypassGovernanceRetention` permission delete locked objects (used for legitimate cleanups by ops). `COMPLIANCE` lets nobody delete — not even root — until the lock expires. Phase 3 ships GOVERNANCE because we want the option to recover from operator mistakes; switch to COMPLIANCE in Phase 5 once procedures are fully validated.

### 15.8 Per-consumer service accounts in Vault

Each consumer (Loki, Mimir, Tempo, Postgres pgBackRest, Redis backup script, future apps) gets its own MinIO service account with a bucket-scoped policy. No consumer ever uses root credentials.

```bash
# (1) Define + attach the per-consumer policies (one example; repeat per consumer)

# Loki — read+write on loki-chunks only
$ cat > /tmp/policy-loki.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow",
      "Action": ["s3:ListBucket","s3:GetBucketLocation"],
      "Resource": ["arn:aws:s3:::loki-chunks"] },
    { "Effect": "Allow",
      "Action": ["s3:GetObject","s3:PutObject","s3:DeleteObject","s3:AbortMultipartUpload","s3:ListMultipartUploadParts"],
      "Resource": ["arn:aws:s3:::loki-chunks/*"] }
  ]
}
EOF
$ mc admin policy create au-platform loki-policy /tmp/policy-loki.json

# (2) Create the service account, bind the policy
$ mc admin user svcacct add au-platform root \
    --name loki-svc \
    --policy-file /tmp/policy-loki.json
# Outputs ACCESS_KEY + SECRET_KEY — capture them

# (3) Stash credentials in Vault under kv/platform/minio/<consumer>/
$ vault kv put kv/platform/minio/loki \
    access_key='<from step 2>' \
    secret_key='<from step 2>' \
    bucket='loki-chunks' \
    endpoint='https://minio.africanunion.org' \
    rotated_at="$(date -Iseconds)" \
    rotation_period_days=180
```

Repeat for the other consumers — same pattern, scoped to a different bucket. Concise table of the bindings:

| Consumer            | Vault path                        | Bucket             | Policy actions                | Used by                              |
| ------------------- | --------------------------------- | ------------------ | ----------------------------- | ------------------------------------ |
| `loki-svc`          | `kv/platform/minio/loki`          | `loki-chunks`      | `s3:Get/Put/Delete/List`      | Chapter 09 — Loki chunk backend      |
| `mimir-svc`         | `kv/platform/minio/mimir`         | `mimir-blocks`     | Same                          | Chapter 10 — Mimir block storage     |
| `tempo-svc`         | `kv/platform/minio/tempo`         | `tempo-traces`     | Same                          | Chapter 11 — Tempo trace storage     |
| `pgbackrest-svc`    | `kv/platform/minio/pgbackrest`    | `postgres-backups` | `s3:Get/Put/List` (no Delete) | Chapter 13 — pgBackRest offsite repo |
| `redis-backup-svc`  | `kv/platform/minio/redis-backup`  | `redis-backups`    | `s3:Get/Put/List`             | Chapter 14 — hourly RDB ship         |
| `platform-misc-svc` | `kv/platform/minio/platform-misc` | `platform-misc`    | `s3:Get/Put/Delete/List`      | Ad-hoc ops use; future apps          |

`pgbackrest-svc` deliberately lacks `s3:Delete` — pgBackRest manages retention by object metadata; revoking Delete prevents an attacker who steals the credential from purging backups. The Object Lock from §15.7 layers on top.

### 15.9 Migrate Phase 2 storage onto MinIO

Each Phase 2 service that promised "Phase 3 MinIO migration path" gets the swap now. Rolling migration — one node at a time per service — keeps each service operational throughout.

#### Loki (chapter 09 §9.13)

```bash
# [each obs VM, in turn — auishqosrobs01 first, wait for ready, then 02, then 03]

# (1) Update loki.yaml storage section
$ sudo tee -a /etc/loki/loki.yaml.d/storage-s3.yaml > /dev/null <<EOF
storage_config:
  aws:
    s3: https://$(vault kv get -field=access_key kv/platform/minio/loki):$(vault kv get -field=secret_key kv/platform/minio/loki)@minio.africanunion.org/loki-chunks
    s3forcepathstyle: true
    insecure: false
EOF

# (2) Migrate existing chunks: rsync from /var/lib/loki/chunks → MinIO
$ MINIO_ALIAS=$(vault kv get -field=access_key kv/platform/minio/loki)
$ MINIO_SECRET=$(vault kv get -field=secret_key kv/platform/minio/loki)
$ mc alias set au-loki https://minio.africanunion.org "$MINIO_ALIAS" "$MINIO_SECRET"
$ mc cp --recursive /var/lib/loki/chunks/ au-loki/loki-chunks/

# (3) Restart Loki
$ sudo systemctl restart loki

# (4) Wait until ring shows ACTIVE again before moving to next node
$ until curl -s http://127.0.0.1:3100/ring | grep -q '"State":"ACTIVE"'; do sleep 2; done
```

#### Mimir (chapter 10 §10.14)

```bash
# Per node — same rolling pattern as Loki
$ sudo tee /etc/mimir/mimir-storage-s3.yaml > /dev/null <<EOF
common:
  storage:
    backend: s3
    s3:
      endpoint: minio.africanunion.org
      bucket_name: mimir-blocks
      access_key_id: $(vault kv get -field=access_key kv/platform/minio/mimir)
      secret_access_key: $(vault kv get -field=secret_key kv/platform/minio/mimir)
      insecure: false
EOF
# Migrate existing blocks → MinIO, then rolling restart
$ mc cp --recursive /var/lib/mimir/tsdb/ au-mimir/mimir-blocks/
$ sudo systemctl restart mimir
```

#### Tempo (chapter 11 §11.12)

```bash
$ sudo tee /etc/tempo/tempo-storage-s3.yaml > /dev/null <<EOF
storage:
  trace:
    backend: s3
    s3:
      endpoint: minio.africanunion.org
      bucket: tempo-traces
      access_key: $(vault kv get -field=access_key kv/platform/minio/tempo)
      secret_key: $(vault kv get -field=secret_key kv/platform/minio/tempo)
      insecure: false
      forcepathstyle: true
    wal:
      path: /var/lib/tempo/wal             # WAL stays local on each node
EOF
$ mc cp --recursive /var/lib/tempo/blocks/ au-tempo/tempo-traces/
$ sudo systemctl restart tempo
```

#### Postgres pgBackRest (chapter 13 §13.7)

```bash
# [auishqosrpdb01 + 02] — extend the pgbackrest config
$ sudo tee -a /etc/pgbackrest/pgbackrest.conf > /dev/null <<EOF

# Repo 2 — offsite to MinIO
repo2-type=s3
repo2-s3-endpoint=minio.africanunion.org
repo2-s3-bucket=postgres-backups
repo2-s3-region=au-platform
repo2-s3-key=$(vault kv get -field=access_key kv/platform/minio/pgbackrest)
repo2-s3-key-secret=$(vault kv get -field=secret_key kv/platform/minio/pgbackrest)
repo2-s3-uri-style=path
repo2-path=/app
repo2-retention-full=2
repo2-retention-archive=30
EOF

# Re-stanza-create with the new repo
$ sudo -u postgres pgbackrest --stanza=app --repo=2 stanza-create
# Subsequent backups write to BOTH repos (local + MinIO) — set repo-targets in your timer units
```

#### Redis (chapter 14 §14.8)

The chapter 14 backup script already references `mc cp ... au-minio/redis-backups/...`. Configure the `mc` alias on each red VM:

```bash
# [auishqosrred01-03]
$ MINIO_ACCESS=$(vault kv get -field=access_key kv/platform/minio/redis-backup)
$ MINIO_SECRET=$(vault kv get -field=secret_key kv/platform/minio/redis-backup)
$ sudo -u redis mc alias set au-minio https://minio.africanunion.org "$MINIO_ACCESS" "$MINIO_SECRET"
# Next hourly backup will ship to MinIO automatically
```

After all 5 services are migrated, the Phase 1+2 close-out tables update: the `Phase 2 location` column for Loki/Mimir/Tempo flips from "filesystem on obs VMs" to "MinIO chunks/blocks/traces with versioning + lifecycle."

### 15.10 Prometheus integration

MinIO exposes Prometheus metrics natively at `/minio/v2/metrics/cluster`. Add the scrape config:

```bash
# [each obs VM — auishqosrobs01-03]
$ sudo tee /etc/prometheus/scrapes.d/minio.yml > /dev/null <<'EOF'
scrape_configs:
  - job_name: minio-cluster
    metrics_path: /minio/v2/metrics/cluster
    scheme: https
    tls_config:
      ca_file: /etc/prometheus/ca/au-internal-ca.pem
    bearer_token_file: /etc/prometheus/secrets/minio-prom-token
    static_configs:
      - targets:
          - auishqosrobj01:443
          - auishqosrobj02:443
          - auishqosrobj03:443
          - auishqosrobj04:443
        labels:
          role: minio
EOF
$ sudo -u prometheus promtool check config /etc/prometheus/prometheus.yml
$ curl -X POST http://127.0.0.1:9090/-/reload
```

The bearer token is generated via MinIO's `mc admin prometheus generate` command; result stored in Vault and served from `/etc/prometheus/secrets/minio-prom-token` (same pattern as the Vault scrape token in chapter 10 §10.7).

Add MinIO-specific alert rules to chapter 12's ruleset:

```bash
# [auishqosrobs01]
$ sudo -u mimir tee -a /var/lib/mimir/rules/anonymous/platform.yaml > /dev/null <<'EOF'

  # ─────────────────────────────  Phase 3: MinIO  ───────────────────────────────
  - name: minio
    interval: 60s
    rules:
      - alert: MinioNodeOffline
        expr: minio_cluster_nodes_offline_total > 0
        for: 2m
        labels:
          severity: critical
          service: minio
        annotations:
          summary: '{{ $value }} MinIO node(s) offline'
          description: 'EC tolerates 1 node loss; a second loss takes the cluster down'

      - alert: MinioDriveOffline
        expr: minio_cluster_drive_offline_total > 0
        for: 5m
        labels:
          severity: warning
          service: minio
        annotations:
          summary: '{{ $value }} MinIO drive(s) offline'
          description: 'Auto-heal will rebuild from parity; investigate hardware'

      - alert: MinioCapacityHigh
        expr: |
          (1 - minio_cluster_capacity_usable_free_bytes /
               minio_cluster_capacity_usable_total_bytes) > 0.75
        for: 30m
        labels:
          severity: warning
          service: minio
        annotations:
          summary: 'MinIO usable capacity at {{ $value | humanizePercentage }}'

      - alert: MinioCapacityCritical
        expr: |
          (1 - minio_cluster_capacity_usable_free_bytes /
               minio_cluster_capacity_usable_total_bytes) > 0.90
        for: 5m
        labels:
          severity: critical
          service: minio
        annotations:
          summary: 'MinIO usable capacity at {{ $value | humanizePercentage }} — writes will fail soon'

      - alert: MinioHealRequired
        expr: minio_heal_objects_heal_total > 0
        for: 1h
        labels:
          severity: warning
          service: minio
        annotations:
          summary: 'MinIO has objects requiring heal — run `mc admin heal --recursive`'
EOF

$ for h in 01 02 03; do
    ssh -J au-bastion auishqosrobs${h}.au-internal \
      'curl -s -X POST http://127.0.0.1:9009/ruler/reload'
  done
```

### 15.11 UFW + firewall rules

```bash
# [auishqosrobj01-04]

# S3 API (via nginx) from app + observability + DB tiers
$ sudo ufw allow from 10.111.10.0/24 to any port 443 proto tcp comment 'MinIO ← App VLAN (apps writing)'
$ sudo ufw allow from 10.111.20.0/24 to any port 443 proto tcp comment 'MinIO ← Data VLAN (Postgres, Redis backups)'
$ sudo ufw allow from 10.111.30.0/24 to any port 443 proto tcp comment 'MinIO ← Platform VLAN (LGTM)'
$ sudo ufw allow from 10.111.40.0/24 to any port 443 proto tcp comment 'MinIO ← Ops VLAN'
$ sudo ufw allow from 10.111.10.0/24 to any port 80  proto tcp comment 'MinIO 80→443'
$ sudo ufw allow from 10.111.20.0/24 to any port 80  proto tcp comment 'MinIO 80→443'
$ sudo ufw allow from 10.111.30.0/24 to any port 80  proto tcp comment 'MinIO 80→443'

# Inter-node — distributed mode talks node-to-node on 9000
$ sudo ufw allow from 10.111.20.50 to any port 9000 proto tcp comment 'MinIO ← obj01'
$ sudo ufw allow from 10.111.20.51 to any port 9000 proto tcp comment 'MinIO ← obj02'
$ sudo ufw allow from 10.111.20.52 to any port 9000 proto tcp comment 'MinIO ← obj03'
$ sudo ufw allow from 10.111.20.53 to any port 9000 proto tcp comment 'MinIO ← obj04'

# Console (operator access from Ops VLAN only — never internet-exposed)
# Already covered by the 443-ops-VLAN rule (nginx serves both the S3 API and the console
# under different server_names but the same listening IP).
```

### 15.12 Verification

```bash
# (1) All 4 nodes online + cluster healthy
$ mc admin info au-platform
# Expected: "4 Online" — drives all online; usable capacity ~4 TB after EC overhead

# (2) Cluster health endpoint
$ for n in 01 02 03 04; do
    ssh -J au-bastion "auishqosrobj${n}.au-internal" \
      'curl -sk https://127.0.0.1:9000/minio/health/cluster'
  done
# Expected: HTTP/1.1 200 OK from each

# (3) Buckets exist with versioning + lifecycle + encryption + retention
$ mc ls au-platform
$ for b in loki-chunks mimir-blocks tempo-traces postgres-backups redis-backups; do
    echo "=== $b ==="
    mc version info au-platform/$b
    mc ilm rule ls au-platform/$b
    mc encrypt info au-platform/$b
    mc retention info --default au-platform/$b 2>/dev/null || echo "(no retention)"
  done

# (4) Service accounts authenticate + bucket-scoped
$ MINIO_ACCESS=$(vault kv get -field=access_key kv/platform/minio/loki)
$ MINIO_SECRET=$(vault kv get -field=secret_key kv/platform/minio/loki)
$ mc alias set au-loki-test https://minio.africanunion.org "$MINIO_ACCESS" "$MINIO_SECRET"
$ mc ls au-loki-test/loki-chunks   # should succeed
$ mc ls au-loki-test/mimir-blocks  # should fail with AccessDenied (proves scoping)

# (5) Loki/Mimir/Tempo are using MinIO as backend
$ ssh -J au-bastion auishqosrobs01.au-internal \
    'curl -s http://127.0.0.1:3100/config 2>/dev/null | grep -A3 storage_config'
# Expected: aws/s3 section with minio.africanunion.org

# (6) pgBackRest sees the new repo
$ ssh -J au-bastion auishqosrpdb01.au-internal \
    'sudo -u postgres pgbackrest --stanza=app info'
# Expected: 2 repos (local + MinIO), recent backups in both

# (7) Heal status — should be empty
$ mc admin heal --quiet au-platform
# Expected: nothing to heal

# (8) Synthetic write/read at the platform-misc bucket via Ops account
$ echo "verification $(date -u +%FT%TZ)" | mc pipe au-platform/platform-misc/verify.txt
$ mc cat au-platform/platform-misc/verify.txt
$ mc rm au-platform/platform-misc/verify.txt

# (9) Failure tolerance drill — stop one node, verify reads still work
$ ssh -J au-bastion auishqosrobj01.au-internal 'sudo systemctl stop minio'
$ mc ls au-platform/loki-chunks   # should still succeed
$ mc admin info au-platform | head -10   # should show 3 online, 1 offline
$ ssh -J au-bastion auishqosrobj01.au-internal 'sudo systemctl start minio'
$ sleep 30
$ mc admin info au-platform | head -10   # should show 4 online again
```

**Common failures and remedies:**

| Symptom                                                           | Cause                                                              | Fix                                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Cluster won't form: "Waiting for the first server to come online" | DNS not resolving across nodes; or UFW blocking 9000 between nodes | Verify §15.4 DNS check; verify §15.11 UFW rules; check `journalctl -u minio`                                   |
| `XMinioStorageDiskBound` error on writes                          | One drive or node out, EC can't write enough stripes               | Check `mc admin info`; bring offline drive back; if hardware-dead, replace + heal                              |
| Lifecycle rules don't seem to apply                               | Versioning was off when bucket created                             | `mc version enable`; recreate rules; existing objects need a `mc ilm restore` pass                             |
| pgBackRest "WARN: configured remote-type is invalid"              | wrong repo number in command                                       | Use `--repo=2` for the MinIO repo; default `--repo=1` is local                                                 |
| nginx returns 502 Bad Gateway                                     | MinIO not bound to 127.0.0.1:9000 (still on `:9000`)               | Verify `MINIO_OPTS` in `/etc/default/minio` has `--address 127.0.0.1:9000`; restart                            |
| Console websocket disconnects every minute                        | nginx websocket headers missing                                    | Verify console server block has `Upgrade` + `Connection upgrade` headers per §15.5                             |
| `mc admin heal` fills logs but never completes                    | Background heal already running; or large bucket with many shards  | Check `mc admin heal --json`; healing happens in the background by default — let it finish                     |
| MinIO consumes huge CPU on writes                                 | EC computation under load — expected                               | Confirm the load matches consumer scrape pattern; if sustained >70% per node, plan an expansion (Phase 5 ch25) |

### 15.13 Phase 4 path (site replication for DR)

Phase 4 [chapter 20 — DR site](20-dr-site.md) introduces an off-site MinIO cluster (4 more nodes at the DR location). MinIO's **site replication** copies every bucket, every object, every IAM user, every policy from the primary cluster to the secondary, asynchronously, with conflict-free merge.

Migration shape (chapter 20 has the full procedure):

```bash
# Prepare the secondary cluster (chapter 20 deploys it identically to this chapter)
$ mc alias set au-dr https://minio-dr.africanunion.org rootuser DRPASS

# Enable site replication from au-platform → au-dr
$ mc admin replicate add au-platform au-dr

# Verify
$ mc admin replicate info au-platform
$ mc admin replicate status au-platform
```

After this, every PutObject on `au-platform` is asynchronously mirrored to `au-dr`. Service accounts, policies, bucket settings replicate with no manual sync. RPO target: <5 min replication lag for normal load.

What carries over unchanged: the bucket layout, the per-consumer service account pattern, the lifecycle policies, the encryption configuration. Phase 4 is purely an "add a second site" operation, no architectural changes.

---
