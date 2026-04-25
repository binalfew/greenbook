# 09 — Hardening checklist

> **Phase**: pre-go-live audit, then quarterly · **Run on**: BOTH VMs · **Time**: ~30 min
>
> Walk through this before declaring "production ready" and again every quarter. Six categories: OS, PostgreSQL, Docker + container, Nginx + TLS, secrets, observability. Most items have already been done by the bring-up files; this is the reviewer's checklist.
>
> **Prev**: [08 — Day-2 operations](08-day-2-operations.md) · **Next**: [10 — Troubleshooting](10-troubleshooting.md) · **Index**: [README](README.md)

---

## 11. Hardening checklist

Treat this as a checklist to walk through before declaring the deployment "production ready" — and again quarterly thereafter.

Each item below has the same shape:

- **The rule** in bold (what must be true).
- **Why** it matters in one line (the threat model the rule defends against).
- **Verify with** a command you can paste — pass/fail in seconds, no judgement required.
- **Set in** a pointer to the bring-up section that originally configured it (so when something fails verification, you know where to fix).

If any "Verify with" command shows a different result than the **Pass** line, treat the item as **failed** and either fix immediately or file a follow-up before launch.

### 11.1 Operating system

> Run on **BOTH VMs** unless a row says otherwise.

- **Ubuntu 24.04 LTS, fully patched. No outstanding reboot required.**
  Why: kernel CVEs accumulate; an unpatched VM is the easiest pivot from a remote exploit to host compromise.
  Verify with:

  ```bash
  $ lsb_release -d
  # Pass: "Description: Ubuntu 24.04.x LTS"
  $ apt list --upgradable 2>/dev/null | grep -v "^Listing" | grep -i security | wc -l
  # Pass: 0  (no pending security updates)
  $ test -e /var/run/reboot-required && echo "REBOOT REQUIRED" || echo "no reboot pending"
  # Pass: "no reboot pending"
  ```

  Set in: [01-pre-flight.md §3.1](01-pre-flight.md), [08-day-2-operations.md §9.5](08-day-2-operations.md)

- **`unattended-upgrades` is enabled and applied a security update in the last week.**
  Why: the daemon is the difference between "patched the day a CVE drops" and "patched whenever someone notices".
  Verify with:

  ```bash
  $ systemctl is-active unattended-upgrades
  # Pass: "active"
  $ grep -E '^APT::Periodic::(Update-Package-Lists|Unattended-Upgrade) "1"' /etc/apt/apt.conf.d/20auto-upgrades | wc -l
  # Pass: 2
  $ ls -lt /var/log/unattended-upgrades/unattended-upgrades.log* 2>/dev/null | head -1
  # Pass: a log file modified within the last 7 days
  ```

  Set in: [01-pre-flight.md §3.4](01-pre-flight.md)

