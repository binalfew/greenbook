# 00 — Architecture

> **Phase**: foundation · **Audience**: platform engineers, security architects, AU IT leadership · **Time to read**: 30-40 min
>
> Canonical architectural reference for AU's internal application platform. Explains the tier model, network segmentation, component selections, sizing, HA/DR strategy, and the rationale for major decisions. Every Phase 1-5 chapter assumes this document is the source of truth for "why" questions.
>
> **Prev**: [README](README.md) · **Next**: [01 — Capacity & sizing](01-capacity-sizing.md) · **Index**: [README](README.md)

---

## Contents

- [§0.1 Goals + non-goals](#01-goals-non-goals)
- [§0.2 Tier model + traffic flow](#02-tier-model-traffic-flow)
- [§0.3 Network segmentation + IP allocation](#03-network-segmentation-ip-allocation)
- [§0.4 Component decisions + rationale](#04-component-decisions-rationale)
- [§0.5 Identity + access architecture](#05-identity-access-architecture)
- [§0.6 Secrets architecture](#06-secrets-architecture)
- [§0.7 Observability architecture](#07-observability-architecture)
- [§0.8 HA + disaster recovery](#08-ha-disaster-recovery)
- [§0.9 What this platform deliberately does NOT include](#09-what-this-platform-deliberately-does-not-include)

## 0. Architecture

### 0.1 Goals + non-goals

The platform exists to serve a specific organisational need: **AU has multiple internal applications to run, and operating them as N independent silos doesn't scale**. Greenbook proved a deployment shape works for one app; this platform extracts the shared infrastructure so every subsequent app inherits hardened defaults instead of re-inventing them.

**In-scope (goals):**

1. **Host 10-30 internal AU applications** on shared, hardened infrastructure. Apps are tenants of the platform; the platform is operated by a small dedicated team.
2. **Single sign-on across everything** — apps, GitLab, Vault, Grafana, Nomad UI — federated to AU's existing Active Directory / LDAP.
3. **Self-service deployment** — app teams submit Nomad jobs via GitLab CI; the platform team approves changes, but routine deploys don't require platform-team intervention.
4. **Production-grade resilience** — application-level HA via Nomad scheduling, data-tier HA via Postgres replication and Redis Sentinel, edge HA via HAProxy active-active.
5. **Operational observability** — every app produces logs + metrics + traces that flow into the LGTM stack and are searchable per-app.
6. **Hardened secrets management** — no app stores credentials in source; all secrets fetched from Vault at runtime.
7. **Off-host disaster recovery** — backup tier physically separated from primary, RPO ≤ 1 hour, RTO ≤ 4 hours.

**Out-of-scope (non-goals):**

1. **Public-facing multi-tenant SaaS** — the platform serves AU's internal users, not external customers. No marketplace, no per-tenant billing, no signup flow.
2. **Hyperscale** — the platform is sized for ~30 apps with ~10K total internal users. It is not designed to scale to 100+ apps without architectural revisions.
3. **Replacing existing AU AD** — Keycloak federates to AD; it does not replace it.
4. **Replacing AU's existing networking gear** — the platform consumes AU's perimeter firewall, NAT, and VLAN infrastructure. It does not introduce competing network kit.
5. **Building everything from scratch** — every component is open-source upstream; the platform team maintains operational integration, not custom forks.
6. **Kubernetes** — explicitly chose Nomad for AU's scale; see [§0.4](#04-component-decisions-rationale).

### 0.2 Tier model + traffic flow

Six logical tiers, each with distinct purpose, separation, and access pattern:

```
                         INTERNET
                            │
                            │  HTTPS only
                            ▼
                    ┌────────────────┐
                    │   Cloudflare   │   CDN, WAF, DDoS protection
                    │   (managed)    │   Public TLS termination
                    └────────┬───────┘
                             │  HTTPS — Cloudflare IPs only
                             ▼
   ╔═════════════════════════════════════════════════════════════════════════════╗
   ║  AU on-premises platform                                                    ║
   ║                                                                             ║
   ║  ┌─────────────────────────────────────────────────────────────────────┐    ║
   ║  │ VLAN 1 — DMZ (public-facing)                                        │    ║
   ║  │   HAProxy active-active pair                                        │    ║
   ║  │   Origin TLS terminator (AU wildcard cert *.africanunion.org)       │    ║
   ║  │   Forwards to App tier via Consul-discovered backends               │    ║
   ║  └────────────────────────────┬────────────────────────────────────────┘    ║
   ║                               │  HTTP (LAN trust boundary)                  ║
   ║                               ▼                                             ║
   ║  ┌─────────────────────────────────────────────────────────────────────┐    ║
   ║  │ VLAN 2 — App                                                        │    ║
   ║  │   Nomad clients (N nodes; HA via Nomad scheduling)                  │    ║
   ║  │   Per-app workloads — containers, exec drivers, etc.                │    ║
   ║  │   Apps register with Consul; HAProxy + apps both discover via DNS   │    ║
   ║  └─────────────┬───────────────────────────────┬───────────────────────┘    ║
   ║                │                               │                            ║
   ║                ▼                               ▼                            ║
   ║  ┌──────────────────────────────────┐ ┌────────────────────────────────┐    ║
   ║  │ VLAN 3 — Data                    │ │ VLAN 4 — Platform              │    ║
   ║  │   Postgres primary + replica     │ │   Nomad servers (3)            │    ║
   ║  │   PgBouncer (connection pooler)  │ │   Consul servers (3)           │    ║
   ║  │   Redis (Sentinel HA)            │ │   Vault HA (3)                 │    ║
   ║  │   MinIO (S3-compatible storage)  │ │   Keycloak HA (2)              │    ║
   ║  │                                  │ │   GitLab CE                    │    ║
   ║  │   Apps connect via TLS or mTLS   │ │   Nexus                        │    ║
   ║  │                                  │ │   Loki + Mimir + Tempo (3)     │    ║
   ║  │                                  │ │   Grafana + Alertmanager       │    ║
   ║  └──────────────────────────────────┘ └────────────────────────────────┘    ║
   ║                                                                             ║
   ║  ┌─────────────────────────────────────────────────────────────────────┐    ║
   ║  │ VLAN 5 — Operations                                                 │    ║
   ║  │   Bastion / Teleport (2 nodes, active/passive)                      │    ║
   ║  │   Ansible control node                                              │    ║
   ║  │   Backup orchestration                                              │    ║
   ║  │                                                                     │    ║
   ║  │   Operator workstations enter the platform here; everything else    │    ║
   ║  │   is reached via the bastion.                                       │    ║
   ║  └─────────────────────────────────────────────────────────────────────┘    ║
   ║                                                                             ║
   ║  ┌─────────────────────────────────────────────────────────────────────┐    ║
   ║  │ VLAN 6 — Management (out-of-band)                                   │    ║
   ║  │   IPMI / hypervisor management interfaces                           │    ║
   ║  │   Reachable only from operator workstations on a dedicated link     │    ║
   ║  └─────────────────────────────────────────────────────────────────────┘    ║
   ╚═════════════════════════════════════════════════════════════════════════════╝
```

**Traffic flow for a typical app request (e.g., `https://greenbook.africanunion.org/users`):**

1. Internet client → Cloudflare (CDN/WAF/edge TLS)
2. Cloudflare → AU perimeter NAT → DMZ HAProxy (origin TLS handshake)
3. HAProxy decrypts, looks up `greenbook.service.consul` via Consul DNS
4. HAProxy → App-tier Nomad client running greenbook container (HTTP, plain text on the LAN)
5. App container → Vault (fetches DB credentials at startup; in-memory thereafter)
6. App container → Postgres on Data VLAN (TLS connection)
7. App container → Redis on Data VLAN (session lookup)
8. Response flows back: container → HAProxy → Cloudflare → Internet client
9. App emits log line → Loki on Platform VLAN; metric → Mimir; trace span → Tempo
10. Grafana dashboard shows the request landing in real-time

Every step is logged + traceable. There are no untraced paths through the platform.

### 0.3 Network segmentation + IP allocation

**Subnet plan** (AU's existing /16 broken into platform-tier /24s):

| VLAN | Tier       | Subnet            | Hosts (initial) | Purpose                          |
| ---- | ---------- | ----------------- | --------------- | -------------------------------- |
| 1    | DMZ        | `172.16.177.0/24` | 4-6             | LB pair, future scale slots      |
| 2    | App        | `10.111.10.0/24`  | 10-30           | Nomad clients (per app)          |
| 3    | Data       | `10.111.20.0/24`  | 6-10            | DB, Redis, MinIO, PgBouncer      |
| 4    | Platform   | `10.111.30.0/24`  | 15-25           | Nomad/Consul/Vault/Keycloak/etc. |
| 5    | Operations | `10.111.40.0/24`  | 4-8             | Bastion, Ansible, backup orch    |
| 6    | Management | `10.111.99.0/24`  | varies          | IPMI / hypervisor mgmt           |

**Hostname convention**: `auishqos<role><instance>` continues from the existing AU pattern. Examples:

| Role suffix | Tier       | Examples                                                             |
| ----------- | ---------- | -------------------------------------------------------------------- |
| `arp`       | DMZ        | `auishqosrarp01`, `auishqosrarp02` (HAProxy pair)                    |
| `app`       | App        | `auishqosrapp01`, `auishqosrapp02`, `auishqosrapp03` (Nomad clients) |
| `db`        | Data       | `auishqosrdb01`, `auishqosrdb02` (Postgres primary + replica)        |
| `cache`     | Data       | `auishqosrcache01-03` (Redis Sentinel)                               |
| `obj`       | Data       | `auishqosrobj01-04` (MinIO erasure-coded set)                        |
| `nmd`       | Platform   | `auishqosrnmd01-03` (Nomad servers)                                  |
| `cns`       | Platform   | `auishqosrcns01-03` (Consul servers)                                 |
| `vlt`       | Platform   | `auishqosrvlt01-03` (Vault HA)                                       |
| `kc`        | Platform   | `auishqosrkc01-02` (Keycloak HA)                                     |
| `git`       | Platform   | `auishqosrgit01` (GitLab CE)                                         |
| `nex`       | Platform   | `auishqosrnex01` (Nexus)                                             |
| `obs`       | Platform   | `auishqosrobs01-03` (Loki/Mimir/Tempo)                               |
| `bst`       | Operations | `auishqosrbst01-02` (Bastion pair)                                   |

**Inter-tier firewall rules** (default deny, explicit allow):

| From → To               | Allowed                                                         |
| ----------------------- | --------------------------------------------------------------- |
| Internet → DMZ          | TCP 80, 443 (from Cloudflare ranges only)                       |
| DMZ → App               | TCP 80, 443 (per-app destination ports)                         |
| DMZ → Platform          | TCP 8500 (Consul DNS — for service discovery)                   |
| App → Data              | TCP 5432 (Postgres), 6379 (Redis), 9000 (MinIO)                 |
| App → Platform          | TCP 8200 (Vault), 8500 (Consul), 4646 (Nomad), 3100 (Loki push) |
| Operations → all VLANs  | TCP 22 (SSH), via bastion only                                  |
| Management → Operations | TCP 443, 8443 (hypervisor / IPMI mgmt UI)                       |
| All → Internet          | TCP 80, 443 outbound (apt updates, DNS, NTP)                    |

Every rule is implemented at the AU perimeter firewall plus replicated at the per-VM UFW level (defence in depth, same pattern as greenbook).

### 0.4 Component decisions + rationale

This section is the canonical record of the six locked decisions from the [README](README.md). Each is documented with the alternatives considered and the reasoning.

#### 0.4.1 Container orchestration → Nomad

**Considered**:

- Plain Docker Compose + Ansible (current greenbook shape)
- Docker Swarm
- Kubernetes (vanilla, k3s, RKE2, OpenShift)
- HashiCorp Nomad

**Chosen: Nomad.**

**Why**:

- AU's scale (10-30 apps) is below the threshold where Kubernetes' complexity pays off. K8s assumes 50+ apps and a dedicated platform team of 5+ — neither is true for AU.
- Nomad's single-binary install + HCL config is operationally simpler. A typical Nomad cluster is 3 servers + N clients; that's it.
- Drops in alongside Vault (dynamic secrets injection per workload) and Consul (service discovery) without integration tax — they're designed as a triplet.
- Production proven at scale: Cloudflare, Trivago, BetterCloud, Roblox all run Nomad in production with traffic AU will never see.
- Schedules anything — containers, raw exec, JARs, even VM batch jobs. Useful when not every app is containerised yet.

**Trade-offs accepted**:

- Smaller community than k8s. Hiring "Nomad engineers" is harder than hiring "k8s engineers" — but AU's platform team is small enough that retraining is cheaper than churning over hiring market constraints.
- Fewer off-the-shelf operators than k8s' helm-chart ecosystem. For AU's app set (web apps + databases + caches), this isn't binding.
- If the platform ever needs to scale to 50+ apps with very dynamic workloads, k8s migration becomes attractive — but that's a 5-year-out problem, not a now problem.

**Rejected: Docker Swarm** — Docker Inc. has clearly deprioritised Swarm; long-term viability is uncertain.
**Rejected: Kubernetes** — overkill at AU's scale; the operational tax is real.

#### 0.4.2 Identity → Keycloak federated to AU AD/LDAP

**Considered**:

- Keycloak standalone (own user database)
- Keycloak federated to AU AD
- LDAP-only (no Keycloak; apps authenticate directly against AD)
- Authentik / Authelia (lightweight alternatives)

**Chosen: Keycloak federated to AU AD/LDAP.**

**Why**:

- AU has an existing Active Directory used for HR / payroll / Office365 — that's the canonical user lifecycle source. Onboarding/offboarding happens there; the platform must respect those events.
- Keycloak federates to AD via the LDAP user-storage provider; users authenticate with their existing AU credentials. No parallel password to manage.
- Single SSO token issued by Keycloak unlocks every platform service (apps, GitLab, Vault, Grafana, Nomad UI). One MFA setup, one offboarding path.
- Apps speak modern protocols (OIDC for new apps, SAML for legacy). Keycloak handles the protocol translation; the LDAP/AD layer is invisible to apps.

**Trade-offs accepted**:

- Keycloak is heavier than Authentik/Authelia (Java-based, JVM tuning) but the ecosystem maturity is unmatched.
- AU AD goes down → Keycloak can't log new users in (existing sessions continue). Mitigated by Keycloak's user cache + AD redundancy.

**Rejected: standalone Keycloak** — would create a parallel user store, breaking AU's HR-driven user lifecycle.
**Rejected: LDAP-only** — would force every app to implement LDAP authentication directly; loses MFA-at-the-edge, loses unified session management.

#### 0.4.3 VCS + CI/CD → GitLab CE

**Considered**:

- GitLab CE (bundled VCS + CI + container registry + package registry)
- Forgejo + separate CI (Drone, Woodpecker)
- Gitea + Jenkins
- Bitbucket Server (paid)
- GitHub Enterprise Server (paid)

**Chosen: GitLab CE.**

**Why**:

- One product covers VCS, CI/CD, container registry, package registry. One Keycloak SSO integration. One ACL model. One backup strategy.
- Mature CI/CD with native Docker support, GitOps patterns, and security scanning built-in (free tier includes container scanning).
- GitLab Runner can be installed on Nomad clients (so CI workloads schedule alongside app workloads, sharing infrastructure efficiently).
- Active development; well-documented; many community resources.

**Trade-offs accepted**:

- Single big VM (16 GB RAM, 4 CPU minimum). Heavier than a stripped-down VCS like Forgejo.
- Single point of failure — GitLab CE doesn't HA cleanly without going Premium tier ($$$). Mitigated by aggressive backups (every 4 hours) and tested restore procedures.
- Vendor lock-in to GitLab's CI YAML format. Acceptable trade-off for the integration benefit.

**Rejected: Forgejo + Woodpecker** — viable, but two products to operate. The integration cost outweighs the lighter footprint at AU's scale.
**Rejected: Bitbucket / GitHub Enterprise** — paid, and Bitbucket's on-prem product line is winding down.

#### 0.4.4 Observability → LGTM stack

**Considered**:

- ELK / OpenSearch stack
- Graylog (originally planned in greenbook chapter 11)
- LGTM: Loki + Grafana + Tempo + Mimir
- Splunk (paid, expensive at AU's scale)
- SaaS observability (Datadog, New Relic) — disqualified by on-prem mandate

**Chosen: LGTM stack.**

**Why**:

- All from Grafana Labs, all open source, all integrate cleanly out of the box.
- Loki indexes logs by **labels** (e.g., `{app="greenbook", level="error"}`) instead of full-text. Result: storage is dramatically cheaper than Elastic — order-of-magnitude cheaper at AU's expected log volumes.
- Grafana as the unified UI means logs + metrics + traces share one dashboard, one auth, one URL. Operators don't context-switch between Kibana / Grafana / Jaeger.
- Active development; Grafana Labs has a strong open-source commitment.

**Trade-offs accepted**:

- Loki's label-based search is **not** Elastic-style full-text. Operators used to ELK need to relearn search patterns.
- Mimir is younger than Prometheus' built-in storage; we're choosing it for HA + long retention.
- Slightly more components than "just install ELK" — but each component is small.

**Rejected: ELK / OpenSearch** — heavyweight, expensive storage; full-text indexing is overkill for label-aware structured logs (which is what pino emits).
**Rejected: Graylog** — operationally fine, but log-only. We'd need a separate metrics + traces stack anyway. LGTM unifies all three.

#### 0.4.5 Service discovery → Consul

**Considered**:

- Consul (with Nomad + Vault — HashiCorp triplet)
- etcd (k8s' native; pairs poorly with Nomad)
- DNS-only (round-robin records in AU's DNS)
- HAProxy with hardcoded backends

**Chosen: Consul.**

**Why**:

- Nomad jobs register with Consul automatically; Consul provides DNS-based service discovery (`<service>.service.consul`). HAProxy and apps both look up backends via Consul DNS — no hardcoded lists, no manual rebalancing.
- Consul Connect adds optional mTLS service mesh — workload-to-workload encryption, useful for Phase 4+ when compliance posture tightens.
- Vault uses Consul as a high-availability storage backend (or alternatively Vault's own integrated storage; we lean toward integrated storage in Phase 1, may revisit).
- Single-binary install, low operational cost.

**Trade-offs accepted**:

- Adds another HashiCorp service to operate. But: same toolchain, same HCL config, same ACL model as Nomad and Vault.
- Consul DNS adds 1-5 ms latency to lookups. Negligible for HTTP/gRPC.

**Rejected: etcd** — primarily designed for k8s; not a clean fit for Nomad-based stack.
**Rejected: DNS-only** — no health checking, no de-registration on instance failure, manual record management.
**Rejected: hardcoded backends** — eliminates the entire benefit of dynamic scaling.

#### 0.4.6 Network segmentation → 6 VLANs

**Considered**:

- 3-tier (DMZ / App / Data) — current greenbook shape
- 4-tier (+ Platform)
- 6-tier (DMZ / App / Data / Platform / Operations / Management)
- Flat single-VLAN (rejected — no blast-radius reduction)

**Chosen: 6-tier.**

**Why**:

- Each tier has distinct security needs: DMZ is internet-facing; App is the runtime workload; Data holds the crown jewels; Platform holds the keys (Vault + Keycloak); Operations is operator-only; Management is hardware-only.
- Explicit firewall rules between tiers enforce least-privilege. An App-tier compromise can't pivot to Platform tier (Vault) without a separate Platform-tier breach.
- Aligns with common compliance frameworks (PCI DSS, HIPAA, ISO 27001 segmentation requirements).

**Trade-offs accepted**:

- 6 sets of firewall rules to maintain — more configuration than 3 or 4 tiers. Manageable with infrastructure-as-code (Ansible).
- Slightly more complex VM provisioning — but consistent and predictable.

**Rejected: 3-tier** — no separation between Platform services and App workloads. A compromised app could reach Vault directly. Unacceptable for the platform tier.
**Rejected: 4-tier** — Operations and Management really should be separate; mixing them creates audit and access-control complexity.

### 0.5 Identity + access architecture

Three classes of principals access the platform:

1. **End users** (humans using AU applications): authenticate to apps via OIDC; apps redirect to Keycloak; Keycloak validates against AD; user gets back to the app with an OIDC ID token. MFA enforced at Keycloak per AU policy.
2. **Operators** (humans operating the platform): SSH to bastion via SSH key + Yubikey (Phase 1) → Teleport with session recording (Phase 5). All operations logged.
3. **Workloads** (apps + platform services): authenticate to Vault via Nomad-issued JWT (workload identity); fetch credentials with short TTL; rotate automatically.

Authorisation flows:

```
End user → Keycloak → app (OIDC ID + Access tokens, RBAC enforced in app)
Operator → Bastion → target VM (sudo on the target VM via group membership)
Workload → Nomad workload identity → Vault → secrets (capability-scoped)
```

No long-lived static credentials anywhere. Every authentication produces a short-lived token; every token is revocable.

### 0.6 Secrets architecture

Vault is the canonical secret store. Three secret categories:

| Category               | Source                          | Consumption                                          | Rotation                |
| ---------------------- | ------------------------------- | ---------------------------------------------------- | ----------------------- |
| **Static app secrets** | Operator-set via `vault kv put` | Nomad job templates inject at startup                | Manual, audit-tracked   |
| **Dynamic DB creds**   | Vault generates per-workload    | Workload fetches at startup; Vault tracks lease      | Automatic per-lease TTL |
| **TLS material**       | Vault PKI engine                | App fetches; renewed before expiry via reload signal | Automatic (90-day TTL)  |

Vault HA is 3-node integrated storage (Phase 1) — no separate Consul backend required for Phase 1. Optional migration to Consul-backed storage in Phase 4 if cross-region replication becomes a need.

Secrets never appear in:

- Source control (`.env`, `secrets.yaml` — banned)
- CI/CD logs (Vault tokens redacted)
- Container images (no `ENV` lines with credentials)
- Plaintext on disk after install (Vault dev-mode forbidden in production)

### 0.7 Observability architecture

Three signals, one stack:

```
                ┌─────────────┐  ┌──────────────┐  ┌─────────────┐
                │   Logs      │  │  Metrics     │  │  Traces     │
                │  pino /     │  │ Prometheus   │  │  OTLP/      │
                │  syslog     │  │  scrape      │  │  Jaeger     │
                └──────┬──────┘  └──────┬───────┘  └──────┬──────┘
                       │                │                  │
                       ▼                ▼                  ▼
                ┌─────────────┐  ┌──────────────┐  ┌─────────────┐
                │   Loki      │  │   Mimir      │  │   Tempo     │
                │  (label-    │  │ (long-term   │  │  (trace     │
                │  indexed)   │  │  Prom store) │  │  storage)   │
                └──────┬──────┘  └──────┬───────┘  └──────┬──────┘
                       └────────────────┼──────────────────┘
                                        ▼
                               ┌────────────────┐
                               │    Grafana     │
                               │  (unified UI)  │
                               └────────────────┘
                                        │
                                        ▼
                               ┌────────────────┐
                               │ Alertmanager   │
                               │ (paging via    │
                               │  Opsgenie/     │
                               │  PagerDuty)    │
                               └────────────────┘
```

Log retention: 30 days hot in Loki (S3-compatible MinIO backing), 1 year cold. Metric retention: 15 days local, 1 year remote (Mimir). Trace retention: 7 days hot, 30 days cold. All retentions tunable per the operational budget.

Every app emits **structured JSON logs** (pino convention) with at minimum:

- `time` — RFC3339 timestamp
- `level` — info / warn / error / fatal
- `service` — app name
- `version` — release version
- `correlationId` — propagated through the request chain
- `msg` — human-readable message

Loki labels extracted from these fields enable queries like `{service="greenbook", level="error"} | json | line_format "{{.correlationId}} {{.msg}}"`.

### 0.8 HA + disaster recovery

**HA (no single point of failure within the primary site):**

| Tier       | HA strategy                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| Cloudflare | Inherently HA (anycast across multiple datacenters)                                                                |
| DMZ        | HAProxy active-active pair with VRRP-managed VIP                                                                   |
| App        | Multiple Nomad clients; Nomad re-schedules on client failure                                                       |
| Postgres   | Streaming replication primary → replica; PgBouncer routes; manual failover Phase 1 → automatic via Patroni Phase 4 |
| Redis      | Sentinel (3 sentinels) with automatic failover                                                                     |
| MinIO      | Erasure-coded set across 4+ nodes; tolerates 2 simultaneous failures                                               |
| Nomad      | 3 servers with Raft consensus                                                                                      |
| Consul     | 3 servers with Raft consensus                                                                                      |
| Vault      | 3 nodes with Raft consensus (integrated storage)                                                                   |
| Keycloak   | 2 nodes active-active with shared DB                                                                               |
| GitLab     | Single VM (CE doesn't HA without Premium); aggressive backup compensates                                           |
| LGTM       | 3 nodes per service (Loki/Mimir/Tempo); object storage for persistence                                             |
| Bastion    | 2 nodes active-passive                                                                                             |

**DR (full-site loss)**:

- **RPO target**: 1 hour (max acceptable data loss)
- **RTO target**: 4 hours (max time to restored service)
- **DR site**: warm standby in a geographically-separated AU facility
- **Replication**: Postgres logical replication primary → DR; MinIO bucket replication; Vault snapshots every 15 min replicated off-site
- **DR drill**: quarterly, full failover + recovery test
- **What's NOT replicated**: GitLab CE (rebuild from backup); Nexus (rebuild + re-publish artifacts); per-app Nomad jobs (re-deployed via GitLab CI from source)

### 0.9 What this platform deliberately does NOT include

Listed explicitly so future "why don't we have X" conversations have a recorded answer:

- **Kubernetes** — see [§0.4.1](#041-container-orchestration-nomad). Considered and rejected for AU's scale.
- **Service mesh (Linkerd, Istio)** — Consul Connect provides optional mTLS; full Istio-style mesh is overkill for AU's app-to-app traffic patterns. Reconsider if zero-trust architecture becomes a hard compliance requirement.
- **Multi-region active-active** — single primary site + warm DR is sufficient for AU's RTO. Multi-region active-active triples operational complexity.
- **Kafka / event bus** — AU's apps don't currently have streaming/event-driven patterns. Add when 3+ apps independently want it.
- **Identity provider behind Keycloak** (e.g., Auth0 → Keycloak → AU AD) — adds a layer with no benefit; Keycloak federating directly to AD is sufficient.
- **Container scanning service (Snyk, Trivy as standalone)** — GitLab CE includes container scanning in CI; adding standalone scanning duplicates effort.
- **Custom in-house observability** — LGTM is the canonical stack. No bespoke log aggregator, no custom metrics store. If a tool is needed, justify it against LGTM.
- **Self-managed CDN** — Cloudflare is the public edge. Not interested in operating a CDN.
- **API gateway as a separate tier** — HAProxy + Consul provides what's needed. Apps that want richer API gateway features (rate limiting per-key, OAuth scope enforcement) handle it in-app or via Keycloak.

---
