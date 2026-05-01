# 09 — Loki + Grafana

> **Phase**: 2 (identity + observability) · **Run on**: 3× observability VMs (`auishqosrobs01-03`) + 1× Grafana VM (`auishqosrgrf01`) + Promtail on every platform VM · **Time**: ~3 hours
>
> Centralised log aggregation. Every platform VM (bastions, Vault nodes, Keycloak, Nomad, GitLab, Nexus) ships its logs to a 3-node Loki cluster. Grafana provides the search UI, federated to Keycloak (chapter 08) for SSO. **First chapter of the LGTM stack** — chapters 10 (Mimir/metrics), 11 (Tempo/traces), 12 (Alertmanager) build on the same infrastructure.
>
> Phase 2 chapter 3 of 6.
>
> **Prev**: [08 — Keycloak federated to AD](08-keycloak-ad.md) · **Next**: [10 — Prometheus + Mimir](10-prometheus.md) · **Index**: [README](README.md)

---

## Contents

- [§9.1 Role + threat model](#91-role-threat-model)
- [§9.2 Pre-flight (3 obs VMs + Grafana VM)](#92-pre-flight-3-obs-vms-grafana-vm)
- [§9.3 Install Loki on the obs VMs](#93-install-loki-on-the-obs-vms)
- [§9.4 Loki cluster configuration](#94-loki-cluster-configuration)
- [§9.5 Install Grafana](#95-install-grafana)
- [§9.6 Grafana SSO via Keycloak](#96-grafana-sso-via-keycloak)
- [§9.7 Add Loki as a Grafana data source](#97-add-loki-as-a-grafana-data-source)
- [§9.8 Promtail on every platform VM](#98-promtail-on-every-platform-vm)
- [§9.9 Standard log-label conventions](#99-standard-log-label-conventions)
- [§9.10 Initial dashboards](#910-initial-dashboards)
- [§9.11 UFW + firewall rules](#911-ufw-firewall-rules)
- [§9.12 Verification](#912-verification)
- [§9.13 Path to Phase 3 (MinIO storage backend)](#913-path-to-phase-3-minio-storage-backend)

## 9. Loki + Grafana

### 9.1 Role + threat model

Loki ingests log streams (push-based; Promtail agents on each VM stream their journald + named log files) and stores them indexed by **labels** (not full-text). Grafana queries Loki with LogQL; operators see logs from every platform service in one UI, searchable by service / level / time / correlation ID.

Three consequences:

1. **Compromise = audit log integrity loss.** An attacker with write access to Loki can inject misleading log entries or delete genuine ones — undermines incident response. Defence: write access via per-VM Promtail tokens (not shared); Loki nodes themselves accessed only via SSO; archive tier (Phase 3 MinIO with versioning) for tamper-evident long-term retention.
2. **Outage = no operational visibility.** Existing logs on individual VMs continue to accumulate locally, but operators lose the unified search until Loki is back. Mitigation: 3-node Loki cluster (tolerates 1 node loss); Promtail buffers locally and replays after Loki recovers.
3. **Disk fill on the obs VMs is the most likely failure.** Log volume grows with platform usage; Phase 2 uses local filesystem chunk store. Phase 3 [chapter 15 — MinIO](15-minio.md) moves chunks to S3-compatible object storage, removing the disk-fill failure mode.

**Threat model — what we defend against:**

| Threat                                          | Mitigation                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Tampered log entries                            | Per-VM Promtail tokens (separate per host); Loki write API requires token; tokens rotated on suspicion              |
| Sensitive data leaking into logs (PII, secrets) | App-side redaction at log emission (greenbook's correlationId/structured-fields pattern); regex filters at Promtail |
| Unauthorised log read                           | Grafana behind Keycloak SSO; per-team folder ACLs; read access logged via Grafana audit                             |
| Disk fill from runaway log volume               | Per-stream rate limits in Loki; per-tenant retention; alert (chapter 12) on free-space thresholds                   |
| Loss of Loki cluster                            | 3-node Raft replication; each chunk replicated to ≥2 nodes; Phase 3 MinIO chunk backend → durable storage           |
| Log gap during Loki outage                      | Promtail buffers up to 10 GB locally; replays automatically when Loki recovers                                      |

**Phase 2 deliberate non-goals:**

- **Object storage backend (MinIO / S3)** — Phase 3 [chapter 15](15-minio.md) introduces MinIO; until then, local filesystem on each obs VM. 3-way replication compensates.
- **Multi-tenancy** — single tenant for the platform; per-team isolation via Grafana folder ACLs, not Loki tenants.
- **Log forwarding to external SIEM** — out of scope for Phase 2; revisit if AU compliance ever requires it.

### 9.2 Pre-flight (3 obs VMs + Grafana VM)

Four Ubuntu 24.04 VMs hardened to AU base. Skip §1.8. Operator account membership.

| Role        | Hostname         | IP           | vCPU | RAM   | Disk       | Notes                               |
| ----------- | ---------------- | ------------ | ---- | ----- | ---------- | ----------------------------------- |
| Loki node 1 | `auishqosrobs01` | 10.111.30.60 | 4    | 16 GB | 200 GB SSD | Loki + Mimir (ch10) + Tempo (ch11)  |
| Loki node 2 | `auishqosrobs02` | 10.111.30.61 | 4    | 16 GB | 200 GB SSD | Same — colocated stack              |
| Loki node 3 | `auishqosrobs03` | 10.111.30.62 | 4    | 16 GB | 200 GB SSD | Same                                |
| Grafana     | `auishqosrgrf01` | 10.111.30.70 | 2    | 4 GB  | 80 GB SSD  | Single VM (Phase 2); HA in Phase 3+ |

The 3 obs VMs are sized to host Loki + Mimir + Tempo together (chapters 10-11 share the infrastructure). Grafana stays separate so its outage doesn't affect ingestion.

```bash
# [each VM]
$ lsb_release -d
$ sudo systemctl is-active unattended-upgrades fail2ban
$ groups | grep operators
```

### 9.3 Install Loki on the obs VMs

Loki ships as a single binary. We install it from the Grafana apt repo for managed updates.

```bash
# [auishqosrobs01-03]

# (1) Add Grafana's apt repo
$ wget -O- https://apt.grafana.com/gpg.key \
    | sudo gpg --dearmor -o /usr/share/keyrings/grafana.gpg
$ echo "deb [signed-by=/usr/share/keyrings/grafana.gpg] https://apt.grafana.com stable main" \
    | sudo tee /etc/apt/sources.list.d/grafana.list

# (2) Install Loki + Promtail (we'll use Promtail on every VM later)
$ sudo apt update
$ sudo apt install -y loki promtail

# (3) Pin
$ sudo apt-mark hold loki promtail

# (4) Verify
$ loki -version
$ promtail -version
```

### 9.4 Loki cluster configuration

Loki runs in **microservices mode** for HA — each node runs all components (distributor, ingester, querier, query-frontend, compactor) but coordinates via a shared ring (memberlist gossip) and shared storage (filesystem in Phase 2; MinIO in Phase 3).

```bash
# [each obs VM]

$ sudo install -d -m 750 -o loki -g loki \
    /etc/loki \
    /var/lib/loki \
    /var/lib/loki/chunks \
    /var/lib/loki/rules \
    /var/lib/loki/wal

# (1) Loki config — node-specific bits noted with REPLACE markers
$ sudo tee /etc/loki/loki.yaml > /dev/null <<'EOF'
auth_enabled: false  # Phase 2 single-tenant; Phase 5 per-team auth via header

server:
  http_listen_port: 3100
  grpc_listen_port: 9095
  http_listen_address: 0.0.0.0
  log_level: info

common:
  path_prefix: /var/lib/loki
  storage:
    filesystem:
      chunks_directory: /var/lib/loki/chunks
      rules_directory: /var/lib/loki/rules
  replication_factor: 3
  ring:
    instance_addr: 10.111.30.60   # REPLACE per node
    kvstore:
      store: memberlist

memberlist:
  join_members:
    - auishqosrobs01:7946
    - auishqosrobs02:7946
    - auishqosrobs03:7946
  bind_port: 7946

schema_config:
  configs:
    - from: 2026-05-01
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h

compactor:
  working_directory: /var/lib/loki/compactor
  compaction_interval: 10m
  retention_enabled: true
  retention_delete_delay: 2h
  retention_delete_worker_count: 150
  delete_request_store: filesystem

limits_config:
  retention_period: 720h          # 30 days hot retention
  max_query_length: 720h
  max_query_parallelism: 32
  reject_old_samples: true
  reject_old_samples_max_age: 168h
  ingestion_rate_mb: 16
  ingestion_burst_size_mb: 32
  per_stream_rate_limit: 5MB
  per_stream_rate_limit_burst: 15MB

ruler:
  storage:
    type: local
    local:
      directory: /var/lib/loki/rules
  rule_path: /var/lib/loki/rules-temp
  alertmanager_url: http://auishqosrobs01:9093  # Phase 2 ch12
  ring:
    kvstore:
      store: memberlist

query_range:
  align_queries_with_step: true
  cache_results: true
  results_cache:
    cache:
      embedded_cache:
        enabled: true
        max_size_mb: 100

frontend:
  log_queries_longer_than: 10s
  compress_responses: true
  max_outstanding_per_tenant: 2048
EOF

# (2) systemd unit was installed by the apt package; just enable
$ sudo systemctl enable --now loki

# (3) Verify
$ sudo systemctl status loki --no-pager | head -5
$ curl http://127.0.0.1:3100/ready
# Expected (after ~30 sec): "ready"
$ curl http://127.0.0.1:3100/metrics | grep loki_build_info
# Expected: loki_build_info gauge with version label
```

After all 3 nodes are running, verify the ring formed:

```bash
$ curl http://127.0.0.1:3100/ring
# Expected: an HTML/JSON view showing 3 ingesters, all "ACTIVE"
```

### 9.5 Install Grafana

```bash
# [auishqosrgrf01]

# (1) Same Grafana apt repo as Loki
$ wget -O- https://apt.grafana.com/gpg.key \
    | sudo gpg --dearmor -o /usr/share/keyrings/grafana.gpg
$ echo "deb [signed-by=/usr/share/keyrings/grafana.gpg] https://apt.grafana.com stable main" \
    | sudo tee /etc/apt/sources.list.d/grafana.list

$ sudo apt update
$ sudo apt install -y grafana
$ sudo apt-mark hold grafana

# (2) TLS via local nginx (same pattern as Nexus ch06, Keycloak ch07)
$ sudo apt install -y nginx
$ sudo install -d -m 755 /etc/nginx/ssl
$ sudo install -m 644 -o root -g root \
    wildcard.africanunion.org.fullchain.pem \
    /etc/nginx/ssl/grafana.crt
$ sudo install -m 600 -o root -g root \
    wildcard.africanunion.org.key \
    /etc/nginx/ssl/grafana.key

$ sudo tee /etc/nginx/sites-available/grafana > /dev/null <<'EOF'
upstream grafana_app {
    server 127.0.0.1:3000;
    keepalive 16;
}

server {
    listen 80;
    server_name grafana.africanunion.org;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name grafana.africanunion.org;

    ssl_certificate     /etc/nginx/ssl/grafana.crt;
    ssl_certificate_key /etc/nginx/ssl/grafana.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;

    location / {
        proxy_pass http://grafana_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }

    # WebSocket — Grafana uses for live tailing
    location /api/live/ {
        proxy_pass http://grafana_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
EOF
$ sudo ln -sf /etc/nginx/sites-available/grafana /etc/nginx/sites-enabled/grafana
$ sudo rm -f /etc/nginx/sites-enabled/default

# (3) Tell Grafana its public URL + bind to loopback
$ sudo tee /etc/grafana/grafana.ini.d/00-platform.ini > /dev/null <<'EOF'
[server]
http_addr = 127.0.0.1
http_port = 3000
protocol = http
domain = grafana.africanunion.org
root_url = https://grafana.africanunion.org/
serve_from_sub_path = false

[security]
disable_initial_admin_creation = false  # need bootstrap admin first
cookie_secure = true
cookie_samesite = lax

[users]
allow_sign_up = false
auto_assign_org = true
auto_assign_org_role = Viewer
EOF

# (4) Start Grafana + reload nginx
$ sudo systemctl enable --now grafana-server
$ sudo nginx -t && sudo systemctl reload nginx

# (5) First admin login + password rotation (same pattern as
#     Nexus ch06 / Keycloak ch07 / GitLab ch04)
#     Default admin/admin → forces password change on first login.
#     Choose a strong unique password; store in Vault:
$ vault kv put kv/platform/grafana/admin_password \
    username='admin' \
    password='<new-password>' \
    rotated_at="$(date -Iseconds)" \
    rotation_period_days=90
```

### 9.6 Grafana SSO via Keycloak

Use the OIDC client created in chapter 07 §7.9.

```bash
# (1) Fetch Grafana's Keycloak client secret
$ vault kv get kv/platform/keycloak/clients/grafana

# (2) Configure Grafana for Keycloak OAuth
# [auishqosrgrf01]
$ sudo tee /etc/grafana/grafana.ini.d/10-oauth.ini > /dev/null <<EOF
[auth.generic_oauth]
enabled = true
name = AU SSO
allow_sign_up = true
auto_login = false
client_id = grafana
client_secret = $(vault kv get -field=client_secret kv/platform/keycloak/clients/grafana)
scopes = openid email profile groups
empty_scopes = false
auth_url = https://keycloak.africanunion.org/realms/au/protocol/openid-connect/auth
token_url = https://keycloak.africanunion.org/realms/au/protocol/openid-connect/token
api_url = https://keycloak.africanunion.org/realms/au/protocol/openid-connect/userinfo
allowed_groups = au-platform-engineers, au-app-developers, au-all-staff
role_attribute_path = contains(groups[*], 'au-platform-engineers') && 'Admin' || contains(groups[*], 'au-app-developers') && 'Editor' || 'Viewer'
role_attribute_strict = false
allow_assign_grafana_admin = true
skip_org_role_sync = false

[auth]
disable_login_form = false      # keep enabled for break-glass admin login
oauth_auto_login = false
EOF

# (3) Restart Grafana
$ sudo systemctl restart grafana-server

# (4) Test SSO
#     - Browse to https://grafana.africanunion.org/
#     - Click "Sign in with AU SSO" button on login page
#     - Redirected to Keycloak → log in with AU AD creds (chapter 08)
#     - Redirected back to Grafana, logged in with role mapped from
#       AD group (Admin / Editor / Viewer per the role_attribute_path)
```

> **ℹ Add the `groups` claim to the Keycloak OIDC client**
>
> If `groups` doesn't appear in the userinfo response, configure the Keycloak client's "Client scopes" → add a "groups" mapper. Already covered in chapter 07 §7.9 client templates; verify if Grafana role mapping fails.

### 9.7 Add Loki as a Grafana data source

```bash
# [Grafana admin UI]
# Configuration → Data sources → Add data source → Loki

URL: http://auishqosrobs01:3100
HTTP method: GET (default)
Access: Server (default)
# All other settings default

Save & Test
# Expected: "Data source successfully connected"
```

Or via provisioning (preferred for repeatability):

```bash
# [auishqosrgrf01]
$ sudo tee /etc/grafana/provisioning/datasources/loki.yaml > /dev/null <<'EOF'
apiVersion: 1

datasources:
  - name: Loki
    type: loki
    access: proxy
    url: http://auishqosrobs01:3100
    isDefault: true
    editable: false
    jsonData:
      maxLines: 1000
      derivedFields:
        - name: correlationId
          matcherRegex: '"correlationId":"([^"]+)"'
          datasourceUid: tempo  # cross-link to Tempo (Phase 2 ch11)
          url: '$${__value.raw}'
EOF

$ sudo systemctl restart grafana-server
```

### 9.8 Promtail on every platform VM

Promtail tails files / journald and pushes to Loki. Install on every platform VM (bastions, Vault nodes, Keycloak, Nomad servers + clients, GitLab, Nexus, the Grafana host itself).

```bash
# [every platform VM]

# (1) Same Grafana apt repo
$ wget -O- https://apt.grafana.com/gpg.key \
    | sudo gpg --dearmor -o /usr/share/keyrings/grafana.gpg
$ echo "deb [signed-by=/usr/share/keyrings/grafana.gpg] https://apt.grafana.com stable main" \
    | sudo tee /etc/apt/sources.list.d/grafana.list
$ sudo apt update
$ sudo apt install -y promtail
$ sudo apt-mark hold promtail

# (2) Add promtail user to systemd-journal group so it can read journald
$ sudo usermod -a -G systemd-journal promtail

# (3) Promtail config — push to Loki, scrape journald + key log files.
#     Substitute HOSTNAME and ROLE per host.
$ sudo tee /etc/promtail/config.yml > /dev/null <<EOF
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /var/lib/promtail/positions.yaml

clients:
  - url: http://auishqosrobs01:3100/loki/api/v1/push
    backoff_config:
      min_period: 500ms
      max_period: 5m
      max_retries: 10
    batchwait: 1s
    batchsize: 1048576

scrape_configs:
  # Systemd journal — every service
  - job_name: journal
    journal:
      max_age: 12h
      labels:
        job: systemd-journal
        host: $(hostname -s)
        role: <ROLE>          # bastion / vault / nomad-server / etc.
    relabel_configs:
      - source_labels: ['__journal__systemd_unit']
        target_label: 'unit'
      - source_labels: ['__journal_syslog_identifier']
        target_label: 'identifier'
      - source_labels: ['__journal_priority_keyword']
        target_label: 'level'

  # nginx access + error logs (where applicable — gitlab, keycloak, grafana hosts)
  - job_name: nginx
    static_configs:
      - targets: [localhost]
        labels:
          job: nginx
          host: $(hostname -s)
          __path__: /var/log/nginx/*.log
EOF

$ sudo install -d -m 750 -o promtail -g promtail /var/lib/promtail

# (4) Enable + start
$ sudo systemctl enable --now promtail
$ sudo systemctl status promtail --no-pager | head -5
```

### 9.9 Standard log-label conventions

Logs become useful when labels are consistent. Phase 2 standard labels:

| Label   | Source                | Examples                                 |
| ------- | --------------------- | ---------------------------------------- |
| `host`  | Promtail config       | `auishqosrvlt01`, `auishqosrgit01`       |
| `role`  | Promtail config       | `vault`, `gitlab`, `nomad-server`, `app` |
| `job`   | Promtail scrape job   | `systemd-journal`, `nginx`               |
| `unit`  | journald systemd unit | `vault.service`, `nginx.service`         |
| `level` | journald priority     | `info`, `warning`, `err`, `crit`         |

App-emitted structured logs (greenbook-style pino JSON) get parsed via Loki's `| json` LogQL operator; specific fields (`correlationId`, `service`, `version`) become queryable without becoming labels (high cardinality).

**Sample LogQL queries**:

```
# All errors across all platform services in the last hour
{level=~"err|crit|alert|emerg"} |= ""

# Vault audit events
{role="vault", unit="vault.service"} |= "audit"

# A specific correlation ID across the entire stack
{job="systemd-journal"} |~ "9f3ebc184a4a7e19"

# Nginx 5xx
{job="nginx"} |~ " 5\\d\\d "
```

### 9.10 Initial dashboards

Provision a starter dashboard that gives operators a single pane for Phase 1 services. Create as JSON, drop into Grafana's provisioning directory.

```bash
# [auishqosrgrf01]
$ sudo install -d -m 755 /etc/grafana/provisioning/dashboards
$ sudo tee /etc/grafana/provisioning/dashboards/platform.yaml > /dev/null <<'EOF'
apiVersion: 1

providers:
  - name: 'Platform'
    orgId: 1
    folder: 'Platform'
    type: file
    disableDeletion: false
    updateIntervalSeconds: 60
    allowUiUpdates: true
    options:
      path: /var/lib/grafana/dashboards/platform
EOF

$ sudo install -d -m 755 /var/lib/grafana/dashboards/platform

# Drop in dashboards as JSON files. AU's actual starter set will grow
# over time; for now seed with:
#   - platform-overview.json — top-level: error counts by role + recent
#     critical events
#   - vault-audit.json — Vault audit events with policy + path filters
#   - nginx-errors.json — 4xx/5xx rates per nginx host
#   - keycloak-events.json — login successes/failures per realm
#
# Specific JSON content omitted from this chapter (~600 lines for the
# starter set); maintained in a separate dashboard repo with version
# control. The provisioning directory pulls from that repo via Ansible
# in Phase 5.

$ sudo systemctl restart grafana-server
```

### 9.11 UFW + firewall rules

```bash
# [each obs VM — auishqosrobs01-03]

# Loki HTTP from Promtail (every platform VM) + Grafana
$ sudo ufw allow from 10.111.0.0/16 to any port 3100 proto tcp \
    comment 'Promtail + Grafana → Loki ingest/query'

# Loki gRPC for inter-Loki coordination (cluster traffic)
$ sudo ufw allow from 10.111.30.60 to any port 9095 proto tcp comment 'Loki obs01'
$ sudo ufw allow from 10.111.30.61 to any port 9095 proto tcp comment 'Loki obs02'
$ sudo ufw allow from 10.111.30.62 to any port 9095 proto tcp comment 'Loki obs03'

# Memberlist gossip between Loki nodes
$ sudo ufw allow from 10.111.30.60 to any port 7946 proto any comment 'Loki memberlist'
$ sudo ufw allow from 10.111.30.61 to any port 7946 proto any comment 'Loki memberlist'
$ sudo ufw allow from 10.111.30.62 to any port 7946 proto any comment 'Loki memberlist'

# [auishqosrgrf01]
$ sudo ufw allow from 10.111.10.0/24 to any port 443 proto tcp comment 'App VLAN → Grafana'
$ sudo ufw allow from 10.111.30.0/24 to any port 443 proto tcp comment 'Platform VLAN → Grafana'
$ sudo ufw allow from 10.111.40.0/24 to any port 443 proto tcp comment 'Operations VLAN → Grafana'
$ sudo ufw allow from 10.111.10.0/24 to any port 80 proto tcp comment 'Grafana 80→443'
$ sudo ufw allow from 10.111.30.0/24 to any port 80 proto tcp comment 'Grafana 80→443'
```

### 9.12 Verification

```bash
# (1) All 3 Loki nodes ready + ring formed
$ for h in 01 02 03; do
    ssh -J au-bastion auishqosrobs${h}.au-internal \
      'curl -s http://127.0.0.1:3100/ready'
  done
# Expected: "ready" from each

$ ssh -J au-bastion auishqosrobs01.au-internal \
    'curl -s http://127.0.0.1:3100/ring' | grep -c ACTIVE
# Expected: 3 (ACTIVE ingesters)

# (2) Grafana reachable + cert valid
$ curl -kI https://grafana.africanunion.org/
# Expected: HTTP/2 200

# (3) SSO login works (browser test)
#     Logout → click AU SSO → Keycloak → AD creds → land in Grafana
#     with the right role per group membership

# (4) Loki data source healthy
#     Grafana UI → Connections → Data sources → Loki → Test
#     Expected: "Data source successfully connected"

# (5) Promtail pushing logs
#     Grafana UI → Explore → select Loki → query: {job="systemd-journal"}
#     Expected: lines from every platform VM with promtail running

# (6) Per-host filtering works
#     Query: {host="auishqosrvlt01"} |= "Vault"
#     Expected: Vault server log lines

# (7) Cross-service correlation ID search works
#     Hit a known endpoint (e.g., a curl through the DMZ) and grab the
#     cf-ray / x-correlation-id from the response. Then search:
#     {job="systemd-journal"} |~ "<correlation-id>"
#     Expected: hits from every layer the request traversed
```

**Common failures and remedies:**

| Symptom                                                    | Cause                                                     | Fix                                                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Loki returns "too many outstanding requests"               | Default ingestion rate exceeded                           | Bump `ingestion_rate_mb` and `ingestion_burst_size_mb` in `loki.yaml`; restart                      |
| Promtail shows "context deadline exceeded" pushing to Loki | Network or Loki overloaded                                | Check Loki `journalctl -u loki` for ingester pressure; verify UFW                                   |
| Grafana SSO redirect lands on "user not in allowed groups" | `allowed_groups` list doesn't include the user's AD group | Add the group name to `allowed_groups` in `/etc/grafana/grafana.ini.d/10-oauth.ini`                 |
| Live tailing in Explore doesn't update                     | nginx not forwarding WebSocket                            | Verify nginx site has the `/api/live/` location block with WebSocket headers                        |
| `{role="vault"}` returns nothing                           | Promtail's `role` label not set on Vault hosts            | Edit promtail config on Vault hosts; set `role: vault`; restart promtail                            |
| Out-of-order log entries (timestamps wrong)                | Promtail / Loki clock skew                                | Verify NTP healthy on every VM (greenbook ch01 §1.3)                                                |
| Disk filling on obs VMs                                    | Retention not enforced; or compactor not running          | Check loki.log for compactor errors; verify `retention_period` set; Phase 3 MinIO removes this risk |

### 9.13 Path to Phase 3 (MinIO storage backend)

Phase 3 [chapter 15 — MinIO](15-minio.md) replaces local filesystem chunk storage with S3-compatible MinIO. Loki config change:

```yaml
# Phase 3 storage replacement
storage:
  s3:
    endpoint: minio.africanunion.org
    bucketnames: loki-chunks
    access_key_id: <from Vault>
    secret_access_key: <from Vault>
    s3forcepathstyle: true
    insecure: false
```

Migration: stop Loki on all 3 nodes; sync existing local chunks to MinIO; swap config; restart. ~30 min downtime tolerable for the migration window.

The dashboard provisioning, SSO config, Promtail agents, and label conventions all carry over unchanged.

---
