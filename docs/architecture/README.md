# AU Internal Application Platform

**Architecture and operations reference for AU's shared on-premises application platform**
_Living document — describes the platform that hosts greenbook + future AU applications. Distinct from greenbook's own deployment guide ([../deployment/](../deployment/)) which documents one application; this guide documents the platform that hosts many._

Prepared for: **Binalfew** — Senior Solutions & System Architect, MISD / AUC

> **Status**: Early scaffolding (2026-05). Foundation chapters in draft. Phase 1 chapters planned but not yet written. Treat the architecture as proposed; treat the chapter outline as a roadmap, not a contract.

---

## Audience

This guide is for **platform engineers** — the team operating the shared infrastructure that AU applications run on. It assumes:

- Comfort with Linux administration (Ubuntu 24.04, systemd, networking)
- Familiarity with Docker / containers
- Working knowledge of nginx, Postgres, and at least one config-management tool (Ansible / Puppet / Salt)
- Some exposure to HashiCorp tools is helpful but not required — chapters introduce concepts before using them

If you're an **application developer** wanting to deploy a new app onto this platform, skip to [§How to deploy a new app on the platform](#how-to-deploy-a-new-app-on-the-platform) below — most of the architectural detail isn't relevant for that workflow.

---

## Where do I start?

| If you're…                                | Read these, in order                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **New to the platform — orient first**    | [00 — Architecture](00-architecture.md) → [01 — Capacity & sizing](01-capacity-sizing.md)                                                                          |
| **Building Phase 1 (developer foothold)** | [02 — Bastion](02-bastion.md) → [03 — Vault](03-vault.md) → [04 — GitLab CE](04-gitlab.md) → [05 — Nomad cluster](05-nomad-cluster.md) → [06 — Nexus](06-nexus.md) |
| **Adding identity (Phase 2)**             | [07 — Keycloak](07-keycloak.md) → [08 — Keycloak federated to AD](08-keycloak-ad.md)                                                                               |
| **Adding observability (Phase 2)**        | [09 — Loki + Grafana](09-loki.md) → [10 — Prometheus + Mimir](10-prometheus.md) → [11 — Tempo](11-tempo.md) → [12 — Alertmanager](12-alertmanager.md)              |
| **Adding data services (Phase 3)**        | [13 — Postgres HA](13-postgres-ha.md) → [14 — Redis Sentinel](14-redis.md) → [15 — MinIO](15-minio.md) → [16 — PgBouncer](16-pgbouncer.md)                         |
| **Adding edge LB (Phase 3)**              | [17 — HAProxy HA pair](17-haproxy.md) → [18 — Public DNS + Cloudflare](18-cloudflare.md)                                                                           |
| **Wanting resilience / DR (Phase 4)**     | [19 — Backup strategy](19-backups.md) → [20 — DR site](20-dr.md)                                                                                                   |
| **Operational maturity (Phase 5)**        | [21 — Teleport bastion](21-teleport.md) → [22 — Dynamic Vault secrets](22-vault-dynamic.md) → [23 — Runbook automation](23-automation.md)                          |
| **Deploying a new app onto the platform** | [30 — App onboarding workflow](30-app-onboarding.md)                                                                                                               |
| **Verifying the platform end-to-end**     | [40 — Verification ladder](40-verification.md)                                                                                                                     |
| **Investigating a platform incident**     | [41 — Incident response](41-incident.md)                                                                                                                           |
| **Hardening / pre-production review**     | [42 — Hardening checklist](42-hardening.md)                                                                                                                        |

