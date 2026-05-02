# 41 — Incident response

> **Phase**: post-phase reference · **Run on**: triggered by Alertmanager critical alert; executed by on-call operator · **Time**: per-incident; playbooks aim for ≤30 min mean-time-to-mitigate
>
> Playbooks per common platform failure mode. Each playbook follows the same shape: detection → triage → mitigation → verification → post-incident. Designed to be runnable from cold — the on-call operator who hasn't seen the platform in a month should be able to execute these without spelunking through chapters.

---

## Contents

- [§41.1 The IR shape](#411-the-ir-shape)
- [§41.2 P-01 — Postgres primary down](#412-p-01-postgres-primary-down)
- [§41.3 P-02 — Vault sealed](#413-p-02-vault-sealed)
- [§41.4 P-03 — Keycloak unreachable (SSO down platform-wide)](#414-p-03-keycloak-unreachable-sso-down-platform-wide)
- [§41.5 P-04 — Nomad scheduler unavailable](#415-p-04-nomad-scheduler-unavailable)
- [§41.6 P-05 — GitLab down (CI/CD blocked)](#416-p-05-gitlab-down-cicd-blocked)
- [§41.7 P-06 — MinIO node loss](#417-p-06-minio-node-loss)
- [§41.8 P-07 — Redis Sentinel split-brain](#418-p-07-redis-sentinel-split-brain)
- [§41.9 P-08 — HAProxy VRRP split-brain](#419-p-08-haproxy-vrrp-split-brain)
- [§41.10 P-09 — Cloudflare 521 / origin unreachable](#4110-p-09-cloudflare-521-origin-unreachable)
- [§41.11 P-10 — Corporate WAF blocking app traffic](#4111-p-10-corporate-waf-blocking-app-traffic)
- [§41.12 P-11 — Object Lock blocking ops cleanup](#4112-p-11-object-lock-blocking-ops-cleanup)
- [§41.13 Severity declaration + escalation](#4113-severity-declaration-escalation)
- [§41.14 Post-incident review](#4114-post-incident-review)

## 41. Incident response

### 41.1 The IR shape

Every playbook below shares this skeleton:

1. **Detection** — what alert fires, what dashboards show, what users report
2. **Triage** — quick checks to confirm scope; rule out false-positive
3. **Mitigation** — restore service (the goal — root cause comes later)
4. **Verification** — service is genuinely back; not just the alert silenced
5. **Post-incident** — log → review → playbook update if needed

Time targets:

- Detection: <2 min via Alertmanager (chapter 12)
- Triage: <5 min
- Mitigation: <30 min (P-01) to <2 hours (full DR)
- Verification: <10 min — chapter 40 ladder layer relevant to the component

The on-call operator's first action is **always** to declare the incident in the team channel (one-line summary + which playbook they're running). That alone keeps coordination working when 2+ operators converge on the same alert.

### 41.2 P-01 — Postgres primary down

**Detection**

- Alert: `PostgresDown` (CRITICAL) for `auishqosrpdb01:9187`
- Apps in Loki: bursts of "FATAL: terminating connection" / "could not connect to server"
- Dashboard: `postgres-overview` shows `up` flatlined for the primary

**Triage**

```bash
$ ssh -J au-bastion auishqosrpdb01.au-internal 'sudo systemctl is-active postgresql@16-main'
$ ssh -J au-bastion auishqosrpdb01.au-internal 'pg_isready -h 127.0.0.1'
```

If both fail and the VM is reachable: Postgres process is down — try `systemctl restart` once.
If the VM itself is unreachable: it's a hard failure → failover.

**Mitigation — quick restart**

```bash
$ ssh auishqosrpdb01 'sudo systemctl restart postgresql@16-main'
$ sleep 30
$ ssh auishqosrpdb01 'sudo -u postgres pg_isready'
```

If recovers: skip to Verification.

**Mitigation — failover** (chapter 13 §13.10)

```bash
# (1) Verify replica catch-up
$ ssh auishqosrpdb02 'sudo -u postgres psql -c "
    SELECT pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn(),
           now() - pg_last_xact_replay_timestamp() AS lag;"'

# (2) Promote replica to primary
$ ssh auishqosrpdb02 'sudo -u postgres pg_ctl promote -D /var/lib/postgresql/16/main'

# (3) HAProxy auto-discovers the new primary via pg-isprimary check (chapter 17 §17.5.2)
#     — DNS / config updates are NOT needed.

# (4) Apps reconnect within ~30s as their connection pools cycle
```

**Verification**

- chapter 40 §40.2 layer-2 health check on Postgres returns `accepting connections`
- chapter 40 §40.4 Nomad scheduling round-trip succeeds (apps can connect)
- Dashboard: app error rates return to baseline

**Post-incident**

- Hard fence the old primary (chapter 13 §13.10 step 5 — `recovery.signal` + don't restart yet)
- Schedule pg_rewind rebuild as new replica during next maintenance window
- If failover happened: log the timing, compare to RTO target (chapter 19 §19.3)

### 41.3 P-02 — Vault sealed

**Detection**

- Alert: `VaultSealed` (CRITICAL) for one or more Vault nodes
- Apps in Loki: "Vault is sealed" responses; per-app cred fetch failures cascading
- Dashboard: `vault-overview` shows `vault_core_unsealed` flatlined to 0

**Triage**

```bash
$ for h in 01 02 03; do ssh auishqosrvlt${h} 'vault status | head -5'; done
```

- If 1 node sealed, 2 unsealed: less urgent — ride on the 2 unsealed via HA
- If 2-3 sealed: full sealing event; possibly a restart, an unclean reboot, or a security trigger

**Mitigation — unseal a single node**

```bash
# Coordinate with at least 3 of the 5 unseal-key custodians (chapter 03 §3.7)
$ ssh auishqosrvlt01
$ vault operator unseal <key-1>
$ vault operator unseal <key-2>
$ vault operator unseal <key-3>
$ vault status   # Sealed: false
```

**Mitigation — full cluster sealed**

- Same procedure on each node, all 3 in parallel sessions (one custodian can give the same key to multiple nodes; that's fine)
- Verify HA leader elected: `vault status | grep "HA Cluster"`

**Verification**

- chapter 40 §40.3 Vault round-trip passes
- Apps' Vault Agent sidecars resume normal operation (Loki: `vault token renewed` events)

**Post-incident**

- Determine why Vault sealed (the cause is rarely "random restart"):
  - Was there a kernel update + reboot? Document the patch-night procedure
  - Was there a security trigger (audit anomaly)? Investigate the audit log
  - Was disk space / memory exhausted? Resize + alert
- If 2+ custodians had to be paged at 3am: investigate whether key custody can be improved (more custodians, on-call rotation among them)

### 41.4 P-03 — Keycloak unreachable (SSO down platform-wide)

**Detection**

- Alert: `KeycloakDown` (CRITICAL)
- Operators: can't log into Grafana, Vault UI, GitLab, Teleport
- Apps: new user logins fail; existing tokens still valid until expiry

**Triage**

```bash
$ for h in 01 02; do
    ssh auishqosrkc${h} 'curl -k https://127.0.0.1:8443/health/ready'
  done
$ ssh auishqosrkdb01 'sudo -u postgres pg_isready'   # KC needs its DB
```

- If Keycloak processes up but DB down: P-01 procedure on `auishqosrkdb01`
- If both Keycloak nodes down: HA cluster issue; check JGroups gossip
- If AD federation broken: chapter 08 §8.10 rollback procedure

**Mitigation — restart Keycloak nodes (rolling)**

```bash
$ ssh auishqosrkc01 'sudo systemctl restart keycloak'
$ sleep 60
$ # Verify kc01 healthy before restarting kc02
$ curl -k https://auishqosrkc01:8443/health/ready
$ ssh auishqosrkc02 'sudo systemctl restart keycloak'
```

**Mitigation — break-glass admin login (when SSO is the problem)**

```bash
# Per chapter 07 §7.5 — admin password in Vault
$ vault kv get -field=password kv/platform/keycloak/admin
$ # Login to Keycloak admin UI directly (not via SSO) with that password
```

**Mitigation — AD federation broken**

Per chapter 08 §8.10:

1. Disable LDAP user-storage provider in Keycloak admin UI
2. Re-enable local-account login on the realm
3. Operators use break-glass admin password
4. Investigate AD-side: bind credentials, network reachability, schema changes
5. Re-enable federation once root cause fixed

**Verification**

- chapter 40 §40.6 SSO end-to-end test
- New user login through Grafana works

**Post-incident**

- Test the break-glass admin password rotation worked (was in Vault when needed)
- Verify the AD bind credentials in `kv/platform/keycloak/ad_bind_credentials` are still fresh

### 41.5 P-04 — Nomad scheduler unavailable

**Detection**

- Alert: `NomadServerDown` (CRITICAL)
- Already-allocated jobs keep running; new deployments + restarts fail
- Apps with crashed containers don't get rescheduled

**Triage**

```bash
$ for h in 01 02 03; do ssh auishqosrnmd${h} 'nomad server members | head -10'; done
$ for h in 01 02 03; do ssh auishqosrnmd${h} 'sudo systemctl is-active nomad'; done
```

- If 2/3 alive: cluster has quorum; non-urgent — restart the dead node
- If 1/3 alive: quorum lost; needs full investigation
- If 0/3: catastrophic; restore from snapshot (chapter 05)

**Mitigation — restart dead node**

```bash
$ ssh auishqosrnmd<N> 'sudo systemctl restart nomad'
$ sleep 30
$ ssh auishqosrnmd<N> 'nomad server members'
```

**Mitigation — quorum lost**

1. Identify which node has the most-recent Raft log: `nomad operator raft list-peers`
2. If safe, force the laggers to rejoin via `nomad operator raft add-peer`
3. If full corruption: stop all Nomad servers, restore from latest snapshot on one node, bootstrap cluster from there

**Verification**

- chapter 40 §40.4 Nomad scheduling test — synthetic batch job runs
- `nomad node status` shows clients reachable
- Existing allocations unaffected (they should never have stopped — Nomad servers control scheduling, not the running tasks)

**Post-incident**

- Snapshot health check (chapter 19): when did the last Nomad snapshot succeed?
- If quorum lost due to network partition: revisit network design with AU IT

### 41.6 P-05 — GitLab down (CI/CD blocked)

**Detection**

- Alert: `GitLabUnreachable` (CRITICAL)
- Developers: can't push, can't run CI, can't pull from registry
- Already-deployed apps continue running (Nomad doesn't depend on GitLab)

**Triage**

```bash
$ ssh auishqosrgit01 'sudo gitlab-ctl status'
```

- Single VM (chapter 04 §4.1 — CE limit). If process broken, restart; if VM dead, restore from backup.

**Mitigation — restart**

```bash
$ ssh auishqosrgit01 'sudo gitlab-ctl restart'
$ sleep 120
$ curl -k https://git.africanunion.org/-/health
```

**Mitigation — restore from backup (catastrophic)**
Per chapter 19 §19.6 + chapter 20 §20.8:

```bash
# (1) Bring up a fresh GitLab VM with same hostname / IP
$ # ... provision via Ansible (chapter 23 §23.6)
# (2) Restore from latest backup
$ mc cp au-platform/platform-misc/gitlab-backups/$(latest).tar /tmp/
$ ssh auishqosrgit01 "sudo gitlab-rake gitlab:backup:restore BACKUP=$(latest)"
# (3) Restore secrets bundle (it's in a separate file at the same backup dir)
$ # Apply per chapter 04
```

**Verification**

- chapter 40 §40.5 GitLab + Nexus operational test
- A developer pushes a commit; CI pipeline runs to completion

**Post-incident**

- RTO measurement: full restore should be <2h (chapter 19 §19.3)
- If backup-restore was needed: investigate why GitLab can't be HA (CE licence) — Premium upgrade case?

### 41.7 P-06 — MinIO node loss

**Detection**

- Alert: `MinioNodeOffline` (CRITICAL)
- Apps + Loki + Mimir + Tempo: continue to function (EC tolerates 1 node loss)
- Backup writes: queued, will replay when node returns

**Triage**

```bash
$ mc admin info au-platform
$ ssh auishqosrobj<N> 'sudo systemctl is-active minio'
```

**Mitigation**

- If process broken: `sudo systemctl restart minio`
- If disk full: identify culprit bucket, check lifecycle rules, free space
- If hardware loss: provision replacement, mc admin healing

**Verification**

- `mc admin info au-platform` shows 4 online again
- `mc admin heal --recursive` returns clean (no objects to heal)

**Post-incident**

- If 1 node + 1 drive loss happens at the same time: EC threshold is 2; consider expansion (chapter 25 reserved slot)
- Verify site-replication queue (chapter 20 §20.6) drained back to 0

### 41.8 P-07 — Redis Sentinel split-brain

**Detection**

- Alert: `RedisDown` (CRITICAL) for one node, but apps see intermittent connection refusals + cache inconsistency
- Sentinel logs: `+sdown` / `-sdown` flapping

**Triage**

```bash
$ for h in 01 02 03; do
    ssh auishqosrred${h} 'redis-cli -p 26379 sentinel master platform | head -3'
  done
```

- If all 3 agree on the same master IP: no split-brain; one node is just slow
- If they disagree on which IP is master: actual split-brain

**Mitigation — split-brain**

1. Identify the network partition: `mtr` between sentinels
2. Pick the side with the majority of sentinels (it's the legitimate master); demote the minority side to read-only
3. Restart Sentinel on the minority side once the partition heals — they'll re-discover the legit master

**Mitigation — flapping**

- Raise `down-after-milliseconds` from 5000 → 10000 in `/etc/redis/sentinel.conf`
- Restart all 3 sentinels rolling
- Investigate underlying network blip via Loki

**Verification**

- chapter 14 §14.6 round-trip test
- Apps' session error rate returns to baseline

**Post-incident**

- Was the cause network or process? Adjust `down-after-milliseconds` per finding.
- If split-brain caused stale writes: app-level reconciliation may be needed (rare)

### 41.9 P-08 — HAProxy VRRP split-brain

**Detection**

- Both LB VMs claim master state in their notify scripts
- Apps see intermittent connection failures (depending on which LB the gratuitous-ARP cache currently routes to)

**Triage**

```bash
$ for h in 01 02; do ssh auishqosrlb${h} 'ip a show eth0 | grep inet'; done
```

- If both list 10.111.30.100: split-brain confirmed
- VRRP between them is not gossiping

**Mitigation**

1. Identify the partition: `mtr lb01 → lb02`
2. **Stop Keepalived on the lower-priority LB** (auishqosrlb02 — priority 100 vs lb01's 110) to forfeit the VIP
3. Wait 5 sec; verify only one LB has the VIP
4. Restart Keepalived on lb02 once partition heals: `sudo systemctl restart keepalived`

**Verification**

- chapter 17 §17.10 VRRP failover drill (run a small sub-test)
- Only one LB has the VIP; other is `BACKUP` state in journald

**Post-incident**

- Verify VRRP unicast peers are configured (chapter 17 §17.4) — multicast can fail silently on some networks
- If the partition was at the network level: AU IT investigation

### 41.10 P-09 — Cloudflare 521 / origin unreachable

**Detection**

- External users see Cloudflare's 521 error page
- Internal users (bypassing Cloudflare) work fine
- Cloudflare LB monitor shows pool unhealthy

**Triage** (per chapter 18 §18.10 Lesson 1)

```bash
# (1) From external network
$ curl -I https://<app>.africanunion.org/
# Expected: 521 → confirms origin unreachable from Cloudflare's perspective

# (2) From AU IT laptop bypassing corporate WAF
$ # Same curl — if same 521, AU NAT is broken (not corporate filter)

# (3) From the bastion
$ curl -kI https://196.188.248.25/   # AU public IP
$ curl -kI https://<dmz-nginx-internal-ip>/

# Layers: which one fails?
```

**Mitigation**

- AU NAT misconfigured → coordinate with AU IT network team; verify port-forward
- DMZ nginx down → restart it; verify chapter 12 of greenbook deployment
- Origin firewall blocking Cloudflare ranges → refresh allowlist; check `/var/lib/cf-ips-v4.txt` recency

**Verification**

- chapter 40 §40.11 layer-1 + layer-2 + layer-3 pass
- Cloudflare LB monitor returns to healthy

**Post-incident**

- If Cloudflare ranges shifted: ensure `refresh-cf-ips.sh` (chapter 18 §18.6) is healthy
- If NAT was broken: document the AU IT runbook step that recreates it

### 41.11 P-10 — Corporate WAF blocking app traffic

**Detection** (per chapter 18 §18.10 Lessons 3 + 4)

- Internal users get 403 with a 20+ KB HTML body when POSTing to `<app>/.../<something>.data`
- External users work fine
- App logs show no record of the request reaching the origin

**Triage**

```bash
# (1) From internal AU laptop
$ curl -X POST -d '{}' https://<app>.africanunion.org/api/login.data -i
# If response is 20+ KB and "File blocked" / "Quarantined" in body: corporate WAF intercepted

# (2) Bypass with curl from outside AU (or via a non-AU proxy)
# If that works: confirms the issue is AU-internal corporate WAF
```

**Mitigation**

1. Open AU IT ticket: "bypass-list `*.africanunion.org` in corporate filter (Symantec WSS / Bluecoat-class)"
2. Reference chapter 14 §14.10 of greenbook deployment as the precedent
3. While waiting: app team can rename the URL pattern (avoiding `.data`) if business-critical

**Verification**

- Same `curl -X POST` from internal AU returns the legitimate app response
- chapter 40 §40.11 layer-7 passes

**Post-incident**

- Document the URL pattern that triggered the filter
- Consider a periodic test (cron from inside AU) that verifies the bypass-list is still active — corporate WAF rules can drift back

### 41.12 P-11 — Object Lock blocking ops cleanup

**Detection**

- Operator tries to `mc rm` a backup file → "object is WORM protected"
- This is **expected behaviour** — Object Lock GOVERNANCE on backup buckets prevents accidental deletes

**Triage**

- Confirm the deletion is legitimate (not ransomware mitigation)
- Get sign-off from a second operator (deletion has audit + 2-person rule)

**Mitigation**

```bash
# Use the bypass-governance permission (chapter 15 §15.7)
$ mc rm --bypass au-platform/postgres-backups/<file>
# Or override retention temporarily:
$ mc retention set --bypass-governance "" au-platform/postgres-backups/<file>
```

**Verification**

- File is gone from `mc ls`
- Audit trail (Loki: MinIO audit log) records the bypass

**Post-incident**

- Why was the deletion needed? If a real cleanup, document it; if a mistake, the lock did its job
- Verify Object Lock is still active on the bucket: `mc retention info --default au-platform/<bucket>`

### 41.13 Severity declaration + escalation

The on-call operator declares severity in the team channel as the first action:

| Severity | Definition                                                 | Action                                                    |
| -------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| SEV-1    | Platform tier down or critical security incident           | Page primary + secondary on-call; declare in `#incidents` |
| SEV-2    | Significant degradation; users affected; not platform-wide | Page primary; declare in `#incidents`                     |
| SEV-3    | Single-app issue; users not affected                       | Standard on-call response                                 |
| SEV-4    | Maintenance / known issue                                  | Logged but no paging                                      |

Escalation path (until Q6 paging product is selected — chapter 12 §12.9):

- Primary on-call → secondary on-call (5 min)
- Secondary → platform team lead (15 min)
- Platform team lead → AU IT leadership (30 min for SEV-1 only)

### 41.14 Post-incident review

Within 5 working days of any SEV-1 or SEV-2:

1. **Timeline** — minute-by-minute reconstruction from Loki + Teleport audit
2. **Root cause** — the actual cause, not the symptom
3. **What worked** — playbook accurate; alerts fired in time; communication clear
4. **What didn't** — gaps in this chapter's playbook; missing alerts; unclear runbook steps
5. **Action items** — concrete changes to chapters / playbooks / alerts; due date + owner

PIR notes go in GitLab at `docs/runbooks/incidents/<date>-<sev>-<short-name>.md`. Not blameless theatre — actual changes; if the same incident pattern repeats, the chapter wasn't actually updated.

The strongest signal that the incident-response framework is working: the next time the same pattern hits, the on-call operator finds the playbook in this chapter and runs it without needing to ask a more-senior engineer.

---
