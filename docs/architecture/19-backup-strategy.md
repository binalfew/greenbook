# 19 — Backup strategy

> **Phase**: 4 (resilience) · **Run on**: each component VM (orchestration via existing systemd timers + an aggregator on the bastion) · **Time**: ~3 hours to consolidate; quarterly drill cadence
>
> Unified backup strategy across the platform. Phases 1-3 introduced per-component backups in passing (Vault snapshots, gitlab-rake, pgBackRest, Redis BGSAVE, etc.); this chapter ties them into a single orchestrated view with RPO/RTO targets, the 3-2-1 rule applied, restore-drill cadence, and verification that's not just "did it run" but "can it actually restore."
>
> Phase 4 chapter 1 of 2.
>
> **Prev**: [18 — Public DNS + Cloudflare](18-public-dns.md) — _closes Phase 3_ · **Next**: [20 — DR site](20-dr-site.md) · **Index**: [README](README.md)

---

## Contents

- [§19.1 Role + threat model](#191-role-threat-model)
- [§19.2 Per-component backup status (consolidated)](#192-per-component-backup-status-consolidated)
- [§19.3 RPO + RTO targets per service](#193-rpo-rto-targets-per-service)
- [§19.4 The 3-2-1 rule applied to AU](#194-the-3-2-1-rule-applied-to-au)
- [§19.5 Encryption — at rest + in transit](#195-encryption-at-rest-in-transit)
- [§19.6 Backup verification (not just "did it run")](#196-backup-verification-not-just-did-it-run)
- [§19.7 Restore-drill calendar](#197-restore-drill-calendar)
- [§19.8 Backup-specific alerts (extends ch12 ruleset)](#198-backup-specific-alerts-extends-ch12-ruleset)
- [§19.9 Backup audit trail](#199-backup-audit-trail)
- [§19.10 Verification](#1910-verification)
- [§19.11 Phase 5 path (continuous-replication tiers)](#1911-phase-5-path-continuous-replication-tiers)

## 19. Backup strategy

### 19.1 Role + threat model

Backups protect against three failure classes that **HA does not cover**:

1. **Data loss** — accidental delete, bad migration, app-level corruption that replicates faithfully across HA nodes.
2. **Ransomware / malicious deletion** — an attacker with write access uses HA as their friend (changes propagate everywhere).
3. **Catastrophic site loss** — DC fire, hypervisor cluster loss, network isolation. Chapter 20 covers DR; chapter 19 's backups are the substrate that makes DR possible.

HA replicates the present; backups preserve the past. They're not substitutes.

Three consequences:

1. **Compromise = ability to read every backup.** Backup repos hold complete copies of every database, every secret rotation history, every config. Defence: per-consumer service accounts with bucket-scoped policies (chapter 15 §15.8); MinIO Object Lock GOVERNANCE on `*-backups` buckets (§15.7); offsite copies in Phase 4 ch20.
2. **Outage of the backup target = silent data exposure window.** If MinIO is down for 6 hours, no backups land for 6 hours; a failure during that window has nothing to recover from. Mitigation: alert on backup-job failure (§19.8); MinIO HA from chapter 15 tolerates 1 node down.
3. **Untested backups are the realistic failure mode.** Backups that "always succeeded" but have never been restored are the single most common DR fiasco. Defence: quarterly restore drills documented in §19.7; the cadence isn't optional.

**Threat model — what we defend against:**

| Threat                                        | Mitigation                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Bad migration / accidental DROP TABLE         | pgBackRest PITR (ch13 §13.7) — restore to a point in time before the bad change                        |
| Ransomware writes to backup repos             | MinIO Object Lock GOVERNANCE on `*-backups` buckets; offsite copy at DR site (ch20)                    |
| Compromised app role used to dump app DB      | Per-app role least privilege; pgaudit logs every statement (ch13)                                      |
| Backup target compromised                     | Per-consumer credentials in Vault; rotation cadence 90-180 days; audit log streamed to Loki            |
| Silent backup corruption (block-level rot)    | pgBackRest verifies blocks on every backup; weekly `pgbackrest verify`; MinIO BitRot self-heal         |
| Partial backup taken during write             | Component-specific consistency: BGSAVE for Redis, pg_basebackup-style for Postgres, snapshot for Vault |
| Backup-job failure goes undetected            | Per-component alert in ch12's ruleset (§19.8); summary of last-successful-backup per service           |
| Restore procedure works for one engineer only | Documented runbook + quarterly drill; the procedure must be runnable from the docs by any operator     |

**Phase 4 deliberate non-goals:**

- **Continuous data protection (CDP)** — sub-second RPO via continuous block-level replication. Out of scope; Phase 5 ch22 may revisit if Postgres logical replication enables a full CDC stream.
- **Application-aware logical backups** (e.g., per-tenant database export for greenbook) — apps can ship their own logical exports if needed; the platform-tier provides only physical/component-level backups.
- **Tape / cold-air-gap archive** — out of scope; AU's compliance posture doesn't require offline tape today.
- **Backup deduplication across consumers** — pgBackRest dedupes within its own repo; MinIO buckets are per-consumer, not deduplicated globally.

### 19.2 Per-component backup status (consolidated)

Phase 1-3 introduced per-component backups inline. Consolidated view of every backup the platform takes:

| Component            | What's backed up                               | Mechanism                          | Schedule                                                | Local path / target                                        | Off-site                    | Documented in |
| -------------------- | ---------------------------------------------- | ---------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- | --------------------------- | ------------- |
| Vault                | Raft snapshot                                  | `vault operator raft snapshot`     | Hourly                                                  | `/var/lib/vault/snapshots/` + ship to MinIO                | Phase 4 ch20                | ch03 §3.10    |
| GitLab               | gitlab-rake + secrets bundle                   | `gitlab-rake gitlab:backup:create` | Every 4h                                                | `/var/opt/gitlab/backups/` + ship to MinIO `platform-misc` | Phase 4 ch20                | ch04          |
| Nomad servers        | Raft snapshot                                  | `nomad operator snapshot save`     | Daily                                                   | bastion-hosted snapshot dir + MinIO `platform-misc`        | Phase 4 ch20                | ch05          |
| Consul servers       | Snapshot                                       | `consul snapshot save`             | Daily                                                   | bastion-hosted snapshot dir + MinIO `platform-misc`        | Phase 4 ch20                | ch05          |
| Nexus                | Filesystem + DB export                         | `nexus-task export-database`       | Daily                                                   | `/var/lib/nexus-backup/` + ship to MinIO `platform-misc`   | Phase 4 ch20                | ch06          |
| Keycloak             | Postgres dump + realm export                   | `pg_dump` + `kc.sh export`         | Hourly + nightly                                        | local dir + ship to MinIO `postgres-backups`               | Phase 4 ch20                | ch07          |
| Loki / Mimir / Tempo | (none — they ARE the backup target for chunks) | n/a                                | n/a                                                     | n/a                                                        | Phase 4 ch20 site repl      | n/a           |
| Postgres app DB      | Full + diff via pgBackRest                     | pgBackRest                         | Sun 02:00 + Mon-Sat 02:00 + WAL archive on every commit | local repo + MinIO `postgres-backups`                      | Phase 4 ch20                | ch13 §13.7    |
| Redis                | RDB snapshot via BGSAVE                        | Custom systemd timer + `mc cp`     | Hourly                                                  | `/var/lib/redis/dump.rdb` + MinIO `redis-backups`          | Phase 4 ch20                | ch14 §14.8    |
| MinIO                | (self-replicates internally; off-site = ch20)  | Site replication                   | Continuous (Phase 4)                                    | n/a — handled by chapter 20                                | Phase 4 ch20 (mc replicate) | ch15 §15.13   |
| PgBouncer            | (stateless — config in GitLab)                 | Git                                | On commit                                               | GitLab repo                                                | GitLab is backed up         | ch16          |
| HAProxy              | (stateless — config in GitLab)                 | Git                                | On commit                                               | GitLab repo                                                | Same                        | ch17          |
| Cloudflare           | (managed by Cloudflare; export periodically)   | API export                         | Weekly                                                  | GitLab repo                                                | n/a                         | ch18          |

The single thread that runs through all of these: **every persistent component pushes to MinIO** (Phase 3 chapter 15 unlocked this). No more per-component "where do backups live?" questions — they all live in MinIO buckets, with Object Lock on the backup-specific buckets, and the Phase 4 chapter 20 site replication makes them off-site automatically.

### 19.3 RPO + RTO targets per service

**RPO** (Recovery Point Objective) = how much data can we afford to lose.
**RTO** (Recovery Time Objective) = how fast must we recover.

The platform targets:

| Service         | RPO target                                  | RTO target                  | Backed by                                             |
| --------------- | ------------------------------------------- | --------------------------- | ----------------------------------------------------- |
| Vault           | 1 hour                                      | 30 min                      | Hourly Raft snapshots + restore procedure             |
| GitLab          | 4 hours                                     | 2 hours                     | 4-hourly gitlab-rake + restore to fresh VM            |
| Nomad / Consul  | 1 day                                       | 1 hour                      | Daily snapshots + Nomad bootstrap from snapshot       |
| Nexus           | 1 day                                       | 2 hours                     | Daily DB export; artifacts re-fetchable from upstream |
| Keycloak        | 1 hour                                      | 30 min                      | Hourly DB backup + realm import                       |
| Postgres app DB | 1 minute                                    | 30 min                      | WAL archive on every commit (`archive_timeout 60s`)   |
| Redis           | 1 hour                                      | 15 min                      | Hourly RDB; cache-tier — most data is reconstructible |
| Object storage  | (none — durable by design)                  | 0 (continuous availability) | EC + Phase 4 site repl                                |
| Apps            | (per app — RPO inherited from DB + storage) | (per app — see chapter 30)  | App-specific                                          |

Critical-path services target ~1h RPO; lower-priority targets 1-day RPO. The aggressive Postgres RPO (1 min) is what `archive_timeout = 60s` in chapter 13 §13.4 paid for.

**RTO chain** — the worst-case full-platform DR is bounded by:

```
Vault restore (30 min)           ← everything else needs Vault credentials
  → Nomad/Consul restore (1 hour) ← apps need scheduler
    → Postgres restore (30 min)   ← apps need DB
      → Apps restart (30 min)     ← Nomad restarts allocs

Total worst case: ~3 hours, well under the 4-hour Phase 4 RTO target.
```

DR site (chapter 20) shortens this dramatically — most components are pre-replicated, just need promotion.

### 19.4 The 3-2-1 rule applied to AU

The classic backup rule:

- **3** copies of data
- **2** different storage media
- **1** off-site copy

Applied to the platform:

| Component           | Copy 1 (live)         | Copy 2 (different medium / VM)  | Copy 3 / off-site (ch20)                              |
| ------------------- | --------------------- | ------------------------------- | ----------------------------------------------------- |
| Postgres app DB     | Primary               | Replica + pgBackRest local repo | MinIO `postgres-backups` + DR site replica + DR MinIO |
| Vault               | 3-node Raft cluster   | Hourly snapshot to bastion FS   | MinIO + DR site                                       |
| GitLab              | Single VM live        | gitlab-rake → local backup dir  | MinIO + DR site                                       |
| Redis               | 3-VM Sentinel cluster | Hourly RDB to local FS          | MinIO + DR site                                       |
| Object storage data | 4-node EC (durable)   | (data IS the backup target)     | DR site MinIO via site replication                    |

Every component has at minimum 3 copies; at minimum 2 different media (local FS + MinIO object storage); and chapter 20 establishes the off-site copy. After Phase 4, the platform meets the 3-2-1 rule across the board.

### 19.5 Encryption — at rest + in transit

Every backup traverses the network and lands on a storage medium. Both legs are encrypted:

| Stage                          | Encryption mechanism                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| Source → MinIO transit         | TLS via local nginx (chapter 15 §15.5); AU wildcard cert                                  |
| MinIO at-rest                  | SSE-S3 (chapter 15 §15.7) with built-in KES keys; Phase 5 ch22 swaps to Vault Transit KMS |
| Postgres pgBackRest local repo | pgBackRest's `--repo-cipher-type=aes-256-cbc` with key from Vault                         |
| Vault snapshots                | Vault encrypts internally; bastion-side at-rest via LUKS on `/var/backups`                |
| GitLab gitlab-rake bundle      | GitLab's built-in encryption; key in Vault                                                |

The chain ensures that even a stolen backup file from any single point in the pipeline reveals no data without the corresponding decryption key from Vault.

```bash
# pgBackRest with at-rest encryption — extends ch13 §13.7 config
$ sudo tee -a /etc/pgbackrest/pgbackrest.conf > /dev/null <<EOF

[global]
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=$(vault kv get -field=repo_pass kv/platform/postgres/pgbackrest_repo)
repo2-cipher-type=aes-256-cbc
repo2-cipher-pass=$(vault kv get -field=repo_pass kv/platform/postgres/pgbackrest_repo)
EOF

# Generate the repo-encryption key (one-time setup)
$ vault kv put kv/platform/postgres/pgbackrest_repo \
    repo_pass="$(openssl rand -base64 64)" \
    rotated_at="$(date -Iseconds)" \
    rotation_period_days=730
```

> **⚠ pgBackRest cipher rotation requires a fresh stanza-create**
>
> Changing `repo1-cipher-pass` invalidates all prior backups in that repo. Plan ahead: only rotate at known-quiet windows; keep the previous pass in Vault for the WAL retention window so PITR to before the rotation still works.

### 19.6 Backup verification (not just "did it run")

A backup that exists but can't be restored is no backup. Three verification layers, run automatically:

#### Layer 1 — Job exit code

Every backup job is a systemd unit. `systemctl is-failed <unit>` answers "did the job complete." Promtail picks up failures from journald → Loki ruler fires the alert in §19.8.

#### Layer 2 — Output integrity (block / record-level)

Each backup tool has its own integrity check:

```bash
# Postgres (pgBackRest)
$ sudo -u postgres pgbackrest --stanza=app verify
# Returns 0 if all blocks pass checksum; non-zero on any corruption

# Vault (snapshot file integrity)
$ vault operator raft snapshot inspect /path/to/snapshot.snap
# Returns metadata; non-zero if file is malformed

# GitLab
$ sudo gitlab-rake gitlab:backup:check[BACKUP=<filename>]
# Validates the backup file's internal manifest

# Redis
$ redis-check-rdb /var/lib/redis/dump.rdb
# Walks the file; reports OK or specific corruption point

# MinIO
$ mc admin heal --recursive --quiet au-platform/postgres-backups
# Verifies + repairs from parity if needed
```

A weekly systemd timer on the bastion runs all of these against the most recent backup of each service:

```bash
# [bastion]
$ sudo tee /usr/local/bin/verify-backups.sh > /dev/null <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
declare -A RESULTS

# Postgres
ssh auishqosrpdb01 'sudo -u postgres pgbackrest --stanza=app verify' \
  && RESULTS[postgres]=ok || RESULTS[postgres]=FAIL

# Vault — verify the latest snapshot the bastion holds
LATEST_VAULT=$(ls -t /var/backups/vault/*.snap | head -1)
vault operator raft snapshot inspect "$LATEST_VAULT" >/dev/null \
  && RESULTS[vault]=ok || RESULTS[vault]=FAIL

# GitLab — find the latest backup file and validate
LATEST_GITLAB=$(ssh auishqosrgit01 'ls -t /var/opt/gitlab/backups/*.tar | head -1')
ssh auishqosrgit01 "sudo gitlab-rake gitlab:backup:check[BACKUP=$(basename $LATEST_GITLAB)]" \
  && RESULTS[gitlab]=ok || RESULTS[gitlab]=FAIL

# Redis
ssh auishqosrred01 'redis-check-rdb /var/lib/redis/dump.rdb' \
  && RESULTS[redis]=ok || RESULTS[redis]=FAIL

# MinIO
mc admin heal --recursive --quiet au-platform/postgres-backups >/dev/null \
  && RESULTS[minio]=ok || RESULTS[minio]=FAIL

# Emit results to journald → Loki picks up via standard alerting
for k in "${!RESULTS[@]}"; do
  logger -t verify-backups "service=$k status=${RESULTS[$k]}"
done

# Aggregate exit
for k in "${!RESULTS[@]}"; do
  [[ "${RESULTS[$k]}" == "ok" ]] || exit 1
done
EOF
$ sudo chmod 755 /usr/local/bin/verify-backups.sh

$ sudo tee /etc/systemd/system/verify-backups.timer > /dev/null <<'EOF'
[Unit]
Description=Weekly backup verification

[Timer]
OnCalendar=Sun 04:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

$ sudo tee /etc/systemd/system/verify-backups.service > /dev/null <<'EOF'
[Unit]
Description=Verify all platform backups

[Service]
Type=oneshot
ExecStart=/usr/local/bin/verify-backups.sh
EOF

$ sudo systemctl daemon-reload
$ sudo systemctl enable --now verify-backups.timer
```

#### Layer 3 — End-to-end restore drill (§19.7)

Quarterly. The only layer that proves the backup actually works.

### 19.7 Restore-drill calendar

Restore drills are quarterly per component, scheduled so each quarter exercises a different subset:

| Quarter | Drill focus                 | What gets restored                                                   |
| ------- | --------------------------- | -------------------------------------------------------------------- |
| Q1      | Postgres + apps             | Restore PITR to a target time on a fresh DB VM; verify               |
| Q2      | Vault + secrets re-issuance | Restore Vault snapshot to a fresh node; verify operator + app tokens |
| Q3      | GitLab + CI/CD              | Restore GitLab to a fresh VM; verify a build runs                    |
| Q4      | Full platform DR            | Phase 4 ch20 DR site activation drill                                |

Each drill produces a written report capturing:

- Time to start procedure
- Time to backup-restored
- Time to service-up
- Time to all-checks-pass
- Any deviation from the runbook

These get committed to GitLab as `docs/runbooks/restore-drills/<date>-<focus>.md`. Patterns of "this step always takes 2× longer than documented" → update the chapter; patterns of "this step doesn't work without sub-step X" → update the runbook.

### 19.8 Backup-specific alerts (extends ch12 ruleset)

Add these to chapter 12's Mimir ruler:

```bash
# [auishqosrobs01]
$ sudo -u mimir tee -a /var/lib/mimir/rules/anonymous/platform.yaml > /dev/null <<'EOF'

  # ─────────────────────────────  Phase 4: Backups  ─────────────────────────────
  - name: backups
    interval: 60s
    rules:
      - alert: BackupJobFailed
        expr: |
          (time() - node_systemd_unit_state_succeeded_seconds{
              name=~"pgbackrest-.*\\.service|vault-snapshot\\.service|gitlab-backup\\.service|redis-backup\\.service|nomad-snapshot\\.service|consul-snapshot\\.service|verify-backups\\.service"
          }) > 86400 * 2
        for: 5m
        labels:
          severity: critical
          service: backup
        annotations:
          summary: 'Backup job {{ $labels.name }} has not succeeded in {{ $value | humanizeDuration }}'

      - alert: BackupRepositoryFull
        expr: |
          (1 - node_filesystem_avail_bytes{mountpoint=~"/var/(backups|opt/gitlab/backups|lib/pgbackrest)"} /
               node_filesystem_size_bytes{mountpoint=~"/var/(backups|opt/gitlab/backups|lib/pgbackrest)"}) > 0.85
        for: 30m
        labels:
          severity: warning
          service: backup
        annotations:
          summary: 'Backup volume {{ $labels.mountpoint }} on {{ $labels.instance }} is {{ $value | humanizePercentage }} full'

      - alert: BackupVerificationFailed
        expr: |
          sum(rate({unit="verify-backups.service"} |= "status=FAIL" [1d])) > 0
        for: 1m
        labels:
          severity: critical
          service: backup
        annotations:
          summary: 'Backup verification failed in the last 24h — see Loki for details'

      - alert: WALArchiveStalled
        expr: |
          (time() - pg_archiver_last_archive_age_seconds) > 600
        for: 10m
        labels:
          severity: critical
          service: postgres
        annotations:
          summary: 'Postgres WAL archive is {{ $value | humanizeDuration }} behind — RPO target at risk'
EOF

$ for h in 01 02 03; do
    ssh -J au-bastion auishqosrobs${h}.au-internal \
      'curl -s -X POST http://127.0.0.1:9009/ruler/reload'
  done
```

The first rule covers the Layer-1 "did the job run." The fourth catches the Postgres WAL-archive stall that compromises the 1-min RPO target.

### 19.9 Backup audit trail

Every backup operation lands in Loki via journald → Promtail. Useful queries:

```bash
# Last 24h backup activity, by service
{job="systemd-journal"} |~ "pgbackrest|vault.*snapshot|gitlab-backup|redis-backup|nomad.*snapshot|consul.*snapshot" | json

# Find any backup-job failure in the last week
{job="systemd-journal"} |~ "backup" |~ "fail|error|exception"

# Delete-events in MinIO audit log (potential ransomware indicator)
{role="minio"} |~ "DELETE" | json | api_method="DeleteObject"
```

Chapter 12 §12.7's Loki ruler already alerts on `Vault permission denied` and `nginx 5xx surge`; add a backup-specific log alert:

```yaml
# Loki ruler — addition to chapter 12 §12.7
- alert: SuspiciousBackupDelete
  expr: |
    sum by (host) (
      rate({role="minio"} |~ "DeleteObject" |~ "backup" [10m])
    ) > 5
  for: 5m
  labels:
    severity: critical
    service: minio
  annotations:
    summary: "{{ $labels.host }}: >5 backup-bucket delete events/sec for 5+ minutes"
    description: "Possible ransomware activity or operator error; investigate via MinIO audit log"
```

Object Lock GOVERNANCE on the backup buckets means even successful delete-object calls won't actually remove data within the retention window — but the alert flags the attempt for human review.

### 19.10 Verification

```bash
# (1) All scheduled backup timers are active
$ sudo systemctl list-timers --no-pager | grep -E 'backup|snapshot|pgbackrest|verify-backups'
# Expected: rows for each timer, all "active"

# (2) Most-recent backup file per component within RPO
$ ssh auishqosrpdb01 'sudo -u postgres pgbackrest --stanza=app info | head -20'
$ ssh bastion        'ls -lat /var/backups/vault/ | head -5'
$ ssh auishqosrgit01 'ls -lat /var/opt/gitlab/backups/ | head -5'
$ ssh auishqosrred01 'stat -c "%y" /var/lib/redis/dump.rdb'
# Expected: each within the per-service RPO from §19.3

# (3) MinIO has the recent ship of each backup
$ for b in postgres-backups redis-backups platform-misc; do
    echo "=== $b ==="
    mc ls --recursive au-platform/$b | head -10
  done

# (4) §19.6 weekly verification ran successfully
$ ssh bastion 'systemctl status verify-backups --no-pager'
$ ssh bastion 'journalctl -u verify-backups -n 50 --no-pager'

# (5) Trigger a synthetic restore drill — pick the smallest service
#     Vault snapshot restore to a throwaway VM; verify operator can read kv/test
$ vault operator raft snapshot save /tmp/test.snap
$ # On a fresh test VM:
$ vault operator init -recovery-shares=5 -recovery-threshold=3 -no-store
$ vault operator raft snapshot restore /tmp/test.snap
$ vault kv get kv/test
# Expected: matches what was in kv/test at snapshot time

# (6) Backup-verification alert fires when forced
$ ssh auishqosrpdb01 'sudo -u postgres pgbackrest --stanza=app stop'
# Wait 5 min — BackupJobFailed alert in email
$ ssh auishqosrpdb01 'sudo -u postgres pgbackrest --stanza=app start'
```

**Common failures and remedies:**

| Symptom                                         | Cause                                          | Fix                                                                                      |
| ----------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| pgBackRest backup fails after MinIO migration   | Repo cipher pass changed without stanza-create | Recreate stanza on repo2; old backups must be re-taken                                   |
| `verify-backups` script aborts on first failure | `set -e` on a partial result                   | Use `set -uo pipefail` (without `-e`) and aggregate at the end (§19.6 already does this) |
| Vault snapshot inspect returns "invalid magic"  | File truncated (network blip during ship)      | Re-take snapshot; check destination disk fullness                                        |
| MinIO Object Lock prevents legitimate cleanup   | GOVERNANCE retention not yet expired           | Use `BypassGovernanceRetention` permission for ops cleanup; document the bypass          |
| Restore drill exceeds documented RTO            | Procedure drift since last drill               | Update the runbook + chapter 30 onboarding; the drill is the source of truth             |

### 19.11 Phase 5 path (continuous-replication tiers)

Phase 5 chapter 22 (dynamic Vault secrets) plus chapter 24 (Patroni for Postgres) introduce continuous-replication options that improve the RPO further:

- **Postgres synchronous replication** — RPO drops to zero (writes block until replica acknowledges). Trade: 5-15ms write-latency increase. Opt-in per critical table.
- **Vault HA across DCs** — already supported; needs the DR network link from chapter 20.
- **MinIO active-active site replication** — chapter 20 starts with one-way; Phase 5 enables bidirectional active-active.

The backup strategy from this chapter remains the foundation; continuous replication layers on top to reduce the RPO window.

---
