# 07 — Keycloak (standalone)

> **Phase**: 2 (identity + observability) · **Run on**: 2× Keycloak VMs (`auishqosrkc01`, `auishqosrkc02`) + 1× Postgres VM (`auishqosrkdb01`) · **Time**: ~3 hours
>
> Identity broker for the platform. Apps + platform services authenticate users via OIDC/SAML against Keycloak; Keycloak validates credentials and issues tokens. **This chapter sets up standalone Keycloak with its own user database**; [chapter 08](08-keycloak-ad.md) federates Keycloak to AU's existing Active Directory so user lifecycle (joiners/leavers) flows from HR's source of truth.
>
> Phase 2 chapter 1 of 6. With Keycloak operational, every Phase 1 service (GitLab, Vault, Nexus, Nomad UI) gets reconfigured for SSO — local accounts kept only as break-glass.
>
> **Prev**: [06 — Nexus](06-nexus.md) · **Next**: [08 — Keycloak federated to AD](08-keycloak-ad.md) · **Index**: [README](README.md)

---

## Contents

- [§7.1 Role + threat model](#71-role-threat-model)
- [§7.2 Pre-flight (Keycloak pair + Postgres backend)](#72-pre-flight-keycloak-pair-postgres-backend)
- [§7.3 Provision the Postgres backend](#73-provision-the-postgres-backend)
- [§7.4 Install Keycloak on both nodes](#74-install-keycloak-on-both-nodes)
- [§7.5 HA cluster configuration](#75-ha-cluster-configuration)
- [§7.6 TLS termination](#76-tls-termination)
- [§7.7 Bootstrap admin + Vault custody](#77-bootstrap-admin-vault-custody)
- [§7.8 Realm setup (the AU realm)](#78-realm-setup-the-au-realm)
- [§7.9 OIDC client templates](#79-oidc-client-templates)
- [§7.10 Backup strategy](#710-backup-strategy)
- [§7.11 Audit logging](#711-audit-logging)
- [§7.12 UFW + firewall rules](#712-ufw-firewall-rules)
- [§7.13 Verification](#713-verification)
- [§7.14 Path to chapter 08 (AD federation)](#714-path-to-chapter-08-ad-federation)

## 7. Keycloak

### 7.1 Role + threat model

Keycloak is the **identity broker**. Every app and platform service that wants SSO talks OIDC or SAML to Keycloak; Keycloak issues tokens after authenticating the user (against its own DB in this chapter, against AD via federation in chapter 08).

Three consequences:

1. **Compromise = bypass authentication for every SSO-integrated service.** An attacker with admin access to Keycloak can mint tokens for any user, edit realm policies, register fraudulent OIDC clients. Defence: TLS, short token lifetimes, limited admin accounts (Phase 2 federation moves admin auth to AD), exhaustive audit logging.
2. **Outage = no new logins anywhere.** Existing tokens remain valid until they expire (typically 5-30 min for access tokens), so logged-in users can keep working briefly. New logins fail until Keycloak is back. Mitigation: HA pair (2 nodes active-active) tolerates single-node loss; Postgres backup for full-data recovery.
3. **Postgres backend = SPOF in Phase 2.** Single dedicated Postgres VM holds all Keycloak state (users, sessions, realm config). Phase 3 [chapter 13 — Postgres HA](13-postgres-ha.md) adds replication; until then, aggressive backup compensates.

**Threat model — what we defend against:**

| Threat                                        | Mitigation                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Stolen admin password                         | Admin password in Vault; chapter 08 swaps to AD-federated admin login                             |
| Brute force against login form                | Built-in brute-force detector enabled on the realm                                                |
| Token tampering                               | Tokens signed with realm RSA key; rotated annually; signature validation at each consumer         |
| Phished refresh token                         | Short access-token TTL (5 min); refresh-token TTL (30 min); operator can force-revoke per session |
| Backup tape stolen → user database disclosure | Backups encrypted at rest; backup tier physically separated from primary                          |
| Postgres data corruption                      | Daily pg_dump + WAL archiving; documented restore procedure                                       |
| OIDC client secret leakage                    | Client secrets stored in Vault, fetched by consumers at startup; rotated quarterly                |

**Phase 2 deliberate non-goals:**

- **AD federation** — that's chapter 08. Phase 2 chapter 7 stands up Keycloak with local accounts; chapter 08 wires the federation.
- **Multi-realm tenant isolation** — single `au` realm for everything. Multi-realm complicates operator UX and isn't needed for AU's scale.
- **Custom themes / branding** — default Keycloak theme is fine for Phase 2; AU branding can be added later without re-architecture.
- **External IdP federation (Google, Azure AD as login provider)** — out of scope. AD federation alone covers AU's identity needs.

### 7.2 Pre-flight (Keycloak pair + Postgres backend)

Three Ubuntu 24.04 VMs hardened to AU base. Skip §1.8. Operator account membership per chapter 02 §2.4.

| Role                | Hostname         | IP           | vCPU | RAM  | Disk      | Notes                               |
| ------------------- | ---------------- | ------------ | ---- | ---- | --------- | ----------------------------------- |
| Keycloak node 1     | `auishqosrkc01`  | 10.111.30.50 | 2    | 8 GB | 80 GB SSD | Active-active pair                  |
| Keycloak node 2     | `auishqosrkc02`  | 10.111.30.51 | 2    | 8 GB | 80 GB SSD | Active-active pair                  |
| Postgres (Keycloak) | `auishqosrkdb01` | 10.111.20.20 | 2    | 4 GB | 80 GB SSD | VLAN 3 (Data); single VM in Phase 2 |

Why dedicated Postgres for Keycloak (not the Phase 3 app DB cluster)? Two reasons: (a) operational separation — Keycloak outage shouldn't cascade through the app DB, and vice versa, (b) different upgrade cadences — Keycloak's schema migrations happen at Keycloak version bumps, independent of app DB changes.

```bash
# [each Keycloak VM + auishqosrkdb01]

$ lsb_release -d
$ sudo systemctl is-active unattended-upgrades fail2ban
$ groups | grep operators
```

### 7.3 Provision the Postgres backend

```bash
# [auishqosrkdb01]

# (1) Install Postgres 16 (matching greenbook deployment chapter 02)
$ sudo apt install -y postgresql-16 postgresql-contrib-16

# (2) Configure listen_addresses for the Keycloak VLAN (Platform)
$ sudo sed -i \
    "s/^#listen_addresses.*/listen_addresses = 'localhost,10.111.20.20'/" \
    /etc/postgresql/16/main/postgresql.conf

# (3) Generate a strong DB password and store in Vault FIRST
$ DB_PASSWORD=$(openssl rand -base64 32 | tr -d '/+' | head -c 32)
$ vault kv put kv/platform/keycloak/db_credentials \
    username='keycloak' \
    password="$DB_PASSWORD" \
    host='auishqosrkdb01' \
    database='keycloak' \
    rotated_at="$(date -Iseconds)"

# (4) Create the database + role
$ sudo -u postgres psql <<EOF
CREATE ROLE keycloak WITH LOGIN PASSWORD '$DB_PASSWORD';
CREATE DATABASE keycloak OWNER keycloak ENCODING 'UTF8' LC_COLLATE='en_US.UTF-8' LC_CTYPE='en_US.UTF-8' TEMPLATE template0;
EOF

# (5) pg_hba.conf — allow only the Keycloak VMs to connect
$ sudo tee -a /etc/postgresql/16/main/pg_hba.conf > /dev/null <<EOF

# Phase 2 chapter 07 — Keycloak nodes
host    keycloak        keycloak        10.111.30.50/32         scram-sha-256
host    keycloak        keycloak        10.111.30.51/32         scram-sha-256
EOF

# (6) Reload Postgres
$ sudo systemctl reload postgresql

# (7) UFW: allow 5432 from Keycloak nodes only
$ sudo ufw allow from 10.111.30.50 to any port 5432 proto tcp comment 'Keycloak kc01'
$ sudo ufw allow from 10.111.30.51 to any port 5432 proto tcp comment 'Keycloak kc02'

# (8) Verify a Keycloak node can connect
# [auishqosrkc01]
$ PGPASSWORD="$DB_PASSWORD" psql -h auishqosrkdb01 -U keycloak -d keycloak \
    -c "SELECT current_user, current_database();"
# Expected: keycloak | keycloak
```

### 7.4 Install Keycloak on both nodes

Keycloak is JVM-based. Same JDK install pattern as Nexus chapter 06.

```bash
# [auishqosrkc01 + auishqosrkc02]

# (1) JDK 17 (Keycloak 23+ requires Java 17)
$ sudo apt install -y openjdk-17-jdk-headless
$ java -version

# (2) Create the keycloak system user
$ sudo useradd --system --create-home --home-dir /opt/keycloak \
    --shell /bin/bash --comment "Keycloak" keycloak

# (3) Download Keycloak — pin a specific version
$ KEYCLOAK_VERSION=24.0.5
$ cd /tmp
$ wget https://github.com/keycloak/keycloak/releases/download/${KEYCLOAK_VERSION}/keycloak-${KEYCLOAK_VERSION}.tar.gz
$ wget https://github.com/keycloak/keycloak/releases/download/${KEYCLOAK_VERSION}/keycloak-${KEYCLOAK_VERSION}.tar.gz.sha256

# (4) Verify checksum
$ sha256sum -c keycloak-${KEYCLOAK_VERSION}.tar.gz.sha256

# (5) Extract
$ sudo tar -xzf keycloak-${KEYCLOAK_VERSION}.tar.gz -C /opt/
$ sudo ln -sf /opt/keycloak-${KEYCLOAK_VERSION} /opt/keycloak/current
$ sudo chown -R keycloak:keycloak /opt/keycloak-${KEYCLOAK_VERSION} /opt/keycloak

# (6) Create config + log directories
$ sudo install -d -m 750 -o keycloak -g keycloak \
    /etc/keycloak \
    /etc/keycloak/tls \
    /var/log/keycloak

# (7) Verify install runs
$ sudo -u keycloak /opt/keycloak/current/bin/kc.sh --version
# Expected: Keycloak 24.0.5
```

### 7.5 HA cluster configuration

Keycloak 23+ uses Quarkus and clusters via Infinispan + JGroups. Two nodes share session state via TCP discovery.

```bash
# [auishqosrkc01 + auishqosrkc02]

# (1) Main config — paths differ per node only in cluster identity
$ sudo tee /etc/keycloak/keycloak.conf > /dev/null <<'EOF'
# Database (shared across both Keycloak nodes via Postgres)
db=postgres
db-url=jdbc:postgresql://auishqosrkdb01:5432/keycloak
db-username=keycloak
# db-password injected via systemd EnvironmentFile (KC_DB_PASSWORD)

# HTTP listener — TLS terminated by local nginx (see §7.6); Keycloak
# itself listens on loopback HTTP and trusts X-Forwarded-* headers
http-enabled=true
http-host=127.0.0.1
http-port=8080
proxy=edge

# Hostname for token-issuer claims
hostname=keycloak.africanunion.org
hostname-strict=false
hostname-strict-https=true

# Cache mode — production HA via JGroups
cache=ispn
cache-stack=tcp
cache-config-file=cache-ispn-tcp.xml

# Logging
log=file
log-level=INFO
log-file=/var/log/keycloak/keycloak.log

# Health + metrics endpoints (for observability stack later)
health-enabled=true
metrics-enabled=true
EOF

# (2) JGroups TCP cache config — tells nodes how to find each other
$ sudo tee /opt/keycloak/current/conf/cache-ispn-tcp.xml > /dev/null <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<infinispan xmlns="urn:infinispan:config:14.0">
  <jgroups>
    <stack name="tcp" extends="udp">
      <TCP bind_addr="match-address:10.111.30.5"/>
      <TCPPING initial_hosts="auishqosrkc01[7800],auishqosrkc02[7800]"/>
      <MERGE3/>
      <FD_SOCK/>
      <FD_ALL3/>
      <pbcast.NAKACK2 use_mcast_xmit="false"/>
      <UNICAST3/>
      <pbcast.STABLE/>
      <pbcast.GMS print_local_addr="true" join_timeout="3000"/>
      <MFC max_credits="2M"/>
      <FRAG2/>
    </stack>
  </jgroups>
  <cache-container name="keycloak">
    <transport stack="tcp"/>
  </cache-container>
</infinispan>
EOF

# (3) systemd unit + EnvironmentFile (DB password from Vault)
$ DB_PASSWORD=$(vault kv get -field=password kv/platform/keycloak/db_credentials)
$ sudo tee /etc/keycloak/env > /dev/null <<EOF
KC_DB_PASSWORD=$DB_PASSWORD
EOF
$ sudo chmod 600 /etc/keycloak/env
$ sudo chown keycloak:keycloak /etc/keycloak/env

$ sudo tee /etc/systemd/system/keycloak.service > /dev/null <<'EOF'
[Unit]
Description=Keycloak
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=keycloak
Group=keycloak
EnvironmentFile=/etc/keycloak/env
ExecStart=/opt/keycloak/current/bin/kc.sh start --optimized \
  --config-file=/etc/keycloak/keycloak.conf
Restart=on-failure
RestartSec=10
LimitNOFILE=102642

[Install]
WantedBy=multi-user.target
EOF

# (4) Build optimised image (one-time per version) — runs DB migrations
#     and prepares the runtime artefacts
$ sudo -u keycloak KC_DB_PASSWORD="$DB_PASSWORD" \
    /opt/keycloak/current/bin/kc.sh build \
      --config-file=/etc/keycloak/keycloak.conf

# (5) First-time-only: create the bootstrap admin user (only on kc01;
#     kc02 picks it up via the shared DB after cluster forms)
# [auishqosrkc01 only]
$ ADMIN_PASSWORD=$(openssl rand -base64 32 | tr -d '/+' | head -c 32)
$ vault kv put kv/platform/keycloak/admin_password \
    username='admin' \
    password="$ADMIN_PASSWORD" \
    rotated_at="$(date -Iseconds)" \
    rotation_period_days=90

$ sudo -u keycloak KEYCLOAK_ADMIN=admin \
    KEYCLOAK_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    /opt/keycloak/current/bin/kc.sh start --optimized \
      --config-file=/etc/keycloak/keycloak.conf &
$ sleep 30
$ sudo kill $(pgrep -f kc.sh)   # stop the bootstrap process

# (6) Enable + start the systemd service on BOTH nodes
$ sudo systemctl daemon-reload
$ sudo systemctl enable --now keycloak

# (7) Verify cluster forms
# [either node]
$ sudo journalctl -u keycloak | grep -i "cluster" | tail -10
# Expected: lines about JGroups views with both nodes joining
```

### 7.6 TLS termination

Like Nexus (chapter 06 §6.5), terminate TLS in a small local nginx that proxies to Keycloak's loopback HTTP port. Avoids managing JVM TLS settings.

```bash
# [auishqosrkc01 + auishqosrkc02]

$ sudo apt install -y nginx

$ sudo install -d -m 755 /etc/nginx/ssl
$ sudo install -m 644 -o root -g root \
    wildcard.africanunion.org.fullchain.pem \
    /etc/nginx/ssl/keycloak.crt
$ sudo install -m 600 -o root -g root \
    wildcard.africanunion.org.key \
    /etc/nginx/ssl/keycloak.key

$ sudo tee /etc/nginx/sites-available/keycloak > /dev/null <<'EOF'
upstream keycloak_app {
    server 127.0.0.1:8080;
    keepalive 16;
}

server {
    listen 80;
    server_name keycloak.africanunion.org;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name keycloak.africanunion.org;

    ssl_certificate     /etc/nginx/ssl/keycloak.crt;
    ssl_certificate_key /etc/nginx/ssl/keycloak.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        proxy_pass http://keycloak_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_buffering off;
        proxy_read_timeout 600s;
    }
}
EOF

$ sudo ln -sf /etc/nginx/sites-available/keycloak /etc/nginx/sites-enabled/keycloak
$ sudo rm -f /etc/nginx/sites-enabled/default
$ sudo nginx -t && sudo systemctl reload nginx
```

**HA endpoint** — `keycloak.africanunion.org` is a DNS A-record pointing to BOTH `auishqosrkc01` and `auishqosrkc02` (DNS round-robin). Phase 3 [chapter 17 — HAProxy](17-haproxy.md) adds active-active LB with health checks; until then, DNS round-robin handles distribution.

### 7.7 Bootstrap admin + Vault custody

Already covered in §7.5 step 5 — the bootstrap admin password is generated, stored in Vault, then used to create the admin user. After the systemd service starts, login at https://keycloak.africanunion.org/admin/ as `admin` with the Vault-stored password.

**Per-operator admin accounts**:

```bash
# Login at https://keycloak.africanunion.org/admin/ as admin (master realm).
# 1. Click "Master" realm → Users → Create new user
# 2. Set username, email, "Email Verified: ON"
# 3. Save → Credentials tab → Set password (strong) → Temporary: OFF
# 4. Role mappings → Realm roles → assign "admin"

# Repeat for each operator. Phase 2 chapter 08 replaces this with
# AD-group-based role assignment.
```

> **ℹ Two realms**
>
> The "master" realm is for managing Keycloak itself — admins, realm management, etc. The "au" realm (created next) is for users + apps + clients. Operator admin accounts live in master; end users (developers, AU staff) live in au.

### 7.8 Realm setup (the AU realm)

```bash
# Login at https://keycloak.africanunion.org/admin/ → switch realm
# selector at top-left → "Create Realm"
# - Realm name: au
# - Display name: African Union
# - Enabled: ON

# Once created, configure realm settings:
# Realm Settings → General
#   - Frontend URL: https://keycloak.africanunion.org
# Realm Settings → Tokens
#   - Default Signature Algorithm: RS256
#   - Access Token Lifespan: 5 minutes
#   - Client Session Idle: 30 minutes
#   - Client Session Max: 12 hours
#   - SSO Session Idle: 30 minutes
#   - SSO Session Max: 12 hours
# Realm Settings → Login
#   - User registration: OFF (Phase 2 standalone; Phase 2 ch08 enables AD federation
#     which makes this irrelevant)
#   - Forgot password: OFF (set up email config first; deferred)
#   - Remember me: OFF
#   - Verify email: ON
# Realm Settings → Security Defenses
#   - Brute Force Detection: enable
#   - Maximum Login Failures: 5
#   - Wait Increment: 60 sec
#   - Quick Login Check Milliseconds: 1000
```

### 7.9 OIDC client templates

Each platform service that uses SSO becomes an OIDC "client" in the au realm. Phase 1 services get reconfigured for SSO once Keycloak is operational.

```bash
# In Keycloak admin UI: au realm → Clients → Create client

# ----- Common settings for every client -----
# Client type: OpenID Connect
# Client ID: <service-name>  (e.g., gitlab, vault, nexus, nomad)
# Client authentication: ON (confidential client)
# Authentication flow: Standard flow (auth code) ON; Direct access grants OFF
# Root URL: https://<service>.africanunion.org
# Valid redirect URIs:
#   - https://<service>.africanunion.org/users/auth/openid_connect/callback  (GitLab)
#   - https://<service>.africanunion.org/auth/realms/au/account/*           (etc)
# Web origins: https://<service>.africanunion.org

# ----- Per client, after creation -----
# Credentials tab → copy the Client Secret
# Store the secret in Vault:
$ vault kv put kv/platform/keycloak/clients/<service> \
    client_id='<service>' \
    client_secret='<paste from UI>' \
    realm='au' \
    issuer='https://keycloak.africanunion.org/realms/au'

# Repeat for each service: gitlab, vault, nexus, nomad, grafana (Phase 2),
# and per-app clients as apps onboard (chapter 30).
```

**Group-based authorisation**:

```bash
# au realm → Groups → Create group
# Standard groups for Phase 2:
#   /platform-engineers   — admin on every platform service
#   /developers           — read on platform services; admin on their own apps
#   /viewers              — read-only across all SSO-integrated UIs
#
# Add users to groups via UI (manual until chapter 08 federates from AD).
# Each app's OIDC scope mapping uses these group memberships for RBAC.
```

### 7.10 Backup strategy

Two things to back up: (a) the Postgres database, (b) the Keycloak realm config (export to JSON for fast disaster recovery).

```bash
# [auishqosrkdb01] — Postgres backup (pg_dump approach for Phase 2;
# Phase 3 chapter 13 introduces pgBackRest with PITR)

$ sudo install -d -m 750 -o postgres -g postgres /var/backups/postgres-keycloak
$ sudo tee /etc/cron.d/keycloak-db-backup > /dev/null <<'EOF'
# Keycloak DB backup hourly
0 * * * * postgres pg_dump -Fc keycloak > /var/backups/postgres-keycloak/keycloak-$(date +\%Y\%m\%d-\%H).dump 2>&1
# Retain 7 days
30 1 * * * postgres find /var/backups/postgres-keycloak -name '*.dump' -mtime +7 -delete
EOF

# [auishqosrkc01] — Realm export (weekly; small files)
$ sudo install -d -m 750 -o keycloak -g keycloak /var/backups/keycloak-realm

$ sudo tee /etc/cron.d/keycloak-realm-export > /dev/null <<'EOF'
# Weekly realm export — DR fast-restore path
0 2 * * 0 keycloak /opt/keycloak/current/bin/kc.sh export --dir=/var/backups/keycloak-realm/$(date +\%Y\%m\%d) --realm=au --users=realm_file 2>&1 | logger -t keycloak-export
EOF
```

### 7.11 Audit logging

Keycloak's events log captures every login, logout, token issuance, admin action.

```bash
# In admin UI: au realm → Realm Settings → Events
# - Save Events: ON
# - Expiration: 90 days (audit trail)
# - Event Listeners: jboss-logging, email (optional, for security alerts)

# Enable admin events too — captures realm config changes
# - Save Admin Events: ON
# - Include Representation: ON  (logs the actual change content)

# Events are stored in the Postgres backend; queryable via API or admin UI
```

For Phase 2 [chapter 09 — Loki + Grafana](09-loki.md), the Keycloak server log file (`/var/log/keycloak/keycloak.log`) is also tailed into Loki for centralised search.

### 7.12 UFW + firewall rules

```bash
# [auishqosrkc01 + auishqosrkc02]

# Allow HTTPS (UI + OIDC endpoints) from App + Platform + Operations VLANs
$ sudo ufw allow from 10.111.10.0/24 to any port 443 proto tcp \
    comment 'App VLAN → Keycloak (apps redirect users for OIDC login)'
$ sudo ufw allow from 10.111.30.0/24 to any port 443 proto tcp \
    comment 'Platform VLAN → Keycloak'
$ sudo ufw allow from 10.111.40.0/24 to any port 443 proto tcp \
    comment 'Operations VLAN → Keycloak (operator admin)'

# 80 → 443 redirect — open 80 same sources
$ sudo ufw allow from 10.111.10.0/24 to any port 80 proto tcp comment 'KC redirect'
$ sudo ufw allow from 10.111.30.0/24 to any port 80 proto tcp comment 'KC redirect'

# JGroups cluster traffic between the two Keycloak nodes (port 7800)
$ sudo ufw allow from 10.111.30.50 to any port 7800 proto tcp comment 'JGroups peer'
$ sudo ufw allow from 10.111.30.51 to any port 7800 proto tcp comment 'JGroups peer'

# DMZ does NOT terminate Keycloak in Phase 2 — internal-only access.
# Phase 3 chapter 17 may add a DMZ proxy for off-prem operator login;
# decision deferred until off-prem need is real.
```

### 7.13 Verification

```bash
# (1) Both nodes alive
$ for h in 01 02; do
    ssh -J au-bastion auishqosrkc${h}.au-internal \
      'sudo systemctl is-active keycloak nginx'
  done
# Expected: active active for each node

# (2) Cluster formed
$ sudo journalctl -u keycloak | grep -i "view received" | tail -3
# Expected: a recent line listing both nodes in the cluster view

# (3) UI reachable + cert valid
$ curl -kI https://keycloak.africanunion.org/
# Expected: HTTP/2 200

# (4) OIDC discovery endpoint works
$ curl -s https://keycloak.africanunion.org/realms/au/.well-known/openid-configuration | jq '.issuer, .authorization_endpoint, .token_endpoint'
# Expected:
#   "https://keycloak.africanunion.org/realms/au"
#   "https://keycloak.africanunion.org/realms/au/protocol/openid-connect/auth"
#   "https://keycloak.africanunion.org/realms/au/protocol/openid-connect/token"

# (5) Login flow works (interactive — via browser)
#     Navigate to https://keycloak.africanunion.org/admin/
#     Login as admin / <Vault-stored password>
#     Switch to "au" realm. Verify operator account exists.

# (6) Realm export works
$ sudo -u keycloak /opt/keycloak/current/bin/kc.sh export \
    --dir=/tmp/realm-test --realm=au --users=realm_file
$ ls -lh /tmp/realm-test/
# Expected: au-realm.json + au-users-0.json
$ sudo rm -rf /tmp/realm-test

# (7) DB backup ran
$ ssh -J au-bastion auishqosrkdb01.au-internal \
    'ls -lh /var/backups/postgres-keycloak/ | head -5'
# Expected: at least one keycloak-*.dump file (after first hour)

# (8) Vault has admin password + at least one client secret
$ vault kv get kv/platform/keycloak/admin_password
$ vault kv list kv/platform/keycloak/clients/
# Expected: list of clients you've created so far
```

**Common failures and remedies:**

| Symptom                                                       | Cause                                                           | Fix                                                                                                                     |
| ------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Keycloak fails to start; log shows "Connection refused: 5432" | Postgres unreachable or pg_hba.conf missing this node           | Verify pg_hba on auishqosrkdb01; firewall opens 5432 from kc01/kc02 IPs                                                 |
| Cluster doesn't form; nodes operate independently             | JGroups TCP port 7800 blocked between nodes                     | Verify UFW rule `from 10.111.30.5{0,1} to any port 7800` on each node; check JGroups bind_addr matches actual interface |
| Login redirects loop after enabling proxy mode                | `proxy=edge` set but X-Forwarded-Proto not propagated correctly | Check nginx site config has `proxy_set_header X-Forwarded-Proto $scheme;`; restart Keycloak                             |
| OIDC client login fails with "Invalid redirect_uri"           | Client config has wrong "Valid redirect URIs" pattern           | Update via admin UI; remember to allow exactly the callback URL the app uses (case-sensitive, trailing slash matters)   |
| Admin UI 500 error after upgrade                              | Build step missed; Quarkus runtime stale                        | Re-run `kc.sh build --config-file=/etc/keycloak/keycloak.conf` after every version change                               |
| Brute force detection blocks legitimate operator              | Maximum login failures (5) hit during password recovery         | Admin UI → Users → find user → Credentials → Reset Password; OR temporarily increase Max Login Failures                 |
| Realm export hangs                                            | Realm contains many users; default timeout                      | Use `--users=different_files --users-per-file=200` to chunk the export                                                  |

### 7.14 Path to chapter 08 (AD federation)

Phase 2 [chapter 08 — Keycloak federated to AD](08-keycloak-ad.md) connects Keycloak to AU's Active Directory:

- AD becomes the user lifecycle source (joiners/leavers)
- Keycloak federates passwords to AD (no parallel password store)
- AD groups map to Keycloak roles (e.g., `au-platform-engineers` AD group → admin role in `master` realm)
- Local accounts kept ONLY for break-glass (the `admin` from §7.7)

The OIDC client configurations from §7.9 don't change — apps continue to authenticate against Keycloak; Keycloak's user source just becomes AD instead of local.

**Phase 1 services adopt SSO:**

Once Keycloak is operational and (optionally) federated to AD, each Phase 1 service gets an OIDC client + integration:

| Service | OIDC client name | Integration mechanism             | Reference                         |
| ------- | ---------------- | --------------------------------- | --------------------------------- |
| GitLab  | `gitlab`         | GitLab OmniAuth + openid_connect  | chapter 04 §4.14                  |
| Vault   | `vault`          | Vault OIDC auth method            | chapter 03 §3.7 (Phase 2 upgrade) |
| Nexus   | `nexus`          | Nexus SAML or LDAP (via Keycloak) | chapter 06 §6.12                  |
| Nomad   | `nomad-ui`       | Nomad ACL + OIDC method           | chapter 05 §5.6 (Phase 2 upgrade) |
| Grafana | `grafana`        | Grafana OAuth                     | chapter 09 §9.x (when drafted)    |

The integration steps go into each service's chapter (or a new appendix section), not here. Chapter 07's job is just to provide the Keycloak realm + OIDC clients.

---
