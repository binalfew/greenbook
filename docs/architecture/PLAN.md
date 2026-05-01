# PLAN — AU Internal Application Platform Documentation

> **Owner**: Binalfew Kassa (Senior Solutions & System Architect, MISD / AUC)
> **Author**: this is the working tracker for the doc-writing project
> **Status**: 🚧 Phase 1 in progress
> **Last updated**: 2026-05-01 (chapter 05 drafted)

This is the living tracker for the platform documentation effort. Updated after every chapter completion, every decision change, and every dependency unlock. The README's chapter-status table is a public-facing summary; **this doc is the source of truth** for what's been done, what's blocked, and what's next.

---

## Summary

Document AU's internal application platform — the long-term home for greenbook + N future apps — as a complete operations reference. Mirrors the depth, structure, and verification rigour of `docs/deployment/` (greenbook's own deployment guide), but at the platform tier rather than per-app. Target output: ~25-30 chapters across 5 delivery phases over 12 months.

Anchored on six locked decisions (Nomad / Keycloak+AD / GitLab CE / LGTM / Consul / 6 VLANs) — see [README §Locked decisions](README.md#locked-decisions). Every chapter assumes those decisions hold.

---

## Project state at a glance

| Metric                                  | Value                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| Phase                                   | 1 of 5                                                                         |
| Chapters drafted                        | 6 (README, 00-architecture, 02-bastion, 03-vault, 04-gitlab, 05-nomad-cluster) |
| Chapters stubbed                        | 1 (01-capacity-sizing)                                                         |
| Chapters planned                        | ~24                                                                            |
| Locked decisions                        | 6 / 6                                                                          |
| Decisions awaiting stakeholder sign-off | 6 (full list below)                                                            |
| External dependencies blocked           | 0                                                                              |

---

## Phase summary

| Phase | Goal                                | Months  | Status         | Chapters in scope                |
| ----- | ----------------------------------- | ------- | -------------- | -------------------------------- |
| 1     | Developer foothold                  | 0-2     | 🚧 in progress | 02, 03, 04, 05, 06               |
| 2     | Identity + observability            | 2-4     | 📋 planned     | 07, 08, 09, 10, 11, 12           |
| 3     | App scaling + edge HA               | 4-6     | 📋 planned     | 13, 14, 15, 16, 17, 18           |
| 4     | Resilience                          | 6-9     | 📋 planned     | 19, 20                           |
| 5     | Operational maturity                | 9-12    | 📋 planned     | 21, 22, 23                       |
| post  | Operational reference (cross-phase) | rolling | 📋 planned     | 30, 40, 41, 42, appendices A/B/C |

---

## Chapter rollup

Legend: ✅ validated · 📝 drafted (review pending) · 🚧 drafting · 📋 planned · 🔒 stub only

| #   | Title                    | Phase | Status | Drafted    | Reviewed by | Validated against real install | Notes                                                            |
| --- | ------------------------ | ----- | ------ | ---------- | ----------- | ------------------------------ | ---------------------------------------------------------------- |
| —   | README                   | —     | 📝     | 2026-05-01 | —           | n/a                            | Living document; no validation step                              |
| 00  | Architecture             | —     | 📝     | 2026-05-01 | —           | n/a                            | Reference; commands deferred to 02-23                            |
| 01  | Capacity & sizing        | —     | 🔒     | 2026-05-01 | —           | n/a                            | Phase-1 sizing only; rest TBD                                    |
| 02  | Bastion                  | 1     | 📝     | 2026-05-01 | —           | —                              | Phase 1 simple bastion; Teleport in 21                           |
| 03  | Vault                    | 1     | 📝     | 2026-05-01 | —           | —                              | 3-node Raft HA; KV v2; Shamir unseal                             |
| 04  | GitLab CE                | 1     | 📝     | 2026-05-01 | —           | —                              | Single VM (CE limit); backup-driven HA                           |
| 05  | Nomad cluster            | 1     | 📝     | 2026-05-01 | —           | —                              | 3 servers + 3 clients; Consul colocated; mTLS + ACLs + Vault JWT |
| 06  | Nexus                    | 1     | 📋     | —          | —           | —                              | NEXT TO DRAFT (final Phase 1 chapter)                            |
| 07  | Keycloak                 | 2     | 📋     | —          | —           | —                              | standalone first, AD-federated next                              |
| 08  | Keycloak federated to AD | 2     | 📋     | —          | —           | —                              | depends on AU IT AD/LDAP access                                  |
| 09  | Loki + Grafana           | 2     | 📋     | —          | —           | —                              | observability foundation                                         |
| 10  | Prometheus + Mimir       | 2     | 📋     | —          | —           | —                              | depends on 09                                                    |
| 11  | Tempo                    | 2     | 📋     | —          | —           | —                              | depends on 09                                                    |
| 12  | Alertmanager             | 2     | 📋     | —          | —           | —                              | depends on 10                                                    |
| 13  | Postgres HA              | 3     | 📋     | —          | —           | —                              | streaming replication; PITR                                      |
| 14  | Redis Sentinel           | 3     | 📋     | —          | —           | —                              | 3-node Sentinel pattern                                          |
| 15  | MinIO                    | 3     | 📋     | —          | —           | —                              | erasure-coded set ≥4 nodes                                       |
| 16  | PgBouncer                | 3     | 📋     | —          | —           | —                              | depends on 13                                                    |
| 17  | HAProxy HA pair          | 3     | 📋     | —          | —           | —                              | active-active VRRP                                               |
| 18  | Public DNS + Cloudflare  | 3     | 📋     | —          | —           | —                              | folds in greenbook ch14 learnings                                |
| 19  | Backup strategy          | 4     | 📋     | —          | —           | —                              | RPO ≤ 1h target                                                  |
| 20  | DR site                  | 4     | 📋     | —          | —           | —                              | RTO ≤ 4h target                                                  |
| 21  | Teleport bastion         | 5     | 📋     | —          | —           | —                              | upgrade from chapter 02 simple bastion                           |
| 22  | Dynamic Vault secrets    | 5     | 📋     | —          | —           | —                              | upgrade from chapter 03 KV-only                                  |
| 23  | Runbook automation       | 5     | 📋     | —          | —           | —                              | Ansible playbooks for routine ops                                |
| 30  | App onboarding workflow  | post  | 📋     | —          | —           | —                              | the user-facing surface                                          |
| 40  | Verification ladder      | post  | 📋     | —          | —           | —                              | mirrors greenbook ch13                                           |
| 41  | Incident response        | post  | 📋     | —          | —           | —                              | playbooks per common failure mode                                |
| 42  | Hardening checklist      | post  | 📋     | —          | —           | —                              | pre-go-live audit                                                |
| A   | Command cheatsheet       | —     | 📋     | —          | —           | —                              | append rolling                                                   |
| B   | Reference configs        | —     | 📋     | —          | —           | —                              | canonical files per chapter                                      |
| C   | External references      | —     | 📋     | —          | —           | —                              | upstream docs, vendor links                                      |

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

| #   | Question                                                                               | Blocking which chapter | Notes                                                                         |
| --- | -------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| Q1  | Hypervisor capacity confirmed for Phase 1 (~13 VMs, ~30 vCPU, ~88 GB RAM, ~3 TB)?      | 02-06 (provisioning)   | Need AU IT confirmation before any chapter directs operators to provision VMs |
| Q2  | VLAN allocation approved (172.16.177.0/24 DMZ; 10.111.{10,20,30,40,99}.0/24 internal)? | 02-06                  | Need network team's blessing on subnet plan                                   |
| Q3  | AU AD/LDAP read-only service account for Keycloak available?                           | 08                     | Phase 2 dependency; needs security review                                     |
| Q4  | Manual Postgres failover (Phase 1) acceptable, or do we need Patroni from day one?     | 13                     | Phase 3 question; defer until Phase 3 starts                                  |
| Q5  | Off-site DR location confirmed?                                                        | 19, 20                 | Phase 4 question                                                              |
| Q6  | Paging integration target: Opsgenie? PagerDuty? AU's existing incident system?         | 12                     | Phase 2 question                                                              |

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

### 2026-05-XX (next planned)

- 🚧 → 📝 06-nexus drafting begins (Phase 1, chapter 5 of 5 — last in Phase 1)

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
