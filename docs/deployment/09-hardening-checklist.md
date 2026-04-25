# 09 — Hardening checklist

> **Phase**: pre-go-live audit, then quarterly · **Run on**: BOTH VMs · **Time**: ~30 min
>
> Walk through this before declaring "production ready" and again every quarter. Six categories: OS, PostgreSQL, Docker + container, Nginx + TLS, secrets, observability. Most items have already been done by the bring-up files; this is the reviewer's checklist.
>
> **Prev**: [08 — Day-2 operations](08-day-2-operations.md) · **Next**: [10 — Troubleshooting](10-troubleshooting.md) · **Index**: [README](README.md)

---

## 11. Hardening checklist

Treat this as a checklist to walk through before declaring the deployment "production ready" — and again quarterly thereafter.

### 11.1 Operating system

- Ubuntu 24.04 LTS, fully patched. /var/run/reboot-required checked weekly.
- unattended-upgrades enabled and verified delivering security updates.
- UFW active with only the ports in §2.3 open, per VM.
- SSH: password auth OFF, root login OFF, fail2ban active on sshd jail.
- SSH keys rotated annually, or after any laptop/contractor turnover.
- Non-root admin accounts with individual SSH keys (no shared logins).
- Auditd enabled for file-integrity monitoring of /etc and /opt/greenbook.

### 11.2 PostgreSQL

- Authentication is scram-sha-256 (not md5, not trust) for all network clients.
- listen_addresses is localhost + ONLY the internal interface (never 0.0.0.0).
- pg_hba.conf allows ONLY the app VM IP on /32.
- UFW allows 5432 ONLY from the app VM IP.
- Database passwords are >= 24 characters, generated with openssl rand -base64 32 or a password manager.
- Backups: pg_dump daily (§4.10.1) + pgBackRest physical + WAL (§4.10.2).
- Backups replicated offsite (§4.10.3) — tested restore within the last 90 days.
- log_min_duration_statement set to log slow queries; logs reviewed weekly.
- Regular VACUUM / ANALYZE; autovacuum settings reviewed for write-heavy tables.

### 11.3 Docker and the app container

- Docker Engine installed from Docker’s official apt repo, auto-updating with the OS.
- Only the deployer user is in the docker group (which is equivalent to root).
- Container runs as non-root (uid 1000 / node).
- read_only: true with a /tmp tmpfs is set.
- cap_drop: ALL is set; only required caps are added back.
- no-new-privileges is set.
- Resource limits (mem, cpu) are set.
- Port 3000 is published to 127.0.0.1, never 0.0.0.0.
- Image tagged by timestamp version, not just "latest" (for auditable rollback).
- Old images pruned weekly; disk usage trended.

### 11.4 Nginx and TLS

- TLS 1.2 and 1.3 only; no SSLv3, TLS 1.0, TLS 1.1.
- HSTS header set (max-age >= 1 year).
- X-Content-Type-Options: nosniff, X-Frame-Options: DENY, Referrer-Policy set.
- OCSP stapling enabled.
- Certbot renewal timer active and "renew --dry-run" passes.
- Rate limiting in place for sensitive endpoints (login, password reset, etc.) via limit_req_zone / limit_req.
- Certificate expiry monitored (§9.3 script or external).

### 11.5 Secrets

- /etc/greenbook.env is 640 root:deployer.
- No secret is ever committed to the git repo; .env and .env.\* are in .gitignore.
- Any secret that has touched git history has been rotated AND the history purged.
- Session secrets and DB passwords are rotated annually, or on any known exposure.
- For higher-assurance environments, secrets moved to Docker secrets or a Vault / secret manager.

### 11.6 Observability

- An external uptime monitor hits https://greenbook.au.int/healthz every minute.
- The /var/log/nginx/greenbook.error.log is reviewed (or alerted on) daily.
- An on-call rotation exists with agreed response SLAs.
- Runbooks for the top three incident types (DB down, cert expired, disk full) are written and in a known location.

---