- **UFW active and only the ports in [README §2.3](README.md#23-port-map) are open, per VM.**
  Why: any extra open port is a potential entry point; default-deny is the most effective single firewall posture.
  Verify with:

  ```bash
  $ sudo ufw status verbose | grep -E "Status|Default|To"
  # Pass: "Status: active", default "deny (incoming)", and ONLY:
  #   - app VM:  22/tcp, 80/tcp, 443/tcp
  #   - DB  VM:  22/tcp, 5432/tcp from 10.111.11.51 only
  ```

  Set in: [01-pre-flight.md §3.6](01-pre-flight.md), [02-db-vm-setup.md §4.7](02-db-vm-setup.md), [06-app-vm-nginx-tls.md §7.2](06-app-vm-nginx-tls.md)

- **SSH: password auth OFF, root login OFF, key-only.**
  Why: SSH brute-force is the most common automated compromise vector for internet-reachable hosts.
  Verify with:

  ```bash
  $ sudo sshd -T 2>/dev/null | grep -E "^(passwordauthentication|permitrootlogin|pubkeyauthentication) "
  # Pass:
  #   passwordauthentication no
  #   permitrootlogin no
  #   pubkeyauthentication yes
  ```

  Set in: [01-pre-flight.md §3.5](01-pre-flight.md)

- **fail2ban active and the sshd jail is watching.**
  Why: rate-limits brute-force attempts and bans repeat offenders without operator involvement.
  Verify with:

  ```bash
  $ sudo systemctl is-active fail2ban
  # Pass: "active"
  $ sudo fail2ban-client status sshd | grep "Currently failed"
  # Pass: any number — proves the jail is alive (zero is also fine)
  ```

  Set in: [01-pre-flight.md §3.7](01-pre-flight.md)

- **SSH keys rotated within the last 12 months OR after the last laptop/contractor turnover, whichever is sooner.**
  Why: stale keys grant indefinite access; key custody after offboarding is the most-missed step in any rotation cycle.
  Verify with: a calendar entry — there's no on-host check. List who currently has access:

  ```bash
  $ sudo find /root /home -name authorized_keys -exec ls -l {} \; -exec wc -l {} \;
  # Review each authorized_keys file: confirm every key still corresponds to
  # an active operator. Remove entries for departed staff or rotated laptops.
  ```

  Set in: ad-hoc; consider tracking in your runbook.

- **No shared logins. Each operator has a personal sudo account; the only "system" account is `deployer` (app VM only, no sudo).**
  Why: shared accounts destroy audit attribution — `auth.log` can't tell who ran `rm -rf`.
  Verify with:

  ```bash
  $ getent passwd | awk -F: '$3 >= 1000 && $3 < 65534' | sort
  # Review: each row should be one named human or the "deployer" system account.
  # No "ops", "admin", "support" group accounts.
  $ sudo grep -rE '^[A-Za-z]+ ALL=\(ALL' /etc/sudoers /etc/sudoers.d/ 2>/dev/null
  # Review: every sudoer is a named human, NEVER deployer.
  ```

  Set in: [01-pre-flight.md §3.8](01-pre-flight.md)

### 11.2 PostgreSQL

> Run on the **DB VM** (`auishqosrgbdbs01`).

- **Authentication is `scram-sha-256` for every network client. No `md5`, no `trust` over TCP.**
  Why: `md5` is computationally weak by 2026 standards; `trust` is unauthenticated. SCRAM resists pass-the-hash and offline crack attempts.
  Verify with:

  ```bash
  $ sudo -u postgres psql -c "SHOW password_encryption;"
  # Pass: "scram-sha-256"
  $ sudo grep -vE '^#|^$' /etc/postgresql/16/main/pg_hba.conf | awk '{print $1, $5}' | grep -vE '^(local|host|hostssl) (peer|scram-sha-256|reject)$'
  # Pass: empty output. Any non-empty row means a non-SCRAM method on a network rule.
  ```

  Set in: [02-db-vm-setup.md §4.2](02-db-vm-setup.md), [02-db-vm-setup.md §4.5](02-db-vm-setup.md)

- **`listen_addresses` is `localhost,<internal IP>` — never `*` or `0.0.0.0`.**
  Why: `*` means Postgres listens on every interface including any future public NIC; the loss of one firewall rule then exposes the DB to the internet.
  Verify with:

  ```bash
  $ sudo -u postgres psql -c "SHOW listen_addresses;"
  # Pass: "localhost,10.111.11.50"  (or your internal IP)
  $ sudo ss -tlnp | grep ':5432'
  # Pass: only 127.0.0.1:5432 and 10.111.11.50:5432. NOT 0.0.0.0:5432, NOT *:5432.
  ```

  Set in: [02-db-vm-setup.md §4.4](02-db-vm-setup.md)

- **`pg_hba.conf` allows ONLY the app VM IP on `/32`, no broader subnet.**
  Why: a `/24` rule allows every host on the subnet — usually fine, until "every host" includes a workstation that gets compromised.
  Verify with:

  ```bash
  $ sudo grep -E '^host\s' /etc/postgresql/16/main/pg_hba.conf
  # Pass: exactly one line for greenbook —
  #   host    greenbook  appuser  10.111.11.51/32  scram-sha-256
  # Reject: /24, /16, "all/all", "0.0.0.0/0".
  ```

  Set in: [02-db-vm-setup.md §4.5](02-db-vm-setup.md)

- **UFW allows port 5432 ONLY from the app VM IP, not from "Anywhere".**
  Why: belt-and-braces with the pg_hba rule — defends against a misconfigured pg_hba being papered over by an over-permissive firewall.
  Verify with:

  ```bash
  $ sudo ufw status numbered | grep -E '5432|Anywhere'
  # Pass: "5432/tcp ALLOW IN <app-vm-ip>" — exactly one row, no "Anywhere".
  ```

  Set in: [02-db-vm-setup.md §4.7](02-db-vm-setup.md)

- **Database passwords are ≥ 24 chars and generated by `openssl rand -base64 32` or a password manager. Never re-used across environments.**
  Why: short or reused passwords are crackable / leakable.
  Verify with: there's no on-host check (Postgres stores hashes only). Confirm in your password manager that the prod password is unique and was generated, not chosen.

  Set in: [05-app-vm-container.md §6.3 → "Generate the secrets first"](05-app-vm-container.md)

- **Backups: nightly `pg_dump` AND continuous pgBackRest WAL archiving.**
  Why: `pg_dump` recovers from logical corruption (bad app deploy, accidental DELETE); pgBackRest recovers from physical corruption (disk failure) AND supports point-in-time recovery.
  Verify with:

  ```bash
  $ ls -lh /var/backups/postgres/greenbook-*.dump 2>/dev/null | tail -3
  # Pass: at least one .dump from within the last 24h, non-zero size.
  $ sudo -u postgres pgbackrest info
  # Pass: stanza "main", at least one backup listed, "archive: " entries showing
  #       continuous WAL up to a recent timestamp (within the last hour ideally).
  ```

  Set in: [03-db-vm-backups.md §4.10.1](03-db-vm-backups.md), [03-db-vm-backups.md §4.10.2](03-db-vm-backups.md)

- **Backups replicated offsite. Tested restore within the last 90 days.**
  Why: a backup that lives only on the same VM as the database is destroyed by the same fire / ransomware / accidental VM-deletion that destroys the data. An untested backup might not actually restore.
  Verify with:

  ```bash
  $ sudo -u postgres pgbackrest info | grep -E 'repo[12]:'
  # Pass: at least repo1 (local) AND repo2 (offsite) both showing recent backups.
  ```

  Plus: review your runbook for the date of the last successful restore drill. ≥ 90 days ago = fail.

  Set in: [03-db-vm-backups.md §4.10.3](03-db-vm-backups.md)

- **`log_min_duration_statement` is set so slow queries appear in the log.**
  Why: slow queries are the leading cause of user-visible latency; you can't fix what you can't see.
  Verify with:

  ```bash
  $ sudo -u postgres psql -c "SHOW log_min_duration_statement;"
  # Pass: any positive value (250ms is the recommended starting point).
  #       "-1" = disabled = fail.
  ```

  Set in: [02-db-vm-setup.md §4.9](02-db-vm-setup.md), [10-troubleshooting.md §12.6](10-troubleshooting.md)

- **Autovacuum is enabled.**
  Why: write-heavy tables without vacuum eventually bloat to many times the live row count, slowing every query and risking transaction-ID wraparound (catastrophic).
  Verify with:

  ```bash
  $ sudo -u postgres psql -c "SHOW autovacuum;"
  # Pass: "on"
  $ sudo -u postgres psql -d greenbook -c "
      SELECT relname, n_dead_tup, last_autovacuum
      FROM pg_stat_user_tables
      WHERE n_dead_tup > 10000
      ORDER BY n_dead_tup DESC LIMIT 5;"
  # Review: any table with > 10k dead tuples and no recent autovacuum is a
  # candidate for tuning per-table autovacuum_vacuum_scale_factor.
  ```

  Set in: Postgres default (no explicit config needed); the second query is for monitoring.

### 11.3 Docker and the app container

> Run on the **App VM** (`auishqosrgbwbs01`).

- **Docker Engine is from Docker's official apt repo, not Ubuntu's `docker.io` package.**
  Why: `docker.io` lags upstream by months and frequently misses security patches.
  Verify with:

  ```bash
  $ apt-cache policy docker-ce | grep -E 'Installed|download.docker.com'
  # Pass: an "Installed:" line AND a "500 https://download.docker.com/..." line.
  ```

  Set in: [04-app-vm-docker.md §5.2](04-app-vm-docker.md)

- **Only the `deployer` user is in the `docker` group. Personal admin accounts are NOT.**
  Why: `docker` group membership is effectively root (mount /, read /etc/shadow). Restricting it to one purpose-built account limits blast radius.
  Verify with:

  ```bash
  $ getent group docker
  # Pass: "docker:x:NNN:deployer" — only "deployer" after the last colon.
  ```

  Set in: [04-app-vm-docker.md §5.5](04-app-vm-docker.md)

- **Container runs as non-root (uid 1000 / node).**
  Why: a compromise of the Node process can't escalate to root via file writes.
  Verify with:

  ```bash
  $ docker exec greenbook id
  # Pass: "uid=1000(node) gid=1000(node) groups=1000(node)"
  ```

  Set in: [05-app-vm-container.md §6.1](05-app-vm-container.md) (Dockerfile: `USER node`)

- **`read_only: true` with a `/tmp` tmpfs is set on the container.**
  Why: even if an attacker achieves code execution, they can't drop persistent malware onto the image's filesystem.
  Verify with:

  ```bash
  $ docker inspect greenbook --format '{{.HostConfig.ReadonlyRootfs}}'
  # Pass: "true"
  $ docker exec greenbook touch /etc/test 2>&1
  # Pass: "Read-only file system" error
  $ docker exec greenbook touch /tmp/test
  # Pass: succeeds (writable tmpfs at /tmp)
  ```

  Set in: [05-app-vm-container.md §6.4](05-app-vm-container.md)

- **`cap_drop: ALL` and `no-new-privileges:true` are set.**
  Why: drops every Linux capability except those explicitly added back; prevents setuid escalation inside the container.
  Verify with:

  ```bash
  $ docker inspect greenbook --format '{{.HostConfig.CapDrop}} | {{.HostConfig.SecurityOpt}}'
  # Pass: "[ALL] | [no-new-privileges:true]"
  ```

  Set in: [05-app-vm-container.md §6.4](05-app-vm-container.md)

- **Resource limits (memory, CPU) are set.**
  Why: an OOM in one process shouldn't take down the whole VM.
  Verify with:

  ```bash
  $ docker inspect greenbook --format '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}'
  # Pass: non-zero values (e.g. "1073741824 1000000000" = 1 GiB / 1 CPU)
  ```

  Set in: [05-app-vm-container.md §6.4](05-app-vm-container.md)

- **Port 3000 is published to `127.0.0.1`, never `0.0.0.0`.**
  Why: a `0.0.0.0` publish bypasses Nginx and exposes the unauthenticated container directly to the network.
  Verify with:

  ```bash
  $ docker port greenbook 3000
  # Pass: "127.0.0.1:3000"  (NOT "0.0.0.0:3000")
  $ sudo ss -tlnp | grep ':3000'
  # Pass: only "127.0.0.1:3000". 0.0.0.0:3000 = fail.
  ```

  Set in: [05-app-vm-container.md §6.4](05-app-vm-container.md)

- **Image is tagged by timestamp/commit, not just `latest`.**
  Why: `latest` defeats rollback — you can't deterministically point at "the version we ran yesterday" if `latest` keeps moving.
  Verify with:

  ```bash
  $ cat /opt/greenbook/.env
  # Pass: APP_VERSION=YYYY-MM-DD-HHMM (or a git tag), NEVER "latest".
  $ docker inspect greenbook --format '{{.Config.Image}}'
  # Pass: "greenbook:<the timestamp>", not "greenbook:latest".
  ```

  Set in: [07-deploy-workflow.md §8.2.3](07-deploy-workflow.md)

- **Old images pruned; disk usage trended.**
  Why: each deploy leaves a ~700 MB image behind. Without pruning, you eventually fill `/var/lib/docker` and Docker stops working.
  Verify with:

  ```bash
  $ docker system df
  # Pass: "Images" reclaimable ≪ total. If reclaimable > 5 GB, run §9.4 prune.
  $ df -h /var/lib/docker
  # Pass: "Use%" < 80%.
  ```

  Set in: [08-day-2-operations.md §9.4](08-day-2-operations.md)

### 11.4 Nginx and TLS

> Run from your **laptop** (probes the public endpoint), unless noted.

- **TLS 1.2 + 1.3 only. No SSLv3, TLS 1.0, TLS 1.1.**
  Why: pre-1.2 protocols have known break attacks (BEAST, POODLE, FREAK).
  Verify with:

  ```bash
  $ openssl s_client -connect greenbook.au.int:443 -tls1_1 </dev/null 2>&1 | grep -E "Cipher|protocol"
  # Pass: connection FAILS or "Cipher: 0000" — TLS 1.1 must be rejected.
  $ openssl s_client -connect greenbook.au.int:443 -tls1_2 </dev/null 2>&1 | grep "Protocol"
  # Pass: "Protocol: TLSv1.2"
  $ openssl s_client -connect greenbook.au.int:443 -tls1_3 </dev/null 2>&1 | grep "Protocol"
  # Pass: "Protocol: TLSv1.3"
  ```

  Set in: [06-app-vm-nginx-tls.md §7.3](06-app-vm-nginx-tls.md)

- **HSTS header set with `max-age` ≥ 1 year.**
  Why: tells browsers to refuse plain HTTP for the host for that duration; defends against SSL-strip attacks on mixed networks.
  Verify with:

  ```bash
  $ curl -sI https://greenbook.au.int/ | grep -i strict-transport-security
  # Pass: "Strict-Transport-Security: max-age=31536000" (or larger)
  ```

  Set in: [06-app-vm-nginx-tls.md §7.3](06-app-vm-nginx-tls.md)

- **Security headers all present: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.**
  Why: defends against MIME sniffing, clickjacking, and over-sharing referrer URLs.
  Verify with:

  ```bash
  $ curl -sI https://greenbook.au.int/ | grep -E -i "x-content-type-options|x-frame-options|referrer-policy"
  # Pass: all three headers present with the values above.
  ```

  Set in: [06-app-vm-nginx-tls.md §7.3](06-app-vm-nginx-tls.md)

- **OCSP stapling enabled.**
  Why: avoids leaking visitor IPs to the CA on every page load and shaves ~100ms off first connection.
  Verify with:

  ```bash
  $ openssl s_client -connect greenbook.au.int:443 -servername greenbook.au.int -status </dev/null 2>&1 | grep -E "OCSP response:|OCSP Response Status"
  # Pass: "OCSP Response Status: successful (0x0)" appears.
  ```

  Set in: [06-app-vm-nginx-tls.md §7.3](06-app-vm-nginx-tls.md)

- **Certbot auto-renewal timer is active and a dry-run renewal succeeds.**
  Why: the cert expires every 90 days (Let's Encrypt). A failed renewal taken to expiry breaks every login.
  Verify with (on the **app VM**):

  ```bash
  $ systemctl list-timers | grep -i certbot
  # Pass: a timer entry, "next" within the next 24h.
  $ sudo certbot renew --dry-run 2>&1 | tail -5
  # Pass: "Congratulations, all simulated renewals succeeded".
  ```

  Set in: [06-app-vm-nginx-tls.md §7.4](06-app-vm-nginx-tls.md)

- **Edge rate limits configured for `/login`, `/forgot-password`, `/api/*`.**
  Why: greenbook has its own rate limiter at the Express layer, but the Nginx zones run BEFORE Express and protect the Node process from floods Express can't even see.
  Verify with (on the **app VM**):

  ```bash
  $ sudo grep -E "limit_req_zone|limit_req " /etc/nginx/sites-enabled/greenbook.conf
  # Pass: at least one limit_req_zone definition AND at least one limit_req
  #       directive on a sensitive location block.
  ```

  Set in: [06-app-vm-nginx-tls.md §7.3](06-app-vm-nginx-tls.md)

- **Certificate expiry monitored externally (uptime probe / cron alarm).**
  Why: even with auto-renewal, a misconfiguration can stall the renewal silently. The first you'll hear about it is users seeing browser warnings.
  Verify with:

  ```bash
  $ echo | openssl s_client -connect greenbook.au.int:443 -servername greenbook.au.int 2>/dev/null \
      | openssl x509 -noout -enddate
  # Pass: "notAfter=" date is at least 14 days in the future.
  # If less, your monitoring should already be alerting.
  ```

  Set in: [08-day-2-operations.md §9.3](08-day-2-operations.md) (the bash health-monitor)

### 11.5 Secrets

> Run on the **App VM** unless noted.

- **`/etc/greenbook.env` permissions: 640, owner root, group deployer.**
  Why: anything wider exposes secrets to other host users; anything tighter breaks the deployer's ability to run compose.
  Verify with:

  ```bash
  $ stat -c '%a %U %G %n' /etc/greenbook.env
  # Pass: "640 root deployer /etc/greenbook.env"
  ```

  Set in: [05-app-vm-container.md §6.3](05-app-vm-container.md)

- **No secret has been committed to git history. `.env` and `.env.*` are in `.gitignore`.**
  Why: anything ever committed to a repo, even briefly, is in clones / forks / CI build caches forever. Rotation is required, but git-history removal is also required.
  Verify with (run from your **laptop** where you have a clone):

  ```bash
  $ grep -E '^\.env' /Users/binalfew/Projects/greenbook/.gitignore
  # Pass: ".env" or ".env.*" present.
  $ cd /Users/binalfew/Projects/greenbook && git log --all --full-history -- .env 2>/dev/null | head
  # Pass: empty output. Any commit touching a real .env file is a finding.
  ```

  If a secret reached git history: rotate it AND use `git filter-repo` (or BFG) to purge from all commits. Force-push, coordinate re-clones.

  Set in: project-level `.gitignore` (already in repo).

- **`SESSION_SECRET` and DB password rotated within the last 12 months (or on any known exposure).**
  Why: long-lived secrets are eventually leaked through accumulated touch points (CI logs, screen-share captures, support tickets).
  Verify with: there's no on-host check; track the last rotation date in your password manager. ≥ 12 months ago = fail.

  Set in: [05-app-vm-container.md §6.3 → "SESSION_SECRET rotation (zero-downtime)"](05-app-vm-container.md)

- **For higher-assurance environments: secrets moved out of `/etc/greenbook.env` into Docker secrets or a real secret manager (Vault, AWS Secrets Manager).**
  Why: `/etc/greenbook.env` is readable by anyone in the docker group via `docker inspect`. For internal AU intranet that's typically acceptable; for anything regulated (PII at scale, financial), it's not.
  Verify with: this is a posture question — does your threat model accept "any docker-group member can read prod secrets"? If yes, OK; if no, the upgrade path is tracked in the runbook.

  Set in: [05-app-vm-container.md §6.3](05-app-vm-container.md) (the "secrets visible to docker group" callout).

### 11.6 Observability

> Run on the **App VM** unless noted.

- **External uptime monitor probes `https://greenbook.au.int/healthz` at least every minute.**
  Why: relying on internal monitoring to tell you the site is up is circular — if the network split takes out monitoring, you find out from a user.
  Verify with: log into your uptime provider (UptimeRobot / Pingdom / StatusCake / internal monitor) and confirm a check exists, is passing, and is configured for ≤ 60s frequency.

  Set in: [08-day-2-operations.md §9.3](08-day-2-operations.md)

- **`/var/log/nginx/greenbook.error.log` is reviewed (or alerted on) daily.**
  Why: Nginx errors precede most user-visible outages by minutes — backend timeouts, upstream resets, TLS handshake failures all show up here first.
  Verify with:

  ```bash
  $ sudo wc -l /var/log/nginx/greenbook.error.log
  # Review: error count over the last 24h. Spikes = investigate.
  $ sudo tail -50 /var/log/nginx/greenbook.error.log | grep -iE "error|warn|crit" | wc -l
  # Pass: a number you've reviewed, with no surprising spikes.
  ```

  Set in: [08-day-2-operations.md §9.1](08-day-2-operations.md)

- **An on-call rotation exists with agreed response SLA.**
  Why: 3am production failures with no documented escalation path are unrecoverable — every incident becomes a war-room scramble.
  Verify with: confirm your runbook has names + contact methods + working hours + the escalation rule (e.g. "page primary; if no ack in 15 min, page secondary; if no ack in 30 min, alert leadership"). No on-host check.

  Set in: ad-hoc; document in the runbook.

- **Runbooks for the top three incident types: DB down, cert expired, disk full.**
  Why: a runbook is the difference between "outage resolved in 10 min" and "outage resolved in 90 min while we figure out which env file controls what".
  Verify with: a documented runbook exists for each, references the right [10-troubleshooting.md](10-troubleshooting.md) section, and includes the on-call contact.

  Set in: each subsection of [10-troubleshooting.md](10-troubleshooting.md) is a runbook seed. Copy into your incident wiki and add organisation-specific contact details.

---

## Quarterly review template

Copy this block into your reviewer notes each quarter. Fill in the review date, who ran the audit, and any deviations.

```
Greenbook hardening audit — YYYY-Q?
Reviewer: <name>
Date:     YYYY-MM-DD

Pass:
  - [ ] 11.1 Operating system (7 items)
  - [ ] 11.2 PostgreSQL (9 items)
  - [ ] 11.3 Docker and the app container (9 items)
  - [ ] 11.4 Nginx and TLS (7 items)
  - [ ] 11.5 Secrets (4 items)
  - [ ] 11.6 Observability (4 items)

Findings (deviations from the rules above):
  -

Follow-ups (with owner + due date):
  -

Next audit due: YYYY-MM-DD (90 days from now)
```
