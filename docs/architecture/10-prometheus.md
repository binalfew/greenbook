# 10 — Prometheus + Mimir

> **Phase**: 2 (identity + observability) · **Run on**: same 3× obs VMs as chapter 09 (`auishqosrobs01-03`); Prometheus collectors + Mimir storage colocated · **Time**: ~3 hours
>
> Centralised metrics collection. Prometheus scrapes every platform component (Vault, Nomad, Consul, Keycloak, Postgres, nginx, node exporters) on its own VM; Mimir provides a horizontally scalable, durable long-term store fronting all 3 Prometheus instances. Grafana from chapter 09 queries Mimir for dashboards and alerting.
>
> Phase 2 chapter 4 of 6.
>
> **Prev**: [09 — Loki + Grafana](09-loki.md) · **Next**: [11 — Tempo](11-tempo.md) · **Index**: [README](README.md)

---

## Contents

- [§10.1 Role + threat model](#101-role-threat-model)
- [§10.2 Pre-flight (reuses obs VMs from chapter 09)](#102-pre-flight-reuses-obs-vms-from-chapter-09)
- [§10.3 Install Prometheus on the obs VMs](#103-install-prometheus-on-the-obs-vms)
- [§10.4 Install Mimir on the obs VMs](#104-install-mimir-on-the-obs-vms)
- [§10.5 Mimir cluster configuration](#105-mimir-cluster-configuration)
- [§10.6 Wire Prometheus to write to Mimir](#106-wire-prometheus-to-write-to-mimir)
- [§10.7 Scrape configs for Phase 1 + Phase 2 services](#107-scrape-configs-for-phase-1-phase-2-services)
- [§10.8 Node exporter on every platform VM](#108-node-exporter-on-every-platform-vm)
- [§10.9 Add Mimir as a Grafana data source](#109-add-mimir-as-a-grafana-data-source)
- [§10.10 Standard metric labels + retention](#1010-standard-metric-labels-retention)
- [§10.11 Initial dashboards](#1011-initial-dashboards)
- [§10.12 UFW + firewall rules](#1012-ufw-firewall-rules)
- [§10.13 Verification](#1013-verification)
- [§10.14 Path to Phase 3 (MinIO storage backend)](#1014-path-to-phase-3-minio-storage-backend)

## 10. Prometheus + Mimir

### 10.1 Role + threat model

Prometheus pulls (scrapes) metrics on a 15-second interval from `/metrics` endpoints on every component. Each Prometheus instance writes via remote-write to Mimir, which is the durable long-term store. Grafana queries Mimir (not Prometheus directly) for dashboards.

Why both? Prometheus is the de-facto scraper; its local TSDB is fine for ~15 days but doesn't scale and isn't HA. Mimir takes Prometheus' remote-write protocol, replicates samples across 3 nodes, deduplicates writes from redundant Prometheus instances (so 3 Prometheuses scraping the same target produce one stored sample), and handles long-term retention. The split — Prometheus scrapes, Mimir stores — is the pattern the LGTM stack is built around.

Three consequences:

1. **Compromise = silenced alarms.** An attacker who can suppress metrics or rewrite them can mask incidents. Defence: scrape configs source-controlled in GitLab; Mimir behind Grafana SSO (chapter 09); rules signed and verified at load time (Phase 5).
2. **Outage = no metric-driven alerts.** Alertmanager (chapter 12) reads from Mimir; if Mimir is fully down, alerts go silent. Mitigation: 3-node Prometheus instances each retain ~15 days locally — operators can fall back to per-instance dashboards or PromQL via SSH; Grafana can also query Prometheus directly when Mimir is unreachable.
3. **Cardinality explosion is the most likely failure.** Labels with high cardinality (per-request IDs, user IDs, full URLs) bloat Mimir's index and OOM the ingesters. Defence: label discipline (§10.10); limits on series-per-tenant; cardinality dashboards from day 1.

**Threat model — what we defend against:**

| Threat                                            | Mitigation                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Tampered metrics (silenced alerts)                | Scrape configs in Git with code-review; Mimir write-path requires bearer token (Phase 5); rules signed           |
| Sensitive data in metric labels                   | Label discipline; high-cardinality fields go in logs (chapter 09) or traces (chapter 11), never as metric labels |
| Unauthorised dashboard read                       | Grafana behind Keycloak SSO (chapter 09); per-team folder ACLs                                                   |
| Cardinality runaway crashes Mimir                 | `max_global_series_per_user` limit (default 150k); per-target scrape limits; weekly cardinality audit            |
| Loss of Mimir cluster                             | 3-replica writes; each block replicated to ≥2 nodes; Phase 3 MinIO chunk backend → durable storage               |
| Metric gap during Mimir outage                    | Prometheus local TSDB retains ~15d; remote-write retries with WAL replay when Mimir recovers                     |
| Scrape target enumeration → attack-surface mapped | Prometheus binds to 127.0.0.1; Mimir / Grafana surface only via authenticated UIs; UFW rules per VLAN            |

**Phase 2 deliberate non-goals:**

- **Object storage backend (MinIO / S3)** — Phase 3 [chapter 15](15-minio.md) introduces MinIO; until then, local filesystem on each obs VM. Ingester replication-factor 3 compensates.
- **Multi-tenancy** — single tenant for the platform; per-team isolation via Grafana folder ACLs, not Mimir tenants.
- **Federation across DR sites** — out of scope for Phase 2; revisit when Phase 4 chapter 20 lands.
- **Alerting rules library** — chapter 12 introduces Alertmanager + initial rules; this chapter establishes only the scrape + store path.

### 10.2 Pre-flight (reuses obs VMs from chapter 09)

No new VMs. The 3 obs VMs provisioned in chapter 09 §9.2 are sized to host Prometheus + Mimir + Tempo together — confirm before proceeding:

| Role       | Hostname         | IP           | Already running                   | Adding now                    |
| ---------- | ---------------- | ------------ | --------------------------------- | ----------------------------- |
| obs node 1 | `auishqosrobs01` | 10.111.30.60 | Loki distributor/ingester/querier | Prometheus + Mimir all-in-one |
| obs node 2 | `auishqosrobs02` | 10.111.30.61 | Loki distributor/ingester/querier | Prometheus + Mimir all-in-one |
| obs node 3 | `auishqosrobs03` | 10.111.30.62 | Loki distributor/ingester/querier | Prometheus + Mimir all-in-one |

```bash
# [each obs VM] sanity check before installing more services
$ free -h | awk 'NR==2 {print "RAM free: "$4}'
$ df -h /var/lib | awk 'NR==2 {print "Disk free /var/lib: "$4}'
$ systemctl is-active loki
# Expected: ≥8 GB RAM free; ≥120 GB disk free; loki active
```

If any obs VM is already showing memory pressure from Loki, halt and revisit sizing — chapter 11 (Tempo) adds even more.

### 10.3 Install Prometheus on the obs VMs

Prometheus ships a single Go binary. The Ubuntu apt package is several minor versions behind upstream; we install from the official tarball and manage with systemd, mirroring how chapters 03 (Vault) and 05 (Nomad) handle HashiCorp binaries.

```bash
# [auishqosrobs01-03]

# (1) Download + verify (use the latest LTS at install time)
$ PROM_VERSION=2.55.1
$ cd /tmp
$ curl -fsSLO https://github.com/prometheus/prometheus/releases/download/v${PROM_VERSION}/prometheus-${PROM_VERSION}.linux-amd64.tar.gz
$ curl -fsSLO https://github.com/prometheus/prometheus/releases/download/v${PROM_VERSION}/sha256sums.txt
$ grep prometheus-${PROM_VERSION}.linux-amd64.tar.gz sha256sums.txt | sha256sum -c
# Expected: prometheus-...tar.gz: OK

# (2) Install binaries
$ tar xvf prometheus-${PROM_VERSION}.linux-amd64.tar.gz
$ sudo install -o root -g root -m 755 \
    prometheus-${PROM_VERSION}.linux-amd64/prometheus \
    prometheus-${PROM_VERSION}.linux-amd64/promtool \
    /usr/local/bin/

# (3) Service user + dirs
$ sudo useradd --system --no-create-home --shell /usr/sbin/nologin prometheus || true
$ sudo install -d -m 750 -o prometheus -g prometheus \
    /etc/prometheus \
    /etc/prometheus/rules.d \
    /etc/prometheus/file_sd \
    /var/lib/prometheus

# (4) systemd unit
$ sudo tee /etc/systemd/system/prometheus.service > /dev/null <<'EOF'
[Unit]
Description=Prometheus
Documentation=https://prometheus.io/docs/introduction/overview/
After=network-online.target
Wants=network-online.target

[Service]
User=prometheus
Group=prometheus
ExecStart=/usr/local/bin/prometheus \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path=/var/lib/prometheus \
  --storage.tsdb.retention.time=15d \
  --storage.tsdb.retention.size=80GB \
  --web.listen-address=127.0.0.1:9090 \
  --web.external-url=https://prometheus-obs01.au-internal/ \
  --web.enable-lifecycle
Restart=on-failure
RestartSec=5s
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

# (5) Verify (config file landed in §10.6)
$ prometheus --version
$ promtool --version
```

We deliberately bind Prometheus to `127.0.0.1` — operator access is via SSH port-forward through the bastion (chapter 02), and Mimir reads via remote-write push, not Grafana pull. No external listener.

### 10.4 Install Mimir on the obs VMs

```bash
# [auishqosrobs01-03]

# (1) Download Mimir (Grafana Labs releases)
$ MIMIR_VERSION=2.14.0
$ cd /tmp
$ curl -fsSLO https://github.com/grafana/mimir/releases/download/mimir-${MIMIR_VERSION}/mimir-linux-amd64
$ curl -fsSLO https://github.com/grafana/mimir/releases/download/mimir-${MIMIR_VERSION}/mimir-linux-amd64-sha-256
$ echo "$(cat mimir-linux-amd64-sha-256)  mimir-linux-amd64" | sha256sum -c
# Expected: mimir-linux-amd64: OK

# (2) Install binary
$ sudo install -o root -g root -m 755 mimir-linux-amd64 /usr/local/bin/mimir

# (3) Service user + dirs
$ sudo useradd --system --no-create-home --shell /usr/sbin/nologin mimir || true
$ sudo install -d -m 750 -o mimir -g mimir \
    /etc/mimir \
    /var/lib/mimir \
    /var/lib/mimir/data \
    /var/lib/mimir/tsdb \
    /var/lib/mimir/tsdb-sync \
    /var/lib/mimir/compactor \
    /var/lib/mimir/rules

# (4) systemd unit
$ sudo tee /etc/systemd/system/mimir.service > /dev/null <<'EOF'
[Unit]
Description=Grafana Mimir
Documentation=https://grafana.com/docs/mimir/
After=network-online.target
Wants=network-online.target

[Service]
User=mimir
Group=mimir
ExecStart=/usr/local/bin/mimir -config.file=/etc/mimir/mimir.yaml
Restart=on-failure
RestartSec=5s
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

# (5) Verify
$ mimir -version
```

### 10.5 Mimir cluster configuration

Mimir runs in **monolithic mode** for Phase 2 — every Mimir process runs all components (distributor, ingester, querier, query-frontend, compactor, ruler, store-gateway) and they coordinate via a memberlist gossip ring, exactly like Loki in chapter 09. Phase 3 with MinIO will keep the same topology; only the chunk backend changes.

```bash
# [each obs VM]

$ sudo tee /etc/mimir/mimir.yaml > /dev/null <<'EOF'
multitenancy_enabled: false  # Phase 2 single-tenant; Phase 5 per-team auth

target: all,alertmanager,overrides-exporter

server:
  http_listen_port: 9009
  grpc_listen_port: 9095
  http_listen_address: 0.0.0.0
  log_level: info

common:
  storage:
    backend: filesystem
    filesystem:
      dir: /var/lib/mimir/data

memberlist:
  join_members:
    - auishqosrobs01:7947
    - auishqosrobs02:7947
    - auishqosrobs03:7947
  bind_port: 7947

ingester:
  ring:
    instance_addr: 10.111.30.60   # REPLACE per node
    replication_factor: 3
    kvstore:
      store: memberlist

distributor:
  ring:
    instance_addr: 10.111.30.60   # REPLACE per node
    kvstore:
      store: memberlist

store_gateway:
  sharding_ring:
    replication_factor: 3
    kvstore:
      store: memberlist

compactor:
  data_dir: /var/lib/mimir/compactor
  sharding_ring:
    kvstore:
      store: memberlist

ruler:
  rule_path: /var/lib/mimir/rules
  ring:
    kvstore:
      store: memberlist

blocks_storage:
  backend: filesystem
  filesystem:
    dir: /var/lib/mimir/tsdb
  bucket_store:
    sync_dir: /var/lib/mimir/tsdb-sync
  tsdb:
    dir: /var/lib/mimir/tsdb

limits:
  ingestion_rate: 100000               # samples/sec per tenant (single tenant here)
  ingestion_burst_size: 200000
  max_global_series_per_user: 150000   # cardinality guard
  max_global_series_per_metric: 20000
  compactor_blocks_retention_period: 90d  # 90-day retention before delete
  out_of_order_time_window: 5m

frontend:
  log_queries_longer_than: 10s
EOF

# (Use sed in-place to fix the 10.111.30.60 → correct IP per node)
# obs02:  sudo sed -i 's/10.111.30.60/10.111.30.61/g' /etc/mimir/mimir.yaml
# obs03:  sudo sed -i 's/10.111.30.60/10.111.30.62/g' /etc/mimir/mimir.yaml

$ sudo systemctl daemon-reload
$ sudo systemctl enable --now mimir
$ sudo systemctl status mimir --no-pager | head -5
$ curl http://127.0.0.1:9009/ready
# Expected (after ~30 sec): "ready"
```

After all 3 nodes are up:

```bash
$ curl http://127.0.0.1:9009/distributor/ring | grep -c ACTIVE
# Expected: 3 (active distributors)
$ curl http://127.0.0.1:9009/ingester/ring | grep -c ACTIVE
# Expected: 3 (active ingesters)
```

> **ℹ Memberlist port choice**
>
> Loki (chapter 09) uses port 7946; Mimir uses 7947 in this config to keep the two gossip rings independent on the same host. Both run on memberlist; choosing different ports avoids the "did the right service join the right ring" diagnostic question.

### 10.6 Wire Prometheus to write to Mimir

Now Prometheus gets a config file that scrapes everything (§10.7) and remote-writes to the local Mimir (which then replicates to peers).

```bash
# [each obs VM]
$ sudo tee /etc/prometheus/prometheus.yml > /dev/null <<'EOF'
global:
  scrape_interval: 15s
  scrape_timeout: 10s
  evaluation_interval: 15s
  external_labels:
    cluster: au-platform
    replica: __REPLICA__   # filled by sed below: prom01 / prom02 / prom03

remote_write:
  - url: http://127.0.0.1:9009/api/v1/push
    name: mimir-local
    queue_config:
      capacity: 10000
      max_samples_per_send: 2000
      batch_send_deadline: 5s
    metadata_config:
      send: true

# Scrape jobs imported piecewise; see §10.7
scrape_config_files:
  - /etc/prometheus/scrapes.d/*.yml

rule_files:
  - /etc/prometheus/rules.d/*.yml
EOF

# Replica label per host (Mimir uses external_labels for HA dedup)
$ HOSTSHORT=$(hostname -s | sed 's/auishqos//')   # → robs01 / robs02 / robs03
$ sudo sed -i "s/__REPLICA__/${HOSTSHORT}/" /etc/prometheus/prometheus.yml

$ sudo install -d -m 750 -o prometheus -g prometheus /etc/prometheus/scrapes.d
$ sudo chown -R prometheus:prometheus /etc/prometheus

# Don't enable yet — scrape jobs come next (§10.7)
```

The `external_labels.replica` pattern is the Mimir HA dedup key: when 3 Prometheus instances scrape the same target, they all push the same metric — but with different `replica` labels. Mimir's distributor sees the duplicates and stores only one copy per `cluster` (configured via `accept_ha_samples` below).

```bash
# [each obs VM] — extend mimir.yaml with HA tracker
$ sudo tee -a /etc/mimir/mimir.yaml > /dev/null <<'EOF'

distributor:
  ha_tracker:
    enable_ha_tracker: true
    kvstore:
      store: memberlist

limits:
  accept_ha_samples: true
  ha_cluster_label: cluster
  ha_replica_label: replica
EOF

$ sudo systemctl restart mimir
```

> **⚠ The `distributor` and `limits` blocks already appear earlier in the file.**
>
> The `tee -a` above is illustrative for a fresh install; in practice merge these keys into the existing blocks rather than appending duplicates. `mimir -config.file=/etc/mimir/mimir.yaml -config.expand-env=false -modules=true` validates without restarting.

### 10.7 Scrape configs for Phase 1 + Phase 2 services

Each scrape job lives in its own file under `/etc/prometheus/scrapes.d/` for clean review and targeted reload. Roll out one at a time.

```bash
# [each obs VM]

# (1) Vault metrics (chapter 03)
$ sudo tee /etc/prometheus/scrapes.d/vault.yml > /dev/null <<'EOF'
scrape_configs:
  - job_name: vault
    metrics_path: /v1/sys/metrics
    params:
      format: ['prometheus']
    scheme: https
    tls_config:
      ca_file: /etc/prometheus/ca/au-internal-ca.pem
    bearer_token_file: /etc/prometheus/secrets/vault-prom-token
    static_configs:
      - targets:
          - auishqosrvlt01:8200
          - auishqosrvlt02:8200
          - auishqosrvlt03:8200
        labels:
          role: vault
EOF

# (2) Nomad + Consul (chapter 05) — both expose Prometheus-format metrics
$ sudo tee /etc/prometheus/scrapes.d/nomad.yml > /dev/null <<'EOF'
scrape_configs:
  - job_name: nomad
    metrics_path: /v1/metrics
    params:
      format: ['prometheus']
    scheme: https
    tls_config:
      ca_file: /etc/prometheus/ca/au-internal-ca.pem
    static_configs:
      - targets:
          - auishqosrnmd01:4646
          - auishqosrnmd02:4646
          - auishqosrnmd03:4646
        labels:
          role: nomad-server
      - targets:
          - auishqosrnmc01:4646
          - auishqosrnmc02:4646
          - auishqosrnmc03:4646
        labels:
          role: nomad-client

  - job_name: consul
    metrics_path: /v1/agent/metrics
    params:
      format: ['prometheus']
    scheme: https
    tls_config:
      ca_file: /etc/prometheus/ca/au-internal-ca.pem
    static_configs:
      - targets:
          - auishqosrnmd01:8501
          - auishqosrnmd02:8501
          - auishqosrnmd03:8501
        labels:
          role: consul
EOF

# (3) Keycloak (chapter 07) — Quarkus Micrometer endpoint
$ sudo tee /etc/prometheus/scrapes.d/keycloak.yml > /dev/null <<'EOF'
scrape_configs:
  - job_name: keycloak
    metrics_path: /metrics
    scheme: https
    tls_config:
      ca_file: /etc/prometheus/ca/au-internal-ca.pem
    static_configs:
      - targets:
          - keycloak.africanunion.org:443
        labels:
          role: keycloak
EOF

# (4) GitLab (chapter 04)
$ sudo tee /etc/prometheus/scrapes.d/gitlab.yml > /dev/null <<'EOF'
scrape_configs:
  - job_name: gitlab-rails
    metrics_path: /-/metrics
    scheme: https
    static_configs:
      - targets:
          - git.africanunion.org:443
        labels:
          role: gitlab

  - job_name: gitlab-workhorse
    metrics_path: /metrics
    static_configs:
      - targets:
          - auishqosrgit01:9229
        labels:
          role: gitlab-workhorse

  - job_name: gitaly
    static_configs:
      - targets:
          - auishqosrgit01:9236
        labels:
          role: gitaly

  - job_name: gitlab-sidekiq
    static_configs:
      - targets:
          - auishqosrgit01:8082
        labels:
          role: gitlab-sidekiq
EOF

# (5) Postgres (Keycloak's DB; Phase 3 ch13 will add the app DB cluster)
$ sudo tee /etc/prometheus/scrapes.d/postgres.yml > /dev/null <<'EOF'
scrape_configs:
  - job_name: postgres
    static_configs:
      - targets:
          - auishqosrkdb01:9187   # postgres_exporter port
        labels:
          role: postgres
          instance_role: keycloak-db
EOF

# (6) Loki (chapter 09) — exposes its own /metrics
$ sudo tee /etc/prometheus/scrapes.d/loki.yml > /dev/null <<'EOF'
scrape_configs:
  - job_name: loki
    static_configs:
      - targets:
          - auishqosrobs01:3100
          - auishqosrobs02:3100
          - auishqosrobs03:3100
        labels:
          role: loki
EOF

# (7) Mimir (self-scrape)
$ sudo tee /etc/prometheus/scrapes.d/mimir.yml > /dev/null <<'EOF'
scrape_configs:
  - job_name: mimir
    static_configs:
      - targets:
          - auishqosrobs01:9009
          - auishqosrobs02:9009
          - auishqosrobs03:9009
        labels:
          role: mimir
EOF

# (8) Validate before enabling
$ sudo -u prometheus promtool check config /etc/prometheus/prometheus.yml
# Expected: "SUCCESS: ... config files for syntactically correct"

# (9) Bootstrap the CA bundle Prometheus uses to verify TLS targets
$ sudo install -d -m 750 -o prometheus -g prometheus /etc/prometheus/ca
$ sudo install -m 644 -o prometheus -g prometheus \
    /etc/ssl/certs/au-internal-ca.pem \
    /etc/prometheus/ca/au-internal-ca.pem

# (10) Vault scrape token — Vault policy "prometheus-scrape" attached to a periodic token
$ sudo install -d -m 700 -o prometheus -g prometheus /etc/prometheus/secrets
$ vault token create -policy=prometheus-scrape -period=720h -orphan -format=json \
    | jq -r .auth.client_token \
    | sudo -u prometheus tee /etc/prometheus/secrets/vault-prom-token > /dev/null
$ sudo chmod 600 /etc/prometheus/secrets/vault-prom-token

# (11) Now start Prometheus
$ sudo systemctl daemon-reload
$ sudo systemctl enable --now prometheus
$ sudo systemctl status prometheus --no-pager | head -5
$ curl -s http://127.0.0.1:9090/-/ready
# Expected: "Prometheus Server is Ready."
```

> **ℹ Reload without restart**
>
> Adding scrape jobs after the fact: drop a new `*.yml` into `/etc/prometheus/scrapes.d/`, validate with `promtool check config`, then `curl -X POST http://127.0.0.1:9090/-/reload` (works because `--web.enable-lifecycle` is set on the systemd unit). No service interruption.

### 10.8 Node exporter on every platform VM

Node exporter is the canonical Prometheus exporter for host-level metrics (CPU, memory, disk, network, filesystem, NTP). Install on every platform VM — same set as Promtail in chapter 09 §9.8.

```bash
# [every platform VM]

# (1) Install from Ubuntu's package — node_exporter is stable upstream
$ sudo apt update
$ sudo apt install -y prometheus-node-exporter
$ sudo apt-mark hold prometheus-node-exporter

# (2) Bind to internal interface only (default is 0.0.0.0:9100; we lock to 10.111.x.x via UFW below)
$ sudo systemctl status prometheus-node-exporter --no-pager | head -5

# (3) Verify
$ curl -s http://127.0.0.1:9100/metrics | head -20
# Expected: # HELP / # TYPE / node_* metric lines
```

Add a scrape job back on the obs VMs:

```bash
# [each obs VM]
$ sudo tee /etc/prometheus/scrapes.d/node.yml > /dev/null <<'EOF'
scrape_configs:
  - job_name: node
    static_configs:
      - targets:
          - auishqosrbas01:9100
          - auishqosrbas02:9100
          - auishqosrvlt01:9100
          - auishqosrvlt02:9100
          - auishqosrvlt03:9100
          - auishqosrgit01:9100
          - auishqosrnmd01:9100
          - auishqosrnmd02:9100
          - auishqosrnmd03:9100
          - auishqosrnmc01:9100
          - auishqosrnmc02:9100
          - auishqosrnmc03:9100
          - auishqosrnex01:9100
          - auishqosrkc01:9100
          - auishqosrkc02:9100
          - auishqosrkdb01:9100
          - auishqosrobs01:9100
          - auishqosrobs02:9100
          - auishqosrobs03:9100
          - auishqosrgrf01:9100
        labels:
          job: node
EOF

$ sudo -u prometheus promtool check config /etc/prometheus/prometheus.yml
$ curl -X POST http://127.0.0.1:9090/-/reload
```

A static target list works for Phase 2's ~20 platform VMs. Phase 3 [chapter 17 — HAProxy + Consul SD](17-haproxy.md) introduces Consul service discovery so future targets register themselves; the scrape config's `static_configs` block becomes `consul_sd_configs`.

### 10.9 Add Mimir as a Grafana data source

```bash
# [auishqosrgrf01]
$ sudo tee /etc/grafana/provisioning/datasources/mimir.yaml > /dev/null <<'EOF'
apiVersion: 1

datasources:
  - name: Mimir
    type: prometheus
    access: proxy
    url: http://auishqosrobs01:9009/prometheus
    isDefault: false
    editable: false
    jsonData:
      httpMethod: POST
      prometheusType: Mimir
      prometheusVersion: 2.14.0
      timeInterval: 15s
      manageAlerts: true
EOF

$ sudo systemctl restart grafana-server
```

> **ℹ Why URL ends in `/prometheus`**
>
> Mimir exposes the standard Prometheus query API under `/prometheus/api/v1/query` etc. Grafana's Prometheus data source appends `/api/v1/...` itself, so we point it at the Mimir URL with `/prometheus` already on the end.

### 10.10 Standard metric labels + retention

Metrics become useful (and stay performant) when labels are consistent and bounded. Phase 2 standard labels:

| Label      | Source                              | Examples                                | Cardinality budget                     |
| ---------- | ----------------------------------- | --------------------------------------- | -------------------------------------- |
| `job`      | scrape job name in `prometheus.yml` | `vault`, `nomad`, `keycloak`, `node`    | <50 — fixed                            |
| `role`     | `labels:` in scrape config          | `vault`, `nomad-server`, `nomad-client` | <30 — fixed                            |
| `instance` | scrape target host:port             | `auishqosrvlt01:8200`                   | ~ #VMs × #scraped-services per VM      |
| `cluster`  | Prometheus `external_labels`        | `au-platform`                           | 1 (Phase 2)                            |
| `replica`  | Prometheus `external_labels`        | `robs01`, `robs02`, `robs03`            | 3 — Mimir collapses these via HA dedup |

**What does NOT belong as a metric label**, even though Prometheus permits it:

- per-request IDs / correlation IDs → goes in logs (chapter 09) or trace tags (chapter 11)
- user IDs / customer IDs → high cardinality; query via traces or logs instead
- full URLs with query strings → use `route` (e.g. `/api/users/:id`) not `path` (raw URL)
- container short-IDs that change every deploy

**Retention tiers:**

| Tier         | Where                                  | Window  | Used for                               |
| ------------ | -------------------------------------- | ------- | -------------------------------------- |
| Hot (Prom)   | each Prometheus' local TSDB            | 15 days | Direct PromQL via SSH if Mimir is down |
| Warm (Mimir) | filesystem on obs VMs (Phase 2)        | 90 days | Grafana dashboards + alerting          |
| Cold         | MinIO with object-lifecycle (Phase 3+) | 1 year  | Capacity planning, audit, post-mortems |

Phase 2 ships hot + warm only; cold tier comes with MinIO in chapter 15.

### 10.11 Initial dashboards

Provision a starter set under the same provisioning directory as chapter 09's Loki dashboards. JSON files can be sourced from the official Grafana Labs dashboards (curated for Mimir, Vault, Nomad, Postgres) and version-controlled separately.

```bash
# [auishqosrgrf01]
$ sudo install -d -m 755 /var/lib/grafana/dashboards/metrics

# Suggested starter set:
#   - node-overview.json          (id 1860 on grafana.com — Prometheus Node Exporter Full)
#   - vault-overview.json         (id 12904)
#   - nomad-overview.json         (id 12727)
#   - consul.json                 (id 13396)
#   - postgres-overview.json      (id 9628)
#   - mimir-overview.json         (Grafana Labs official Mimir dashboards)
#   - keycloak-overview.json      (custom — JVM, login rate, error rate)
#
# Pull each from grafana.com (or maintain locally), drop into /var/lib/grafana/dashboards/metrics/

$ ls /var/lib/grafana/dashboards/metrics/
$ sudo systemctl restart grafana-server
```

Specific JSON content omitted from this chapter; maintained in a `au-grafana-dashboards` Git repository pulled into the provisioning directory by Phase 5 Ansible (chapter 23).

### 10.12 UFW + firewall rules

```bash
# [each obs VM — auishqosrobs01-03]

# Mimir push API from local Prometheus (loopback) — already covered, no rule needed
# Mimir query API for Grafana:
$ sudo ufw allow from 10.111.30.70 to any port 9009 proto tcp \
    comment 'Grafana → Mimir query'

# Mimir gossip + gRPC inter-node (peer-only)
$ sudo ufw allow from 10.111.30.60 to any port 7947 proto any comment 'Mimir memberlist obs01'
$ sudo ufw allow from 10.111.30.61 to any port 7947 proto any comment 'Mimir memberlist obs02'
$ sudo ufw allow from 10.111.30.62 to any port 7947 proto any comment 'Mimir memberlist obs03'
$ sudo ufw allow from 10.111.30.60 to any port 9095 proto tcp comment 'Mimir gRPC obs01'
$ sudo ufw allow from 10.111.30.61 to any port 9095 proto tcp comment 'Mimir gRPC obs02'
$ sudo ufw allow from 10.111.30.62 to any port 9095 proto tcp comment 'Mimir gRPC obs03'

# Note: Loki uses the same gRPC port (9095) — same UFW rule already covers both.

# Prometheus is bound to 127.0.0.1:9090; no external rule needed.

# [every platform VM] — node_exporter scraped from obs VMs
$ sudo ufw allow from 10.111.30.60 to any port 9100 proto tcp comment 'Prometheus scrape obs01'
$ sudo ufw allow from 10.111.30.61 to any port 9100 proto tcp comment 'Prometheus scrape obs02'
$ sudo ufw allow from 10.111.30.62 to any port 9100 proto tcp comment 'Prometheus scrape obs03'

# [auishqosrkdb01] — postgres_exporter
$ sudo ufw allow from 10.111.30.0/24 to any port 9187 proto tcp \
    comment 'Prometheus scrape → postgres_exporter'

# [auishqosrgit01] — gitlab metrics
$ sudo ufw allow from 10.111.30.0/24 to any port 9229 proto tcp comment 'Prometheus → workhorse'
$ sudo ufw allow from 10.111.30.0/24 to any port 9236 proto tcp comment 'Prometheus → gitaly'
$ sudo ufw allow from 10.111.30.0/24 to any port 8082 proto tcp comment 'Prometheus → sidekiq'
```

### 10.13 Verification

```bash
# (1) All 3 Mimir nodes ready + ring formed
$ for h in 01 02 03; do
    ssh -J au-bastion auishqosrobs${h}.au-internal \
      'curl -s http://127.0.0.1:9009/ready'
  done
# Expected: "ready" from each

$ ssh -J au-bastion auishqosrobs01.au-internal \
    'curl -s http://127.0.0.1:9009/ingester/ring' | grep -c ACTIVE
# Expected: 3

# (2) Prometheus scraping cleanly
$ ssh -J au-bastion auishqosrobs01.au-internal \
    'curl -s http://127.0.0.1:9090/api/v1/targets?state=active' \
    | jq '.data.activeTargets[] | {job:.labels.job, health:.health, lastError:.lastError}' \
    | head -50
# Expected: every target health="up"; lastError=""

# (3) HA dedup working — same metric arrives on 3 Prometheuses but lands once in Mimir
$ ssh -J au-bastion auishqosrobs01.au-internal \
    'curl -sG http://127.0.0.1:9009/prometheus/api/v1/query \
      --data-urlencode "query=up{job=\"vault\"}" | jq ".data.result | length"'
# Expected: 3 (one per Vault node), NOT 9 (3 nodes × 3 Prometheus replicas).
# If you see 9, HA tracker isn't deduplicating — check ha_cluster_label / ha_replica_label config.

# (4) Grafana queries Mimir
#     Grafana UI → Explore → Mimir data source → query: up
#     Expected: time-series chart of every up=1 target

# (5) Node exporter on every platform VM
$ ssh -J au-bastion auishqosrobs01.au-internal \
    'curl -sG http://127.0.0.1:9090/api/v1/query \
      --data-urlencode "query=count(up{job=\"node\"})" | jq .data.result'
# Expected: count = number of platform VMs (~20 in Phase 2)

# (6) Cardinality sanity
$ ssh -J au-bastion auishqosrobs01.au-internal \
    'curl -sG http://127.0.0.1:9090/api/v1/query \
      --data-urlencode "query=count({__name__=~\".+\"}) by (job)" | jq .data.result'
# Expected: each job in tens to low-thousands of series. >50k for one job → audit labels.

# (7) Disk usage trending sanely
$ ssh -J au-bastion auishqosrobs01.au-internal 'df -h /var/lib/mimir /var/lib/prometheus'
# Expected: room to grow; alert if >70% in chapter 12.
```

**Common failures and remedies:**

| Symptom                                                 | Cause                                                                    | Fix                                                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prometheus targets all "down" with `connection refused` | UFW blocking scrape port; or service binding to 127.0.0.1 only           | Verify `sudo ufw status numbered`; verify exporter `--web.listen-address` allows internal IP                                                                |
| Vault scrape fails `permission denied`                  | Token missing `prometheus-scrape` policy or expired                      | `vault token lookup $(cat /etc/prometheus/secrets/vault-prom-token)`; rotate per §10.7                                                                      |
| Mimir distributor logs `out-of-order sample`            | NTP skew; Prometheus instances on different times                        | Verify `chronyc tracking` on all 3 obs VMs; same NTP source as the rest of the platform                                                                     |
| Mimir distributor logs `series limit exceeded`          | Cardinality runaway from a new exporter                                  | Identify offender: `topk(10, count by (__name__) ({__name__=~".+"}))`; fix labels at source; raise `max_global_series_per_user` only after fixing the cause |
| Grafana Mimir data source: "no data"                    | Wrong URL (missing `/prometheus`) or no metrics scraped yet              | First check Prometheus targets; then verify data-source URL ends in `/prometheus`; query `up` to confirm                                                    |
| HA dedup not happening (3× duplicate series)            | `accept_ha_samples` not set, or `replica` label not in `external_labels` | `curl http://127.0.0.1:9009/distributor/ha-tracker` shows current cluster/replica state                                                                     |
| Prometheus reload returns 403                           | `--web.enable-lifecycle` flag missing on systemd unit                    | Add to `ExecStart`; daemon-reload; restart                                                                                                                  |
| Mimir process consumes all memory                       | Cardinality + samples-per-tenant uncapped                                | Lower `max_global_series_per_user`; also see Mimir's "Cardinality" dashboard for per-metric pain points                                                     |

### 10.14 Path to Phase 3 (MinIO storage backend)

Phase 3 [chapter 15 — MinIO](15-minio.md) replaces local filesystem block storage with S3-compatible MinIO. Mimir config change:

```yaml
# Phase 3 storage replacement
common:
  storage:
    backend: s3
    s3:
      endpoint: minio.africanunion.org
      bucket_name: mimir-blocks
      access_key_id: ${MINIO_ACCESS_KEY} # injected from Vault via job env
      secret_access_key: ${MINIO_SECRET_KEY} # same
      insecure: false

blocks_storage:
  backend: s3
  s3:
    bucket_name: mimir-blocks
```

Migration: stop Mimir on each node in turn (rolling); replicate existing TSDB blocks to MinIO with `mimir-tsdb-tool` or `mc cp`; swap config; restart. ~30 min downtime tolerable across all 3 (per-node restart is seamless because of replication factor 3).

The Prometheus scrape configs, dashboards, Grafana SSO, and remote-write target all stay identical. Only the storage backend changes — the same property that made the Phase 2 → Phase 3 path easy for Loki.

---
