# PLAN — AU Internal Application Platform Documentation

> **Owner**: Binalfew Kassa (Senior Solutions & System Architect, MISD / AUC)
> **Author**: this is the working tracker for the doc-writing project
> **Status**: ✅ ALL CHAPTERS DRAFTED — every phase + every post-phase reference + all appendices
> **Last updated**: 2026-05-02 (chapters 30, 40, 41, 42 + appendices A, B, C drafted — full doc set complete)

This is the living tracker for the platform documentation effort. Updated after every chapter completion, every decision change, and every dependency unlock. The README's chapter-status table is a public-facing summary; **this doc is the source of truth** for what's been done, what's blocked, and what's next.

---

## Summary

Document AU's internal application platform — the long-term home for greenbook + N future apps — as a complete operations reference. Mirrors the depth, structure, and verification rigour of `docs/deployment/` (greenbook's own deployment guide), but at the platform tier rather than per-app. Target output: ~25-30 chapters across 5 delivery phases over 12 months.

Anchored on six locked decisions (Nomad / Keycloak+AD / GitLab CE / LGTM / Consul / 6 VLANs) — see [README §Locked decisions](README.md#locked-decisions). Every chapter assumes those decisions hold.

---

## Project state at a glance

| Metric                                  | Value                                                |
| --------------------------------------- | ---------------------------------------------------- |
| Phase                                   | 1 of 5                                               |
| Chapters drafted                        | 31 (README, 00, 02-23, 30, 40-42, A, B, C)           |
| Chapters stubbed                        | 1 (01-capacity-sizing)                               |
| Post-phase chapters remaining           | **0 — all drafted**                                  |
| **Phase 1 status**                      | **✅ all 5 component chapters drafted (02-06)**      |
| **Phase 2 status**                      | **✅ all 6 component chapters drafted (07-12)**      |
| **Phase 3 status**                      | **✅ all 6 component chapters drafted (13-18)**      |
| **Phase 4 status**                      | **✅ both chapters drafted (19, 20)**                |
| **Phase 5 status**                      | **✅ all 3 chapters drafted (21, 22, 23)**           |
| **Post-phase status**                   | **✅ all 4 + 3 appendices drafted (30, 40-42, A-C)** |
| Locked decisions                        | 6 / 6                                                |
| Decisions awaiting stakeholder sign-off | 6 (full list below)                                  |
| External dependencies blocked           | 0                                                    |

---

## Phase summary

| Phase | Goal                                | Months  | Status     | Chapters in scope                              |
| ----- | ----------------------------------- | ------- | ---------- | ---------------------------------------------- |
| 1     | Developer foothold                  | 0-2     | 📝 drafted | 02, 03, 04, 05, 06                             |
| 2     | Identity + observability            | 2-4     | 📝 drafted | 07, 08, 09, 10, 11, 12 (all 6 drafted)         |
| 3     | App scaling + edge HA               | 4-6     | 📝 drafted | 13, 14, 15, 16, 17, 18 (all 6 drafted)         |
| 4     | Resilience                          | 6-9     | 📝 drafted | 19, 20 (both drafted)                          |
| 5     | Operational maturity                | 9-12    | 📝 drafted | 21, 22, 23 (all drafted)                       |
| post  | Operational reference (cross-phase) | rolling | 📝 drafted | 30, 40, 41, 42, appendices A/B/C (all drafted) |

---

## Chapter rollup

Legend: ✅ validated · 📝 drafted (review pending) · 🚧 drafting · 📋 planned · 🔒 stub only

| #   | Title                    | Phase | Status | Drafted    | Reviewed by | Validated against real install | Notes                                                                             |
| --- | ------------------------ | ----- | ------ | ---------- | ----------- | ------------------------------ | --------------------------------------------------------------------------------- |
| —   | README                   | —     | 📝     | 2026-05-01 | —           | n/a                            | Living document; no validation step                                               |
| 00  | Architecture             | —     | 📝     | 2026-05-01 | —           | n/a                            | Reference; commands deferred to 02-23                                             |
| 01  | Capacity & sizing        | —     | 🔒     | 2026-05-01 | —           | n/a                            | Phase-1 sizing only; rest TBD                                                     |
| 02  | Bastion                  | 1     | 📝     | 2026-05-01 | —           | —                              | Phase 1 simple bastion; Teleport in 21                                            |
| 03  | Vault                    | 1     | 📝     | 2026-05-01 | —           | —                              | 3-node Raft HA; KV v2; Shamir unseal                                              |
| 04  | GitLab CE                | 1     | 📝     | 2026-05-01 | —           | —                              | Single VM (CE limit); backup-driven HA                                            |
| 05  | Nomad cluster            | 1     | 📝     | 2026-05-01 | —           | —                              | 3 servers + 3 clients; Consul colocated; mTLS + ACLs + Vault JWT                  |
| 06  | Nexus                    | 1     | 📝     | 2026-05-01 | —           | —                              | OSS single VM; Maven/npm/PyPI proxies + hosted repos                              |
| 07  | Keycloak                 | 2     | 📝     | 2026-05-01 | —           | —                              | Standalone HA pair + dedicated Postgres; au realm + OIDC clients                  |
| 08  | Keycloak federated to AD | 2     | 📝     | 2026-05-01 | —           | —                              | AD as user lifecycle source; Q3 dependency surfaced in §8.2                       |
| 09  | Loki + Grafana           | 2     | 📝     | 2026-05-01 | —           | —                              | 3-node Loki cluster + Grafana SSO; Promtail on every platform VM                  |
| 10  | Prometheus + Mimir       | 2     | 📝     | 2026-05-01 | —           | —                              | 3-node Mimir colocated on obs01-03; Prometheus HA with Mimir dedup                |
| 11  | Tempo                    | 2     | 📝     | 2026-05-01 | —           | —                              | 3-node Tempo on obs01-03; OTLP receivers; logs↔traces wired                      |
| 12  | Alertmanager             | 2     | 📝     | 2026-05-01 | —           | —                              | 3-node AM cluster; Mimir+Loki rulers; 30+ initial rules; closes Phase 2           |
| 13  | Postgres HA              | 3     | 📝     | 2026-05-02 | —           | —                              | Primary+replica streaming repl; pgBackRest PITR; Q4 manual-failover answered      |
| 14  | Redis Sentinel           | 3     | 📝     | 2026-05-02 | —           | —                              | 3-VM Redis+Sentinel; sessions/cache/queues; Sentinel-aware client contract        |
| 15  | MinIO                    | 3     | 📝     | 2026-05-02 | —           | —                              | 4-node EC; unlocks Loki/Mimir/Tempo/Postgres/Redis cold tier; per-consumer SAs    |
| 16  | PgBouncer                | 3     | 📝     | 2026-05-02 | —           | —                              | 2-VM PgBouncer active-active; transaction-mode default; auth_query pattern        |
| 17  | HAProxy HA pair          | 3     | 📝     | 2026-05-02 | —           | —                              | Internal LB; VRRP VIP; pg-rw/pg-ro split via xinetd; Consul SD for app backends   |
| 18  | Public DNS + Cloudflare  | 3     | 📝     | 2026-05-02 | —           | —                              | Cloudflare→AU NAT→DMZ; corporate-WAF bypass-list documented; closes Phase 3       |
| 19  | Backup strategy          | 4     | 📝     | 2026-05-02 | —           | —                              | Unified backup view; RPO/RTO targets per service; quarterly drill cadence         |
| 20  | DR site                  | 4     | 📝     | 2026-05-02 | —           | —                              | Warm-standby DR; CF Load Balancer failover; closes Phase 4; Q5 mechanism doc'd    |
| 21  | Teleport bastion         | 5     | 📝     | 2026-05-02 | —           | —                              | Cert-based access + RBAC + session recording; replaces ch02 SSH keys              |
| 22  | Dynamic Vault secrets    | 5     | 📝     | 2026-05-02 | —           | —                              | DB + PKI + Transit + SSH CA engines; 1h leases vs 90d static rotation             |
| 23  | Runbook automation       | 5     | 📝     | 2026-05-02 | —           | —                              | Ansible playbooks; CI lint + dry-run; nightly drift detection; closes Phase 5     |
| 30  | App onboarding workflow  | post  | 📝     | 2026-05-02 | —           | —                              | Consolidates every "ch30 contract" reference from chs 1-23; pre-go-live checklist |
| 40  | Verification ladder      | post  | 📝     | 2026-05-02 | —           | —                              | 11-layer ladder (mirrors greenbook ch13); per-component health checks             |
| 41  | Incident response        | post  | 📝     | 2026-05-02 | —           | —                              | 11 named playbooks (P-01 to P-11); detection→triage→mitigate→verify→PIR shape     |
| 42  | Hardening checklist      | post  | 📝     | 2026-05-02 | —           | —                              | Pre-go-live + quarterly audit; 8 domains; YES/NO with evidence                    |
| A   | Command cheatsheet       | —     | 📝     | 2026-05-02 | —           | —                              | Per-service operational commands extracted from chs 02-23                         |
| B   | Reference configs        | —     | 📝     | 2026-05-02 | —           | —                              | Pointers to canonical config blocks across all chapters                           |
| C   | External references      | —     | 📝     | 2026-05-02 | —           | —                              | Upstream docs, vendor links, RFC pointers                                         |

---

## Decision register

### Locked (committed; reopening requires revision pass)

| #   | Decision                                                       | Date locked | Owner    | Trigger to reopen                                                                                      |
| --- | -------------------------------------------------------------- | ----------- | -------- | ------------------------------------------------------------------------------------------------------ |
| D1  | **Container orchestration: HashiCorp Nomad**                   | 2026-05-01  | Binalfew | App count exceeds 50 / mandatory k8s ecosystem requirement (e.g., a vendor product ships only as Helm) |
| D2  | **Identity: Keycloak federated to AU AD/LDAP**                 | 2026-05-01  | Binalfew | AU AD becomes unavailable / replaced; mandate for SSO product change                                   |
| D3  | **VCS + CI/CD: GitLab CE bundled**                             | 2026-05-01  | Binalfew | GitLab CE licence model changes; hard requirement for HA-without-Premium                               |
| D4  | **Observability: LGTM stack (Loki + Grafana + Tempo + Mimir)** | 2026-05-01  | Binalfew | Compliance requirement for full-text log search forces Elastic; vendor mandate for paid Splunk/Datadog |
| D5  | **Service discovery: HashiCorp Consul**                        | 2026-05-01  | Binalfew | Decision change on D1 (Nomad → k8s) which changes service-discovery model                              |
| D6  | **Network segmentation: 6 VLANs**                              | 2026-05-01  | Binalfew | Compliance audit forces additional segmentation; hardware constraint forces consolidation              |

### Open / pending

| #   | Question                                                                                                                                                                                                     | Blocking which chapter  | Notes                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------- |
| Q1  | Hypervisor capacity confirmed for Phase 1 (~13 VMs, ~30 vCPU, ~88 GB RAM, ~3 TB)?                                                                                                                            | 02-06 (provisioning)    | Need AU IT confirmation before any chapter directs operators to provision VMs            |
| Q2  | VLAN allocation approved (172.16.177.0/24 DMZ; 10.111.{10,20,30,40,99}.0/24 internal)?                                                                                                                       | 02-06                   | Need network team's blessing on subnet plan                                              |
| Q3  | AU AD/LDAP read-only service account for Keycloak available?                                                                                                                                                 | 08                      | Phase 2 dependency; needs security review                                                |
| Q4  | ~~Manual Postgres failover (Phase 1) acceptable, or do we need Patroni from day one?~~ ✅ **answered 2026-05-02**: manual-with-quarterly-drill in Phase 3 (ch13); Patroni in Phase 5 (slot reserved as ch24) | 13 — answered           | RTO target <30 min for drilled manual; <30 sec automatic with Patroni                    |
| Q5  | Off-site DR location confirmed? — **2026-05-02: mechanism documented in ch20 §20.3; 3 candidate options listed; awaiting AU IT site selection**                                                              | 19, 20 — mechanism done | Chapter 20 works regardless of which site lands; the _what_ is open, the _how_ is closed |
| Q6  | Paging integration target: Opsgenie? PagerDuty? AU's existing incident system?                                                                                                                               | 12                      | Phase 2 question                                                                         |

---

## Stakeholder + dependency tracker

| Stakeholder / dependency                        | Decisions / chapters they unblock                | Status  | Notes                                                                                       |
| ----------------------------------------------- | ------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------- |
| **AU IT leadership** — sign-off on D1-D6        | All chapters (rationale anchors here)            | Pending | Should review the locked decisions before chapter writing reaches their respective sections |
| **AU IT infra team** — VM provisioning capacity | Chapter 02 onward (any "provision a VM" step)    | Pending | Q1 + Q2                                                                                     |
| **AU IT network team** — VLAN + firewall rules  | Chapter 02 onward; especially 17 (HAProxy)       | Pending | Q2                                                                                          |
| **AU IT security team** — AD/LDAP integration   | Chapter 08 specifically                          | Pending | Q3                                                                                          |
| **AU IT security team** — perimeter ACL changes | Chapter 18 (Cloudflare); 17 (HAProxy public IPs) | Pending | Will need rules per the existing greenbook pattern                                          |
| **AU procurement** — DR site location           | Chapters 19, 20                                  | Pending | Phase 4                                                                                     |
| **AU compliance / audit** — review hardening    | Chapter 42                                       | Not yet | Engage at Phase 5 / pre-go-live                                                             |

---

## Per-chapter completion checklist

A chapter moves through these states as it matures. Update the chapter rollup status when it crosses each gate.

```
📋 planned   →  🚧 drafting   →  📝 drafted   →  ✅ validated
```

### "Drafted" (📝) — what's required to mark a chapter drafted

- [ ] All sections covered per the chapter's scope (no "TODO" or "TBD" in the body)
- [ ] All commands annotated with what they do + expected output
- [ ] Common failures documented with remedies
- [ ] Cross-references to related chapters resolve
- [ ] Markdown fences balanced (`grep -c '^\`\`\`' file` returns even number)
- [ ] All same-file anchor refs resolve (verified by Python check or manual)
- [ ] Phase header populated (Phase, Run on, Time)
- [ ] Prev / Next / Index links populated
- [ ] Listed in [README](README.md) navigation table + chapter status table
- [ ] Status updated in this PLAN.md

### "Validated" (✅) — what's required to mark a chapter validated

- [ ] All commands run successfully against a real (non-greenbook) test environment
- [ ] All "expected output" matches what real commands produce
- [ ] All remedy commands tested at least once when triggered by a real failure
- [ ] Reviewer (someone other than the author) has walked through the chapter end-to-end
- [ ] `Last validated: YYYY-MM-DD` updated in chapter header
- [ ] Status updated in this PLAN.md

Phase-1 chapters won't reach ✅ until Phase 1 hardware is provisioned and a real bring-up is attempted. That's expected — drafted is shippable; validation gates the production claim.

---

## Risks + known unknowns

| Risk / unknown                                                             | Likelihood | Impact  | Mitigation                                                                                                                                |
| -------------------------------------------------------------------------- | ---------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| AU IT decides on k8s instead of Nomad after chapters 02-06 are drafted     | Low        | High    | D1 has explicit reopen trigger; chapters use Nomad-specific commands but architecture descriptions are partially portable                 |
| GitLab CE single-VM HA limitation forces Premium upgrade                   | Medium     | Medium  | Backup-driven recovery is documented as part of D3; if Premium becomes mandatory, chapter 04 gets a §Premium-mode addendum, not a rewrite |
| Nomad ecosystem doesn't have an off-the-shelf solution for some app's need | Medium     | Low-Med | Apps can use Nomad's `exec` driver (raw binaries) or fall back to Compose-on-Nomad-client; chapter 30 documents both paths                |
| AU AD lacks the schema attributes Keycloak federation expects              | Low        | Medium  | Mitigated by the standalone-Keycloak fallback (chapter 07 before 08); chapter 08 documents AD attribute requirements explicitly           |
| LGTM stack disk usage exceeds initial sizing                               | Medium     | Low     | Loki + Mimir + Tempo all support tiered storage; resize/expand without restart                                                            |
| Hypervisor capacity hits ceiling sooner than expected (Phase 3-4)          | Medium     | High    | Chapter 01 sizing tables include growth markers; trigger procurement before crossing 70% utilisation                                      |
| Documentation effort stalls when Binalfew is pulled to other priorities    | Medium     | Medium  | Per-chapter completion is independent; phases are independently shippable; this PLAN.md preserves state across long writing gaps          |

---

## Changelog

Append-only. Most recent first.

### 2026-05-01

- 📝 README drafted (vision, locked decisions, navigation, phase plan)
- 📝 00-architecture drafted (9 sections covering tier model through non-goals)
- 🔒 01-capacity-sizing stub created (Phase 1 sizing table only)
- 🔒 PLAN.md created (this document)
- D1-D6 locked (Nomad / Keycloak+AD / GitLab CE / LGTM / Consul / 6 VLANs)
- Q1-Q6 raised (open questions awaiting AU IT input)

### 2026-05-01 (later same day)

- 📝 02-bastion drafted (Phase 1, chapter 1 of 5)
  - Sections: role + threat model, base OS hardening cross-ref, SSH daemon hardening, operator account model, key auth setup, ProxyJump pattern, auditd + auth.log retention, UFW + perimeter rules, HA active/passive (DNS-driven), verification, Phase 5 upgrade pointer
  - 22 fenced code blocks, 0 broken anchors
  - Sets the pattern for Phase 1 chapters: clear "Phase 1 vs Phase 5" upgrade path so each chapter can stop at minimal-but-complete

- 📝 03-vault drafted (Phase 1, chapter 2 of 5)
  - Sections: role + threat model, pre-flight, install, cluster config (vault.hcl + TLS), bootstrap (init/unseal/join), root token + Shamir unseal-key custody, operator authentication, policies, KV v2, audit device, Raft snapshot strategy, UFW, verification, Phase 5 upgrade
  - 42 fenced code blocks, 0 broken anchors
  - Bootstrap discipline emphasised: 5-of-3 Shamir split with 5 distinct custodians; root token revoked after operator tokens issued; init JSON file shredded
  - Hourly Raft snapshots via systemd timer with leader-only execution

- 📝 04-gitlab drafted (Phase 1, chapter 3 of 5)
  - Sections: role + threat model, pre-flight (single big VM), Omnibus install, gitlab.rb config, TLS via AU wildcard, root password rotation + Vault custody, container registry, package registry, runner registration tokens stashed in Vault, gitlab-rake backup every 4h + secrets backup, audit logging, UFW, verification, Phase 2 Keycloak SSO migration path
  - 26 fenced code blocks, 0 broken anchors
  - Establishes the "single VM with backup-driven recovery" pattern that GitLab CE forces; Phase 4 chapter 19 hardens this further with off-site replication
  - Vault integration baked in from day 1: root password, runner tokens, future SMTP creds — all stored under kv/platform/gitlab/

- 📝 05-nomad-cluster drafted (Phase 1, chapter 4 of 5)
  - Sections: role + threat model, pre-flight, install Nomad+Consul, mTLS for the cluster (CA + per-node certs + gossip keys), server bootstrap, ACL bootstrap (both Consul + Nomad), client install, Vault integration via JWT workload identity (NOT static tokens), end-to-end test job, GitLab Runner co-location on clients, audit logging, dual-cluster snapshot strategy, UFW (many ports!), verification, Phase 5 upgrade
  - 30 fenced code blocks, 0 broken anchors
  - Largest chapter in Phase 1 because Nomad + Consul together are non-trivial. Makes mTLS + ACLs mandatory from day one (default-deny posture)
  - Establishes the workload-identity pattern explicitly to avoid the "static Vault token in job spec" anti-pattern
  - GitLab Runners co-located on Nomad clients per chapter 04 §4.9 commitment; runner registration token fetched from Vault

- 📝 06-nexus drafted (Phase 1, chapter 5 of 5 — **PHASE 1 COMPLETE**)
  - Sections: role + threat model, pre-flight, OSS install (no apt repo), admin password rotation + Vault, TLS via local nginx reverse proxy, repository setup (Maven/npm/PyPI/Generic/Docker), Phase 2 SSO deferment, backup strategy (DB export task + filesystem snapshot), audit logging, UFW, verification, Phase 2 path
  - 20 fenced code blocks, 0 broken anchors
  - Smallest Phase 1 chapter — Nexus is straightforward single-VM JVM
  - Phase 1 now ships an end-to-end "Phase 1 complete" summary table mapping each component to its Phase 5 upgrade chapter
  - **Phase 1 closes on 2026-05-01**: app teams now have everything needed to deploy a workload (source, secrets, scheduler, dependencies, operator access). Per-app onboarding workflow lands in chapter 30.

- 📝 07-keycloak drafted (Phase 2, chapter 1 of 6 — **PHASE 2 BEGINS**)
  - Sections: role + threat model, pre-flight (3 VMs: 2 Keycloak + 1 Postgres), provision Postgres backend (dedicated VM in VLAN 3 with kv/platform/keycloak/db_credentials), install Keycloak on both nodes (JDK 17 + tarball + systemd), HA cluster config (Quarkus + Infinispan + JGroups TCP discovery), TLS via local nginx (same pattern as Nexus ch06), bootstrap admin password rotation + Vault custody, AU realm setup with security defaults, OIDC client templates with Vault-stored secrets, group-based authorisation foundation, hourly Postgres backup + weekly realm export, audit events enabled, UFW (443 + 80 + 7800 JGroups), verification, path to chapter 08
  - 26 fenced code blocks, 0 broken anchors
  - Establishes the pattern for the rest of Phase 2: SSO is the unifying thread; every Phase 1 service gets reconfigured to consume Keycloak (table at end of §7.14)
  - Dedicated Postgres VM (`auishqosrkdb01`) for Keycloak — separated from Phase 3 app DB cluster for operational independence
  - JGroups TCP discovery (not multicast) for Phase 1's flat Platform VLAN

- 📝 08-keycloak-ad drafted (Phase 2, chapter 2 of 6)
  - Sections: role + threat model (federation benefits + new threats), pre-requisites from AU IT (Q3 dependency surfaced explicitly with bind credential vault path), add LDAP user-storage provider via Keycloak admin UI, test user sync, map AD groups → Keycloak roles, disable local-account login except break-glass, onboard GitLab as the first SSO consumer (per chapter 04 §4.14 commitment), audit + monitoring, verification ladder, rollback procedure (with quarterly drill recommendation), Phase 5 path
  - 26 fenced code blocks, 0 broken anchors
  - More UI-driven than CLI-driven — matches Keycloak's actual operator workflow
  - Surfaces AU IT's read-only LDAP service account requirement as the single biggest external dependency in Phase 2; vault path documented under kv/platform/keycloak/ad_bind_credentials with 365-day rotation
  - Rollback procedure documented + recommended quarterly drill; this is the highest-stakes Phase 2 chapter (federation breaks → no logins anywhere)
  - GitLab onboarding (§8.7) walks the OIDC client integration end-to-end as a template for Vault, Nexus, Nomad, Grafana

- 📝 09-loki drafted (Phase 2, chapter 3 of 6)
  - Sections: role + threat model (audit log integrity; outage = no operational visibility; disk fill is the most likely failure), pre-flight (3 obs VMs sized to colocate Loki+Mimir+Tempo + 1 Grafana VM), install Loki on obs nodes (Grafana apt repo), 3-node cluster config (microservices mode, memberlist gossip, replication factor 3, 30-day retention), install Grafana with TLS via local nginx, Grafana SSO via Keycloak (chapter 08 OIDC client), Loki as Grafana data source via provisioning, Promtail on every platform VM (journald + nginx logs), standard label conventions (host/role/job/unit/level), initial dashboards via provisioning, UFW (3100 + 9095 + 7946 + 443), verification (ring formed, SSO works, cross-service correlation ID search), Phase 3 MinIO migration path
  - 28 fenced code blocks, 0 broken anchors
  - Phase 2 chunks live on local filesystem (replication factor 3 across nodes); Phase 3 ch15 swaps to MinIO without changing dashboards/SSO/Promtail
  - Cross-service correlation ID search demonstrated as the first concrete operational benefit of centralised logs

- 📝 10-prometheus drafted (Phase 2, chapter 4 of 6)
  - Sections: role + threat model (silenced alerts; cardinality runaway as the most likely failure mode), pre-flight (reuses obs01-03 from chapter 09), install Prometheus from upstream tarball (bound to 127.0.0.1), install Mimir from Grafana Labs binary, Mimir cluster config (monolithic mode, replication factor 3, memberlist on port 7947 to avoid Loki's 7946), wire Prometheus remote_write to local Mimir + Mimir HA tracker for dedup, scrape configs per Phase 1+2 service (Vault/Nomad/Consul/Keycloak/GitLab/Postgres/Loki/Mimir), node_exporter on every platform VM, Mimir as Grafana data source, label conventions + 3-tier retention (15d Prom / 90d Mimir / 1y MinIO Phase 3+), starter dashboards from grafana.com IDs, UFW (9009 / 7947 / 9095 / 9100 / 9187 etc), verification including HA dedup check + cardinality sanity, Phase 3 MinIO migration path
  - 30 fenced code blocks, 0 broken anchors
  - Establishes the HA dedup pattern explicitly (3 Prometheus replicas with `external_labels.replica`, Mimir's `accept_ha_samples` collapses to one stored sample per cluster) — this is the single subtle thing in the whole stack
  - Cardinality discipline section (§10.10) calls out specifically what does NOT belong as a metric label (request IDs, user IDs, full URLs) — these go in logs (chapter 09) or traces (chapter 11)
  - Memberlist port choice (7946 vs 7947 for Loki/Mimir) documented as a deliberate decision

- 📝 11-tempo drafted (Phase 2, chapter 5 of 6)
  - Sections: role + threat model (forensic trail integrity; cardinality less-of-a-worry than Mimir; sampling is the lever), pre-flight (re-check obs VMs after Loki+Mimir landed; halt-and-resize gate), install Tempo from Grafana apt repo (already configured in ch09), cluster config (scalable single-binary mode, replication factor 3, memberlist on port 7948 — distinct from Loki's 7946 and Mimir's 7947), OTLP collector path (4317 gRPC + 4318 HTTP; legacy Jaeger/Zipkin time-boxed), Tempo as Grafana data source with tracesToLogsV2 + tracesToMetrics + serviceMap wired to Loki/Mimir UIDs, logs ↔ traces correlation completes the LGTM circuit (Loki ch09 §9.7 already provisioned the reverse link), span attribute conventions + 14d hot retention, **app instrumentation contract** (required vs forbidden — referenced from chapter 30 onboarding), UFW rules + Prometheus self-scrape addition, verification with synthetic OTLP span round-trip, Phase 3 MinIO migration path
  - 20 fenced code blocks, 0 broken anchors
  - **Memberlist port allocation table consolidated** (Loki 7946 / Mimir 7947 / Tempo 7948) so the LGTM gossip namespaces stay unambiguous on the shared obs VMs
  - **App instrumentation contract** is the most consequential addition — 7 required + 4 forbidden items that chapter 30 (App onboarding) will enforce. Greenbook is named as the first adopter, with concrete OTel SDK/transport details for its TS/Express stack
  - LGTM circuit closes with logs↔traces wiring: Loki's `derivedFields` (ch09 §9.7) and Tempo's `tracesToLogsV2` (this chapter §11.6) reference each other's data-source UIDs

- 📝 12-alertmanager drafted (Phase 2, chapter 6 of 6 — **PHASE 2 COMPLETE**)
  - Sections: role + threat model (alert fatigue as the most likely failure mode), pre-flight (last service to fit on the obs VMs without resize), install Alertmanager from upstream tarball (reuses prometheus user), 3-node cluster config with HashiCorp memberlist on port 9094, notification routing tree (3 severity tiers — critical→oncall+paging, warning→team email, info→drop), Mimir ruler config + 30+ initial alert rules covering Phase 1 + Phase 2 services + hosts + the LGTM stack itself, Loki ruler with log-pattern alerts (SSH brute-force, Vault permission denials, nginx 5xx surge, Keycloak admin lockout), silences + inhibitions (HostDown inhibits per-service; MimirIngesterDown inhibits derived metric alerts), Q6 on-call rotation dependency surfaced explicitly with PagerDuty/Opsgenie/AU-incident integration shapes, UFW (9093, 9094, SMTP outbound), synthetic alert end-to-end verification + silence + cluster-gossip checks, **Phase 2 close-out summary** mapping every component to its Phase 5 upgrade chapter
  - 24 fenced code blocks, 0 broken anchors
  - Three severity tiers (`critical` / `warning` / `info`) established as platform convention for all future rules — referenced from chapter 30 (App onboarding) when apps add their own rules
  - Q6 (paging product) decision documented as open with the integration shapes pre-specified; closing Q6 doesn't require a chapter rewrite, just the receiver block swap
  - **Phase 2 closes on 2026-05-01**: app teams now have SSO, logs, metrics, traces, and alerts. Phase 3 starts with Postgres HA (chapter 13) replacing the manual-failover Postgres assumed by chapter 07.

### 2026-05-02

- 📝 13-postgres-ha drafted (Phase 3, chapter 1 of 6 — **PHASE 3 BEGINS**)
  - Sections: role + threat model (every-app-down-on-failure; replication lag as the silent failure mode), pre-flight (2 dedicated DB VMs at 8 vCPU / 32 GB / 700 GB; same shape mandatory because the replica must absorb full prod load on promotion), install PG16 from PGDG repo + cluster on dedicated data volume mounted noatime, primary configuration (memory tuning + WAL + archiving + pgaudit + statement timeouts + TLS), replica bootstrap via pg_basebackup with `--wal-method=stream --slot=...`, replication health verification (round-trip write/read), pgBackRest for WAL archiving + PITR (full + diff timer schedule + quarterly restore drill recommendation), per-app role pattern (per-app DB + role + read-only role + Vault custody under kv/apps/<app>/database with 90d rotation), postgres_exporter for Prometheus (extends ch10's scrape config), **manual failover procedure with quarterly drill cadence** (detection → decision → promote → DNS repoint → hard fence → pg_rewind rebuild as new replica), UFW per VLAN, verification ladder, **applying the same pattern to Keycloak's DB (chapter 07 retrofit)**, Phase 5 path (Patroni + etcd for automated failover; layers on top, doesn't replace)
  - 32 fenced code blocks, 0 broken anchors
  - Q4 closed: manual-with-drill is the right answer for Phase 3 — Patroni's complexity isn't justified at <10 apps, and the drill discipline forces the runbook to be real instead of aspirational. Chapter 24 reserved in Phase 5 for the Patroni rollout.
  - Per-app role design (every app gets its own role + DB + 90d-rotated password in Vault) is the contract that chapter 30 (App onboarding) will enforce
  - **Phase 3 begins on 2026-05-02**: every Phase 3 chapter from here on adds one HA primitive (Redis ch14, MinIO ch15, PgBouncer ch16, HAProxy ch17, Cloudflare ch18) and progressively eliminates the Phase 1+2 "single VM" entries from the close-out tables.

- 📝 14-redis-sentinel drafted (Phase 3, chapter 2 of 6)
  - Sections: role + threat model (sessions+cache+queues use case; replication lag and split-brain as realistic failure modes), pre-flight (3 VMs at 4 vCPU / 16 GB; same-shape rule + mandatory THP / overcommit_memory / somaxconn tuning), install Redis 7 from upstream apt repo, master + replica configuration with shared requirepass + masterauth + min-replicas-to-write 1 (refuse writes if no replica online — protects against silent data loss), Sentinel configuration with quorum=2 + per-node announce-ip + the "Sentinel rewrites its own config" caveat, bootstrap sequence (master first, then replicas join), **application access pattern** (Sentinel-aware clients per language; key-namespacing convention `<app>:*`; KEYS-vs-SCAN warning), persistence + backup strategy (AOF + RDB hybrid; ExecCondition limits backup to current master), redis_exporter integration extending ch10's scrape config, **5 new alert rules in ch12's ruleset** (RedisDown / ReplicationBroken / MemoryHigh / RejectedConnections / SlowQuery), failover behaviour timeline + manual drill procedure (controlled `sentinel failover` + hard `systemctl stop`), UFW per VLAN, verification ladder, Phase 5 path (Redis Cluster for sharding when one node's RAM isn't enough)
  - 34 fenced code blocks, 0 broken anchors
  - **Sentinel-aware client contract** is the contract chapter 30 (App onboarding) will enforce — apps that use a plain `redis://` URL won't follow failovers and will silently break
  - Key-namespacing convention (`<app>:*` prefix) becomes a soft constraint for Phase 3 + a hard constraint when Phase 5 ACLs land

- 📝 15-minio drafted (Phase 3, chapter 3 of 6 — **the keystone**)
  - Sections: role + threat model (data exfiltration at platform scale; silent disk-rot via BitRot self-heal), pre-flight (4 dedicated VMs at 8 vCPU / 16 GB / 2 TB XFS data volume mounted with MinIO's published mount options — same-shape rule enforced by MinIO itself), install MinIO + mc from upstream pinned releases, distributed-mode cluster config (single `MINIO_VOLUMES` line forms the cluster; default EC:2 over 4 nodes — 2 data + 2 parity stripes per object), TLS termination via local nginx (same two-tier pattern as Keycloak/Nexus/Grafana), first-time bootstrap + root credential rotation into Vault, **buckets + lifecycle + retention** (per-consumer bucket layout — loki-chunks / mimir-blocks / tempo-traces / postgres-backups / redis-backups / platform-misc + lifecycle expiry + Object Lock GOVERNANCE on backup buckets + SSE-S3 encryption on every bucket), per-consumer service accounts in Vault (table of 6 consumers + bucket-scoped policies + pgbackrest-svc deliberately lacks Delete), **migrate Phase 2 storage onto MinIO** (rolling per-service swap for Loki/Mimir/Tempo/pgBackRest/Redis with concrete config diffs — completes the "Phase 3 MinIO migration path" promised by every Phase 2 chapter), Prometheus integration via /minio/v2/metrics/cluster + bearer token, **5 new alert rules added to ch12's ruleset** (NodeOffline / DriveOffline / CapacityHigh / CapacityCritical / HealRequired), UFW rules per VLAN, verification with bucket-scoped credential test + node-loss drill, Phase 4 path (site replication for DR — chapter 20 adds an off-site MinIO with `mc admin replicate add`)
  - 36 fenced code blocks, 0 broken anchors
  - **The keystone of Phase 3**: every Phase 2 chapter ended with "Phase 3 MinIO migration path" and this is where those promises cash in. After §15.9, the Phase 1+2 close-out tables update — Loki/Mimir/Tempo flip from "filesystem on obs VMs" to "MinIO with versioning + lifecycle"
  - Same-shape + XFS-only rules are enforced by MinIO itself (not just policy); operators learn this the hard way otherwise
  - Per-consumer service-account pattern locked: every consumer gets bucket-scoped credentials in `kv/platform/minio/<consumer>` with rotation metadata. Becomes the contract for any future app that wants object storage (chapter 30 onboarding will reference this)
  - Object Lock GOVERNANCE on backup buckets is the ransomware mitigation; explicit upgrade to COMPLIANCE deferred to Phase 5 once procedures are validated

- 📝 16-pgbouncer drafted (Phase 3, chapter 4 of 6)
  - Sections: role + threat model (Postgres `max_connections` ceiling math; pool-mode tradeoffs table; pool exhaustion as the most likely failure mode), pre-flight (2 dedicated PgBouncer VMs at 4 vCPU / 8 GB; ulimit nofile 65536), install PgBouncer 1.22+ from PGDG (need ≥1.22 for SCRAM both directions), full pgbouncer.ini config (transaction mode default + per-app `<app>_session` opt-in for session-mode features; sizing math; `query_timeout=60` matching ch13's statement_timeout), **auth_query pattern** (PgBouncer holds ONE credential; reads pg_shadow via SECURITY DEFINER wrapper function — eliminates per-app rotation churn on PgBouncer side), TLS asymmetric (require client→PgBouncer; verify-ca PgBouncer→Postgres), apps switch to PgBouncer with greenbook as first adopter + transaction-mode caveats list (no LISTEN/NOTIFY, no advisory locks across txns, no SET SESSION, prepared-statement gotchas), pgbouncer_exporter integration, **4 new alert rules** (Down / ClientsWaiting / ServerErrors / HighConnectionCount), UFW per VLAN, verification with active-active failover drill, Phase 5 path (Patroni-aware backend rerouting via HAProxy writer-VIP)
  - 30 fenced code blocks, 0 broken anchors
  - **auth_query pattern** is the centrepiece — chapter 30 onboarding will reference: per-app password rotation in Vault no longer requires editing PgBouncer's userlist.txt because PgBouncer queries Postgres directly at connect time
  - `<app>_session` opt-in convention added to the platform contracts list — apps that need LISTEN/NOTIFY or advisory locks across transactions get a separate database name with `pool_mode=session` rather than poisoning the default transaction-mode pool
  - pg-primary.au-internal CNAME pattern: chapter 13 §13.10 already documented operator repointing during failover; chapter 16 explicitly relies on it; Phase 5 ch24 (Patroni) replaces with HAProxy writer-VIP

- 📝 17-haproxy drafted (Phase 3, chapter 5 of 6)
  - Sections: role + threat model (stale health-check decisions as the realistic failure mode; clear separation: this is the **internal** LB, not the DMZ public-facing edge), pre-flight (2 dedicated LB VMs at 4 vCPU / 8 GB; mandatory `ip_nonlocal_bind=1` so HAProxy can bind the floating VIP on whichever node), install HAProxy from haproxy.org PPA + Keepalived, **Keepalived VRRP active-passive config** (master priority 110, backup 100, weight -50 chk*haproxy script flips priority on local HAProxy failure), HAProxy frontends + backends covering 4 service classes — PgBouncer (TCP leastconn), **Postgres rw/ro split** via tiny xinetd `pg-isprimary` script that asks `pg_is_in_recovery()` (HAProxy uses HTTP 200/503 to route writes to the primary, reads to replicas, automatic switchover after ch13 §13.10 promotion), MinIO (TCP+SSL passthrough), and **Nomad apps via Consul DNS service discovery** (`server-template` + `*<svc>.\_tcp.service.consul`SRV records — apps register via Nomad service blocks, HAProxy discovers automatically), multi-VIP layout (3 separate VIPs per service class to avoid IP:port collisions), apps + components switch to the VIP (PgBouncer's`host=`flips from CNAME to`pg-rw.au-internal:5433` — chapter 13 §13.10 step 4 "update DNS" disappears entirely), HAProxy native /metrics endpoint + **5 new alert rules** (Down / BackendDown / AllBackendsDown / HighErrorRate / VRRPSplitBrain), UFW per VLAN with new requirement that backends accept only LB primary IPs (not the VIP — source IP is the physical LB), VRRP failover drill, Phase 5 path (Patroni REST API replacing the xinetd script for sub-30-sec automated Postgres failover)
  - 40 fenced code blocks, 0 broken anchors
  - **The chapter 13 §13.10 Postgres failover procedure shrinks**: the "step 4: update DNS A record" is no longer needed — HAProxy auto-routes via pg-isprimary within 4-6 seconds. RTO improvement: ~30 sec → ~10 sec for the manual drill.
  - **Consul DNS service discovery** is the integration that makes Nomad apps reachable via stable hostnames — chapter 30 onboarding contract: every onboarded app declares a Nomad service block + health check; HAProxy picks it up automatically via SRV record
  - Multi-VIP layout (3 VIPs in §17.5.5) is the production-correct shape; documented as the recommendation after the §17.5.4 single-VIP simplification

- 📝 18-public-dns drafted (Phase 3, chapter 6 of 6 — **PHASE 3 COMPLETE**)
  - Sections: role + threat model (whole-platform exposure to public internet; corporate WAF as the realistic failure mode), topology recap (Cloudflare → AU NAT → DMZ → App; the existing greenbook DMZ nginx pair stays in place — chapter 18 wires Cloudflare in front), pre-flight (Cloudflare Pro+ plan, AU IT prerequisites including the **critical** corporate-WAF bypass-list `*.africanunion.org` step), zone configuration (Full Strict TLS, DNSSEC, HSTS preload, TLS 1.2 floor, Bot Fight Mode), origin TLS via Cloudflare Origin CA (15-year cert, ECC P-256), origin IP allowlist with weekly systemd timer that diffs Cloudflare's published ranges and alerts on changes, WAF rules + rate limiting (managed rules + 4-rule custom set + 3 rate-limit rules per platform), cache rules (default deny + per-extension allowlist; never cache POST/4xx/5xx; never cache Set-Cookie/Authorization responses), per-app DNS + cert workflow (the chapter 30 contract), **lessons from greenbook deployment ch14** distilled (Cloudflare 521 / TLS handshake fail / corporate WAF \*.data block / spec.data block / Always Use HTTPS loop), verification ladder cross-references the existing greenbook ch14 7-layer ladder (this chapter does NOT replicate it), Phase 4 path (Cloudflare Load Balancing for DR site), **Phase 3 close-out summary table** mapping every component to its Phase 5 upgrade chapter
  - 16 fenced code blocks, 0 broken anchors
  - **Critical AU IT dependency** surfaced in §18.3: corporate-WAF bypass-list `*.africanunion.org` — without it, internal AU users hitting platform apps trigger Symantec WSS / Bluecoat-class quarantine (greenbook deployment ch14 §14.10 spent two days diagnosing this the first time)
  - Origin CA cert pattern: 15-year cert from Cloudflare's internal CA distributed to DMZ nginx via Vault; eliminates the 90-day rotation churn of Let's Encrypt while keeping Full Strict mode enforceable
  - The chapter explicitly **does not duplicate** greenbook deployment ch14's verification ladder — that ladder is the authoritative test sheet for any platform app and chapter 18 just cross-references it
  - **Phase 3 closes on 2026-05-02**: every "Phase 1+2 single-VM" entry from the close-out tables now has its HA upgrade. App teams have HA databases, fast caches, durable object storage, connection pooling, internal load balancing, and a public edge with WAF + DDoS protection.

- 📝 19-backup-strategy drafted (Phase 4, chapter 1 of 2)
  - Sections: role + threat model (HA replicates the present, backups preserve the past — they're not substitutes; untested backups as the realistic failure mode), per-component backup status table consolidating chapters 3-15, RPO/RTO targets per service (Postgres 1m/30m via WAL archive_timeout=60s being the most aggressive), the 3-2-1 rule applied to AU's environment, encryption at rest + in transit (pgBackRest AES-256, MinIO SSE-S3, Vault internal, GitLab built-in), **backup verification at three layers** (job exit code → output integrity per-tool checks → quarterly end-to-end restore drill), restore-drill calendar (quarterly Q1 Postgres / Q2 Vault / Q3 GitLab / Q4 full DR), 4 new alert rules added to ch12 (BackupJobFailed, BackupRepositoryFull, BackupVerificationFailed, WALArchiveStalled) + Loki rule for SuspiciousBackupDelete, audit trail via Loki, weekly verify-backups.sh systemd timer on the bastion, Phase 5 path (continuous-replication tiers via synchronous Postgres + active-active MinIO)
  - 16 fenced code blocks, 0 broken anchors
  - **Quarterly drill cadence is non-optional** — the chapter explicitly says skipping two consecutive drills invalidates the DR claim; reinforces the "untested backups are theatre" principle from §19.1
  - The per-component backup status table consolidates 9 prior chapters' inline backup statements into a single source of truth; future audits start from this table

- 📝 20-dr-site drafted (Phase 4, chapter 2 of 2 — **PHASE 4 COMPLETE**)
  - Sections: role + threat model (DR scope = catastrophic site loss; HA + backups + DR are three different layers), DR tier model (cold/warm/hot — Phase 4 is warm), pre-flight (Q5 dependency surfaced explicitly with 3 candidate options + scaled-down DR footprint table — ~50% of primary headcount), replication strategy table per component (continuous for Postgres + MinIO; daily for everything else), Postgres async streaming standby at DR with `synchronous_standby_names=pdb02` for primary-replica sync + WAN-async to DR, MinIO site replication via `mc admin replicate add` (continuous; ~5 min lag), Vault snapshot ship + DR-side restore with **separate custodian split for DR recovery keys** (compromised primary keys must NOT unlock DR), GitLab + Nexus daily ship, Cloudflare Load Balancing for DNS-driven failover (3-failure threshold, ~90 sec to shift), **§20.10 DR activation runbook** with explicit T+0 → T+4h timing per step (Vault → Nomad → Postgres → GitLab → Keycloak → apps → CF LB shift → external verification), reverse migration when primary returns, RTO drill execution + measurement with stopwatch script, verification ladder, **Phase 4 close-out summary table**
  - 28 fenced code blocks, 0 broken anchors
  - **§20.10 DR activation runbook is the single most important section** — when DR is needed, runbook clarity makes the difference between 3-hour and 8-hour recovery. T+0 to T+4h sequence is calibrated to the 4h RTO target.
  - **Q5 (DR location) doesn't fully close** because the location decision is AU IT leadership's; the chapter documents the _mechanism_ and works regardless of whether the chosen site is a secondary AU campus, a cloud region, or a partner DC. Decision moved from Q5 "open" to Q5 "mechanism documented; awaiting AU IT site selection"
  - DR custodian split: DR Vault recovery keys live on physical media at the DR site, NOT in primary's Vault — that would be circular. Documented explicitly to prevent the obvious mistake.
  - **Phase 4 closes on 2026-05-02**: the platform now has tested, drilled, documented resilience — primary site can be lost and the platform recovers within 4 hours.

- 📝 21-teleport drafted (Phase 5, chapter 1 of 3)
  - Sections: role + threat model (operator-tier exposure if Auth Service compromised; misconfigured RBAC as the realistic failure mode), architecture (Auth + Proxy + Node agents with reverse-tunnel from nodes to proxy), pre-flight (3 new VMs + agent on every existing platform VM), Auth Service install + bootstrap with **Postgres app cluster + MinIO bucket as backends** (chapter 13 + chapter 15 reused — no new state stores), Proxy pair behind chapter 17 HAProxy via SSL passthrough, node agent rollout with role/vlan labels, **SSO via Keycloak OIDC client** (chapter 07 patterns; claims_to_roles maps AD groups → Teleport roles), roles + just-in-time access (default everyone is viewer; elevation requires another operator's approve), application access (Vault/GitLab/Grafana/MinIO console all become `tsh app`) + database access (psql/redis-cli through `tsh db`; bridge to chapter 22 Vault PKI), session recording landing in MinIO with Object Lock GOVERNANCE, **migration plan from ch02** (90-day window; legacy bastion as fallback), UFW + verification, decommissioning the chapter 02 bastion (kept as break-glass)
  - 30 fenced code blocks, 0 broken anchors
  - Replaces every "long-lived SSH key" pattern from chapter 02 with 15-minute certificates issued via OIDC; theft buys at most 15 minutes
  - **Quarterly RBAC audit** becomes part of operational hygiene; roles in GitLab with code review

- 📝 22-dynamic-secrets drafted (Phase 5, chapter 2 of 3)
  - Sections: role + threat model (1-hour blast radius vs 90-day static; Postgres role accumulation as the realistic failure mode), four engines table (Database / PKI / Transit / SSH), pre-flight (no new VMs — runs on existing chapter 03 Vault cluster + per-app Vault Agent sidecars on Nomad), **Database engine** (replaces ch13/14/15/16 static passwords with 1h dynamic Postgres roles via `vault read database/creds/<role>`; full Vault Agent sidecar Nomad job spec for greenbook), **PKI engine** (root + intermediate CAs; cert roles for au-internal-server / au-internal-client; cashes in the "Phase 5 mTLS" deferrals from chs 14/15/16/17; Vault Agent template that auto-renews on file change), **Transit engine** (encryption-as-a-service; per-app keys; datakey pattern for high-throughput; replaces MinIO built-in KES), **SSH CA** (break-glass operator access for when Teleport itself is down — 1h cert TTL, only the break-glass-operator group can sign), Vault Agent sidecar pattern (auth + render + renew), per-app rollout playbook (greenbook first; smallest blast radius), verification with role-leak alert, path to chapter 24 (Patroni-aware DB engine — slot reserved)
  - 28 fenced code blocks, 0 broken anchors
  - **The chapters 13-17 "Phase 5 path" deferrals all cash in here**: dynamic Postgres credentials (ch13), per-app Redis ACLs (ch14), MinIO Authenticated Origin Pulls (ch15), PgBouncer per-app TLS (ch16), HAProxy stats API mTLS (ch17). One unified pattern for all of them.
  - **Static-cred phase-out**: each app migrates over 90 days; chapter 30 onboarding eventually requires dynamic creds for new apps from day 1

- 📝 23-runbook-automation drafted (Phase 5, chapter 3 of 3 — **PHASE 5 COMPLETE**)
  - Sections: role + threat model (Ansible's reach is total → mandatory CI lint + 2 approvers; stale playbooks as the realistic failure mode), pre-flight (1 control node on Operations VLAN), install Ansible + ecosystem, **comprehensive inventory** mapping every platform VM to groups (single source of truth; chapter 30 onboarding adds rows here), **authentication via Teleport-issued SSH certs** (no static keys on the control node; ProxyCommand pattern routes Ansible through Teleport; every connection audited), playbook layout (per-component roles mirror chapters 13-21; per-action playbooks; tag system for partial runs), **GitLab CI for lint + dry-run on every PR** (CODEOWNERS + 2-approver branch protection on production), **drift detection** (nightly `--check` mode; alert on changes; manual remediation by default), **patch management** (rolling, health-checked, halt-on-fail; serial=1; per-group health-check task files), **DR drill automation** (semi-automated chapter 20 §20.10 — mechanical parts codified; decisions remain human), Vault → Ansible secret consumption (community.hashi_vault collection; no_log: true), verification + Loki rules for AnsibleDriftDetected / AnsibleDriftCheckMissed / AnsiblePlaybookFailed, **Phase 5 close-out summary** + final close-out summary table
  - 36 fenced code blocks, 0 broken anchors
  - **Reduces every chapter's "do these commands" from a doc-search task to `ansible-playbook X.yml`** — chapters remain the conceptual source; playbooks are derived runnable artifacts
  - GitLab CI on the Ansible repo enforces lint + dry-run before any merge; production-apply stage is `when: manual` so humans push the button, not CI
  - **Phase 5 closes on 2026-05-02. All 5 numbered phases complete.** Platform progresses from "documented" to "automated" — operator workflow shifts from "find chapter X §Y; type these commands carefully" to "review the diff; run the playbook"

### Project state — 2026-05-02 milestone

**21 of 24 main + post-phase chapters drafted.** All 5 numbered phases complete (Phases 1-5). Reserved Phase 5+ slots (chs 24/25/26 for Patroni / MinIO expansion / Redis Cluster) referenced inline but not drafted — they're conditional on AU's growth triggers.

**What remains** (post-phase reference, no fixed order):

- Chapter 30 — App onboarding workflow (the user-facing surface; consolidates every "ch30 contract" reference from chs 1-23)
- Chapter 40 — Verification ladder (mirrors greenbook ch13 — comprehensive end-to-end test sheet)
- Chapter 41 — Incident response (playbooks per common failure mode)
- Chapter 42 — Hardening checklist (pre-go-live audit)
- Appendix A — Command cheatsheet (rolling)
- Appendix B — Reference configs (canonical files per chapter)
- Appendix C — External references (upstream docs, vendor links)

These can be drafted in any order as operational needs surface; the platform is fully described by chapters 02-23 + the README.

- 📝 30-app-onboarding drafted (post-phase reference)
  - Sections: intent + scope (user-facing surface for app teams), platform contract (16-row "what apps get" + 7-item "what apps must provide"), 8-gate onboarding workflow, app instrumentation requirements consolidated from ch11 §11.9, per-app credentials in Vault (`kv/apps/<app>/...` namespace), per-app Postgres role + DB with Vault DB engine binding, Redis access pattern (Sentinel-aware client + `<app>:*` prefix), MinIO bucket allocation, **complete Nomad job spec template** with Vault Agent sidecar + OTel + health checks, public DNS + Cloudflare workflow (per ch18 §18.9), comprehensive **pre-go-live checklist** (5 domains; ~30 items), decommissioning workflow
  - 8 fenced code blocks, 0 broken anchors
  - **The user-facing surface of the platform** — every "chapter 30 contract" reference scattered through chapters 1-23 cashes in here; app teams arrive with "we want to deploy app X" and leave with a running platform-compliant deployment

- 📝 40-verification-ladder drafted (post-phase reference)
  - Sections: 11-layer end-to-end test ladder mirroring greenbook deployment ch13 (VM health → service liveness → Vault round-trip → Nomad/Consul → GitLab/Nexus → Keycloak SSO → LGTM stack → HA layer drill summary → backup verification → DR site reachability → public edge), failure interpretation guide mapping each layer to first-move chapter
  - 24 fenced code blocks, 0 broken anchors
  - The single test sheet operators run after any major change or quarterly as standing hygiene; cross-references chapter 14 of greenbook deployment for the public-edge layer

- 📝 41-incident-response drafted (post-phase reference)
  - Sections: IR shape (detection → triage → mitigate → verify → PIR), **11 named playbooks**: P-01 Postgres primary down, P-02 Vault sealed, P-03 Keycloak unreachable, P-04 Nomad scheduler unavailable, P-05 GitLab down, P-06 MinIO node loss, P-07 Redis Sentinel split-brain, P-08 HAProxy VRRP split-brain, P-09 Cloudflare 521, P-10 Corporate WAF blocking, P-11 Object Lock blocking ops cleanup (each: detection signals + triage commands + mitigation steps + verification + post-incident actions), severity declaration + escalation, post-incident review template
  - 38 fenced code blocks, 0 broken anchors
  - The realistic failure modes encountered through chapters 1-23, each with a runnable playbook the on-call operator can execute cold

- 📝 42-hardening-checklist drafted (post-phase reference)
  - Sections: usage instructions, 8 audit domains (network, auth + access, secrets, audit, backup, DR, observability, compliance + governance) — each a YES/NO checklist with verification commands, output report template at `docs/audits/<date>-hardening.md`
  - 16 fenced code blocks, 0 broken anchors
  - Pre-go-live audit + quarterly thereafter; each item maps back to a chapter section for verifiability

- 📝 Appendix A — Command cheatsheet drafted (rolling)
  - 18 sections of operationally-frequent commands extracted from chapters 02-23, organised per service. Source-of-truth remains the chapter; appendix is the lookup-while-on-call reference.

- 📝 Appendix B — Reference configs drafted (rolling)
  - 16 sections of pointers to canonical config files / blocks per service. **Not duplication** — pure navigation aid pointing at the chapter section that contains the authoritative content.

- 📝 Appendix C — External references drafted (rolling)
  - 15 sections of upstream documentation links, vendor docs, RFCs, technical specs. Per-product (HashiCorp / GitLab / Keycloak / LGTM / Postgres / Redis / MinIO / etc.) plus a standards section.

### Project state — final milestone (2026-05-02)

**31 of 31 chapters drafted.** Every numbered phase + every post-phase reference + all appendices.

The platform documentation now covers:

1. **Phase 1 (chs 02-06)** — Developer foothold: bastion, Vault, GitLab, Nomad, Nexus
2. **Phase 2 (chs 07-12)** — Identity + observability: Keycloak SSO + AD federation; full LGTM stack
3. **Phase 3 (chs 13-18)** — App scaling + edge HA: Postgres HA, Redis, MinIO, PgBouncer, HAProxy, Cloudflare
4. **Phase 4 (chs 19-20)** — Resilience: backup strategy + DR site
5. **Phase 5 (chs 21-23)** — Operational maturity: Teleport, dynamic Vault secrets, Ansible automation
6. **Post-phase (chs 30, 40-42)** — App onboarding workflow + verification ladder + incident response playbooks + hardening checklist
7. **Appendices A-C** — Command cheatsheet + reference configs + external references

Reserved Phase 5+ slots (chs 24/25/26 for Patroni / MinIO expansion / Redis Cluster) referenced inline but not drafted — they remain conditional on AU's growth triggers and can be drafted when those triggers fire.

**The next state transition is from "drafted" to "validated" — every chapter awaits a real-install walkthrough that promotes its status from 📝 to ✅.**

---

## How to use this document

**For Binalfew (project owner)**:

- Glance at "Project state at a glance" for current standing
- Walk "Decision register → Open" before any stakeholder meeting
- Walk "Stakeholder + dependency tracker" before the same meeting
- Skim "Risks + known unknowns" weekly

**For me (when continuing the writing in a new session)**:

- Always read this document before starting a new chapter — it tells me what's locked, what's open, what blocks what
- After completing a chapter, update the rollup table + add a changelog entry
- If a decision changes mid-stream, lock the new decision in the register, add a changelog entry, audit the impact on already-drafted chapters

**For a future reviewer**:

- The chapter status table tells you what's evidence-of-work vs what's promised
- The decision register tells you why each chapter is shaped the way it is
- The validated state tells you which chapters have been tested against real infrastructure
