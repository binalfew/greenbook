# 12 — Alertmanager

> **Phase**: 2 (identity + observability) · **Run on**: 3-node Alertmanager cluster colocated on the obs VMs (`auishqosrobs01-03`); Mimir ruler + Loki ruler push alerts to it · **Time**: ~3 hours
>
> Alert routing and notification. Mimir's ruler (chapter 10) evaluates PromQL rules against metrics; Loki's ruler (chapter 09) evaluates LogQL rules against logs; both push firing alerts to a 3-node Alertmanager cluster, which deduplicates, groups, silences, and forwards to email + paging providers. Closes Phase 2.
>
> Phase 2 chapter 6 of 6.
>
> **Prev**: [11 — Tempo](11-tempo.md) · **Next**: [13 — Postgres HA](13-postgres-ha.md) — _Phase 3_ · **Index**: [README](README.md)

---

## Contents

- [§12.1 Role + threat model](#121-role-threat-model)
- [§12.2 Pre-flight (reuses obs VMs)](#122-pre-flight-reuses-obs-vms)
- [§12.3 Install Alertmanager on the obs VMs](#123-install-alertmanager-on-the-obs-vms)
- [§12.4 Alertmanager cluster configuration](#124-alertmanager-cluster-configuration)
- [§12.5 Notification routing + receivers](#125-notification-routing-receivers)
- [§12.6 Mimir ruler — initial alert rules](#126-mimir-ruler-initial-alert-rules)
- [§12.7 Loki ruler — log-based alerts](#127-loki-ruler-log-based-alerts)
- [§12.8 Silences + inhibitions](#128-silences-inhibitions)
- [§12.9 On-call rotation + escalation (Q6 dependency)](#129-on-call-rotation-escalation-q6-dependency)
- [§12.10 UFW + firewall rules](#1210-ufw-firewall-rules)
- [§12.11 Verification](#1211-verification)
- [§12.12 Phase 2 close-out](#1212-phase-2-close-out)

## 12. Alertmanager

### 12.1 Role + threat model

Alertmanager is the routing and notification layer for the metric- and log-based alerting that Mimir's ruler (chapter 10) and Loki's ruler (chapter 09) generate. The flow is:

```
Mimir/Loki ruler  ──evaluates rules every 60s──▶  fires alert  ──HTTP POST──▶  Alertmanager
                                                                                     │
                                                                                     │ deduplicates + groups
                                                                                     │ applies silences/inhibitions
                                                                                     ▼
                                                                              email · webhook · paging
```

Three consequences:

1. **Compromise = silenced alarms (the same risk as chapter 10, but realised at the routing layer).** An attacker with config write access can route alerts to /dev/null or extend silences to mask incidents. Defence: config in GitLab with code review (chapter 04); Alertmanager API not exposed externally; per-receiver auth (Phase 5 mTLS).
2. **Outage = no notifications.** Alerts continue to fire in Mimir's ruler and accumulate in Alertmanager's gossip ring; if Alertmanager itself is fully down, those alerts buffer at the ruler (1-2 minute retry window) and then drop. Mitigation: 3-node Alertmanager cluster (peer gossip; tolerates 1-node loss).
3. **Alert fatigue is the most likely failure.** Noisy or duplicate alerts train operators to ignore them, defeating the system. Defence: grouping rules (§12.5); inhibitions for known-correlated failures (§12.8); explicit severity tiers; weekly review of "top 10 noisy alerts" via Mimir's `ALERTS` series.

**Threat model — what we defend against:**

| Threat                                      | Mitigation                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Tampered config (silenced alerts)           | Config source-controlled in GitLab; CI validates `amtool check-config` before deploy; Alertmanager web UI behind Grafana SSO   |
| Unauthorised silence creation               | Silence creation requires Grafana auth (silences proxied through Grafana → Alertmanager); audit trail in Loki                  |
| Notification channel hijack (forged emails) | SMTP relay over TLS; receiver webhooks require bearer token from Vault; Phase 5 mTLS on the webhook path                       |
| Alert fatigue → ignored real incidents      | Severity tiers; grouping; inhibitions; weekly review of `ALERTS` cardinality; per-team folder ACLs limit noise to relevant ops |
| Loss of notifications during AM outage      | 3-node cluster gossip; ruler retry; Phase 4 DR site picks up alerting if entire primary is down                                |
| Paging spam during major incident           | Group_wait + group_interval + repeat_interval tuned; "incident mode" silence template for known major events                   |

**Phase 2 deliberate non-goals:**

- **Native PagerDuty / Opsgenie / VictorOps integration** — Phase 2 ships email + webhook receivers; AU's actual paging product is decided in Q6 (open) and wired in Phase 5.
- **Severity-based escalation chains** — Phase 2 has flat routing (severity routes to a receiver); Phase 5 introduces escalation timers + on-call schedules.
- **Synthetic / blackbox monitoring rules** — endpoint up-checks via blackbox_exporter come in Phase 3 chapter 17 (HAProxy + edge), so external-availability rules wait until then.
- **Multi-tenancy** — single tenant for the platform; per-team isolation via routing trees, not Alertmanager tenants.

### 12.2 Pre-flight (reuses obs VMs)

No new VMs. Alertmanager runs colocated with Loki + Mimir + Tempo on the same 3 obs hosts:

| Role       | Hostname         | IP           | Already running                   | Adding now   |
| ---------- | ---------------- | ------------ | --------------------------------- | ------------ |
| obs node 1 | `auishqosrobs01` | 10.111.30.60 | Loki + Prometheus + Mimir + Tempo | Alertmanager |
| obs node 2 | `auishqosrobs02` | 10.111.30.61 | Loki + Prometheus + Mimir + Tempo | Alertmanager |
| obs node 3 | `auishqosrobs03` | 10.111.30.62 | Loki + Prometheus + Mimir + Tempo | Alertmanager |

```bash
# [each obs VM] sanity check
$ free -h | awk 'NR==2 {print "RAM free: "$4}'
$ df -h /var/lib | awk 'NR==2 {print "Disk free /var/lib: "$4}'
$ for u in loki mimir prometheus tempo; do systemctl is-active $u; done
# Expected: ≥2 GB RAM free; ≥40 GB disk free; all four active
```

Alertmanager is small (typically <200 MB RAM per node) — last service to fit on the obs VMs without resize.

You'll also need:

- **SMTP relay**: AU's existing relay at `smtp.au-internal:25` (or wherever; confirm with AU IT). Service-account credentials in Vault under `kv/platform/alertmanager/smtp_relay`.
- **Distribution lists** for severity tiers — at minimum `platform-oncall@africanunion.org` (CRITICAL) and `platform-team@africanunion.org` (WARNING).

### 12.3 Install Alertmanager on the obs VMs

Alertmanager ships as a Prometheus binary. We install from the upstream tarball, mirroring Prometheus' install in chapter 10 §10.3.

```bash
# [auishqosrobs01-03]

# (1) Download + verify
$ AM_VERSION=0.27.0
$ cd /tmp
$ curl -fsSLO https://github.com/prometheus/alertmanager/releases/download/v${AM_VERSION}/alertmanager-${AM_VERSION}.linux-amd64.tar.gz
$ curl -fsSLO https://github.com/prometheus/alertmanager/releases/download/v${AM_VERSION}/sha256sums.txt
$ grep alertmanager-${AM_VERSION}.linux-amd64.tar.gz sha256sums.txt | sha256sum -c
# Expected: alertmanager-...tar.gz: OK

# (2) Install binaries
$ tar xvf alertmanager-${AM_VERSION}.linux-amd64.tar.gz
$ sudo install -o root -g root -m 755 \
    alertmanager-${AM_VERSION}.linux-amd64/alertmanager \
    alertmanager-${AM_VERSION}.linux-amd64/amtool \
    /usr/local/bin/

# (3) Service user + dirs (reuse prometheus user from ch10 — same security posture)
$ sudo install -d -m 750 -o prometheus -g prometheus \
    /etc/alertmanager \
    /etc/alertmanager/templates \
    /var/lib/alertmanager

# (4) systemd unit
$ sudo tee /etc/systemd/system/alertmanager.service > /dev/null <<'EOF'
[Unit]
Description=Alertmanager
Documentation=https://prometheus.io/docs/alerting/latest/alertmanager/
After=network-online.target
Wants=network-online.target

[Service]
User=prometheus
Group=prometheus
ExecStart=/usr/local/bin/alertmanager \
  --config.file=/etc/alertmanager/alertmanager.yml \
  --storage.path=/var/lib/alertmanager \
  --web.listen-address=0.0.0.0:9093 \
  --web.external-url=https://alertmanager.africanunion.org \
  --cluster.listen-address=0.0.0.0:9094 \
  --cluster.peer=auishqosrobs01:9094 \
  --cluster.peer=auishqosrobs02:9094 \
  --cluster.peer=auishqosrobs03:9094 \
  --log.level=info
Restart=on-failure
RestartSec=5s
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

# (5) Verify (config file landed in §12.4)
$ alertmanager --version
$ amtool --version
```

> **ℹ Cluster gossip via `--cluster.peer`**
>
> Unlike Loki/Mimir/Tempo (memberlist via separate ports), Alertmanager uses its own HashiCorp memberlist on port 9094. Listing all 3 peers in `--cluster.peer` (including the local one) is the canonical bootstrap pattern.

### 12.4 Alertmanager cluster configuration

```bash
# [each obs VM]

$ sudo tee /etc/alertmanager/alertmanager.yml > /dev/null <<'EOF'
global:
  resolve_timeout: 5m
  smtp_smarthost: smtp.au-internal:25
  smtp_from: alerts@africanunion.org
  smtp_require_tls: true
  smtp_auth_username_file: /etc/alertmanager/secrets/smtp_user
  smtp_auth_password_file: /etc/alertmanager/secrets/smtp_password

templates:
  - /etc/alertmanager/templates/*.tmpl

route:
  receiver: platform-team-email
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h

  routes:
    # CRITICAL → on-call DL + paging webhook (Phase 5 → PagerDuty)
    - matchers:
        - severity = critical
      receiver: platform-oncall
      group_wait: 10s
      group_interval: 1m
      repeat_interval: 1h
      continue: false

    # WARNING → team email DL
    - matchers:
        - severity = warning
      receiver: platform-team-email
      continue: false

    # INFO / housekeeping → silenced default route (will go nowhere unless overridden)
    - matchers:
        - severity = info
      receiver: 'null'

receivers:
  - name: platform-oncall
    email_configs:
      - to: platform-oncall@africanunion.org
        send_resolved: true
        headers:
          Subject: '[CRIT] {{ .GroupLabels.alertname }} on {{ .GroupLabels.service }}'
    webhook_configs:
      - url: https://paging-webhook.au-internal/v1/alert        # Phase 5 → real paging service
        send_resolved: true
        http_config:
          authorization:
            type: Bearer
            credentials_file: /etc/alertmanager/secrets/paging_token

  - name: platform-team-email
    email_configs:
      - to: platform-team@africanunion.org
        send_resolved: true
        headers:
          Subject: '[WARN] {{ .GroupLabels.alertname }} on {{ .GroupLabels.service }}'

  - name: 'null'

inhibit_rules:
  # If a host is down, silence all per-service alerts on that host
  - source_matchers:
      - alertname = HostDown
    target_matchers:
      - severity = warning
    equal: ['host']

  # If Mimir is unhealthy, silence the metric-quality alerts that depend on it
  - source_matchers:
      - alertname = MimirIngesterDown
    target_matchers:
      - alertname =~ 'High.*Latency|Cardinality.*'
    equal: []
EOF

# (1) Bootstrap secret files (placeholders; real values from Vault below)
$ sudo install -d -m 700 -o prometheus -g prometheus /etc/alertmanager/secrets

$ vault kv get -field=username kv/platform/alertmanager/smtp_relay \
    | sudo -u prometheus tee /etc/alertmanager/secrets/smtp_user > /dev/null
$ vault kv get -field=password kv/platform/alertmanager/smtp_relay \
    | sudo -u prometheus tee /etc/alertmanager/secrets/smtp_password > /dev/null
$ vault kv get -field=token kv/platform/alertmanager/paging_webhook \
    | sudo -u prometheus tee /etc/alertmanager/secrets/paging_token > /dev/null
$ sudo chmod 600 /etc/alertmanager/secrets/*

# (2) Default templates (override per-receiver if needed)
$ sudo tee /etc/alertmanager/templates/email.tmpl > /dev/null <<'EOF'
{{ define "email.subject" }}
[{{ .Status | toUpper }}] {{ .GroupLabels.alertname }} ({{ .GroupLabels.service }})
{{ end }}

{{ define "email.body" }}
{{ range .Alerts }}
Alert: {{ .Annotations.summary }}
Severity: {{ .Labels.severity }}
Description: {{ .Annotations.description }}
Runbook: {{ .Annotations.runbook_url }}
Started: {{ .StartsAt }}
{{ if .EndsAt }}Resolved: {{ .EndsAt }}{{ end }}
Labels: {{ range .Labels.SortedPairs }}{{ .Name }}={{ .Value }} {{ end }}
{{ end }}
{{ end }}
EOF

# (3) Validate config
$ amtool check-config /etc/alertmanager/alertmanager.yml
# Expected: "Checking '/etc/alertmanager/alertmanager.yml'  SUCCESS"

# (4) Start
$ sudo systemctl daemon-reload
$ sudo systemctl enable --now alertmanager
$ sudo systemctl status alertmanager --no-pager | head -5
$ curl -s http://127.0.0.1:9093/-/ready
# Expected: HTTP 200 (empty body)
```

After all 3 nodes are running, verify the cluster formed:

```bash
$ curl -s http://127.0.0.1:9093/api/v2/status | jq '.cluster | {status, peers: [.peers[].name]}'
# Expected: status="ready", peers list contains all 3 obs hostnames
```

### 12.5 Notification routing + receivers

The routing tree (§12.4) flows as:

```
                          ┌─────────────────┐
                          │ root route      │
                          │ default → team  │
                          └────────┬────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
       severity=critical   severity=warning      severity=info
              │                    │                    │
              ▼                    ▼                    ▼
       platform-oncall      platform-team         null receiver
       (DL + paging)        (DL only)             (drop)
       group_wait=10s       group_wait=30s
       repeat=1h            repeat=4h
```

**Severity convention** (referenced by all rules in §12.6, §12.7):

| Severity   | Meaning                                                                | Routing                              | Repeat |
| ---------- | ---------------------------------------------------------------------- | ------------------------------------ | ------ |
| `critical` | Service is down / data loss imminent / SLO breach in progress          | On-call email + paging webhook       | 1 h    |
| `warning`  | Degraded performance / capacity trending wrong / will-be-critical-soon | Team email DL                        | 4 h    |
| `info`     | Configuration drift / informational thresholds / housekeeping          | Dropped (use Grafana for visibility) | n/a    |

Operators may override via labels:

- `notify=oncall` — force a warning into the critical path (rare; for newly-discovered failure modes)
- `notify=silent` — drop a critical (use only with a written silence rationale; auditable in Loki)

### 12.6 Mimir ruler — initial alert rules

Mimir's ruler evaluates PromQL rules against the metrics it stores (chapter 10) and pushes firing alerts to Alertmanager. Rules go in `/var/lib/mimir/rules/` and are loaded automatically.

**Ruler config in `/etc/mimir/mimir.yaml`** — add to chapter 10's config:

```yaml
ruler:
  rule_path: /var/lib/mimir/rules
  alertmanager_url: http://auishqosrobs01:9093,http://auishqosrobs02:9093,http://auishqosrobs03:9093
  enable_api: true
  ring:
    kvstore:
      store: memberlist
```

(Re-`systemctl restart mimir` on each node after the change.)

**Initial alert ruleset** — drop into `/var/lib/mimir/rules/anonymous/platform.yaml` (single tenant for Phase 2; tenant id `anonymous`):

```bash
# [auishqosrobs01]  (rules sync across the cluster via the shared store)
$ sudo install -d -m 750 -o mimir -g mimir /var/lib/mimir/rules/anonymous

$ sudo -u mimir tee /var/lib/mimir/rules/anonymous/platform.yaml > /dev/null <<'EOF'
groups:
  # ─────────────────────────────  Phase 1: Vault  ─────────────────────────────
  - name: vault
    interval: 60s
    rules:
      - alert: VaultDown
        expr: up{job="vault"} == 0
        for: 2m
        labels:
          severity: critical
          service: vault
        annotations:
          summary: 'Vault node {{ $labels.instance }} is down'
          description: '{{ $labels.instance }} has been unreachable to Prometheus for 2+ minutes.'
          runbook_url: 'https://docs.au-internal/runbooks/vault-down'

      - alert: VaultSealed
        expr: vault_core_unsealed == 0
        for: 30s
        labels:
          severity: critical
          service: vault
        annotations:
          summary: 'Vault node {{ $labels.instance }} is sealed'
          description: 'Sealed Vault refuses all reads/writes; unseal procedure needed.'
          runbook_url: 'https://docs.au-internal/runbooks/vault-unseal'

      - alert: VaultLeaderFlapping
        expr: changes(vault_core_active[10m]) > 4
        for: 5m
        labels:
          severity: warning
          service: vault
        annotations:
          summary: 'Vault leader has flapped {{ $value }} times in the last 10 minutes'
          description: 'Frequent leader changes indicate cluster instability — check network + disk on Vault VMs.'

  # ─────────────────────────────  Phase 1: Nomad + Consul  ──────────────────────
  - name: nomad-consul
    interval: 60s
    rules:
      - alert: NomadServerDown
        expr: up{job="nomad", role="nomad-server"} == 0
        for: 2m
        labels:
          severity: critical
          service: nomad
        annotations:
          summary: 'Nomad server {{ $labels.instance }} is down'
          runbook_url: 'https://docs.au-internal/runbooks/nomad-server-down'

      - alert: ConsulQuorumLost
        expr: consul_raft_peers < 2
        for: 1m
        labels:
          severity: critical
          service: consul
        annotations:
          summary: 'Consul quorum lost — only {{ $value }} peer(s) reachable'
          runbook_url: 'https://docs.au-internal/runbooks/consul-quorum'

      - alert: NomadJobFailed
        expr: nomad_nomad_job_summary_failed > 0
        for: 5m
        labels:
          severity: warning
          service: '{{ $labels.exported_job }}'
        annotations:
          summary: 'Nomad job {{ $labels.exported_job }} has failed allocations'

  # ─────────────────────────────  Phase 1: GitLab + Nexus  ──────────────────────
  - name: gitlab-nexus
    interval: 60s
    rules:
      - alert: GitLabUnreachable
        expr: up{job=~"gitlab-rails|gitlab-workhorse"} == 0
        for: 3m
        labels:
          severity: critical
          service: gitlab
        annotations:
          summary: 'GitLab {{ $labels.job }} is down'
          runbook_url: 'https://docs.au-internal/runbooks/gitlab-down'

      - alert: NexusUnreachable
        expr: up{job="nexus"} == 0
        for: 5m
        labels:
          severity: warning
          service: nexus
        annotations:
          summary: 'Nexus is unreachable — CI builds will start failing'

  # ─────────────────────────────  Phase 2: Keycloak  ────────────────────────────
  - name: keycloak
    interval: 60s
    rules:
      - alert: KeycloakDown
        expr: up{job="keycloak"} == 0
        for: 2m
        labels:
          severity: critical
          service: keycloak
        annotations:
          summary: 'Keycloak unreachable — SSO is broken across the platform'
          runbook_url: 'https://docs.au-internal/runbooks/keycloak-down'

      - alert: KeycloakLoginErrorRateHigh
        expr: |
          sum(rate(keycloak_failed_login_attempts_total[5m])) /
          sum(rate(keycloak_login_attempts_total[5m])) > 0.20
        for: 10m
        labels:
          severity: warning
          service: keycloak
        annotations:
          summary: '{{ $value | humanizePercentage }} of Keycloak logins are failing'
          description: 'High failure rate; check AD federation health (chapter 08) and rate-limit triggers'

  # ─────────────────────────────  Phase 2: Postgres (Keycloak DB)  ──────────────
  - name: postgres
    interval: 60s
    rules:
      - alert: PostgresDown
        expr: pg_up == 0
        for: 2m
        labels:
          severity: critical
          service: postgres
        annotations:
          summary: 'Postgres on {{ $labels.instance }} is down'

      - alert: PostgresReplicationLag
        expr: pg_replication_lag_seconds > 60
        for: 5m
        labels:
          severity: warning
          service: postgres
        annotations:
          summary: 'Postgres replica lag is {{ $value | humanizeDuration }}'

  # ─────────────────────────────  Phase 2: LGTM stack itself  ───────────────────
  - name: observability
    interval: 60s
    rules:
      - alert: LokiIngesterDown
        expr: up{job="loki"} == 0
        for: 2m
        labels:
          severity: critical
          service: loki
        annotations:
          summary: 'Loki ingester {{ $labels.instance }} is down'

      - alert: MimirIngesterDown
        expr: up{job="mimir"} == 0
        for: 2m
        labels:
          severity: critical
          service: mimir
        annotations:
          summary: 'Mimir ingester {{ $labels.instance }} is down'

      - alert: TempoIngesterDown
        expr: up{job="tempo"} == 0
        for: 2m
        labels:
          severity: warning
          service: tempo
        annotations:
          summary: 'Tempo ingester {{ $labels.instance }} is down'

      - alert: AlertmanagerClusterDegraded
        expr: alertmanager_cluster_members < 3
        for: 5m
        labels:
          severity: warning
          service: alertmanager
        annotations:
          summary: 'Alertmanager cluster has {{ $value }} members (expected 3)'

  # ─────────────────────────────  Hosts (node_exporter)  ────────────────────────
  - name: hosts
    interval: 60s
    rules:
      - alert: HostDown
        expr: up{job="node"} == 0
        for: 2m
        labels:
          severity: critical
          service: '{{ $labels.instance }}'
          host: '{{ $labels.instance }}'
        annotations:
          summary: 'Host {{ $labels.instance }} is unreachable'

      - alert: HostDiskFull
        expr: |
          (1 - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} /
               node_filesystem_size_bytes{fstype!~"tmpfs|overlay"}) > 0.85
        for: 10m
        labels:
          severity: warning
          host: '{{ $labels.instance }}'
        annotations:
          summary: 'Disk on {{ $labels.instance }}:{{ $labels.mountpoint }} is {{ $value | humanizePercentage }} full'

      - alert: HostDiskCritical
        expr: |
          (1 - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} /
               node_filesystem_size_bytes{fstype!~"tmpfs|overlay"}) > 0.95
        for: 2m
        labels:
          severity: critical
          host: '{{ $labels.instance }}'
        annotations:
          summary: 'Disk on {{ $labels.instance }}:{{ $labels.mountpoint }} is {{ $value | humanizePercentage }} full — service degradation imminent'

      - alert: HostMemoryPressure
        expr: |
          node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes < 0.10
        for: 10m
        labels:
          severity: warning
          host: '{{ $labels.instance }}'
        annotations:
          summary: '{{ $labels.instance }} has <10% memory available'

      - alert: HostNTPSkew
        expr: abs(node_timex_offset_seconds) > 0.5
        for: 10m
        labels:
          severity: warning
          host: '{{ $labels.instance }}'
        annotations:
          summary: '{{ $labels.instance }} clock is off by {{ $value }}s — Mimir/Loki will reject samples'
EOF

# Validate
$ amtool check-config /var/lib/mimir/rules/anonymous/platform.yaml || \
    promtool check rules /var/lib/mimir/rules/anonymous/platform.yaml
# Expected: SUCCESS

# Reload Mimir's ruler
$ for h in 01 02 03; do
    ssh -J au-bastion auishqosrobs${h}.au-internal \
      'curl -s -X POST http://127.0.0.1:9009/ruler/reload'
  done
```

### 12.7 Loki ruler — log-based alerts

Loki's ruler (chapter 09 already has the config block) evaluates LogQL rules against the log stream. Useful for pattern-based alerts that don't have a metric equivalent.

```bash
# [each obs VM]
$ sudo install -d -m 750 -o loki -g loki /var/lib/loki/rules/fake
# (Loki uses tenant id "fake" when auth_enabled=false — same effect as Mimir's "anonymous")

$ sudo -u loki tee /var/lib/loki/rules/fake/platform.yaml > /dev/null <<'EOF'
groups:
  - name: log-alerts
    interval: 1m
    rules:
      # SSH brute-force on bastion
      - alert: BastionSSHBruteForce
        expr: |
          sum by (host) (
            rate({role="bastion", unit="sshd.service"} |~ "Failed password" [5m])
          ) > 5
        for: 5m
        labels:
          severity: warning
          service: bastion
        annotations:
          summary: '{{ $labels.host }}: >5 failed SSH logins/sec for 5+ minutes'
          description: 'Possible brute-force; check fail2ban + auth.log on the bastion'

      # Vault audit anomaly — repeated permission denials
      - alert: VaultAuditPermissionDenials
        expr: |
          sum by (host) (
            rate({role="vault"} |= "permission denied" [10m])
          ) > 1
        for: 10m
        labels:
          severity: warning
          service: vault
        annotations:
          summary: 'Vault on {{ $labels.host }} returning >1 permission-denied/sec'
          description: 'Investigate the policy or token causing denials — see Vault audit log'

      # Nginx 5xx surge anywhere on the platform
      - alert: Nginx5xxSurge
        expr: |
          sum by (host) (
            rate({job="nginx"} |~ ` 5\d\d ` [5m])
          ) > 5
        for: 10m
        labels:
          severity: warning
          service: nginx
        annotations:
          summary: 'Nginx 5xx surge on {{ $labels.host }} ({{ $value }} req/sec)'

      # Keycloak admin account lockouts
      - alert: KeycloakAdminLockout
        expr: |
          sum(rate({role="keycloak"} |= "USER_DISABLED_BY_PERMANENT_LOCKOUT_ERROR" [15m])) > 0
        for: 1m
        labels:
          severity: critical
          service: keycloak
        annotations:
          summary: 'Keycloak admin user permanently locked out'
          description: 'Check Keycloak audit + AD federation; break-glass admin may be needed'
EOF

# Reload Loki's ruler
$ for h in 01 02 03; do
    ssh -J au-bastion auishqosrobs${h}.au-internal \
      'curl -s -X POST http://127.0.0.1:3100/loki/api/v1/rules'
  done
```

> **ℹ When to use Loki rules vs Mimir rules**
>
> Mimir rules are cheaper to evaluate (numeric time-series math) and cover anything that has a counter / gauge. Loki rules cover failure modes that show up only in log content — auth failures, exception text, audit anomalies. Rule of thumb: if there's a `node_*` or `*_total` metric for it, write a Mimir rule. Otherwise reach for Loki.

### 12.8 Silences + inhibitions

**Silences** are time-bounded mute commands operators issue from Grafana (Alerts → Silences) or via `amtool`. Use during planned maintenance.

```bash
# Example: silence all alerts on auishqosrgit01 for 2 hours during a GitLab upgrade
$ amtool --alertmanager.url=http://localhost:9093 silence add \
    instance=auishqosrgit01 \
    --duration=2h \
    --comment="GitLab 17.x upgrade — chapter 04 §4.X"
```

Silence audit trail goes through Loki (Alertmanager logs every silence add/expire) so unjustified silences are forensically visible.

**Inhibitions** are config-driven, automatic, and live in `/etc/alertmanager/alertmanager.yml` (§12.4). The two seeded rules:

1. **`HostDown` inhibits per-service warnings on that host**: when `auishqosrnmd01` is down, you get one `HostDown(critical)` alert, not 8 different "service X is unreachable on auishqosrnmd01" warnings.
2. **`MimirIngesterDown` inhibits metric-quality warnings**: if Mimir itself is broken, derived alerts (`HighLatency`, `Cardinality*`) are unreliable; suppress them until Mimir recovers.

Add new inhibitions only after observing recurring correlated noise in production — premature inhibition is how real signals get hidden.

### 12.9 On-call rotation + escalation (Q6 dependency)

Phase 2 ships **email-only paging** because Q6 (paging integration target) is open in PLAN.md. The `paging-webhook.au-internal` URL in §12.4 is a placeholder.

When Q6 resolves, the integration depends on the chosen product:

| Product                       | Integration shape                                                            | Where it lands                                          |
| ----------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| PagerDuty                     | Native receiver (`pagerduty_configs:`); routing + escalation in PD UI        | Replace `webhook_configs` in `platform-oncall` receiver |
| Opsgenie                      | Native receiver (`opsgenie_configs:`); routing + escalation in Opsgenie UI   | Same                                                    |
| AU's existing incident system | Webhook receiver with bearer token; escalation owned by the receiving system | Same — keep webhook, swap URL + token                   |

In all three cases:

- **Severity → urgency mapping** stays as defined in §12.5
- **Email DL stays as a backup** — never remove email from the critical receiver, even after paging works
- **Escalation chains** (5 min → primary, 15 min → secondary, 30 min → manager) live in the paging product, not in Alertmanager

Until Q6 closes, document on-call rotation on a wiki page and rely on the email DL — every member of the DL receives every critical alert. Acceptable for Phase 2 with low traffic; not acceptable beyond.

### 12.10 UFW + firewall rules

```bash
# [each obs VM — auishqosrobs01-03]

# Alertmanager web UI from the platform VLAN (operators access via Grafana)
$ sudo ufw allow from 10.111.30.0/24 to any port 9093 proto tcp comment 'Grafana → Alertmanager UI/API'
$ sudo ufw allow from 10.111.40.0/24 to any port 9093 proto tcp comment 'Ops VLAN → Alertmanager'

# Alertmanager → Mimir/Loki ruler push (loopback, no rule needed) +
# Mimir/Loki ruler → Alertmanager (peer-only, on same hosts)
# Already covered by the same-host loopback rules

# Cluster gossip between Alertmanager peers
$ sudo ufw allow from 10.111.30.60 to any port 9094 proto any comment 'AM gossip obs01'
$ sudo ufw allow from 10.111.30.61 to any port 9094 proto any comment 'AM gossip obs02'
$ sudo ufw allow from 10.111.30.62 to any port 9094 proto any comment 'AM gossip obs03'

# Outbound: Alertmanager → SMTP relay
# (UFW default is "allow outgoing"; if locked down, add: ufw allow out to smtp.au-internal port 25)

# Add Alertmanager to Prometheus' scrape config (chapter 10)
$ sudo tee /etc/prometheus/scrapes.d/alertmanager.yml > /dev/null <<'EOF'
scrape_configs:
  - job_name: alertmanager
    static_configs:
      - targets:
          - auishqosrobs01:9093
          - auishqosrobs02:9093
          - auishqosrobs03:9093
        labels:
          role: alertmanager
EOF
$ sudo -u prometheus promtool check config /etc/prometheus/prometheus.yml
$ curl -X POST http://127.0.0.1:9090/-/reload
```

### 12.11 Verification

```bash
# (1) All 3 Alertmanagers ready + cluster formed
$ for h in 01 02 03; do
    ssh -J au-bastion auishqosrobs${h}.au-internal \
      'curl -sI http://127.0.0.1:9093/-/ready | head -1'
  done
# Expected: HTTP/1.1 200 OK from each

$ ssh -J au-bastion auishqosrobs01.au-internal \
    'curl -s http://127.0.0.1:9093/api/v2/status | jq ".cluster.peers | length"'
# Expected: 3

# (2) Mimir ruler loaded the rules
$ ssh -J au-bastion auishqosrobs01.au-internal \
    'curl -s http://127.0.0.1:9009/ruler/rule_groups | jq ".[] | .name"'
# Expected: vault, nomad-consul, gitlab-nexus, keycloak, postgres, observability, hosts

# (3) Loki ruler loaded the rules
$ ssh -J au-bastion auishqosrobs01.au-internal \
    'curl -s http://127.0.0.1:3100/loki/api/v1/rules | yq -r ".[].name"'
# Expected: log-alerts

# (4) Synthetic alert end-to-end test — fire a manual alert via the API
$ curl -X POST http://localhost:9093/api/v2/alerts -H "Content-Type: application/json" -d '[
  {
    "labels": {
      "alertname": "VerifyAlerting",
      "severity": "warning",
      "service": "verify",
      "host": "verify-host"
    },
    "annotations": {
      "summary": "Chapter 12 verification synthetic alert",
      "description": "If you see this email, the routing chain works"
    },
    "startsAt": "'$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)'"
  }
]'
# Expected: HTTP 200; an email arrives at platform-team@africanunion.org within ~30s

# (5) Test the inhibition rule — fire HostDown then VaultDown for the same host
$ curl -X POST http://localhost:9093/api/v2/alerts ... # see Alertmanager API docs
# Expected: ONE HostDown alert email, no VaultDown email (inhibited)

# (6) Silence works
$ amtool --alertmanager.url=http://localhost:9093 silence add \
    alertname=VerifyAlerting --duration=10m --comment="ch12 verify"
# Then re-fire the synthetic alert from (4); no email this time

# (7) Cluster gossip — silence created on obs01 visible from obs02
$ ssh -J au-bastion auishqosrobs02.au-internal \
    'amtool --alertmanager.url=http://localhost:9093 silence query'
# Expected: the silence from (6) listed
```

**Common failures and remedies:**

| Symptom                                        | Cause                                                                      | Fix                                                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `curl /-/ready` returns "Cluster is not ready" | Cluster gossip can't reach all peers; UFW or DNS                           | Check 9094 reachability between obs nodes; `cluster.peer` flags include all 3                                          |
| Email never arrives                            | SMTP credentials wrong; relay not reachable; SMTP TLS mismatch             | `tail /var/log/alertmanager` for "smtp" lines; verify `smtp.au-internal:25` reachable; rotate creds in Vault           |
| Mimir ruler shows "0 rules loaded"             | Rules file path wrong or tenant id mismatch                                | Verify path matches `/var/lib/mimir/rules/anonymous/`; check `auth_enabled` in mimir.yaml is `false` (single-tenant)   |
| Alerts fire but Alertmanager shows nothing     | Mimir ruler can't reach Alertmanager                                       | `alertmanager_url` in mimir.yaml lists all 3; UFW 9093 open; `curl -X POST .../api/v2/alerts` from Mimir host works    |
| Email body is empty                            | Template file path wrong or template name doesn't match                    | `templates:` block points at `/etc/alertmanager/templates/*.tmpl`; receiver references `{{ template "email.body" . }}` |
| Rule reload returns 404                        | Mimir version mismatch — `/ruler/reload` was renamed in 2.10+              | Use `curl -X POST http://127.0.0.1:9009/api/v1/rules` or restart Mimir                                                 |
| Silence doesn't propagate to other AM nodes    | Cluster split-brain; gossip broken                                         | Check `cluster_members` metric; restart all 3; if persistent, check NTP                                                |
| Same alert sent 3 times (one per AM node)      | `alertmanager_url` in Mimir lists peers but high-availability flag missing | Mimir auto-dedupes when all 3 URLs listed; verify `ruler.alertmanager_url` is the comma-sep list, not just one         |

### 12.12 Phase 2 close-out

With chapter 12, **Phase 2 (identity + observability) is complete**. The platform now has:

| Capability              | Chapter | What you can do                                                                           |
| ----------------------- | ------- | ----------------------------------------------------------------------------------------- |
| SSO across the platform | 07, 08  | Log into GitLab/Grafana/Vault/Nomad with AU AD credentials; group-driven authorisation    |
| Centralised logs        | 09      | LogQL search across every platform VM; audit trail for Vault, Keycloak, nginx, journald   |
| Centralised metrics     | 10      | PromQL/Mimir queries with 90-day retention; HA-deduplicated; node-level + service-level   |
| Distributed tracing     | 11      | OTLP traces from every app; logs ↔ traces correlation via traceId; TraceQL search        |
| Alerting end-to-end     | 12      | 30+ rules covering Phase 1 + Phase 2 services; routing by severity; silences; inhibitions |

**Phase 2 close-out summary** — same shape as Phase 1's table in chapter 06:

| Component          | Phase 2 location                | Phase 5 upgrade chapter            |
| ------------------ | ------------------------------- | ---------------------------------- |
| Keycloak           | 2-node HA + dedicated Postgres  | 22 — Vault dynamic creds for KC    |
| AD federation      | LDAPS read-only                 | 22 — same                          |
| Loki               | 3-node, filesystem chunks       | 15 — MinIO chunk backend (Phase 3) |
| Prometheus + Mimir | 3-node Mimir, filesystem blocks | 15 — MinIO blocks (Phase 3)        |
| Tempo              | 3-node, filesystem blocks       | 15 — MinIO blocks (Phase 3)        |
| Alertmanager       | 3-node email + webhook          | Phase 5 — paging integration (Q6)  |
| Grafana            | Single VM with SSO              | Phase 3 — HA via shared Postgres   |

**Phase 3 starts with chapter 13** — Postgres HA. The Phase 2 stack assumed a manual-failover Postgres for Keycloak (chapter 07); Phase 3 replaces that with a streaming-replication HA cluster, then introduces Redis (ch14), MinIO (ch15), PgBouncer (ch16), HAProxy (ch17), and folds the greenbook Cloudflare learnings (ch14 of greenbook deployment) into the platform-tier edge config in chapter 18.

**Phase 2 closes on 2026-05-01.** App teams now have everything needed to instrument and operate a workload (auth, logs, metrics, traces, alerts). Per-app onboarding workflow lands in chapter 30.

---
