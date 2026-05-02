# 42 — Hardening checklist

> **Phase**: post-phase reference · **Run on**: pre-go-live audit + quarterly thereafter · **Time**: ~4 hours per audit
>
> Pre-go-live security + operational audit. A long checklist organised by domain. Every item maps back to a chapter section so an auditor can verify both the documentation and the live state. Run by the platform team before declaring the platform production-ready, and quarterly thereafter.

---

## Contents

- [§42.1 How to use this checklist](#421-how-to-use-this-checklist)
- [§42.2 Network](#422-network)
- [§42.3 Authentication + access](#423-authentication-access)
- [§42.4 Secrets](#424-secrets)
- [§42.5 Audit](#425-audit)
- [§42.6 Backup](#426-backup)
- [§42.7 DR](#427-dr)
- [§42.8 Observability](#428-observability)
- [§42.9 Compliance + governance](#429-compliance-governance)
- [§42.10 Output: the audit report](#4210-output-the-audit-report)

## 42. Hardening checklist

### 42.1 How to use this checklist

Each item is a YES/NO question. Answer NO and you have an action item. Answer YES only with verifiable evidence — not "we think we did this," but "I just ran the command and the output confirmed it."

The auditor (platform team lead or external) walks the checklist with the on-call engineer. Both initial each item. The output report (§42.10) is filed in GitLab under `docs/audits/<date>-hardening.md`.

### 42.2 Network

- [ ] Six VLANs defined with appropriate purpose and isolation per chapter 00 §0.3 (DMZ, App, Data, Platform, Operations, Management)
- [ ] UFW configured on every VM with default-deny inbound; per-chapter-specific allow rules in place
- [ ] No service binds 0.0.0.0 unless documented as intended (chapter 03 Vault, chapter 17 HAProxy VIP, chapter 18 Cloudflare-fronted services)
- [ ] DMZ tier accepts only Cloudflare IP ranges per chapter 18 §18.6; weekly refresh-cf-ips timer is active
- [ ] AU perimeter NAT forwards only ports 443 + 80 to DMZ (no SSH on public IP, no admin ports)
- [ ] Internal-only services use `*.au-internal` DNS; public services use `*.africanunion.org`
- [ ] Cloudflare DNSSEC enabled on `africanunion.org`
- [ ] Registrar registry lock applied to `africanunion.org`
- [ ] `ip_forward = 0` on every host except routers (verify: `sysctl net.ipv4.ip_forward`)
- [ ] No SSH access to platform VMs except via Teleport (chapter 21) or break-glass bastion (chapter 02)
- [ ] No services bound to public IP without WAF in front

**Verification:**

```bash
# Iterate every host; confirm UFW status enabled
$ for h in $(ansible-inventory -i au-platform.yml --list | jq -r '.. | objects | .ansible_host? // empty'); do
    ssh $h 'sudo ufw status | head -1'
  done
# Expected: every line "Status: active"
```

### 42.3 Authentication + access

- [ ] All operator access goes through Teleport (chapter 21); legacy bastion is break-glass only
- [ ] MFA (WebAuthn) enforced on Teleport login
- [ ] All app authentication goes through Keycloak SSO (chapter 07-08)
- [ ] AD federation uses LDAPS (port 636), READ_ONLY edit mode (chapter 08 §8.3)
- [ ] Per-app OIDC clients have unique client secrets stored in Vault
- [ ] Vault root token revoked after operator-token issuance (chapter 03 §3.7)
- [ ] Vault unseal keys split among 5 distinct custodians; quorum=3
- [ ] DR Vault recovery keys are separate from primary (chapter 20 §20.7)
- [ ] No SSH password authentication (`PasswordAuthentication no` in sshd_config) anywhere
- [ ] No SSH root login (`PermitRootLogin no`) except on locked-down break-glass paths
- [ ] No long-lived SSH keys in `/home/*/.ssh/authorized_keys` outside the break-glass account
- [ ] Vault PKI engine issues mTLS certs for app-to-backend (chapter 22 §22.5) where required
- [ ] Vault Database engine issues per-session Postgres credentials (chapter 22 §22.4)
- [ ] All static rotated credentials have rotation_period_days metadata in Vault; nothing >365 days
- [ ] Per-app Postgres roles cannot SUPERUSER, BYPASSRLS, or REPLICATION

**Verification:**

```bash
# Vault: unsealed; HA active; audit enabled
$ vault status
$ vault audit list

# Postgres: no SUPERUSER outside of postgres + vault_admin
$ ssh auishqosrpdb01 "sudo -u postgres psql -c \"
  SELECT rolname FROM pg_roles WHERE rolsuper = true OR rolbypassrls = true;\""
# Expected: postgres; vault_admin (chapter 22)

# Teleport: all operators using SSO; no local accounts
$ tctl users ls --format=json | jq '.[] | select(.spec.created_by != "<oidc>")'
# Expected: only the break-glass admin account (if any)
```

### 42.4 Secrets

- [ ] Every component's secrets stored in Vault (no plaintext in GitLab, config files, environment variables checked into git)
- [ ] Vault Audit device enabled; audit log streams to Loki
- [ ] Vault Raft snapshots taken hourly; ship to MinIO via systemd timer (chapter 03 §3.10)
- [ ] Per-app namespace under `kv/apps/<app>/` for static secrets
- [ ] Per-platform-component namespace under `kv/platform/<service>/` for infrastructure secrets
- [ ] All app-tier consumption via Vault Agent sidecar (chapter 22 §22.8) — no `vault read` in app code
- [ ] Vault tokens have TTL ≤ 1 hour; renewable but not infinitely
- [ ] Encryption-at-rest on every persistent volume holding sensitive data:
  - Postgres: pgBackRest repo with AES-256 (chapter 19 §19.5)
  - MinIO: SSE-S3 (or Vault Transit-backed) on every bucket (chapter 15 §15.7)
  - GitLab: built-in encryption per chapter 04
- [ ] TLS 1.2+ on every internal service (no plaintext on the wire)
- [ ] AU wildcard cert + Cloudflare Origin CA cert distributed only to relevant DMZ + service VMs
- [ ] Cloudflare API tokens scoped to single zone; rotated every 90 days

**Verification:**

```bash
# Vault audit device active
$ vault audit list
# Expected: file device on /var/log/vault/audit.log

# All KV entries have rotation metadata
$ vault kv list -format=json kv/ | jq -r '.[]' | while read p; do
    LAST=$(vault kv metadata get -format=json $p 2>/dev/null | jq -r '.data.custom_metadata.rotated_at // "MISSING"')
    [ "$LAST" = "MISSING" ] && echo "MISSING ROTATION: $p"
  done
# Expected: empty output
```

### 42.5 Audit

- [ ] Centralised logs in Loki with 30-day retention (chapter 09); Promtail on every platform VM
- [ ] Vault audit log forwarded to Loki
- [ ] Postgres pgaudit enabled with `log = 'role,ddl,write'` (chapter 13 §13.4)
- [ ] Keycloak admin events + login events streamed to Loki
- [ ] MinIO audit-webhook to Loki (chapter 15 §15.6)
- [ ] Teleport session recordings in MinIO with Object Lock GOVERNANCE 90d (chapter 21 §21.4)
- [ ] auditd configured per chapter 02 §2.7 on every Linux host
- [ ] GitLab Audit Events streamed (Premium-only feature; CE has limited audit)
- [ ] All admin UIs accessed via Teleport `tsh app` for protocol-level audit (chapter 21 §21.9)
- [ ] Quarterly access-review exercise: every operator's roles + active sessions reviewed

**Verification:**

```bash
# Loki has events from every expected source
$ for src in vault postgres keycloak minio nginx; do
    COUNT=$(logcli query "{role=\"$src\"}" --quiet --limit 1 --since 1h 2>/dev/null | wc -l)
    [ "$COUNT" -lt 1 ] && echo "MISSING LOGS: $src"
  done

# Teleport recordings exist for the past week
$ mc ls --recursive au-platform/teleport-recordings/ | head -5
# Expected: files from within last 7 days
```

### 42.6 Backup

- [ ] Every persistent component has a documented backup mechanism (chapter 19 §19.2)
- [ ] RPO targets per service documented and met (chapter 19 §19.3)
- [ ] 3-2-1 rule satisfied: 3 copies, 2 media, 1 off-site (chapter 19 §19.4)
- [ ] Backup verification three layers active (chapter 19 §19.6) — job exit code, output integrity, restore drill
- [ ] Quarterly restore drills documented in `docs/runbooks/restore-drills/` (chapter 19 §19.7)
- [ ] Most recent restore drill within 90 days for each component
- [ ] Object Lock GOVERNANCE on backup buckets in MinIO (chapter 15 §15.7)
- [ ] Backup encryption keys (pgBackRest cipher-pass) in Vault with rotation metadata
- [ ] Backup-failure alerts in Alertmanager (chapter 19 §19.8)
- [ ] Weekly `verify-backups.sh` systemd timer active on bastion

**Verification:**

```bash
# Recent restore drill artifacts
$ for c in postgres vault gitlab redis; do
    ls -t docs/runbooks/restore-drills/*-$c.md 2>/dev/null | head -1
  done
# Expected: each within 90 days
```

### 42.7 DR

- [ ] DR site exists and is reachable from primary's operator network (chapter 20)
- [ ] DR Postgres async streaming standby is current (lag < 60s) (chapter 20 §20.5)
- [ ] MinIO site replication healthy (queue < 1000) (chapter 20 §20.6)
- [ ] DR Vault recovery keys split between separate custodians from primary's set (chapter 20 §20.7)
- [ ] Cloudflare Load Balancing pool for both origins is configured + monitored (chapter 20 §20.9)
- [ ] DR activation runbook documented step-by-step (chapter 20 §20.10) with T+0 → T+4h timing
- [ ] Quarterly DR drill executed; latest within 90 days; landing within RTO target
- [ ] Drill reports archived in `docs/runbooks/dr-drills/` with timing per step
- [ ] Reverse migration procedure documented (when primary returns)

**Verification:**

```bash
# DR replication metrics
$ ssh dr-pdb01 "sudo -u postgres psql -tAc \"
  SELECT extract(epoch from now() - pg_last_xact_replay_timestamp())\""
# Expected: < 60

$ mc admin replicate status au-platform | jq '.metrics.queued'
# Expected: < 1000
```

### 42.8 Observability

- [ ] LGTM stack fully deployed (chapters 09-12); all 4 components healthy
- [ ] Prometheus scrapes every platform component (chapter 10 §10.7)
- [ ] node_exporter on every platform VM (chapter 10 §10.8)
- [ ] Mimir 90-day retention; Tempo 14-day retention; Loki 30-day retention
- [ ] Grafana dashboards provisioned via files (chapter 09 §9.10) — not click-ops
- [ ] Alertmanager 3-node cluster with VRRP-style gossip (chapter 12 §12.4)
- [ ] All severity-critical alerts route to on-call email DL + paging webhook
- [ ] Severity tiers documented (chapter 12 §12.5): critical / warning / info
- [ ] Per-component alerts cover the realistic failure modes from chapter 41 playbooks
- [ ] Synthetic alert end-to-end test passes (chapter 12 §12.11)
- [ ] Loki ↔ Tempo correlation works (click traceId in log → land in trace) (chapter 11 §11.7)

**Verification:**

```bash
# All ruler groups loaded
$ ssh auishqosrobs01 "curl -s http://127.0.0.1:9009/ruler/rule_groups | jq '.[] | .name'"
# Expected: vault, nomad-consul, gitlab-nexus, keycloak, postgres, observability,
#           hosts, redis, minio, pgbouncer, haproxy, backups
```

### 42.9 Compliance + governance

- [ ] Locked decisions register up-to-date (PLAN.md decision register)
- [ ] Open questions Q1-Q6 status reviewed; closed where mechanism is documented
- [ ] All chapter sections "Phase 5 deliberate non-goals" reviewed against current AU posture
- [ ] PR + code-review workflow on the platform repo; CODEOWNERS in effect
- [ ] CI runs ansible-lint + yamllint + dry-run on every PR (chapter 23 §23.7)
- [ ] Quarterly RBAC audit (Teleport roles) executed
- [ ] Quarterly secret-rotation audit (every Vault path's `rotated_at` within its declared period)
- [ ] Quarterly chapter audit: which chapters are stale? Which are validated against real install?
- [ ] Stakeholder dependencies (PLAN.md tracker) reviewed; no overdue items
- [ ] Incident response playbooks (chapter 41) cover the realistic failure modes for current Phase
- [ ] Post-incident reviews filed for every SEV-1/SEV-2 in `docs/runbooks/incidents/`

**Verification:**

- Walk PLAN.md "Decision register" + "Stakeholder + dependency tracker" with the platform team lead
- Confirm dates on the most-recent quarterly audit reports

### 42.10 Output: the audit report

Each audit produces a single Markdown file at `docs/audits/<date>-hardening.md`:

```markdown
# Hardening audit — <date>

**Auditors:** <names>
**Auditees:** <on-call engineer + platform team lead>
**Scope:** <e.g., pre-go-live; quarterly Q3>

## Summary

- Total items: 80
- PASS: 76
- FAIL: 3
- N/A: 1

## Failures

| Section       | Item                                                                     | Cause                       | Owner              | Due date   |
| ------------- | ------------------------------------------------------------------------ | --------------------------- | ------------------ | ---------- |
| §42.4 Secrets | Vault rotation_period_days missing on `kv/platform/cloudflare/api_token` | new path not yet annotated  | platform team      | 2026-05-09 |
| §42.6 Backup  | Vault snapshot timer last successful 5 days ago                          | timer disabled accidentally | sre on-call        | 2026-05-03 |
| §42.7 DR      | DR drill last run 92 days ago                                            | scheduling slip             | platform team lead | 2026-05-15 |

## Improvements identified (no failure)

- §42.8 Observability: Tempo dashboard provisioning gap — manual import only

## Sign-off

- Auditor: <name> ******\_******
- Auditee: <name> ******\_******
```

The report is committed to GitLab. Open issues are created per failure with the due dates above; the next audit checks they were resolved.

---
