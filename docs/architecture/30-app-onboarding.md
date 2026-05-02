# 30 — App onboarding workflow

> **Phase**: post-phase reference · **Run on**: per-app, by the app team with platform-team review at the gate steps · **Time**: ~1-2 days for a well-prepared team
>
> The user-facing surface of the platform. Consolidates every "chapter 30 contract" reference scattered through chapters 1-23 into a single workflow. App teams arrive here with "we want to deploy app X to the platform"; they leave with a running, monitored, backed-up, externally-accessible app that meets every platform contract.

---

## Contents

- [§30.1 Intent + scope](#301-intent-scope)
- [§30.2 The platform contract — what apps get; what apps must provide](#302-the-platform-contract-what-apps-get-what-apps-must-provide)
- [§30.3 Onboarding workflow (the gates)](#303-onboarding-workflow-the-gates)
- [§30.4 App instrumentation requirements (consolidated)](#304-app-instrumentation-requirements-consolidated)
- [§30.5 Per-app credentials in Vault](#305-per-app-credentials-in-vault)
- [§30.6 Per-app Postgres role + DB](#306-per-app-postgres-role-db)
- [§30.7 Redis access pattern](#307-redis-access-pattern)
- [§30.8 Object storage (MinIO) allocation](#308-object-storage-minio-allocation)
- [§30.9 Nomad job spec template](#309-nomad-job-spec-template)
- [§30.10 Public DNS + Cloudflare](#3010-public-dns-cloudflare)
- [§30.11 Pre-go-live checklist](#3011-pre-go-live-checklist)
- [§30.12 Decommissioning](#3012-decommissioning)

## 30. App onboarding workflow

### 30.1 Intent + scope

This chapter is for app teams. Other chapters explain how the platform is built; this one explains how to deploy your app on it.

If you're an app team lead reading this, you should leave with:

- A clear list of what your app must do to be platform-compliant
- The exact sequence of steps to onboard
- Templates for every config file you'll need
- A go-live checklist that aligns with the platform's verification ladder (chapter 40)

What this chapter does NOT cover:

- How to write your app — the platform is opinionated about _operability_, not about your business logic
- How to choose your tech stack — any container that runs on Nomad's `docker` driver works (greenbook is React Router 7 + Node; future apps can be anything)
- How to ship features after go-live — that's standard CI/CD via chapter 04 GitLab

### 30.2 The platform contract — what apps get; what apps must provide

**What the platform provides** (every onboarded app gets these for free):

| Capability              | Source              | What you do                                                 |
| ----------------------- | ------------------- | ----------------------------------------------------------- |
| Container scheduling    | Nomad (chapter 05)  | Submit a Nomad job spec                                     |
| Service discovery       | Consul (chapter 05) | Declare a `service` block in the job spec                   |
| SSO                     | Keycloak (ch 07-08) | Add an OIDC client; map AD groups → app roles               |
| Postgres database       | Chapters 13 + 16    | Request a DB; receive a per-app role + DSN                  |
| Redis cache             | Chapter 14          | Use Sentinel client + your `<app>:*` prefix                 |
| Object storage          | Chapter 15          | Request a bucket; receive a service account                 |
| Internal load balancing | Chapter 17          | None — Consul SD picks you up automatically                 |
| Public DNS + WAF        | Chapter 18          | Request a subdomain; provide your `/healthz` endpoint       |
| Logs                    | Chapter 09          | Emit JSON to stdout; Promtail picks it up                   |
| Metrics                 | Chapter 10          | Expose `/metrics` (Prometheus format)                       |
| Traces                  | Chapter 11          | Push OTLP to `tempo.service.consul:4317`                    |
| Alerts                  | Chapter 12          | Define your alert rules; merge into the platform repo       |
| Backups                 | Chapter 19          | DB + object backups are automatic per the platform schedule |
| DR                      | Chapter 20          | Apps inherit DR coverage of the platform                    |
| Operator access         | Chapter 21          | Your team gets Teleport roles per the request flow          |
| Dynamic credentials     | Chapter 22          | Vault Agent sidecar pattern; replaces static secrets        |
| Automation              | Chapter 23          | Your Nomad job spec lands in the Ansible inventory          |

**What apps must provide:**

1. **A health-check endpoint** at `/healthz` that returns `200` when ready to serve, `503` otherwise. Used by Nomad's task health check, Consul's service health, HAProxy's backend probe, and Cloudflare's origin probe — one endpoint, four consumers.
2. **A `/metrics` endpoint** in Prometheus format. At minimum: `<app>_requests_total`, `<app>_request_duration_seconds`, `<app>_errors_total`. App-specific business metrics welcome.
3. **Structured JSON logs to stdout**. Each line: `level`, `time`, `msg`, `traceId` (when active), `correlationId`, plus app-specific fields. No PII / secrets in logs.
4. **OTel tracing instrumentation** per chapter 11 §11.9. Auto-instrumentation for HTTP/DB/Redis/queue clients; manual spans for business-significant operations.
5. **A Nomad job spec** following §30.9 template. CPU + memory + disk reserved; `service` block with `/healthz` health check; Vault Agent sidecar.
6. **A code repository in GitLab** with CI that builds + tests + pushes images to Nexus + creates Nomad job-spec PRs.
7. **A README** at the repo root explaining: what the app does, how to run it locally, how to deploy, who's on the team, how to escalate.

The list looks long; in practice it's a one-time setup per app and most items are template-able.

### 30.3 Onboarding workflow (the gates)

| Gate | Owner         | Output                                                                  |
| ---- | ------------- | ----------------------------------------------------------------------- |
| 0    | App team lead | Brief platform team: app purpose, expected QPS, data sensitivity, team  |
| 1    | Platform team | Provision platform-side resources (Vault paths, DB role, MinIO bucket)  |
| 2    | App team      | Code repo in GitLab; CI builds image to Nexus                           |
| 3    | App team      | Nomad job spec; deploy to staging environment                           |
| 4    | App team      | Verification ladder (chapter 40) passes against staging                 |
| 5    | Platform team | Public DNS + Cloudflare records; AU IT corporate-WAF bypass coordinated |
| 6    | App team      | Production deploy + verification ladder passes against prod             |
| 7    | Joint         | Go-live; post-launch monitoring for first 7 days; lessons fed back      |

Each gate is a code-review-style approval — no commit moves to the next gate without sign-off.

### 30.4 App instrumentation requirements (consolidated)

From chapter 11 §11.9, with platform-wide consolidation:

**Required:**

1. **OTel SDK installed** for the app's runtime — Node, Go, Python, Java, Rust all have first-party SDKs.
2. **OTLP exporter** configured to push to `tempo.service.consul:4317` (gRPC).
3. **Resource attributes** set:
   - `service.name = "<app>"` (constant; matches Consul service name)
   - `service.version = "<git-sha>"` (build-time injected)
   - `service.namespace = "<tenant>"` (per-tenant if multi-tenant)
   - `deployment.environment = "prod" | "staging"`
4. **Auto-instrumentation enabled** for HTTP server/client, DB, Redis, queue, gRPC.
5. **Manual spans** around business-significant work that auto-instrumentation misses.
6. **Log/trace correlation**: every log line emitted while a span is active includes `traceId` + `spanId` as structured fields (most OTel SDKs do this automatically with the right log integration).
7. **Head-based 10% sampling** at the SDK: `OTEL_TRACES_SAMPLER=parentbased_traceidratio`, `OTEL_TRACES_SAMPLER_ARG=0.1`. Errors + slow requests force-sampled via OTel API.

**Forbidden:**

1. Sending traces from a customer's browser directly to Tempo (no public OTLP receiver).
2. Putting PII / secrets / full request bodies in span attributes.
3. Using Jaeger or Zipkin protocols for new code (deprecated; use OTLP).
4. Disabling sampling globally ("100% sampling because traces are useful") — Tempo's storage is sized for ~10%.

### 30.5 Per-app credentials in Vault

Every app gets its own Vault namespace under `kv/apps/<app>/`. Convention:

| Path                            | Holds                                                       | Source           |
| ------------------------------- | ----------------------------------------------------------- | ---------------- |
| `kv/apps/<app>/database`        | DSN config (host, port, db, sslmode); password is dynamic   | Vault DB engine  |
| `kv/apps/<app>/redis`           | Sentinels list, master_name, password                       | Static-rotated   |
| `kv/apps/<app>/minio`           | Per-bucket service account (access_key, secret_key, bucket) | MinIO IAM        |
| `kv/apps/<app>/oidc`            | Keycloak OIDC client_id + client_secret                     | Keycloak         |
| `kv/apps/<app>/api-keys`        | Outbound API tokens (e.g., third-party service)             | App team-managed |
| `kv/apps/<app>/encryption-keys` | Transit engine key name(s) the app uses                     | Vault Transit    |

App reads via Vault Agent sidecar (chapter 22 §22.8). Apps **never** check secrets into git, **never** log them, **never** pass them as command-line args.

### 30.6 Per-app Postgres role + DB

Platform-team task at gate 1:

```bash
# 1. Create the per-app login role + DB on the primary
$ ssh auishqosrpdb01 "sudo -u postgres psql <<'SQL'
CREATE ROLE app_<app> LOGIN PASSWORD 'BOOTSTRAP';
ALTER ROLE app_<app> SET statement_timeout = '30s';
ALTER ROLE app_<app> SET idle_in_transaction_session_timeout = '2min';
CREATE DATABASE <app> OWNER app_<app> ENCODING 'UTF8' TEMPLATE template0;
\\c <app>
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO app_<app>;
SQL"

# 2. Optional read-only role for analytics
$ ssh auishqosrpdb01 "sudo -u postgres psql -c \"
  CREATE ROLE app_<app>_ro LOGIN PASSWORD 'BOOTSTRAP_RO';
  GRANT CONNECT ON DATABASE <app> TO app_<app>_ro;
  GRANT USAGE ON SCHEMA public TO app_<app>_ro;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_<app>_ro;\""

# 3. Add a Vault DB engine role for dynamic credentials (chapter 22)
$ vault write database/roles/app-role-<app> \
    db_name=postgres-app \
    creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}' INHERIT; \
                          GRANT app_<app> TO \"{{name}}\";" \
    revocation_statements="DROP ROLE IF EXISTS \"{{name}}\";" \
    default_ttl="1h" max_ttl="24h"

# 4. Vault policy + JWT workload role
$ vault policy write <app>-db -<<EOF
path "database/creds/app-role-<app>" { capabilities = ["read"] }
path "database/creds/app-role-<app>-ro" { capabilities = ["read"] }
EOF

$ vault write auth/nomad-workload/role/<app> \
    bound_audiences="vault.io" \
    user_claim="/nomad_job_id" \
    bound_claims='{"nomad_job_id":"<app>"}' \
    token_policies="default,<app>-db,<app>-pki,<app>-transit" \
    token_ttl=1h
```

App connects through PgBouncer at `pgbouncer.au-internal:6432` (or via HAProxy at `pg-rw.au-internal:5433` if read-write split is needed). Connection comes from the Vault Agent template; app code never sees the password directly.

### 30.7 Redis access pattern

Per chapter 14 §14.7 — apps use a **Sentinel-aware client**:

```typescript
// Node.js / ioredis
import Redis from "ioredis";

const redis = new Redis({
  sentinels: [
    { host: "auishqosrred01", port: 26379 },
    { host: "auishqosrred02", port: 26379 },
    { host: "auishqosrred03", port: 26379 },
  ],
  name: "platform",
  password: process.env.REDIS_PASSWORD, // from Vault Agent
  keyPrefix: "<app>:", // mandatory key namespacing
});
```

**Per-app key prefix is mandatory** — every key starts with `<app>:`. Until Phase 5 ACLs, this is the only isolation between apps sharing the cluster.

**Forbidden patterns**: `KEYS *` (use `SCAN`); session tokens kept beyond 24h (use TTL); business-canonical state in Redis (Postgres is the source of truth; Redis is a cache).

### 30.8 Object storage (MinIO) allocation

Apps that need blob storage (uploaded files, generated reports, large exports) request a dedicated bucket:

```bash
# Platform-team task at gate 1
$ mc mb --with-versioning au-platform/<app>-data
$ mc encrypt set sse-s3 au-platform/<app>-data
$ mc ilm rule add au-platform/<app>-data --expire-days 365  # adjust per app

# Per-app service account
$ cat > /tmp/policy-<app>.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": ["arn:aws:s3:::<app>-data"] },
    { "Effect": "Allow",
      "Action": ["s3:GetObject","s3:PutObject","s3:DeleteObject","s3:AbortMultipartUpload"],
      "Resource": ["arn:aws:s3:::<app>-data/*"] }
  ]
}
EOF
$ mc admin policy create au-platform <app>-policy /tmp/policy-<app>.json
$ mc admin user svcacct add au-platform root --name <app>-svc --policy-file /tmp/policy-<app>.json
# Capture access + secret keys

$ vault kv put kv/apps/<app>/minio \
    access_key='<from above>' secret_key='<from above>' \
    bucket='<app>-data' endpoint='https://minio.africanunion.org' \
    rotated_at="$(date -Iseconds)" rotation_period_days=180
```

Apps use the AWS S3 SDK with the credentials from Vault. Object keys: `<app>/<class>/<id>/<filename>` (so `<app>` prefix is your namespace inside the bucket).

### 30.9 Nomad job spec template

```hcl
job "<app>" {
  region      = "au-platform"
  datacenters = ["au-dc1"]
  type        = "service"

  group "app" {
    count = 3

    network {
      mode = "bridge"
      port "http" { to = 3000 }
      port "metrics" { to = 9100 }
    }

    service {
      name = "<app>"
      port = "http"
      tags = ["app", "env:prod"]

      check {
        type     = "http"
        path     = "/healthz"
        interval = "10s"
        timeout  = "2s"
      }
    }

    service {
      name = "<app>-metrics"
      port = "metrics"
      tags = ["metrics"]

      check {
        type     = "http"
        path     = "/metrics"
        interval = "30s"
        timeout  = "5s"
      }
    }

    vault {
      role = "<app>"
    }

    task "vault-agent" {
      driver = "docker"
      config {
        image = "hashicorp/vault:1.15"
        args  = ["agent", "-config=/local/agent.hcl"]
      }
      template {
        destination = "local/agent.hcl"
        data        = file("vault-agent.hcl.tpl")
      }
      template {
        destination = "secrets/db.env"
        data        = <<EOF
{{ with secret "database/creds/app-role-<app>" }}
DATABASE_URL=postgresql://{{ .Data.username }}:{{ .Data.password }}@pgbouncer.au-internal:6432/<app>?sslmode=require
{{ end }}
EOF
        change_mode = "noop"
      }
      template {
        destination = "secrets/redis.env"
        data        = <<EOF
{{ with secret "kv/data/apps/<app>/redis" }}
REDIS_PASSWORD={{ .Data.data.password }}
REDIS_SENTINELS={{ .Data.data.sentinels }}
{{ end }}
EOF
        change_mode = "noop"
      }
    }

    task "app" {
      driver = "docker"

      config {
        image = "registry.au-internal/<app>:${NOMAD_META_version}"
        ports = ["http", "metrics"]
      }

      env {
        OTEL_SERVICE_NAME            = "<app>"
        OTEL_SERVICE_VERSION         = "${NOMAD_META_version}"
        OTEL_DEPLOYMENT_ENVIRONMENT  = "prod"
        OTEL_EXPORTER_OTLP_ENDPOINT  = "http://tempo.service.consul:4317"
        OTEL_TRACES_SAMPLER          = "parentbased_traceidratio"
        OTEL_TRACES_SAMPLER_ARG      = "0.1"
      }

      template {
        destination = "secrets/db.env"
        env         = true
        data        = "{{ file `secrets/db.env` }}"
        change_mode = "restart"
      }
      template {
        destination = "secrets/redis.env"
        env         = true
        data        = "{{ file `secrets/redis.env` }}"
        change_mode = "restart"
      }

      resources {
        cpu    = 500
        memory = 512
      }
    }

    update {
      max_parallel     = 1
      health_check     = "checks"
      min_healthy_time = "10s"
      healthy_deadline = "5m"
      auto_revert      = true
    }
  }
}
```

Tune `count`, `cpu`, `memory` per app. The shape is fixed.

### 30.10 Public DNS + Cloudflare

Per chapter 18 §18.9:

1. **Subdomain**: `<app>.africanunion.org`
2. **DNS A record at Cloudflare**: A → `196.188.248.25` (AU perimeter), `proxied: true`
3. **DMZ nginx**: new `server { server_name <app>.africanunion.org; ... }` block; rate-limits per app
4. **App VM nginx OR Consul SD via HAProxy** (chapter 17): `<app>.platform.local` resolves to the running Nomad allocs
5. **Cloudflare WAF Custom Rules** if app needs special handling (webhook IP allowlists, geo restrictions)
6. **Verification ladder** (chapter 14 of greenbook deployment) walked end-to-end before go-live
7. **Open AU IT ticket** for corporate-WAF bypass-list verification (`*.africanunion.org` should already be allowlisted; verify per-subdomain)

### 30.11 Pre-go-live checklist

A new app is go-live-ready when **every** item below is true:

**Code + CI**

- [ ] Repo in GitLab with CODEOWNERS + 2-approver branch protection
- [ ] CI builds image, runs tests, pushes to Nexus on merge to main
- [ ] Vulnerability scan in CI (e.g., `trivy image`)
- [ ] README documents purpose, runbook, escalation

**Platform integration**

- [ ] Vault paths created and contain real values
- [ ] Postgres role + DB created; dynamic Vault DB engine role configured
- [ ] Redis `<app>:*` prefix used; Sentinel-aware client
- [ ] MinIO bucket created with versioning + lifecycle + encryption (if needed)
- [ ] Keycloak OIDC client created; AD groups mapped to app roles
- [ ] Nomad job spec follows §30.9 template; deployed to staging
- [ ] Consul service registration verified; SRV record resolves

**Observability**

- [ ] `/healthz` returns 200 when ready
- [ ] `/metrics` exposes Prometheus format
- [ ] Structured JSON logs to stdout with `traceId` + `correlationId`
- [ ] OTLP traces visible in Grafana Tempo
- [ ] App-specific dashboard published to Grafana
- [ ] App-specific alerts in `platform.yaml` ruleset

**External access**

- [ ] DNS A record `<app>.africanunion.org` proxied through Cloudflare
- [ ] Cloudflare WAF rules + rate limits configured
- [ ] DMZ nginx server block with TLS + IP allowlist
- [ ] AU IT corporate-WAF bypass verified (the `*.data` lesson)
- [ ] Greenbook ch14 verification ladder all 7 layers pass against prod

**Backup + DR**

- [ ] Postgres backups inherit platform schedule (chapter 19); app team aware of RPO target
- [ ] If using MinIO for app uploads: Object Lock GOVERNANCE enabled on critical paths
- [ ] App is included in Phase 4 DR drill scope

**Operator readiness**

- [ ] App team members in Keycloak group; Teleport role grants relevant access
- [ ] On-call rotation defined; escalation path documented in runbook
- [ ] Incident playbook for the app's most likely failure modes drafted (chapter 41 pattern)

### 30.12 Decommissioning

When an app retires, reverse the onboarding:

1. Stop traffic via Cloudflare DNS removal
2. `nomad job stop <app>` → wait for graceful drain
3. Vault DB engine: revoke all leases + drop the role
4. Postgres: `DROP DATABASE` + `DROP ROLE` (after final backup)
5. MinIO: optionally archive bucket to cold storage; retain per AU's data-retention policy; then `mc rb`
6. Redis: `redis-cli --scan --pattern '<app>:*' | xargs redis-cli del`
7. Keycloak OIDC client: delete
8. Vault paths: delete or archive (subject to audit retention)
9. GitLab repo: archive (don't delete — git history is the audit trail)
10. Remove app's row from chapter 23 Ansible inventory + alert rules + dashboards

Document the decommissioning in GitLab — pinned issue or wiki page — so future incident responders don't trip over orphaned references.

---
