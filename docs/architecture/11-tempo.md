# 11 — Tempo

> **Phase**: 2 (identity + observability) · **Run on**: same 3× obs VMs as chapters 09-10 (`auishqosrobs01-03`); each app instrumented with OTLP exporters · **Time**: ~2 hours
>
> Distributed tracing. Apps emit OTLP spans on every request; Tempo ingests, stores, and indexes them; Grafana queries via TraceQL. The third (and final pure-storage) component of the LGTM stack — chapter 12 (Alertmanager) closes Phase 2.
>
> Phase 2 chapter 5 of 6.
>
> **Prev**: [10 — Prometheus + Mimir](10-prometheus.md) · **Next**: [12 — Alertmanager](12-alertmanager.md) · **Index**: [README](README.md)

---

## Contents

- [§11.1 Role + threat model](#111-role-threat-model)
- [§11.2 Pre-flight (reuses obs VMs from chapter 09)](#112-pre-flight-reuses-obs-vms-from-chapter-09)
- [§11.3 Install Tempo on the obs VMs](#113-install-tempo-on-the-obs-vms)
- [§11.4 Tempo cluster configuration](#114-tempo-cluster-configuration)
- [§11.5 OTLP collector path](#115-otlp-collector-path)
- [§11.6 Add Tempo as a Grafana data source](#116-add-tempo-as-a-grafana-data-source)
- [§11.7 Wire logs ↔ traces (Loki → Tempo, Tempo → Loki)](#117-wire-logs-traces-loki-tempo-tempo-loki)
- [§11.8 Span attribute conventions + retention](#118-span-attribute-conventions-retention)
- [§11.9 App instrumentation contract](#119-app-instrumentation-contract)
- [§11.10 UFW + firewall rules](#1110-ufw-firewall-rules)
- [§11.11 Verification](#1111-verification)
- [§11.12 Path to Phase 3 (MinIO storage backend)](#1112-path-to-phase-3-minio-storage-backend)

## 11. Tempo

### 11.1 Role + threat model

Tempo stores distributed traces — one entry per request showing every span (DB call, downstream HTTP, queue dispatch, etc.) that contributed to the response. Apps emit traces via OTLP (OpenTelemetry Protocol, gRPC or HTTP). Operators search by trace ID, service name, status code, latency, or arbitrary span attributes via TraceQL in Grafana.

Why traces matter on this platform: chapters 09 (logs) and 10 (metrics) tell you _that_ something is slow or broken. Traces tell you _where in the request path_ it happened. Combined with the correlation-ID convention established in chapter 09 §9.7, an operator can: see a Mimir alert (metric) → click the dashboard panel → land on the failing time window in Loki (log) → click a trace ID in the log → land in Tempo on the exact request → see the span with the high latency / non-200 status. That cross-product is the operational payoff of the full LGTM stack.

Three consequences:

1. **Compromise = lost forensic trail.** An attacker who deletes traces hides the request path that contained their actions. Defence: Tempo writes are restricted to the OTLP receiver port, fronted by mTLS in Phase 5; storage replication factor 3.
2. **Outage = no per-request visibility.** Apps continue serving (OTLP exporters buffer locally and drop after limit); operators lose drill-down ability. Mitigation: 3-node cluster tolerates 1-node loss; per-app OTLP buffer is small (128 MB default), so a full outage costs minutes of trace history but no request-handling latency.
3. **Cardinality is less of a worry than for Mimir.** Tempo's index is on a small fixed set of fields (service, span name, status, root operation); attribute-level cardinality is fine because attributes are stored, not indexed. Sampling is the real lever.

**Threat model — what we defend against:**

| Threat                                       | Mitigation                                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Tampered or deleted traces                   | OTLP receivers accept from App VLAN only (UFW); replication factor 3; Phase 5 mTLS on the OTLP path        |
| Sensitive data in span attributes (PII, PHI) | App-side allowlist on which attributes get exported; redaction in OTel SDK; review at code-review time     |
| Unauthorised trace read                      | Grafana behind Keycloak SSO (chapter 09); Tempo HTTP API not exposed externally                            |
| Storage runaway                              | Sampling (head-based 10% in Phase 2); compactor with 14-day retention; Phase 3 MinIO with object lifecycle |
| Loss of Tempo cluster                        | 3-replica writes; each block replicated to ≥2 nodes; Phase 3 MinIO chunk backend → durable storage         |
| Trace gap during Tempo outage                | OTLP exporters buffer up to 128 MB per app; replays automatically when Tempo recovers                      |

**Phase 2 deliberate non-goals:**

- **Object storage backend (MinIO / S3)** — Phase 3 [chapter 15](15-minio.md) introduces MinIO; until then, local filesystem on each obs VM. Replication factor 3 compensates.
- **Tail-based sampling** — Phase 2 ships head-based sampling (per-app, 10%); tail sampling (keep all errors / slow requests regardless of headline rate) needs an OTel Collector tier and lands in Phase 5.
- **Long-term span search** — TraceQL covers the 14-day window; older traces are retrievable by trace ID only.
- **Span-metric generation in Tempo** — disabled in Phase 2; Mimir handles metrics directly. Phase 5 might enable Tempo's `metrics_generator` for RED/USE metrics derived from spans.

### 11.2 Pre-flight (reuses obs VMs from chapter 09)

No new VMs. Confirm the obs VMs still have headroom after Loki + Mimir installs:

| Role       | Hostname         | IP           | Already running                      | Adding now       |
| ---------- | ---------------- | ------------ | ------------------------------------ | ---------------- |
| obs node 1 | `auishqosrobs01` | 10.111.30.60 | Loki + Prometheus + Mimir all-in-one | Tempo all-in-one |
| obs node 2 | `auishqosrobs02` | 10.111.30.61 | Loki + Prometheus + Mimir all-in-one | Tempo all-in-one |
| obs node 3 | `auishqosrobs03` | 10.111.30.62 | Loki + Prometheus + Mimir all-in-one | Tempo all-in-one |

```bash
# [each obs VM] re-check after Mimir landed
$ free -h | awk 'NR==2 {print "RAM free: "$4}'
$ df -h /var/lib | awk 'NR==2 {print "Disk free /var/lib: "$4}'
$ for u in loki mimir prometheus; do systemctl is-active $u; done
# Expected: ≥4 GB RAM free; ≥80 GB disk free; all three active
```

If headroom is tight, **stop here** and either upgrade the obs VMs (16→32 GB RAM, 200→400 GB disk) or split Tempo onto its own 3-VM cluster. The chapters were sized assuming colocation works at Phase 2 volumes (~30 apps × 10% sampling ≈ 3-5 K spans/sec); above that, split.

### 11.3 Install Tempo on the obs VMs

Tempo ships as a Grafana Labs binary. The Grafana apt repo (already configured in chapter 09 for Loki) carries it, so installation is a single apt step.

```bash
# [auishqosrobs01-03]

# (1) Tempo from the Grafana apt repo (configured in ch09)
$ sudo apt update
$ sudo apt install -y tempo
$ sudo apt-mark hold tempo

# (2) Verify
$ tempo -version
$ systemctl status tempo --no-pager | head -5
# (Will be "failed" until we drop the config file in §11.4 — expected)

# (3) Stop the service while we configure
$ sudo systemctl stop tempo

# (4) Service user + dirs (apt package creates `tempo` user; just confirm + extend dirs)
$ id tempo
$ sudo install -d -m 750 -o tempo -g tempo \
    /etc/tempo \
    /var/lib/tempo \
    /var/lib/tempo/wal \
    /var/lib/tempo/blocks \
    /var/lib/tempo/generator \
    /var/lib/tempo/overrides
```

### 11.4 Tempo cluster configuration

Tempo runs in **scalable single-binary mode** (Grafana's term) — same pattern as Mimir's monolithic mode and Loki's microservices mode: every process runs all components and coordinates via memberlist gossip. Phase 2 uses local filesystem; Phase 3 with MinIO is a one-config-block change.

```bash
# [each obs VM]

$ sudo tee /etc/tempo/tempo.yaml > /dev/null <<'EOF'
target: all

server:
  http_listen_port: 3200
  grpc_listen_port: 9096      # 9095 is taken by Loki/Mimir gRPC; bump by 1
  http_listen_address: 0.0.0.0
  log_level: info

multitenancy_enabled: false   # Phase 2 single-tenant; Phase 5 per-team auth

memberlist:
  join_members:
    - auishqosrobs01:7948
    - auishqosrobs02:7948
    - auishqosrobs03:7948
  bind_port: 7948             # 7946 = Loki, 7947 = Mimir, 7948 = Tempo

distributor:
  receivers:
    otlp:
      protocols:
        grpc:
          endpoint: 0.0.0.0:4317
        http:
          endpoint: 0.0.0.0:4318
    # Jaeger receivers kept for libraries that haven't migrated to OTLP yet.
    # Disable once all apps emit OTLP (target: end of Phase 2).
    jaeger:
      protocols:
        thrift_http:
          endpoint: 0.0.0.0:14268
    zipkin:
      endpoint: 0.0.0.0:9411
  ring:
    kvstore:
      store: memberlist

ingester:
  trace_idle_period: 10s
  max_block_duration: 5m
  max_block_bytes: 100_000_000
  lifecycler:
    address: 10.111.30.60     # REPLACE per node (obs02 → .61, obs03 → .62)
    ring:
      replication_factor: 3
      kvstore:
        store: memberlist

compactor:
  compaction:
    block_retention: 336h     # 14-day retention for Phase 2
    compacted_block_retention: 1h
  ring:
    kvstore:
      store: memberlist

storage:
  trace:
    backend: local
    local:
      path: /var/lib/tempo/blocks
    wal:
      path: /var/lib/tempo/wal
    pool:
      max_workers: 100
      queue_depth: 10000

querier:
  frontend_worker:
    frontend_address: 127.0.0.1:9096

query_frontend:
  search:
    duration_slo: 5s
    throughput_bytes_slo: 1.073741824e+09

# metrics_generator disabled for Phase 2 — Mimir handles metrics directly.
# Re-enable in Phase 5 if/when RED metrics from spans are wanted.
overrides:
  defaults:
    metrics_generator:
      processors: []
    ingestion:
      max_traces_per_user: 100000
      burst_size_bytes: 50_000_000
      rate_limit_bytes: 25_000_000
EOF

# Per-node IP fix
$ HOSTSHORT=$(hostname -s)
$ case "$HOSTSHORT" in
    auishqosrobs02) sudo sed -i 's/10.111.30.60/10.111.30.61/g' /etc/tempo/tempo.yaml ;;
    auishqosrobs03) sudo sed -i 's/10.111.30.60/10.111.30.62/g' /etc/tempo/tempo.yaml ;;
  esac
$ grep '^    address:' /etc/tempo/tempo.yaml   # confirm node-specific IP

# (1) Validate
$ sudo -u tempo tempo -config.file=/etc/tempo/tempo.yaml -config.expand-env=false -modules=true 2>&1 | head -20

# (2) Start
$ sudo systemctl daemon-reload
$ sudo systemctl enable --now tempo
$ sudo systemctl status tempo --no-pager | head -5
$ curl http://127.0.0.1:3200/ready
# Expected (after ~30 sec): "ready"
```

After all 3 nodes are up:

```bash
$ curl http://127.0.0.1:3200/status/services | head -20
# Expected: every service listed as "Running"

$ curl http://127.0.0.1:3200/distributor/ring | grep -c ACTIVE
# Expected: 3
```

> **ℹ Memberlist port choice (running tally)**
>
> The three LGTM stores share obs01-03 and each runs a memberlist ring. Distinct ports keep the gossip namespaces separate and make `ss -lntp` output unambiguous:
>
> | Service | Memberlist port | gRPC port | HTTP API port |
> | ------- | --------------- | --------- | ------------- |
> | Loki    | 7946            | 9095      | 3100          |
> | Mimir   | 7947            | 9095      | 9009          |
> | Tempo   | 7948            | 9096      | 3200          |
>
> Mimir and Loki share gRPC port 9095 because each binds to its own grpc-listen-address; Tempo bumps to 9096 to be unambiguous.

### 11.5 OTLP collector path

Apps push spans to Tempo's OTLP receiver. Two endpoints are exposed:

| Protocol  | Port  | Used by                                                         |
| --------- | ----- | --------------------------------------------------------------- |
| OTLP gRPC | 4317  | Most OTel SDKs (Node, Go, Python, Java) — preferred             |
| OTLP HTTP | 4318  | Browser SDKs, environments without gRPC, some legacy collectors |
| Jaeger    | 14268 | Pre-OTLP libraries; deprecated, target for migration in Phase 2 |
| Zipkin    | 9411  | Pre-OTLP libraries; same                                        |

**No external OTel Collector tier in Phase 2.** Apps push directly to Tempo's distributor on any of the 3 obs VMs (DNS round-robin via `tempo.au-internal` → 3 obs IPs). Phase 5 [chapter 23 — Runbook automation](23-runbook.md) introduces an OTel Collector tier (per-region, doing tail-based sampling, attribute scrubbing, and multi-backend fanout); Phase 2 stays direct because the additional component isn't justified at this app count.

> **DNS round-robin via Consul (chapter 05)**
>
> Register a `tempo` service in Consul with three target addresses (one per obs VM); Consul DNS resolves `tempo.service.consul` → randomised IP. Apps point their OTLP exporter at `tempo.service.consul:4317` and get free 1-of-3 failover.

### 11.6 Add Tempo as a Grafana data source

```bash
# [auishqosrgrf01]
$ sudo tee /etc/grafana/provisioning/datasources/tempo.yaml > /dev/null <<'EOF'
apiVersion: 1

datasources:
  - name: Tempo
    type: tempo
    uid: tempo                  # referenced by Loki's derivedFields in ch09 §9.7
    access: proxy
    url: http://auishqosrobs01:3200
    isDefault: false
    editable: false
    jsonData:
      httpMethod: GET
      tracesToLogsV2:
        datasourceUid: loki
        spanStartTimeShift: '-5m'
        spanEndTimeShift: '5m'
        tags:
          - { key: 'service.name', value: 'service' }
          - { key: 'host.name',    value: 'host' }
        filterByTraceID: true
        filterBySpanID: false
        customQuery: false
      tracesToMetrics:
        datasourceUid: mimir
        spanStartTimeShift: '-5m'
        spanEndTimeShift: '5m'
        tags:
          - { key: 'service.name', value: 'service' }
        queries:
          - name: 'Request rate'
            query: 'sum(rate(http_server_requests_seconds_count{$$__tags}[5m]))'
          - name: 'Error rate'
            query: 'sum(rate(http_server_requests_seconds_count{$$__tags,status=~"5.."}[5m]))'
      serviceMap:
        datasourceUid: mimir
      nodeGraph:
        enabled: true
      search:
        hide: false
      lokiSearch:
        datasourceUid: loki
EOF

$ sudo systemctl restart grafana-server
```

### 11.7 Wire logs ↔ traces (Loki → Tempo, Tempo → Loki)

Chapter 09 §9.7 already provisioned a Loki data source with a `derivedFields` block pointing at `datasourceUid: tempo`. With chapter 11's data source registered under that UID, Loki log lines now render trace IDs as clickable links straight into Tempo.

The reverse — Tempo → Loki — is wired in §11.6 via `tracesToLogsV2.datasourceUid: loki`. From a Tempo trace, click a span → "Logs for this span" → Grafana switches to Loki and runs a query like:

```
{service="<span.service.name>", host="<span.host.name>"} |= "<traceID>"
```

For this to work both directions, the **app instrumentation contract** in §11.9 below mandates:

1. Every app log line includes the active `traceId` (and `spanId`) as a structured field — pino, slog, structlog, etc. all support this via OTel Context propagation.
2. Span attributes include `service.name` and `host.name` (both standard OpenTelemetry resource attributes).

Without (1) the Loki search returns nothing; without (2) the Loki query has no labels to filter by.

### 11.8 Span attribute conventions + retention

| Attribute                   | Source                              | Examples                              | Notes                                         |
| --------------------------- | ----------------------------------- | ------------------------------------- | --------------------------------------------- |
| `service.name`              | OTel resource (`OTEL_SERVICE_NAME`) | `greenbook-web`, `greenbook-api`      | Indexed; required                             |
| `service.version`           | OTel resource                       | `1.4.2`, `2026.05.01-9f3ebc1`         | Indexed; required                             |
| `service.namespace`         | OTel resource                       | `tenant-mga`, `tenant-greenbook`      | Indexed; per-app multi-tenant strategy        |
| `deployment.environment`    | OTel resource                       | `prod`, `staging`                     | Indexed; required                             |
| `host.name`                 | OTel resource                       | `auishqosrnmc01`                      | Indexed; populated automatically              |
| `http.method`               | HTTP semantic conv                  | `GET`, `POST`                         | Indexed via `span.kind=server`                |
| `http.route`                | HTTP semantic conv                  | `/api/users/:id`                      | Use route, not path with raw IDs              |
| `http.status_code`          | HTTP semantic conv                  | `200`, `500`                          | Indexed                                       |
| `db.system`, `db.statement` | DB semantic conv                    | `postgresql`, `SELECT ... FROM users` | Sanitise statement to avoid PII in attributes |
| `correlation.id`            | App-emitted                         | `9f3ebc184a4a7e19`                    | Cross-link to logs (chapter 09 standard)      |

**What does NOT belong as a span attribute**, even though OTLP permits it:

- Full request bodies (use logs instead)
- Customer PII / health data — strip at instrumentation time
- Auth tokens, session IDs — never
- Stack traces as attributes — use span events with `exception.stacktrace`

**Retention tiers:**

| Tier        | Where                                  | Window  | Used for                         |
| ----------- | -------------------------------------- | ------- | -------------------------------- |
| Hot (Tempo) | filesystem on obs VMs (Phase 2)        | 14 days | TraceQL search, drill-down       |
| Cold        | MinIO with object-lifecycle (Phase 3+) | 90 days | Trace-ID lookup only (no search) |

14 days hot is enough for incident post-mortems but short for capacity planning — use Mimir aggregations (chapter 10) for trends, not Tempo.

### 11.9 App instrumentation contract

Apps that run on the platform MUST adopt these instrumentation defaults. Captured here so chapter 30 (App onboarding workflow) can reference them; greenbook will be the first adopter as part of its move from POC to Phase-2-managed app.

**Required:**

1. **OTel SDK installed** for the app's runtime (Node/Go/Python/Java/...).
2. **OTLP exporter configured** to push to `tempo.service.consul:4317` (gRPC).
3. **Resource attributes** set:
   - `service.name` (constant per app)
   - `service.version` (build-time injected)
   - `service.namespace` (per-tenant or per-team)
   - `deployment.environment` (`prod` / `staging` / `dev`)
4. **Auto-instrumentation enabled** for HTTP server / client, DB driver, queue producer/consumer, Redis, gRPC.
5. **Manual spans** for any business-significant unit of work that auto-instrumentation misses (e.g. a multi-step domain operation in greenbook).
6. **Log/trace correlation**: every log line emitted while a span is active includes the active `traceId` and `spanId` as structured fields. Most OTel SDKs do this automatically given the right log integration; verify in code review.
7. **Sampling**: head-based 10% sampling at the SDK (`OTEL_TRACES_SAMPLER=parentbased_traceidratio`, `OTEL_TRACES_SAMPLER_ARG=0.1`). Errors and slow requests can be force-sampled via the OTel API.

**Forbidden:**

1. Sending traces from a customer's browser directly to Tempo (no public OTLP receiver).
2. Putting PII / secrets / full request bodies in span attributes.
3. Using Jaeger or Zipkin protocols for new code (deprecated; use OTLP).
4. Disabling sampling globally ("100% sampling because traces are useful") — Tempo's storage is sized for ~10%.

**Greenbook reference (the first app adopter)**: greenbook is a TypeScript / Node.js / Express app. The Phase-2 instrumentation PR adds:

- `@opentelemetry/auto-instrumentations-node` package
- `OTEL_SERVICE_NAME=greenbook` and `OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo.service.consul:4317` in the app's Nomad job spec
- A pino transport that injects `traceId` / `spanId` per log line
- Manual spans inside `app/services/*.server.ts` for the workflow operations (`submitChange`, `approveChange`)

Other apps follow the same shape; chapter 30 has the per-language onboarding cookbook.

### 11.10 UFW + firewall rules

```bash
# [each obs VM — auishqosrobs01-03]

# OTLP gRPC + HTTP from App VLAN (where Nomad clients live)
$ sudo ufw allow from 10.111.10.0/24 to any port 4317 proto tcp comment 'OTLP gRPC ← App VLAN'
$ sudo ufw allow from 10.111.10.0/24 to any port 4318 proto tcp comment 'OTLP HTTP ← App VLAN'

# Legacy receivers — narrower allowlist, time-boxed (drop end of Phase 2)
$ sudo ufw allow from 10.111.10.0/24 to any port 14268 proto tcp comment 'Jaeger thrift_http ← App VLAN [DEPRECATED]'
$ sudo ufw allow from 10.111.10.0/24 to any port 9411 proto tcp comment 'Zipkin ← App VLAN [DEPRECATED]'

# Tempo HTTP query API (Grafana on grf01 only)
$ sudo ufw allow from 10.111.30.70 to any port 3200 proto tcp comment 'Grafana → Tempo query'

# Tempo gossip + gRPC (peer-only)
$ sudo ufw allow from 10.111.30.60 to any port 7948 proto any comment 'Tempo memberlist obs01'
$ sudo ufw allow from 10.111.30.61 to any port 7948 proto any comment 'Tempo memberlist obs02'
$ sudo ufw allow from 10.111.30.62 to any port 7948 proto any comment 'Tempo memberlist obs03'
$ sudo ufw allow from 10.111.30.60 to any port 9096 proto tcp comment 'Tempo gRPC obs01'
$ sudo ufw allow from 10.111.30.61 to any port 9096 proto tcp comment 'Tempo gRPC obs02'
$ sudo ufw allow from 10.111.30.62 to any port 9096 proto tcp comment 'Tempo gRPC obs03'

# Self-scrape from Prometheus (chapter 10) — already allowed via 10.111.30.0/24 → 9100,
# but add Tempo's own /metrics on 3200 if not already covered by the Loki/Mimir rules
$ sudo ufw allow from 10.111.30.0/24 to any port 3200 proto tcp comment 'Prometheus → Tempo /metrics'
```

Add Tempo to Prometheus' scrape config (chapter 10):

```bash
# [each obs VM]
$ sudo tee /etc/prometheus/scrapes.d/tempo.yml > /dev/null <<'EOF'
scrape_configs:
  - job_name: tempo
    static_configs:
      - targets:
          - auishqosrobs01:3200
          - auishqosrobs02:3200
          - auishqosrobs03:3200
        labels:
          role: tempo
EOF

$ sudo -u prometheus promtool check config /etc/prometheus/prometheus.yml
$ curl -X POST http://127.0.0.1:9090/-/reload
```

### 11.11 Verification

```bash
# (1) All 3 Tempo nodes ready + ring formed
$ for h in 01 02 03; do
    ssh -J au-bastion auishqosrobs${h}.au-internal \
      'curl -s http://127.0.0.1:3200/ready'
  done
# Expected: "ready" from each

$ ssh -J au-bastion auishqosrobs01.au-internal \
    'curl -s http://127.0.0.1:3200/distributor/ring' | grep -c ACTIVE
# Expected: 3 (active distributors)

# (2) OTLP receiver listening
$ ssh -J au-bastion auishqosrobs01.au-internal \
    'sudo ss -lntp | grep -E ":(4317|4318)"'
# Expected: 4317 + 4318 listening, owned by tempo

# (3) Send a synthetic trace and round-trip it
#     Easiest: install otel-cli on a client VM and emit one span.
$ otel-cli span --service "verify-tempo" --name "ch11-verify" \
    --endpoint tempo.service.consul:4317
# Returns a trace ID (TRACEID) on stdout

#     Then query it back:
$ ssh -J au-bastion auishqosrobs01.au-internal \
    "curl -s 'http://127.0.0.1:3200/api/traces/${TRACEID}'" | jq '.batches | length'
# Expected: ≥1 (the batch containing the span we just sent)

# (4) Grafana queries Tempo
#     Grafana UI → Explore → Tempo data source → Search → Service: verify-tempo
#     Expected: the synthetic trace from (3) appears

# (5) Logs ↔ traces wiring works
#     Emit a log line from any platform VM that includes a known traceId:
#       echo '{"level":"info","traceId":"abc123","msg":"ch11 verify"}' | logger -t test
#     In Grafana → Explore → Loki, query: {host="<that-host>"} |= "abc123"
#     Hover over the traceId → "Tempo" link appears → click → Tempo Explore opens

# (6) Span-driven UFW reachability check
$ ssh au-bastion 'curl -fsS -X POST -H "Content-Type: application/json" \
    --data "{}" http://tempo.service.consul:4318/v1/traces'
# Expected: HTTP 415 Unsupported Media Type (or 400) — endpoint is reachable but rejects
# the empty payload. Confirms the OTLP HTTP receiver is reachable from App VLAN.
```

**Common failures and remedies:**

| Symptom                                                        | Cause                                                           | Fix                                                                                           |
| -------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `curl /ready` returns "Ingester not ready: waiting for tokens" | Tempo is still joining the ring                                 | Wait ~30s; if it persists, check memberlist port 7948 reachable between all 3 nodes           |
| App OTLP exporter logs `connection refused`                    | UFW blocking 4317 or DNS resolving to a single IP that's down   | Check UFW; check `dig tempo.service.consul` returns 3 A records                               |
| Grafana Tempo: "no traces found" but app emits traces          | Sampling too aggressive; or `service.name` mismatched in search | Set `OTEL_TRACES_SAMPLER_ARG=1.0` temporarily in the app and resend; widen TraceQL search     |
| Tempo OOM under load                                           | Not enough RAM (chapter 09 obs VMs were sized for Loki only)    | Resize obs VMs, or split Tempo onto its own 3-VM cluster (revisit §11.2 sizing)               |
| Compactor logs `level=error` repeatedly                        | Disk pressure on `/var/lib/tempo/blocks`                        | Verify `block_retention` set (default is 0 = forever); free disk; restart                     |
| `tracesToLogsV2` link in Grafana 404s                          | `datasourceUid: loki` in §11.6 doesn't match Loki's actual UID  | In Grafana UI: data sources → Loki → Settings → check UID; align in `tempo.yaml` provisioning |
| Logs don't have `traceId` for a given app                      | App not using OTel-aware logger or context propagation broken   | Verify SDK auto-instrumentation enabled; manually run a known endpoint and inspect log lines  |

### 11.12 Path to Phase 3 (MinIO storage backend)

Phase 3 [chapter 15 — MinIO](15-minio.md) replaces local filesystem block storage with S3-compatible MinIO. Tempo config change:

```yaml
# Phase 3 storage replacement
storage:
  trace:
    backend: s3
    s3:
      endpoint: minio.africanunion.org
      bucket: tempo-traces
      access_key: ${MINIO_ACCESS_KEY} # injected from Vault via Nomad workload identity
      secret_key: ${MINIO_SECRET_KEY}
      insecure: false
      tls_insecure_skip_verify: false
      forcepathstyle: true
    wal:
      path: /var/lib/tempo/wal # WAL stays local on each node
```

Migration: stop Tempo on each node in turn (rolling, 1-of-3 down at a time); copy existing local blocks to MinIO with `mc mirror`; swap config; restart. Phase 2 → Phase 3 expected downtime: per-node rolling restart, no global outage.

The OTLP receivers, Grafana data source, log/trace correlation, span attribute contract, and app instrumentation all stay identical. Only the storage backend changes — the same property that made the Phase 2 → Phase 3 path easy for Loki (chapter 09) and Mimir (chapter 10).

---
