# 20 — DR site

> **Phase**: 4 (resilience) · **Run on**: a complete second datacentre / cloud region — TBD per Q5; pre-flight section assumes a same-shape mirror of primary · **Time**: ~2 weeks build, ~1 day per drill
>
> Off-site disaster recovery. A scaled-down mirror of the primary platform at a separate location, kept warm via component-specific replication. RTO ≤ 4h target. **Closes Phase 4.**
>
> Phase 4 chapter 2 of 2.
>
> **Prev**: [19 — Backup strategy](19-backup-strategy.md) · **Next**: [21 — Teleport bastion](21-teleport.md) — _Phase 5_ · **Index**: [README](README.md)

---

## Contents

- [§20.1 Role + threat model](#201-role-threat-model)
- [§20.2 DR tier model (cold / warm / hot)](#202-dr-tier-model-cold-warm-hot)
- [§20.3 Pre-flight (Q5 dependency + DR site footprint)](#203-pre-flight-q5-dependency-dr-site-footprint)
- [§20.4 Replication strategy per component](#204-replication-strategy-per-component)
- [§20.5 Postgres async streaming standby](#205-postgres-async-streaming-standby)
- [§20.6 MinIO site replication](#206-minio-site-replication)
- [§20.7 Vault snapshot ship + restore](#207-vault-snapshot-ship-restore)
- [§20.8 GitLab + Nexus ship of recent backups](#208-gitlab-nexus-ship-of-recent-backups)
- [§20.9 Cloudflare Load Balancing failover](#209-cloudflare-load-balancing-failover)
- [§20.10 DR activation runbook](#2010-dr-activation-runbook)
- [§20.11 RTO drill execution + measurement](#2011-rto-drill-execution-measurement)
- [§20.12 Verification](#2012-verification)
- [§20.13 Phase 4 close-out](#2013-phase-4-close-out)

## 20. DR site

### 20.1 Role + threat model

DR protects against **catastrophic loss of the primary site** — DC fire, hypervisor cluster permanent loss, regional network isolation, AU campus power event lasting >RTO. HA (chapters 13-17) protects against single-component loss; backups (chapter 19) protect against data loss; DR protects against site loss.

The pattern is **warm standby**: a complete (scaled-down) mirror at a second location, kept current via component-specific replication, ready for manual promotion within the 4h RTO.

```
                              normal operation
                              ────────────────
   ┌─────────────────────────────────┐         ┌──────────────────────────────┐
   │  Primary site (Addis HQ)        │ ──repl─▶│  DR site (TBD per Q5)        │
   │  - All apps live                │         │  - Postgres replica          │
   │  - Cloudflare → primary IP      │         │  - MinIO secondary site      │
   │  - 100% of platform load        │         │  - Vault snapshot daily      │
   │                                 │         │  - GitLab backup file       │
   │                                 │         │  - Cold-standby app VMs     │
   └─────────────────────────────────┘         └──────────────────────────────┘
                                                              ▲
                              after activation                │
                              ─────────────────                │
                              Cloudflare Load Balancer reroutes
                              to DR origin IP; Postgres replica
                              promoted; apps started; ~4h RTO
```

Three consequences:

1. **Compromise = mirrored compromise.** Anything an attacker can do to the primary site can be replicated to DR if not detected in time. Defence: MinIO Object Lock on backup buckets at both sites; per-site Vault namespace isolation; chapter 19 §19.9 alert on suspicious DELETE patterns.
2. **Outage = partial DR coverage at best.** If the DR site itself is down (or the link between sites breaks), the platform has no fallback. Mitigation: monitor DR site availability as a tier-1 metric; if DR is degraded, defer non-emergency primary-side maintenance.
3. **Untested DR is theatre.** DR drills are quarterly per chapter 19 §19.7; they're the only proof DR works. Defence: the drill cadence isn't optional; if a drill is skipped two quarters in a row, the DR claim is invalidated.

**Threat model — what we defend against:**

| Threat                          | Mitigation                                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Primary site permanent loss     | Full DR mirror with documented activation runbook (§20.10); RTO 4h                                                                |
| Replication link cut            | Postgres async replication tolerates lag; MinIO site replication queues; Vault snapshot ships once daily; degraded but not broken |
| DR site itself compromised      | Monitor DR via primary's Loki/Mimir over a separate VPN tunnel; per-site Vault root tokens; DR cert chain separate from primary   |
| Replicated ransomware           | Object Lock GOVERNANCE on `*-backups` buckets at BOTH sites; secondary Vault has its own audit log                                |
| Misrouted Cloudflare failover   | Cloudflare Load Balancer health check uses application-layer probe; per-region geosteering off by default                         |
| RTO breach during real incident | Quarterly drill with stopwatch; deviation gets the runbook updated; recurrent slowness gets engineering follow-up                 |

**Phase 4 deliberate non-goals:**

- **Active-active dual-site** — both sites serving production traffic simultaneously. Far harder than warm standby; out of scope for Phase 4. Phase 5 may revisit if AU's volume justifies it.
- **Sub-1h RPO across the DR link** — async replication is the realistic ceiling; synchronous replication across a WAN is a latency disaster.
- **DR for the bastions** — bastions are reproducible from Ansible (Phase 5); no need to mirror state.
- **DR for the observability stack itself** — if DR is invoked, ship logs/metrics/traces directly from DR-side apps to a fresh DR-side LGTM bring-up. Phase 4 documents the shape; Phase 5 ch23 automates it.

### 20.2 DR tier model (cold / warm / hot)

The standard taxonomy:

| Tier | Description                                             | RTO         | Cost    | Phase 4 status               |
| ---- | ------------------------------------------------------- | ----------- | ------- | ---------------------------- |
| Cold | Backups only at DR site; rebuild from scratch           | 24-48 hours | Lowest  | Below the bar                |
| Warm | Mirror exists, kept current, requires manual activation | 1-4 hours   | Mid     | **Phase 4 target**           |
| Hot  | Mirror is live and accepting traffic                    | seconds     | Highest | Phase 5 maybe; not justified |

Why warm:

- Cold is below AU's RTO requirement (4h hard target).
- Hot doubles the platform's running cost; given Phase 1's "10-30 apps" scale, the marginal availability gain isn't worth it.
- Warm is the operational sweet spot: replication keeps the data current, manual promotion gives control during incidents (no reflexive failover of "wait, was that really a primary outage?").

### 20.3 Pre-flight (Q5 dependency + DR site footprint)

**Q5 (open in PLAN.md): Off-site DR location confirmed?** Phase 4 ch20 is the chapter that closes this. Possible answers:

| Option                                            | RPO / RTO impact            | Pros                                           | Cons                                   |
| ------------------------------------------------- | --------------------------- | ---------------------------------------------- | -------------------------------------- |
| Secondary AU campus                               | Same-city; sub-50ms RTT     | AU IT controls both ends                       | Same-city earthquake / power-grid risk |
| AU-managed cloud (AWS / Azure af-south)           | Cross-region; ~80-150ms RTT | True geographic isolation                      | Cloud bill; AU policies on cloud       |
| Partner DC (e.g. Liquid Telecom Addis or Nairobi) | Sub-150ms RTT               | African continent infra; geographic separation | Per-month fee; sovereignty review      |

The decision is AU IT leadership's. Phase 4 ch20 documents the **mechanism** assuming a chosen DR site exists; the chapter is correct regardless of which option lands.

**DR site footprint** — scaled-down mirror, ~50% of primary capacity:

| Component       | Primary count       | DR count    | Notes                                                                              |
| --------------- | ------------------- | ----------- | ---------------------------------------------------------------------------------- |
| Bastion         | 2 (HA pair)         | 1           | Cold-standby; only operational during drills + DR                                  |
| Vault           | 3 (Raft cluster)    | 1           | Cold-standby; restored from snapshot on activation                                 |
| Nomad servers   | 3                   | 3           | Same — Nomad needs quorum even at DR                                               |
| Consul servers  | 3                   | 3           | Same                                                                               |
| Nomad clients   | 3                   | 2           | Capacity reduction acceptable during DR                                            |
| GitLab          | 1                   | 1           | Restored from latest backup at DR activation                                       |
| Nexus           | 1                   | 1           | Same                                                                               |
| Keycloak        | 2                   | 1           | Single-instance during DR; HA restored when primary returns                        |
| Keycloak DB     | 1                   | 1           | Replicated (or restored from backup)                                               |
| obs (LGTM)      | 3                   | 1           | Single-instance LGTM at DR; full HA when primary returns                           |
| Grafana         | 1                   | 1           | Same                                                                               |
| Postgres app DB | 2 (primary+replica) | 1 (replica) | Async streaming standby; promoted on activation                                    |
| Redis           | 3                   | 0           | No DR-side cache — sessions invalidate on failover; apps re-warm from primary data |
| MinIO           | 4 (EC)              | 4 (EC)      | Site replication; same shape required for symmetric capacity                       |
| PgBouncer       | 2                   | 1           | Cold-standby                                                                       |
| HAProxy         | 2                   | 2           | VRRP pair at DR site                                                               |

Total: ~30 VMs at primary + ~20 at DR = ~50% of primary headcount at DR. This is the "warm" sweet spot.

### 20.4 Replication strategy per component

| Component       | Replication mechanism                   | Lag target | Activation step                                   |
| --------------- | --------------------------------------- | ---------- | ------------------------------------------------- |
| Postgres app DB | Async streaming standby                 | <60 sec    | `pg_promote()` on DR replica                      |
| Postgres KC DB  | Same                                    | <60 sec    | Same                                              |
| MinIO           | Site replication (`mc admin replicate`) | <5 min     | DNS repoint; no MinIO-side action                 |
| Vault           | Daily snapshot ship + on-demand restore | 24 hours   | `vault operator raft snapshot restore` on DR node |
| GitLab          | Daily backup file ship to DR MinIO      | 24 hours   | gitlab-rake restore on fresh DR VM                |
| Nexus           | Daily DB export ship                    | 24 hours   | nexus-task restore on fresh DR VM                 |
| Keycloak realm  | Nightly export ship                     | 24 hours   | kc.sh import on fresh DR Keycloak                 |
| Nomad / Consul  | Daily snapshot ship                     | 24 hours   | Bootstrap from snapshot at DR activation          |
| Cloudflare DNS  | Active LB pool (both origins)           | 0          | LB health check shifts traffic                    |

Postgres + MinIO get continuous replication — the data tier — because RPO matters most there. Everything else gets daily ship; loss of a day's GitLab CI history is acceptable; loss of a day's app data isn't.

### 20.5 Postgres async streaming standby

Add a third replica to the chapter 13 cluster — at the DR site. Same `pg_basebackup` pattern as the primary-site replica (chapter 13 §13.5), with the DR site's network in between:

```bash
# [DR site — auishqosrpdb-dr01]

# (1) PG16 install per chapter 13 §13.3
$ # ... (same as ch13 §13.3) ...

# (2) Stop the cluster + clear data dir
$ sudo systemctl stop postgresql@16-main
$ sudo -u postgres rm -rf /var/lib/postgresql/16/main/*

# (3) Pull base backup over the WAN
$ REPL_PASS=$(vault kv get -field=password kv/platform/postgres/replication)
$ sudo -u postgres PGPASSWORD="$REPL_PASS" pg_basebackup \
    --host=auishqosrpdb01.au-internal \
    --username=replicator \
    --pgdata=/var/lib/postgresql/16/main \
    --wal-method=stream \
    --slot=replica_dr01 \
    --progress --verbose --checkpoint=fast

# (Primary needs the slot first)
# [auishqosrpdb01]
$ sudo -u postgres psql -c "SELECT pg_create_physical_replication_slot('replica_dr01');"

# (4) Replica config — same shape as ch13 §13.5 step 5 but pointing at the DR slot
$ sudo -u postgres tee /etc/postgresql/16/main/conf.d/10-replica.conf > /dev/null <<EOF
primary_conninfo = 'host=auishqosrpdb01.au-internal port=5432 user=replicator password=$REPL_PASS application_name=dr01 sslmode=require'
primary_slot_name = 'replica_dr01'
hot_standby = on
hot_standby_feedback = on
EOF

$ sudo -u postgres touch /var/lib/postgresql/16/main/standby.signal
$ sudo systemctl start postgresql@16-main

# (5) Verify lag from primary
# [auishqosrpdb01]
$ sudo -u postgres psql -c "
  SELECT application_name, client_addr, state, sync_state, replay_lag
  FROM pg_stat_replication WHERE application_name = 'dr01';"
# Expected: state=streaming, sync_state=async, replay_lag near 0 (or seconds for WAN-link cases)
```

Two replicas exist now (one at primary site, one at DR). Primary writes are async-replicated to both. Either can be promoted; chapter 13's failover procedure is unchanged for the local replica; the DR replica gets promoted only at full DR activation (§20.10).

A `BACKUP` mode tunable: set `synchronous_standby_names = 'pdb02'` to force at least the local replica to sync-confirm writes before commit. The DR replica stays async; this caps WAN-introduced latency without sacrificing local-replica RPO=0.

### 20.6 MinIO site replication

MinIO's site replication does the heavy lift. After chapter 15 §15.13 outlined the shape:

```bash
# Prerequisites: DR-site MinIO cluster deployed identically per chapter 15 (4-node EC,
# same bucket layout, same root user). DR cluster bootstrap:
$ mc alias set au-dr https://minio-dr.africanunion.org rootuser DRPASS

# Enable bidirectional site replication (replication is automatic both ways for new objects;
# Phase 4 keeps writes one-way primary→DR for clarity)
$ mc admin replicate add au-platform au-dr

# Verify config replicated
$ mc admin replicate info au-platform
$ mc admin replicate status au-platform
# Expected: status=Healthy; per-bucket replication enabled; queue depth low
```

After this, every PutObject on `au-platform` is asynchronously mirrored to `au-dr`. Buckets, IAM users, policies, encryption settings — everything replicates with no manual sync. The DR-site MinIO is **always current within ~5 min** of primary.

> **ℹ Replication queue can grow during link blips**
>
> Site replication queues writes locally if the WAN link is unavailable. Watch `minio_replication_queued_count` (Prometheus); alert if >10000 for 30 min (link-down indicator).

### 20.7 Vault snapshot ship + restore

Vault's Raft snapshots from chapter 03 §3.10 already ship hourly to MinIO `platform-misc`. With site replication, the snapshots automatically appear at DR-MinIO too. DR activation:

```bash
# At DR site, on fresh Vault VM
$ vault operator init -recovery-shares=5 -recovery-threshold=3
# Capture recovery keys + initial root token

# Restore from latest snapshot (already replicated to DR MinIO)
$ mc cp au-dr/platform-misc/vault-snapshots/$(latest).snap /tmp/
$ vault operator raft snapshot restore /tmp/$(latest).snap

# Verify
$ vault status
$ vault kv get kv/platform/test
```

The recovery keys at DR site are **separate** from primary's unseal keys — different custodians, different storage. This is intentional: a compromised primary unseal-key set must not unlock the DR Vault.

```bash
# Document the DR-side custodian split
$ vault kv put kv/platform/vault/dr_recovery_keys \
    custodians='dr_custodian_1,dr_custodian_2,dr_custodian_3' \
    initialized_at="$(date -Iseconds)" \
    last_drilled='YYYY-MM-DD'
```

(In practice, DR Vault recovery keys live on physical media at the DR site, not in primary's Vault — that would be circular. The KV entry above just documents WHO holds them.)

### 20.8 GitLab + Nexus ship of recent backups

Both already ship to MinIO via chapter 19; site replication carries them to DR-MinIO. Activation is restoration on a fresh DR-side VM:

```bash
# GitLab
$ ssh dr-gitlab "sudo gitlab-ctl reconfigure"   # bring up empty install
$ mc cp au-dr/platform-misc/gitlab-backups/$(latest).tar /tmp/
$ ssh dr-gitlab "sudo gitlab-rake gitlab:backup:restore BACKUP=$(latest)"

# Nexus
$ mc cp au-dr/platform-misc/nexus-export/$(latest).gz /tmp/
$ ssh dr-nexus "sudo nexus-task restore --file=/tmp/$(latest).gz"
```

RPO is "last 4-hourly GitLab backup" + "last daily Nexus export" — well within the 4h Phase 4 RTO.

### 20.9 Cloudflare Load Balancing failover

Cloudflare's Load Balancing add-on does origin health checks and steers traffic away from the unhealthy origin. Add the second origin and configure:

**Pool**:

```
Name: au-platform-primary
Origins:
  - 196.188.248.25 (primary perimeter NAT)
Health check:
  - Path: /healthz
  - Method: GET
  - Expected: HTTP 200
  - Interval: 30 sec
  - Threshold: 3 consecutive failures
```

```
Name: au-platform-dr
Origins:
  - <DR perimeter NAT IP>
Health check:
  - Same as primary
```

**Load Balancer**:

```
Hostname: greenbook.africanunion.org
Pools (priority order):
  1. au-platform-primary
  2. au-platform-dr
Steering: Failover
```

Result: all traffic goes to primary while it's healthy; if 3 consecutive health checks fail (~90 sec), Cloudflare steers traffic to DR. Apps at DR must already be running for this to work — the LB doesn't activate DR; it routes traffic to whichever activated DR you've prepared.

```bash
# API-driven via Cloudflare's load_balancing endpoint; example
$ CF_TOKEN=$(vault kv get -field=api_token kv/platform/cloudflare/api_token)
$ CF_ZONE_ID=$(curl -sf -H "Authorization: Bearer $CF_TOKEN" \
    "https://api.cloudflare.com/client/v4/zones?name=africanunion.org" | jq -r '.result[0].id')

# Create pool, monitor, load balancer (multi-step; simplified here)
$ curl -X POST -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/load_balancers/pools" \
    -d '<pool config>'
```

### 20.10 DR activation runbook

The **single most important section in this chapter**. When DR is needed, decisions take seconds; runbook clarity makes the difference between 3-hour and 8-hour recovery.

**Trigger** — declare DR activation when:

- Primary site has been unreachable for >30 min via every connectivity check
- AU IT confirms no recovery in the next 2-4 hours
- Decision authority: platform team lead OR designated on-call engineer

**Decision** — choose the activation level:

| Level                  | What runs at DR                                    | When                                          |
| ---------------------- | -------------------------------------------------- | --------------------------------------------- |
| **Partial — DB only**  | DR Postgres serves reads; primary apps point at it | Primary-site network partition; apps still up |
| **Full DR**            | Apps + DB at DR site; Cloudflare reroutes traffic  | Primary site totally lost                     |
| **DR drill (planned)** | Same as Full DR; coordinated test                  | Quarterly                                     |

**Full DR sequence** (4-hour RTO target):

```
T+0:00  Decision made; declare DR; notify stakeholders
T+0:05  Verify DR site is reachable from operator network
        (SSH to DR bastion via separate VPN; if this fails, DR is broken)
T+0:10  Activate DR Vault
        - SSH to DR Vault VM
        - vault operator init + restore latest snapshot
        - Unseal with DR custodian keys
T+0:30  Activate DR Nomad + Consul cluster
        - Restore Nomad + Consul snapshots
        - Bring up Nomad servers (3-node DR cluster)
T+1:00  Promote DR Postgres to primary
        - sudo -u postgres pg_ctl promote
        - Verify pg_is_in_recovery() returns 'f'
        - Update DR-side pg_hba.conf if needed
T+1:30  Restore DR GitLab + Nexus from latest backup
        (gitlab-rake restore; nexus-task restore)
T+2:00  Bring up DR Keycloak
        - kc.sh import realm from latest export
        - Verify SSO works for an admin login
T+2:30  Start app workloads on DR Nomad clients
        - nomad job run for each app spec
        - Apps re-fetch their secrets from DR Vault
T+3:00  Verify backend connectivity
        - Apps successfully connect to DR Postgres + DR Redis (cold-start)
T+3:30  Switch Cloudflare LB primary pool to DR pool
        OR  let the failover happen automatically (LB health check)
T+4:00  External traffic reaches DR site; users see service restored
        - Run greenbook ch14 verification ladder against the DR origin
```

Each minute of slippage in any step is documented in the post-drill report. Patterns that consistently slip get root-cause analysis.

**Reverse migration** (when primary returns):

```
T+0:00  Decision: primary site recovered
T+0:30  Set up Postgres on primary side as new DR replica (reverse direction)
T+2:00  Wait for primary-side replica to catch up
T+2:30  Quiesce DR site writes (read-only mode)
T+3:00  Promote primary's local replica back to primary
T+3:30  Cloudflare LB shifts back; DR returns to standby
T+4:00  Reverse migration complete
```

Reverse migration is roughly the same shape as activation — same risk surface, same drill cadence implications.

### 20.11 RTO drill execution + measurement

Quarterly drill (chapter 19 §19.7's Q4 slot). Drill plan lives at `docs/runbooks/dr-drills/` and gets a fresh report each quarter.

```bash
# [bastion]
$ sudo tee /usr/local/bin/dr-drill-stopwatch.sh > /dev/null <<'EOF'
#!/usr/bin/env bash
LOG=/var/log/dr-drill-$(date +%Y%m%d).log
START=$(date +%s)
log() {
  local NOW=$(date +%s)
  local ELAPSED=$((NOW - START))
  printf "%4ds  %s\n" "$ELAPSED" "$1" | tee -a "$LOG"
}
log "DR drill started"
read -p "Press enter when DR Vault is up"; log "Vault up"
read -p "Press enter when DR Nomad is up"; log "Nomad up"
read -p "Press enter when DR Postgres promoted"; log "Postgres promoted"
read -p "Press enter when DR GitLab restored"; log "GitLab restored"
read -p "Press enter when DR Keycloak up"; log "Keycloak up"
read -p "Press enter when apps are up"; log "Apps up"
read -p "Press enter when CF LB shifted"; log "Cloudflare LB shifted"
read -p "Press enter when external traffic verified"; log "External traffic verified"
log "DR drill complete"
echo "Report: $LOG"
EOF
$ sudo chmod 755 /usr/local/bin/dr-drill-stopwatch.sh
```

Each drill report goes into GitLab; deviations from documented timings update this chapter and §20.10. After three consecutive drills landing within RTO, the platform's DR claim is validated.

### 20.12 Verification

```bash
# (1) DR site Postgres replication healthy
$ ssh dr-pdb01 "sudo -u postgres psql -c 'SELECT pg_is_in_recovery(), \
    extract(epoch from now() - pg_last_xact_replay_timestamp()) AS lag_sec;'"
# Expected: t, lag_sec < 60

# (2) MinIO site replication healthy
$ mc admin replicate status au-platform
# Expected: status=Healthy; metrics show replication current

# (3) Vault snapshot ships are reaching DR MinIO
$ mc ls au-dr/platform-misc/vault-snapshots/
# Expected: snapshot files within the last hour

# (4) Cloudflare LB monitor is green for both pools
$ curl -sf -H "Authorization: Bearer $CF_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/load_balancers/pools" \
  | jq '.result[] | {name: .name, healthy: .healthy}'
# Expected: both pools healthy=true

# (5) Synthetic DR-VPN reachability (operator network → DR bastion)
$ ssh dr-bastion 'echo OK'
# Expected: OK; if this fails, DR activation will fail too

# (6) Quarterly drill executed
$ ls /var/log/dr-drill-*.log | tail -4
# Expected: 4 entries, one per quarter

# (7) DR site replicas have full data
$ ssh dr-pdb01 "sudo -u postgres psql -c 'SELECT count(*) FROM pg_database WHERE datname NOT IN (\"template0\",\"template1\",\"postgres\");'"
# Expected: same count as primary
```

**Common failures and remedies:**

| Symptom                                   | Cause                                                       | Fix                                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| MinIO replication queue keeps growing     | WAN link saturated or DR-MinIO offline                      | Check link bandwidth; verify DR-MinIO health                                                           |
| Postgres DR replica falls behind by hours | WAN link blip + replication slot full + WAL retention small | Increase `wal_keep_size` on primary; add a replication slot timeout monitor                            |
| Cloudflare LB doesn't fail over           | Health check path requires auth                             | Use unauthenticated `/healthz`; both apps must implement it                                            |
| DR drill exceeds 4h RTO target            | Procedure drift since last drill                            | Update §20.10 + chapter 30; deviations are the source of truth                                         |
| DR Vault unseal fails                     | DR custodian keys lost or wrong                             | Document recovery via primary's master root token re-creation; this is the highest-stakes failure mode |

### 20.13 Phase 4 close-out

With chapter 20, **Phase 4 (resilience) is complete**. The platform now has:

| Capability                    | Phase 1-3 status                    | After Phase 4                                         |
| ----------------------------- | ----------------------------------- | ----------------------------------------------------- |
| Backup orchestration          | Per-component ad-hoc                | Unified strategy with RPO/RTO targets (ch19)          |
| Backup encryption + integrity | Component-specific                  | Standardised AES-256 + verification + audit (ch19)    |
| Restore drill cadence         | (none)                              | Quarterly per ch19 §19.7                              |
| Off-site copy                 | (none — all data on-site)           | Continuous Postgres + MinIO; daily for the rest       |
| DR site                       | (none)                              | Warm-standby mirror with documented activation (ch20) |
| Site failover                 | Manual (single-site outage = total) | Cloudflare LB-driven; ~4h RTO drilled                 |

**Phase 4 close-out summary** — same shape as Phase 1, 2, 3 closeouts:

| Component            | Phase 4 location                      | Phase 5 upgrade chapter                      |
| -------------------- | ------------------------------------- | -------------------------------------------- |
| Backup orchestration | systemd timers + bastion verification | 23 — Ansible automation                      |
| Restore drills       | Manual quarterly                      | 23 — semi-automated drill execution          |
| DR Postgres          | Async streaming standby               | 24 — Patroni-aware failover (sub-30-sec RTO) |
| DR MinIO             | Site replication one-way              | 25 — bidirectional active-active             |
| DR Vault             | Snapshot ship + restore on activation | 22 — DR Performance Standby (sub-1-min RTO)  |
| DR activation        | Manual runbook (§20.10)               | 23 — semi-automated runbook execution        |

**Phase 5 starts with chapter 21** — Teleport bastion. The simple bastion from chapter 02 graduates to session recording, RBAC, certificate-based access; chapter 22 introduces dynamic Vault secrets; chapters 23-26 automate runbooks and address the remaining "manual" items in the Phase 4 close-out.

**Phase 4 closes on 2026-05-02.** The platform now has tested, documented, drilled resilience — primary site can be lost and the platform recovers within 4 hours.

---
