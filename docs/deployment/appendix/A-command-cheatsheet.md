# Appendix A — Command cheat sheet

> Quick-reference one-liners for the operations you'll repeat most often: deploy, view logs, health probes, on-demand backup + PITR restore, firewall management. All paths are absolute so the commands work from any working directory.
>
> **Index**: [README](../README.md)

---

## Contents

- [§A.1 Deploy](#a1-deploy)
- [§A.2 Logs](#a2-logs)
- [§A.3 Health](#a3-health)
- [§A.4 Backup](#a4-backup)
- [§A.5 Firewall](#a5-firewall)

## Appendix A: Command cheat sheet

Minimal commands you will run most often, with paths fully qualified so they work from any directory.

### A.1 Deploy

```bash
# Deploy the main branch
$ /opt/greenbook/deploy.sh main

# Deploy a specific tag
$ /opt/greenbook/deploy.sh v1.2.3

# Rollback to a previous version
$ echo "APP_VERSION=2026-04-22-0930" > /opt/greenbook/.env
$ docker compose -f /opt/greenbook/docker-compose.yml up -d
```

### A.2 Logs

```bash
# App container — follow
$ docker compose -f /opt/greenbook/docker-compose.yml logs -f app

# App container — last 200
$ docker compose -f /opt/greenbook/docker-compose.yml logs --tail=200 app

# Nginx
$ sudo tail -F /var/log/nginx/greenbook.access.log
$ sudo tail -F /var/log/nginx/greenbook.error.log

# Postgres (on auishqosrgbdbs01)
$ sudo tail -F /var/log/postgresql/postgresql-16-main.log
```

### A.3 Health

```bash
# Local health probe (inside app VM)
$ curl -I http://127.0.0.1:3000/healthz

# Public health probe (from anywhere)
$ curl -I https://greenbook.au.int/healthz

# Container health
$ docker compose -f /opt/greenbook/docker-compose.yml ps
$ docker inspect greenbook --format '{{.State.Health.Status}}'

# TLS cert expiry
$ echo | openssl s_client -connect greenbook.au.int:443 \
  -servername greenbook.au.int 2>/dev/null | \
  openssl x509 -noout -dates
```

### A.4 Backup

```bash
# [auishqosrgbdbs01]
# On-demand full pgBackRest backup
$ sudo -u postgres pgbackrest --stanza=main --type=full backup

# List existing backups
$ sudo -u postgres pgbackrest info

# PITR restore to a specific time (to a scratch instance first!)
$ sudo -u postgres pgbackrest --stanza=main --delta --type=time \
  --target="2026-04-23 14:30:00" restore
```

### A.5 Firewall

```bash
# List rules
$ sudo ufw status verbose

# Numbered list (for deletion by index)
$ sudo ufw status numbered

# Delete rule N
$ sudo ufw delete N

# Reload rules (after editing /etc/ufw/)
$ sudo ufw reload
```

---
