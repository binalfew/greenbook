# Appendix B — Complete configuration files reference

> Every config file produced by the bring-up phase, in full, with no surrounding prose. Use this as a "what should this file look like?" reference when troubleshooting drift on a long-lived deployment.
>
> **Index**: [README](../README.md)

---

## Contents

- [§B.1 /etc/ssh/sshd_config.d/99-hardening.conf](#b1-etcsshsshd_configd99-hardeningconf)
- [§B.2 /etc/postgresql/16/main/postgresql.conf (relevant additions)](#b2-etcpostgresql16mainpostgresqlconf-relevant-additions)
- [§B.3 /etc/postgresql/16/main/pg_hba.conf (the relevant line)](#b3-etcpostgresql16mainpg_hbaconf-the-relevant-line)
- [§B.4 /etc/greenbook.env (template)](#b4-etcgreenbookenv-template)
- [§B.5 /opt/greenbook/docker-compose.yml](#b5-optgreenbookdocker-composeyml)
- [§B.6 /etc/pgbackrest.conf](#b6-etcpgbackrestconf)
- [§B.7 /etc/systemd/system/greenbook.service](#b7-etcsystemdsystemgreenbookservice)
- [§B.8 App VM nginx files (multi-tenant)](#b8-app-vm-nginx-files-multi-tenant)

## Appendix B: Complete configuration files reference

### B.1 /etc/ssh/sshd_config.d/99-hardening.conf

```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
KbdInteractiveAuthentication no
X11Forwarding no
MaxAuthTries 3
LoginGraceTime 30
```

### B.2 /etc/postgresql/16/main/postgresql.conf (relevant additions)

```
# Connection
listen_addresses = 'localhost,10.111.11.50'
max_connections = 100

# Memory (example for 8 GB DB VM)
shared_buffers = 2GB
effective_cache_size = 6GB
work_mem = 32MB
maintenance_work_mem = 512MB

# Logging
log_min_duration_statement = 250ms
log_checkpoints = on
log_connections = on
log_disconnections = on
log_lock_waits = on
log_line_prefix = '%m [%p] %q%u@%d '

# WAL / archiving for pgBackRest
wal_level = replica
archive_mode = on
archive_command = 'pgbackrest --stanza=main archive-push %p'
archive_timeout = 60
max_wal_senders = 3
wal_compression = on
checkpoint_timeout = 15min

# Other
random_page_cost = 1.1
```

### B.3 /etc/postgresql/16/main/pg_hba.conf (the relevant line)

```
# TYPE  DATABASE  USER     ADDRESS         METHOD
host    greenbook appuser  10.111.11.51/32    scram-sha-256
```

### B.4 /etc/greenbook.env (template)

```ini
# ─── Required ────────────────────────────────────────────
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://appuser:STRONG_PASSWORD@10.111.11.50:5432/greenbook
SESSION_SECRET=REPLACE_WITH_OPENSSL_RAND_BASE64_48
HONEYPOT_SECRET=REPLACE_WITH_OPENSSL_RAND_BASE64_32
RESEND_API_KEY=re_REPLACE_WITH_REAL_KEY

# ─── Public URL + service metadata ───────────────────────
APP_URL=https://greenbook.africanunion.org
APP_NAME=greenbook-prod
# APP_VERSION injected by deploy.sh via /opt/greenbook/.env

# ─── Logging / observability ─────────────────────────────
LOG_LEVEL=info
SENTRY_DSN=
SENTRY_TRACES_SAMPLE_RATE=0.1

# ─── CORS + rate limiting ────────────────────────────────
CORS_ORIGINS=https://greenbook.africanunion.org
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=300
```

### B.5 /opt/greenbook/docker-compose.yml

The production compose file is shipped as a standalone file in this directory: **[docker-compose.yml](docker-compose.yml)**. Copy it to the app VM with:

```bash
$ scp docs/deployment/appendix/docker-compose.yml \
      deployer@10.111.11.51:/opt/greenbook/docker-compose.yml
```

Stripped (no annotations) form for at-a-glance reference:

```yaml
services:
  app:
    image: greenbook:${APP_VERSION:-latest}
    container_name: greenbook
    restart: unless-stopped
    init: true
    stop_grace_period: 30s
    env_file:
      - /etc/greenbook.env
    environment:
      APP_VERSION: ${APP_VERSION:-dev}
    ports:
      - "127.0.0.1:3000:3000"
    healthcheck:
      test:
        [
          "CMD-SHELL",
          'node -e "fetch(''http://127.0.0.1:3000/healthz'').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" || exit 1',
        ]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 45s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
        tag: "greenbook"
    deploy:
      resources:
        limits:
          memory: 1g
          cpus: "1.0"
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=64m
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
```

Rationale for every field is in [07-deploy-workflow.md §7.2.3](../07-deploy-workflow.md).

### B.6 /etc/pgbackrest.conf

```
[global]
repo1-path=/var/lib/pgbackrest
repo1-retention-full=2
repo1-retention-diff=7
process-max=2
compress-type=zst
compress-level=6
log-level-console=info
log-level-file=detail
start-fast=y
archive-async=y
spool-path=/var/spool/pgbackrest

[main]
pg1-path=/var/lib/postgresql/16/main
pg1-port=5432
pg1-user=postgres
```

### B.7 /etc/systemd/system/greenbook.service

```ini
[Unit]
Description=Greenbook (docker compose)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/greenbook
ExecStart=/usr/bin/docker compose -f /opt/greenbook/docker-compose.yml up -d
ExecStop=/usr/bin/docker compose -f /opt/greenbook/docker-compose.yml down

[Install]
WantedBy=multi-user.target
```

### B.8 App VM nginx files (multi-tenant)

The App VM's nginx is multi-tenant — shared `http {}`-scope config + shared snippets + one per-app server block. Four files ship in [`appendix/app-vm/`](app-vm/):

| File                                                                       | Lives at                                          | Purpose                                                                                                                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`app-vm/00-app-vm-shared.conf`](app-vm/00-app-vm-shared.conf)             | `/etc/nginx/conf.d/00-app-vm-shared.conf`         | WebSocket upgrade `map`, shared rate-limit zones (`app_general`, `app_auth`)                                                                           |
| [`app-vm/app-vm-proxy-headers.conf`](app-vm/app-vm-proxy-headers.conf)     | `/etc/nginx/snippets/app-vm-proxy-headers.conf`   | Shared `proxy_set_header` block + timeouts + buffering policy                                                                                          |
| [`app-vm/greenbook-cache-policy.conf`](app-vm/greenbook-cache-policy.conf) | `/etc/nginx/snippets/greenbook-cache-policy.conf` | Greenbook PWA-specific (`/sw.js`, `/assets/*`, `/manifest.json`)                                                                                       |
| [`app-vm/greenbook.conf`](app-vm/greenbook.conf)                           | `/etc/nginx/sites-available/greenbook.conf`       | Per-app server block — first of N (greenbook today; future apps onboard via [06 §6.6](../06-app-vm-nginx-tls.md#66-adding-a-second-app-on-the-app-vm)) |

Install commands (two hops each — destination is root-owned and `deployer` is no-sudo per [09 §9.1](../09-hardening-checklist.md#91-operating-system); use your personal sudo-capable admin account on the App VM, `greenbook` in the AU's setup):

```bash
# (a) From your laptop — scp all four files in one shot:
$ scp docs/deployment/appendix/app-vm/00-app-vm-shared.conf \
      docs/deployment/appendix/app-vm/app-vm-proxy-headers.conf \
      docs/deployment/appendix/app-vm/greenbook-cache-policy.conf \
      docs/deployment/appendix/app-vm/greenbook.conf \
      greenbook@10.111.11.51:~/

# (b) On the App VM as your admin account:
$ ssh greenbook@10.111.11.51

# Shared http{}-scope config (loads from conf.d/*):
$ sudo install -m 644 -o root -g root \
    ~/00-app-vm-shared.conf /etc/nginx/conf.d/00-app-vm-shared.conf

# Shared + per-app snippets:
$ sudo install -d -m 755 /etc/nginx/snippets
$ sudo install -m 644 -o root -g root \
    ~/app-vm-proxy-headers.conf /etc/nginx/snippets/app-vm-proxy-headers.conf
$ sudo install -m 644 -o root -g root \
    ~/greenbook-cache-policy.conf /etc/nginx/snippets/greenbook-cache-policy.conf

# Per-app server block + symlink + drop the default:
$ sudo install -m 644 -o root -g root \
    ~/greenbook.conf /etc/nginx/sites-available/greenbook.conf
$ sudo ln -sf /etc/nginx/sites-available/greenbook.conf \
              /etc/nginx/sites-enabled/greenbook.conf
$ sudo rm -f /etc/nginx/sites-enabled/default

$ rm ~/00-app-vm-shared.conf ~/app-vm-proxy-headers.conf \
     ~/greenbook-cache-policy.conf ~/greenbook.conf

$ sudo nginx -t && sudo systemctl reload nginx
```

Rationale for every directive — and the breakdown of which directives belong in shared files vs per-app files — is in [06-app-vm-nginx-tls.md §6.3](../06-app-vm-nginx-tls.md#63-the-nginx-server-config). The annotated source for each file lives in [`appendix/app-vm/`](app-vm/) directly.

---