> Most of these chapters are **planned, not yet written**. See [§Chapter status](#chapter-status) for what's drafted vs pending.

---

## Locked decisions

These six decisions bake into every chapter. Re-opening any of them requires a meaningful revision pass; they're locked deliberately so chapters can refer to them as fact.

| #   | Decision area            | Choice                                                                   | Why                                                                                                                                 |
| --- | ------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Container orchestration  | **HashiCorp Nomad**                                                      | Right complexity for AU's scale (10-30 apps); pairs cleanly with Vault + Consul; single-binary install vs k8s' control plane sprawl |
| 2   | Identity                 | **Keycloak federated to AU AD/LDAP**                                     | Single source of truth for user lifecycle; SSO across all platform services; no parallel identity store                             |
| 3   | VCS + CI/CD              | **GitLab CE** (bundled VCS + CI + container registry + package registry) | One product, one Keycloak SSO, one ACL model — operational simplicity outweighs the "one big VM" cost                               |
| 4   | Observability stack      | **LGTM** (Loki + Grafana + Tempo + Mimir) + Alertmanager                 | Modern unified stack from Grafana Labs; cheaper storage than Elastic; replaces the older Graylog-only plan                          |
| 5   | Service discovery + mesh | **HashiCorp Consul** (paired with Nomad)                                 | Native Nomad integration; lightweight DNS-based service discovery; mTLS optional (Connect) when needed                              |
| 6   | Network segmentation     | **6 VLANs** (DMZ / App / Data / Platform / Operations / Management)      | Blast-radius reduction; explicit firewall rules between tiers; no transitive trust                                                  |

The full rationale for each choice — including alternatives considered and rejected — lives in [00 — Architecture §0.4](00-architecture.md).

---

## Architecture at a glance

```
                     ┌────────────────────────────────────────────────────────┐
                     │  Public                                                │
                     │   Cloudflare (CDN + WAF + edge TLS)                    │
                     └──────────────────────────┬─────────────────────────────┘
                                                │
                     ┌──────────────────────────┴─────────────────────────────┐
                     │  VLAN 1 — DMZ                                          │
                     │   HAProxy active-active pair (origin TLS terminator)   │
                     └──────────────────────────┬─────────────────────────────┘
                                                │
   ┌────────────────────────────────────────────┴──────────────────────────────┐
   │  Internal network                                                          │
   │                                                                            │
   │  VLAN 2 — App                       VLAN 3 — Data                          │
   │   Nomad clients                      Postgres primary + replica            │
   │   Per-app workloads (containers)     PgBouncer pool                        │
   │                                      Redis (Sentinel)                      │
   │                                      MinIO (S3-compatible)                 │
   │                                                                            │
   │  VLAN 4 — Platform                                                         │
   │   Nomad servers (3)                  Keycloak HA (2)                       │
   │   Consul servers (3)                 GitLab CE                             │
   │   Vault HA (3)                       Nexus                                 │
   │   Loki + Mimir + Tempo (3)           Grafana + Alertmanager                │
   │                                                                            │
   │  VLAN 5 — Operations                                                       │
   │   Bastion / Teleport (2 nodes, active/passive)                             │
   │   Ansible control node                                                     │
   │   Backup orchestration                                                     │
   │                                                                            │
   │  VLAN 6 — Management (out-of-band)                                         │
   │   IPMI / hypervisor management (operator workstations only)                │
   └───────────────────────────────────────────────────────────────────────────┘
```

The full diagram with IP allocations, per-tier firewall rules, and traffic flows is in [00 — Architecture §0.2](00-architecture.md).

---

## Phased rollout

The platform is built in five phases. Each phase produces independently-useful infrastructure; you can stop at any phase and have a working subset.

| Phase | Months | Goal                         | Components delivered                                                                                   |
| ----- | ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1     | 0-2    | **Developer foothold**       | Bastion, Vault (KV), GitLab CE, Nomad cluster, Nexus                                                   |
| 2     | 2-4    | **Identity + observability** | Keycloak (federated to AD), LGTM stack, Alertmanager                                                   |
| 3     | 4-6    | **App scaling + edge HA**    | HAProxy LB pair, Redis (Sentinel), Postgres replica, PgBouncer, MinIO, multi-VM app deployment pattern |
| 4     | 6-9    | **Resilience**               | Backup strategy + offsite replication, DR site, paging integration, runbook bootstrap                  |
| 5     | 9-12   | **Operational maturity**     | Teleport (session recording, RBAC), Vault dynamic secrets, runbook automation, capacity planning       |

Total elapsed time: ~12 months, assuming a small dedicated platform team (2-3 engineers). Compressible to ~6 months with a larger team or extension to 18+ months with part-time staffing.

---

## How to deploy a new app on the platform

Once the platform is operational (Phase 1+ complete), onboarding a new application is roughly:

1. **Source**: app team requests a GitLab project; platform provisions with standard branch protection + CI templates
2. **Build**: GitLab CI pipelines build container images, push to GitLab Container Registry (or Nexus for non-Docker artefacts)
3. **Secrets**: app's secrets (DB creds, API keys) live in Vault; Nomad reads them at job-launch time
4. **Deploy**: app team submits a Nomad job spec via GitLab CI; Nomad schedules across App-VLAN clients
5. **Discovery + LB**: Consul registers the service; HAProxy at the DMZ proxies the public hostname to the Consul-discovered backends
6. **Observe**: app emits structured logs (pino / similar) → Loki; metrics → Mimir; traces → Tempo; everything visible in Grafana

The full per-app onboarding chapter is [30 — App onboarding](30-app-onboarding.md).

> **ℹ Greenbook reference deployment**
>
> The existing greenbook deployment (under [../deployment/](../deployment/)) was the proof-of-concept that validated the deployment shape. Once Phase 1-3 of this platform are running, greenbook will be migrated to run on the platform — its current single-VM-per-tier architecture replaced by Nomad-scheduled containers with shared platform services. The greenbook deployment guide will then be archived as a historical reference.

---

## Chapter status

Legend: ✅ done · 🚧 drafting · 📋 planned · _italic_ = stub only

| Chapter                          | Phase | Status      |
| -------------------------------- | ----- | ----------- |
| README (this file)               | —     | 🚧 drafting |
| 00 — Architecture                | —     | 📝 drafted  |
| 01 — Capacity & sizing           | —     | 🔒 stub     |
| 02 — Bastion                     | 1     | 📝 drafted  |
| 03 — Vault                       | 1     | 📝 drafted  |
| 04 — GitLab CE                   | 1     | 📝 drafted  |
| 05 — Nomad cluster               | 1     | 📝 drafted  |
| 06 — Nexus                       | 1     | 📝 drafted  |
| 07 — Keycloak                    | 2     | 📝 drafted  |
| 08 — Keycloak federated to AD    | 2     | 📝 drafted  |
| 09 — Loki + Grafana              | 2     | 📝 drafted  |
| 10 — Prometheus + Mimir          | 2     | 📝 drafted  |
| 11 — Tempo                       | 2     | 📝 drafted  |
| 12 — Alertmanager                | 2     | 📝 drafted  |
| 13 — Postgres HA                 | 3     | 📝 drafted  |
| 14 — Redis Sentinel              | 3     | 📝 drafted  |
| 15 — MinIO                       | 3     | 📝 drafted  |
| 16 — PgBouncer                   | 3     | 📝 drafted  |
| 17 — HAProxy HA pair             | 3     | 📋 planned  |
| 18 — Public DNS + Cloudflare     | 3     | 📋 planned  |
| 19 — Backup strategy             | 4     | 📋 planned  |
| 20 — DR site                     | 4     | 📋 planned  |
| 21 — Teleport bastion            | 5     | 📋 planned  |
| 22 — Dynamic Vault secrets       | 5     | 📋 planned  |
| 23 — Runbook automation          | 5     | 📋 planned  |
| 30 — App onboarding workflow     | post  | 📋 planned  |
| 40 — Verification ladder         | post  | 📋 planned  |
| 41 — Incident response           | post  | 📋 planned  |
| 42 — Hardening checklist         | post  | 📋 planned  |
| Appendix A — Command cheatsheet  | —     | 📋 planned  |
| Appendix B — Reference configs   | —     | 📋 planned  |
| Appendix C — External references | —     | 📋 planned  |

---

## Glossary

| Term                | Meaning                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------- |
| **Platform tier**   | Shared infrastructure services (Vault, Keycloak, GitLab, observability) used by every app    |
| **App tier**        | Per-application workloads — Nomad clients running containers                                 |
| **Data tier**       | Stateful services: Postgres, Redis, MinIO                                                    |
| **DMZ**             | Demilitarised zone — public-facing tier; only host with internet exposure                    |
| **Operations tier** | Bastion, Ansible control node, backup orchestration — operator-only access                   |
| **Management tier** | Out-of-band hardware management (IPMI, hypervisor) — most isolated VLAN                      |
| **App onboarding**  | The process of bringing a new application onto the platform; documented in chapter 30        |
| **Phase N**         | A discrete delivery milestone of the platform (Phase 1-5); each produces working subset      |
| **Nomad client**    | A worker node in a Nomad cluster — runs containers/jobs scheduled by Nomad servers           |
| **Nomad server**    | A control-plane node for the Nomad cluster — schedules workloads onto clients                |
| **Consul service**  | A registered backend in Consul's catalog; HAProxy/Nomad use Consul DNS to discover instances |

---

## Document conventions

- **VM hostnames** follow AU's existing convention (`auishqos<role><instance>`)
- **Internal IPs** use the AU VLAN allocations defined in [00 §0.3](00-architecture.md)
- **Code examples** are annotated with `# [hostname]` headers indicating where each command runs
- **Cross-references** are always relative paths (e.g., `[Vault](03-vault.md)`)
- **Status callouts** use ℹ (informational), ⚠ (warning), ✓ (success/checkpoint)
- **Time estimates** in chapter headers are first-time-doing-it estimates, not "you've-done-this-100-times" times

---

## Versioning

This document tracks the platform as it evolves. There is **no separate version number** — git is the version history. Each chapter has a `Last validated:` timestamp in its header that gets updated when the chapter's commands are re-run end-to-end against a clean install.

---
