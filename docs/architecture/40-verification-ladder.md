# 40 — Verification ladder

> **Phase**: post-phase reference · **Run on**: bastion + each component VM via Teleport · **Time**: ~2 hours for the full ladder; per-layer ~10-15 min
>
> Comprehensive end-to-end test sheet for the platform. Mirrors greenbook deployment chapter 13 in shape — eleven layers from VM health upward, each layer assuming the previous succeeded. Run after any major change (new chapter applied, DR drill, patch night) or quarterly as standing hygiene.

---

## Contents

- [§40.1 Layer 1 — VM health (every host responds)](#401-layer-1-vm-health-every-host-responds)
- [§40.2 Layer 2 — Service liveness](#402-layer-2-service-liveness)
- [§40.3 Layer 3 — Vault unsealed + KV round-trip](#403-layer-3-vault-unsealed-kv-round-trip)
- [§40.4 Layer 4 — Nomad scheduling + Consul registration](#404-layer-4-nomad-scheduling-consul-registration)
- [§40.5 Layer 5 — GitLab + Nexus operational](#405-layer-5-gitlab-nexus-operational)
- [§40.6 Layer 6 — Keycloak SSO end-to-end](#406-layer-6-keycloak-sso-end-to-end)
- [§40.7 Layer 7 — LGTM stack (logs + metrics + traces + alerts)](#407-layer-7-lgtm-stack-logs-metrics-traces-alerts)
- [§40.8 Layer 8 — HA layer (per-component failover drill summary)](#408-layer-8-ha-layer-per-component-failover-drill-summary)
- [§40.9 Layer 9 — Backup verification (chapter 19 §19.6)](#409-layer-9-backup-verification-chapter-19-196)
- [§40.10 Layer 10 — DR site reachability + replication](#4010-layer-10-dr-site-reachability-replication)
- [§40.11 Layer 11 — Public edge (Cloudflare → DMZ → app)](#4011-layer-11-public-edge-cloudflare-dmz-app)
- [§40.12 Failure interpretation guide](#4012-failure-interpretation-guide)

## 40. Verification ladder

### 40.1 Layer 1 — VM health (every host responds)

```bash
# [bastion] — ping every host in inventory
$ for host in $(ansible-inventory -i /opt/ansible/inventory/au-platform.yml --list \
                  | jq -r '.. | objects | .ansible_host? // empty'); do
    if ping -c 1 -W 2 "$host" > /dev/null 2>&1; then
      echo "OK  $host"
    else
      echo "DOWN $host"
    fi
  done

# Expected: OK from every host; any DOWN halts the ladder until resolved
```

Cross-check with Prometheus' `up{job="node"}`:

```bash
$ ssh auishqosrobs01 "curl -sG http://127.0.0.1:9090/api/v1/query \
    --data-urlencode 'query=up{job=\"node\"} == 0' | jq '.data.result | length'"
# Expected: 0
```

### 40.2 Layer 2 — Service liveness

Each platform component exposes a health endpoint. Hit them all:

| Service       | Endpoint                                                      | Expected                               |
| ------------- | ------------------------------------------------------------- | -------------------------------------- |
| Vault         | `https://vault.au-internal:8200/v1/sys/health`                | 200 + `initialized:true, sealed:false` |
| Consul        | `https://auishqosrnmd01:8501/v1/status/leader`                | 200 + leader IP                        |
| Nomad         | `https://auishqosrnmd01:4646/v1/status/leader`                | 200 + leader IP                        |
| GitLab        | `https://git.africanunion.org/-/health`                       | 200 + "GitLab OK"                      |
| Nexus         | `https://nexus.au-internal/service/rest/v1/status`            | 200                                    |
| Keycloak      | `https://keycloak.africanunion.org/health/ready`              | 200 + `UP`                             |
| Postgres      | `pg_isready -h pg-rw.au-internal -p 5433`                     | "accepting connections"                |
| Redis         | `redis-cli -p 26379 -a <pass> sentinel master platform`       | 1 master listed                        |
| MinIO         | `https://minio.africanunion.org/minio/health/cluster`         | 200                                    |
| Loki          | `http://auishqosrobs01:3100/ready`                            | "ready"                                |
| Mimir         | `http://auishqosrobs01:9009/ready`                            | "ready"                                |
| Tempo         | `http://auishqosrobs01:3200/ready`                            | "ready"                                |
| Alertmanager  | `http://auishqosrobs01:9093/-/ready`                          | 200                                    |
| Grafana       | `https://grafana.africanunion.org/api/health`                 | 200 + version info                     |
| HAProxy       | `http://auishqosrlb01:8404/`                                  | 200 + stats page                       |
| PgBouncer     | `psql -p 6432 pgbouncer -U pgbouncer_admin -c "SHOW VERSION"` | version string                         |
| Teleport Auth | `tctl status`                                                 | cluster status OK                      |

Any non-OK halts the ladder.

### 40.3 Layer 3 — Vault unsealed + KV round-trip

```bash
$ vault status
# Expected: Sealed: false, Initialized: true, HA Enabled: true, HA Cluster: <leader-name>

$ vault kv put kv/test/ladder check=$(date -Iseconds)
$ vault kv get -field=check kv/test/ladder
# Expected: same timestamp returned

$ vault audit list
# Expected: file audit device enabled
$ tail -3 /var/log/vault/audit.log
# Expected: recent JSON audit lines including the test/ladder put + get

$ vault kv delete kv/test/ladder
```

Dynamic engine round-trip (chapter 22):

```bash
$ vault read database/creds/app-role-greenbook | head -5
# Expected: username, password, lease_id, lease_duration: 3600
$ vault lease revoke <lease_id>
```

### 40.4 Layer 4 — Nomad scheduling + Consul registration

```bash
# (1) Nomad servers see each other
$ nomad server members
# Expected: 3 servers, all alive

# (2) Nomad clients are healthy
$ nomad node status
# Expected: 3+ clients, all "ready"

# (3) Run a synthetic test job
$ nomad job init -short test-ladder
$ cat > test-ladder.nomad <<'EOF'
job "test-ladder" {
  type = "batch"
  group "g" {
    task "t" {
      driver = "docker"
      config { image = "alpine:latest"; args = ["echo", "ladder-ok"] }
      resources { cpu = 50; memory = 64 }
    }
  }
}
EOF
$ nomad job run test-ladder.nomad
$ nomad alloc logs $(nomad job allocs -json test-ladder | jq -r '.[0].ID') t
# Expected: "ladder-ok"
$ nomad job stop -purge test-ladder

# (4) Consul service catalog has every expected service
$ consul catalog services
# Expected: every Nomad-managed service + every Consul-registered platform service

# (5) DNS service-discovery works
$ dig @10.111.30.10 -p 8600 vault.service.consul SRV +short
# Expected: SRV records for every Vault node
```

### 40.5 Layer 5 — GitLab + Nexus operational

```bash
# (1) GitLab reachable + accepting commits
$ git clone https://git.africanunion.org/platform/test.git /tmp/gl-test
$ echo "ladder-$(date)" > /tmp/gl-test/file.txt
$ (cd /tmp/gl-test && git add . && git commit -m "ladder test" && git push)

# (2) GitLab CI runs (push triggers a pipeline)
$ # check via GitLab UI or API: pipeline succeeds within 60s

# (3) Nexus accepts a push + pull
$ docker pull nexus.au-internal/test/ladder:1
# Expected: image pulls (or 404 first-time; push then re-pull)

# (4) GitLab runners are alive
$ # GitLab UI: Admin → Runners — all online
```

### 40.6 Layer 6 — Keycloak SSO end-to-end

```bash
# (1) Realm + clients exist
$ curl -sk https://keycloak.africanunion.org/realms/au/.well-known/openid-configuration \
    | jq '.issuer'
# Expected: "https://keycloak.africanunion.org/realms/au"

# (2) An admin can log in (manual)
#   - Browse to https://keycloak.africanunion.org/admin
#   - Sign in with break-glass admin credentials (Vault: kv/platform/keycloak/admin)
#   - Verify realm "au" exists; users sync from AD; clients listed

# (3) AD federation healthy
$ # Keycloak admin UI → User Federation → ldap-au → "Test connection" + "Test authentication" both OK

# (4) End-to-end SSO into Grafana
#   - Browse https://grafana.africanunion.org
#   - Click "Sign in with AU SSO"
#   - Redirected to Keycloak; sign in with AD creds
#   - Land back in Grafana with a role mapped from group membership
```

### 40.7 Layer 7 — LGTM stack (logs + metrics + traces + alerts)

```bash
# (1) Logs flowing — query Loki for any platform service in the last 5 min
$ logcli query '{job="systemd-journal"}' --tail --limit 10
# Expected: lines from multiple hosts within seconds

# (2) Metrics flowing — count active scrape targets in Prometheus
$ ssh auishqosrobs01 "curl -sG http://127.0.0.1:9090/api/v1/query \
    --data-urlencode 'query=count(up == 1)'"
# Expected: matches expected target count (varies by Phase)

# (3) Traces flowing — emit a test span; query it back
$ otel-cli span --service "ladder-verify" --name "test" --endpoint tempo.service.consul:4317
# Capture TRACEID
$ ssh auishqosrobs01 "curl -s http://127.0.0.1:3200/api/traces/${TRACEID} | jq '.batches | length'"
# Expected: ≥1

# (4) Alerts loaded
$ ssh auishqosrobs01 "curl -s http://127.0.0.1:9009/ruler/rule_groups | jq '.[].name'"
# Expected: vault, nomad-consul, gitlab-nexus, keycloak, postgres, observability, hosts,
#           redis, minio, pgbouncer, haproxy, backups (Phase 4)

# (5) Synthetic alert end-to-end (from chapter 12 §12.11 step 4)
$ curl -X POST http://localhost:9093/api/v2/alerts -H "Content-Type: application/json" -d '[
  {"labels":{"alertname":"VerifyAlerting","severity":"warning","service":"ladder"},
   "annotations":{"summary":"Verification ladder synthetic alert"},
   "startsAt":"'$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)'"}]'
# Expected: email arrives at platform-team-email DL within 30s

# (6) Cross-service correlation works — emit a log line with a known traceId, search Loki
$ TRACEID=$(otel-cli span --service "ladder-verify" --name "correlation" --endpoint tempo.service.consul:4317)
$ logger -t test "ladder traceId=${TRACEID}"
$ logcli query "{job=\"systemd-journal\"} |~ \"${TRACEID}\""
# Expected: the log line we just emitted appears in Loki + clickable link to Tempo
```

### 40.8 Layer 8 — HA layer (per-component failover drill summary)

Quarterly per chapter 19 §19.7 — the full drills document timing. The ladder records that drills exist and were run within the last quarter:

```bash
# Postgres (chapter 13)
$ ls /var/log/postgres-failover-drill-*.log | head -1
# Expected: file from within the last 90 days

# Redis (chapter 14)
$ ls /var/log/redis-failover-drill-*.log | head -1

# Vault (chapter 03)
$ ls /var/log/vault-restore-drill-*.log | head -1

# DR (chapter 20)
$ ls /var/log/dr-drill-*.log | head -1
```

Any "no file in last 90 days" → schedule the drill before the next ladder run.

### 40.9 Layer 9 — Backup verification (chapter 19 §19.6)

```bash
$ ssh bastion "sudo systemctl status verify-backups --no-pager | head -3"
# Expected: last successful run within 7 days

$ ssh bastion "tail /var/log/ansible/verify-backups-$(date +%Y%m%d).log"
# Expected: postgres=ok vault=ok gitlab=ok redis=ok minio=ok

# Spot-check a backup file's age
$ ssh auishqosrpdb01 "sudo -u postgres pgbackrest --stanza=app info | head -10"
# Expected: most recent backup within RPO target
```

### 40.10 Layer 10 — DR site reachability + replication

```bash
# DR Postgres replication healthy
$ ssh dr-pdb01 "sudo -u postgres psql -c 'SELECT pg_is_in_recovery(), \
    extract(epoch from now() - pg_last_xact_replay_timestamp()) AS lag_sec;'"
# Expected: t, lag_sec < 60

# MinIO site replication healthy
$ mc admin replicate status au-platform | grep -i "queued\|status"
# Expected: status=Healthy; queued ≤ 1000

# DR-MinIO has the recent ship of each backup
$ mc ls au-dr/postgres-backups | head -5
$ mc ls au-dr/platform-misc/vault-snapshots | head -5

# Cloudflare LB monitor green for both pools
$ curl -sf -H "Authorization: Bearer $CF_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/load_balancers/pools" \
  | jq '.result[] | {name, healthy}'
# Expected: both pools healthy=true
```

### 40.11 Layer 11 — Public edge (Cloudflare → DMZ → app)

For each app published externally, walk the 7-layer ladder from greenbook deployment chapter 14:

| Layer | Test                                                                              |
| ----- | --------------------------------------------------------------------------------- |
| L1    | DNS resolves to Cloudflare anycast IP (`dig <app>.africanunion.org`)              |
| L2    | TLS handshake to Cloudflare succeeds with valid cert                              |
| L3    | Cloudflare → origin Full Strict TLS handshake succeeds                            |
| L4    | DMZ nginx → App VM forwarding works                                               |
| L5    | App responds with expected content (e.g., login page)                             |
| L6    | Cookie + session flow works end-to-end (login via SSO → reach authenticated page) |
| L7    | POST + write paths work (the corporate-WAF check from greenbook ch14 §14.10)      |

```bash
# Layer 1
$ dig +short <app>.africanunion.org
# Expected: Cloudflare anycast IP, NOT 196.188.248.25

# Layer 2
$ curl -sI https://<app>.africanunion.org/ | head -5
# Expected: HTTP/2 200

# Layer 7 (the critical one — corporate WAF check)
$ curl -X POST -H "Content-Type: application/json" -d '{}' https://<app>.africanunion.org/api/test
# From outside AU: HTTP 4xx (small response) — proves Cloudflare + origin both reachable
# From inside AU: same — if 20+ KB HTML body, corporate WAF is intercepting (greenbook ch14 §14.10)
```

### 40.12 Failure interpretation guide

When the ladder reports a failure, the expected first move depends on the layer:

| Layer | First move                                                             |
| ----- | ---------------------------------------------------------------------- |
| 1     | Hypervisor / network team — VM truly down                              |
| 2     | Per-service `journalctl -u <svc>` + relevant chapter's troubleshooting |
| 3     | Vault is the platform's keys-to-the-kingdom — unseal procedure (ch 03) |
| 4     | Nomad/Consul cluster diagnostics (ch 05)                               |
| 5     | GitLab logs / runner status / Nexus disk space                         |
| 6     | Keycloak federation health (ch 08); check AD bind credentials in Vault |
| 7     | LGTM stack — start at obs01 logs; verify cluster ring formed           |
| 8     | A drill is overdue — schedule it; investigate why scheduling slipped   |
| 9     | A backup verification failed — chapter 19 §19.6 has the per-tool fixes |
| 10    | DR replication broken — usually network link; coordinate with AU IT    |
| 11    | App-level — chapter 41 incident response per app's failure mode        |

Each failure should produce a Loki query saved as a Grafana panel + an entry in the runbook so the next encounter is faster.

---
