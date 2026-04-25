# Appendix B — Complete configuration files reference

> Every config file produced by the bring-up phase, in full, with no surrounding prose. Use this as a "what should this file look like?" reference when troubleshooting drift on a long-lived deployment.
>
> **Index**: [README](../README.md)

---

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
APP_URL=https://greenbook.au.int
APP_NAME=greenbook-prod
# APP_VERSION injected by deploy.sh via /opt/greenbook/.env

# ─── Logging / observability ─────────────────────────────
LOG_LEVEL=info
SENTRY_DSN=
SENTRY_TRACES_SAMPLE_RATE=0.1

# ─── CORS + rate limiting ────────────────────────────────
CORS_ORIGINS=https://greenbook.au.int
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

Rationale for every field is in [07-deploy-workflow.md §8.2.3](../07-deploy-workflow.md).

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

### B.8 /etc/nginx/sites-available/greenbook.conf

```
upstream greenbook_upstream {
    server 127.0.0.1:3000;
    keepalive 32;
}

map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      '';
}

server {
    listen 80;
    listen [::]:80;
    server_name greenbook.au.int;

    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name greenbook.au.int;

    ssl_certificate     /etc/letsencrypt/live/greenbook.au.int/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/greenbook.au.int/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;
    ssl_stapling        on;
    ssl_stapling_verify on;
    resolver            1.1.1.1 9.9.9.9 valid=300s;
    resolver_timeout    5s;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options    "nosniff" always;
    add_header X-Frame-Options           "DENY" always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin" always;

    client_max_body_size 20m;

    access_log /var/log/nginx/greenbook.access.log;
    error_log  /var/log/nginx/greenbook.error.log warn;

    location = /sw.js {
        proxy_pass http://greenbook_upstream;
        proxy_set_header Host $host;
        add_header Cache-Control "public, max-age=0, must-revalidate" always;
    }

    location ^~ /assets/ {
        proxy_pass http://greenbook_upstream;
        proxy_set_header Host $host;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        expires 1y;
    }

    location = /manifest.json {
        proxy_pass http://greenbook_upstream;
        proxy_set_header Host $host;
        add_header Cache-Control "public, max-age=3600" always;
    }

    location / {
        proxy_pass         http://greenbook_upstream;
        proxy_http_version 1.1;
        proxy_set_header   Connection        $connection_upgrade;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   X-Forwarded-Host  $host;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   X-Correlation-Id  $http_x_correlation_id;
        proxy_connect_timeout 10s;
        proxy_send_timeout    60s;
        proxy_read_timeout    3600s;
        proxy_buffering       off;
    }
}
```

---
