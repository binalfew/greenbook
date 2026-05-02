# 21 — Teleport bastion

> **Phase**: 5 (operational maturity) · **Run on**: 1× Auth Service VM (`auishqostele01`) + 2× Proxy Service VMs behind chapter 17 HAProxy + Teleport node agent on every existing platform VM · **Time**: ~6 hours, plus operator migration window
>
> Upgrade from chapter 02's simple OpenSSH + ProxyJump bastion to Teleport. Adds certificate-based access (no static SSH keys), session recording, protocol-aware RBAC, MFA, just-in-time access, and unified application + database access. The Phase 1 bastion stays as fallback during migration; once all operators have moved, it's decommissioned.
>
> Phase 5 chapter 1 of 3.
>
> **Prev**: [20 — DR site](20-dr-site.md) — _closes Phase 4_ · **Next**: [22 — Dynamic Vault secrets](22-dynamic-secrets.md) · **Index**: [README](README.md)

---

## Contents

- [§21.1 Role + threat model](#211-role-threat-model)
- [§21.2 Architecture (Auth + Proxy + Nodes)](#212-architecture-auth-proxy-nodes)
- [§21.3 Pre-flight (3 new VMs + agents on every existing host)](#213-pre-flight-3-new-vms-agents-on-every-existing-host)
- [§21.4 Install + bootstrap the Auth Service](#214-install-bootstrap-the-auth-service)
- [§21.5 Proxy Service pair](#215-proxy-service-pair)
- [§21.6 Node agents (every platform VM)](#216-node-agents-every-platform-vm)
- [§21.7 SSO via Keycloak (chapter 07 OIDC)](#217-sso-via-keycloak-chapter-07-oidc)
- [§21.8 Roles + just-in-time access](#218-roles-just-in-time-access)
- [§21.9 Application access + database access](#219-application-access-database-access)
- [§21.10 Session recording + audit](#2110-session-recording-audit)
- [§21.11 Migration from chapter 02 simple bastion](#2111-migration-from-chapter-02-simple-bastion)
- [§21.12 UFW + Verification](#2112-ufw-verification)
- [§21.13 Decommissioning chapter 02's bastion](#2113-decommissioning-chapter-02s-bastion)

## 21. Teleport bastion

### 21.1 Role + threat model

The Phase 1 bastion (chapter 02) was correct for its time: OpenSSH + ProxyJump + auditd + DNS-driven HA. As the platform's operator count grows beyond a few people and as the audit posture tightens, three things become limiting:

1. **Static SSH keys** — issued forever, stored on operator laptops, cleanup-after-departure is manual, theft is invisible.
2. **No protocol-aware RBAC** — `/etc/ssh/sshd_config` can grant or deny shell access; it cannot say "this operator may SSH only to Postgres VMs and only run psql, not bash."
3. **Audit is per-host journald** — to investigate "who ran what across the platform last Tuesday," you query 30 different `/var/log/auth.log` files.

Teleport replaces all three with **short-lived certificates** (15-minute default TTL), **role-based protocol filtering** (per-resource, per-command), and **central session recording + audit** (every keystroke, every database query, every web-UI click).

Three consequences:

1. **Compromise = total operator-tier exposure.** Teleport's Auth Service is the new keys-to-the-kingdom. Defence: dedicated VM in Operations VLAN; backed up per chapter 19; recovery codes split between custodians (same Shamir split pattern as Vault root tokens); MFA required on every operator login.
2. **Outage = operators can't reach platform VMs.** Mitigation: 2-Proxy HA active-active behind chapter 17 HAProxy; Auth Service backed by Postgres HA (chapter 13) for state durability; **chapter 02's simple bastion stays operational as fallback** for at least 90 days post-migration.
3. **Misconfigured RBAC is the realistic failure mode.** A role granted "ssh to all hosts" defeats the point of Teleport. Defence: roles in GitLab with code review; quarterly RBAC audit; principle of least privilege (start everyone as "viewer + JIT"; elevate only on requested+approved access).

**Threat model — what we defend against:**

| Threat                                               | Mitigation                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Stolen long-lived SSH key                            | Eliminated — certs are 15-min TTL; theft buys at most 15 min of access                                        |
| Operator departure leaves dormant credentials        | Keycloak group removal → next cert refresh fails → access revoked within 15 min                               |
| Privilege escalation via shell features              | Roles can restrict to specific commands; recording captures the attempt                                       |
| Insider abuse (curiosity browsing of sensitive data) | Session recording + log-based alert on unusual command patterns; deterrent + forensic                         |
| Forgotten DB queries with PII                        | Database access is recorded protocol-level (queries + responses); pattern alerts in Loki                      |
| MITM on operator's connection                        | Teleport client verifies Auth Service cert; cert chain rooted at Vault PKI (chapter 22)                       |
| Auth Service compromise                              | Backups (ch19), Postgres HA backend (ch13), recovery code split between custodians                            |
| Bypass via the legacy bastion during migration       | Time-boxed: legacy bastion decommissioned 90 days after Teleport adoption (§21.13); UFW logs every legacy SSH |

**Phase 5 deliberate non-goals:**

- **Cloud-hosted Teleport (Teleport Cloud)** — keeps audit trail outside AU; out of scope for compliance reasons.
- **Per-operator desktop tools beyond `tsh`** — `tsh` covers SSH, kubectl, psql, MySQL, MongoDB, Redis, app web access. No need for proprietary IDE plugins.
- **Replacing AD as the operator directory** — Teleport authenticates operators via Keycloak (which federates AD per chapter 08). AD remains the source of truth.
- **Workload identity for apps** — that's the Nomad JWT workload identity from chapter 05 + Vault dynamic secrets (chapter 22). Teleport is operator access; chapter 22 is workload access.

### 21.2 Architecture (Auth + Proxy + Nodes)

Teleport ships three services. Smallest deployment puts them on separate VMs:

```
                 ┌─────────────────────────────────────────────────┐
                 │  Operator laptop                                │
                 │  - tsh login (OIDC → Keycloak → AD)             │
                 │  - tsh ssh / tsh db / tsh app                   │
                 └────────────────────┬────────────────────────────┘
                                      │ HTTPS to teleport.africanunion.org
                                      ▼
                 ┌─────────────────────────────────────────────────┐
                 │  Cloudflare → AU NAT → DMZ nginx → HAProxy VIP  │
                 │  (chapter 18 + 17)                              │
                 └────────────────────┬────────────────────────────┘
                                      │
                 ┌────────────────────┴────────────────────┐
                 ▼                                          ▼
        ┌──────────────────┐                       ┌──────────────────┐
        │ Proxy 01         │                       │ Proxy 02         │
        │ - Web UI         │                       │ - Same           │
        │ - Reverse-tunnel │                       │                  │
        │   target for     │                       │                  │
        │   nodes          │                       │                  │
        └────────┬─────────┘                       └─────────┬────────┘
                 │                                            │
                 └─────────────────┬──────────────────────────┘
                                   │ gRPC
                                   ▼
                 ┌──────────────────────────────────────────────────┐
                 │  Auth Service (auishqostele01)                   │
                 │  - Certificate authority                         │
                 │  - RBAC engine                                   │
                 │  - Session recording store                       │
                 │  - Postgres backend (chapter 13's app DB)        │
                 └──────────────────────────────────────────────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              │                                         │
              ▼                                         ▼
   Every existing platform VM           App + DB access (Vault, GitLab,
   runs the Teleport node agent          Grafana, Postgres, Redis, MinIO)
   as systemd service
```

The **node agent** model: every existing platform VM gets a small `teleport` daemon installed. It establishes a reverse tunnel to the Proxy Service (so the Proxy never needs direct network access _to_ every host). When an operator runs `tsh ssh user@platform-vm`, the Proxy routes the connection through the reverse tunnel.

This design eliminates the "operator IP must be allowed to every host" problem from chapter 02 — the Proxy is the only ingress point per VLAN; everything else is locked down at L4.

### 21.3 Pre-flight (3 new VMs + agents on every existing host)

| Role              | Hostname            | IP           | vCPU | RAM  | Disk   | Notes                                                        |
| ----------------- | ------------------- | ------------ | ---- | ---- | ------ | ------------------------------------------------------------ |
| Auth Service      | `auishqostele01`    | 10.111.40.50 | 4    | 8 GB | 100 GB | Single VM Phase 5; ch24 Postgres backend HA-ifies            |
| Proxy Service 1   | `auishqostele-px01` | 10.111.30.95 | 4    | 8 GB | 60 GB  | Public-facing via chapter 17 HAProxy + chapter 18 Cloudflare |
| Proxy Service 2   | `auishqostele-px02` | 10.111.30.96 | 4    | 8 GB | 60 GB  | Active-active with px01                                      |
| **Auth backend**  | (chapter 13 app DB) | —            | —    | —    | —      | Reuses existing Postgres cluster — schema `teleport`         |
| **Audit storage** | (chapter 15 MinIO)  | —            | —    | —    | —      | Reuses MinIO bucket `teleport-recordings`                    |

The Auth Service in **Operations VLAN** (10.111.40.0/24) — alongside bastions and Ansible. Proxies in **Platform VLAN** (10.111.30.0/24) since they're operator-facing and HAProxy fronts them.

```bash
# [each new VM]
$ lsb_release -d
$ sudo systemctl is-active unattended-upgrades fail2ban
$ groups | grep operators

# Hostname resolution
$ getent hosts teleport.africanunion.org   # public — Cloudflare → DMZ → HAProxy → Proxy VMs
$ getent hosts teleport-auth.au-internal   # internal — Auth Service
```

DNS: `teleport.africanunion.org` is a public Cloudflare-proxied A record (via chapter 18). `teleport-auth.au-internal` is internal-only.

### 21.4 Install + bootstrap the Auth Service

```bash
# [auishqostele01]

# (1) Install Teleport from upstream
$ TELEPORT_VERSION=16.4.0
$ curl -fsSL https://goteleport.com/static/install.sh | sudo bash -s ${TELEPORT_VERSION}
$ teleport version

# (2) Service user + dirs (apt package creates teleport user)
$ id teleport
$ sudo install -d -m 750 -o teleport -g teleport \
    /etc/teleport \
    /var/lib/teleport \
    /var/log/teleport

# (3) Auth Service config
$ sudo tee /etc/teleport.yaml > /dev/null <<'EOF'
version: v3

teleport:
  nodename: auishqostele01
  data_dir: /var/lib/teleport
  log:
    output: stderr
    severity: INFO
    format:
      output: text
  storage:
    type: postgres
    conn_string: postgres://teleport:<PG_PASS>@pgbouncer.au-internal:6432/teleport?sslmode=require
    audit_events_uri:
      - postgres://teleport:<PG_PASS>@pgbouncer.au-internal:6432/teleport?sslmode=require
    audit_sessions_uri: s3://teleport-recordings?endpoint=minio.africanunion.org&region=au-platform&insecure=false

auth_service:
  enabled: true
  cluster_name: au-platform
  listen_addr: 0.0.0.0:3025
  authentication:
    type: oidc                       # SSO via Keycloak (§21.7)
    second_factor: webauthn          # MFA enforced
    webauthn:
      rp_id: teleport.africanunion.org
  session_recording: node-sync       # record on the node, sync to MinIO
  proxy_listener_mode: multiplex
  tokens:
    - "proxy,node:bootstrap-token-rotated-after-first-use"

ssh_service:
  enabled: false                     # Auth doesn't serve SSH

proxy_service:
  enabled: false
EOF

# (4) Provision the Postgres schema for Teleport storage
$ PG_PASS=$(openssl rand -base64 32)
$ vault kv put kv/platform/teleport/db \
    username='teleport' password="$PG_PASS" \
    rotated_at="$(date -Iseconds)" rotation_period_days=90

$ ssh -J au-bastion auishqosrpdb01.au-internal "sudo -u postgres psql <<EOF
  CREATE ROLE teleport LOGIN PASSWORD '$PG_PASS';
  CREATE DATABASE teleport OWNER teleport;
  ALTER ROLE teleport SET statement_timeout = '30s';
EOF"

# Substitute the password into the config
$ sudo sed -i "s|<PG_PASS>|$PG_PASS|g" /etc/teleport.yaml
$ sudo chown teleport:teleport /etc/teleport.yaml
$ sudo chmod 600 /etc/teleport.yaml

# (5) Provision the MinIO bucket for session recordings
$ mc mb au-platform/teleport-recordings
$ mc retention set --default GOVERNANCE 90d au-platform/teleport-recordings
$ mc encrypt set sse-s3 au-platform/teleport-recordings

# Create a service account for Teleport's S3 access
$ cat > /tmp/policy-teleport.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow",
      "Action": ["s3:GetObject","s3:PutObject","s3:ListBucket","s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::teleport-recordings","arn:aws:s3:::teleport-recordings/*"] }
  ]
}
EOF
$ mc admin policy create au-platform teleport-policy /tmp/policy-teleport.json
$ mc admin user svcacct add au-platform root --name teleport-svc --policy-file /tmp/policy-teleport.json
# Capture access + secret keys; vault kv put kv/platform/minio/teleport ...

# (6) Start Auth Service
$ sudo systemctl enable --now teleport
$ sudo systemctl status teleport --no-pager | head -5
$ tctl status   # local CLI on Auth Service

# (7) Generate a recovery code split (Shamir 5-of-3) — same custodian pattern as Vault
$ tctl admin sign --user=admin --out=/tmp/admin-cert
# Distribute admin recovery to 5 named custodians; require 3 to recover
```

### 21.5 Proxy Service pair

```bash
# [auishqostele-px01-02]

# (1) Same install as Auth
$ TELEPORT_VERSION=16.4.0
$ curl -fsSL https://goteleport.com/static/install.sh | sudo bash -s ${TELEPORT_VERSION}

# (2) Get a join token from Auth (run on auishqostele01)
$ tctl tokens add --type=proxy --ttl=1h
# Outputs: <PROXY_JOIN_TOKEN>

# (3) Proxy config (same on both — px02 differs only in nodename)
$ sudo tee /etc/teleport.yaml > /dev/null <<EOF
version: v3

teleport:
  nodename: $(hostname -s)
  data_dir: /var/lib/teleport
  log:
    output: stderr
    severity: INFO
  auth_servers:
    - teleport-auth.au-internal:3025
  auth_token: <PROXY_JOIN_TOKEN>

auth_service:
  enabled: false

ssh_service:
  enabled: false

proxy_service:
  enabled: true
  listen_addr: 0.0.0.0:3023
  web_listen_addr: 0.0.0.0:3080
  tunnel_listen_addr: 0.0.0.0:3024
  public_addr: teleport.africanunion.org:443
  https_keypairs:
    - key_file: /etc/teleport/tls.key
      cert_file: /etc/teleport/tls.crt
EOF

# (4) Install the Cloudflare Origin CA cert (chapter 18 §18.5) — Cloudflare → Proxy strict TLS
$ vault kv get -field=cert_pem kv/platform/cloudflare/origin_cert | \
    sudo tee /etc/teleport/tls.crt
$ vault kv get -field=key_pem kv/platform/cloudflare/origin_cert | \
    sudo tee /etc/teleport/tls.key
$ sudo chown teleport:teleport /etc/teleport/tls.{crt,key}
$ sudo chmod 600 /etc/teleport/tls.key

# (5) Enable + verify
$ sudo systemctl enable --now teleport
$ curl -sk https://127.0.0.1:3080/healthz
# Expected: HTTP 200

# (6) Add the Proxy VMs to chapter 17's HAProxy as a new backend pool
# [auishqosrlb01-02]
$ sudo tee /etc/haproxy/conf.d/50-teleport.cfg > /dev/null <<'EOF'
listen teleport-https
    bind 10.111.30.102:443    # the lb-apps VIP from ch17 §17.5.5
    mode tcp                  # SSL passthrough — Teleport handles TLS itself
    option tcplog
    timeout client 1h
    timeout server 1h
    balance leastconn
    option tcp-check
    tcp-check connect port 443 ssl
    default-server inter 5s fall 2 rise 3 maxconn 1000

    server tele-px01 10.111.30.95:443 check
    server tele-px02 10.111.30.96:443 check
EOF
$ sudo systemctl reload haproxy
```

### 21.6 Node agents (every platform VM)

```bash
# [every existing platform VM — all bastions, Vault, Nomad, Consul, GitLab, Nexus,
#  Keycloak, Postgres, Redis, MinIO, PgBouncer, HAProxy, LB, observability hosts]

# (1) Same install
$ TELEPORT_VERSION=16.4.0
$ curl -fsSL https://goteleport.com/static/install.sh | sudo bash -s ${TELEPORT_VERSION}

# (2) Get a node join token from Auth
# [auishqostele01]
$ tctl tokens add --type=node --ttl=24h
# Outputs: <NODE_JOIN_TOKEN>

# (3) Node config — derives labels from the host's role
$ ROLE=$(grep -oP '(?<=^role: )\w+' /etc/promtail/config.yml || echo "unknown")
$ sudo tee /etc/teleport.yaml > /dev/null <<EOF
version: v3

teleport:
  nodename: $(hostname -s)
  data_dir: /var/lib/teleport
  log:
    output: stderr
    severity: INFO
  auth_servers:
    - teleport.africanunion.org:443     # join via the Proxy (handles reverse tunnel)
  auth_token: <NODE_JOIN_TOKEN>

ssh_service:
  enabled: true
  labels:
    role: $ROLE
    vlan: $(hostname -s | grep -oP '(?<=auishqo)[a-z]+' | head -c 4)
    env: prod
  commands:
    - name: hostname
      command: ['hostname']
      period: 1h

auth_service:
  enabled: false

proxy_service:
  enabled: false
EOF

# (4) Enable + verify
$ sudo systemctl enable --now teleport
$ sudo systemctl status teleport --no-pager | head -5

# (5) Confirm registration with Auth (run on auishqostele01)
$ tctl nodes ls
# Expected: every platform VM listed with role + vlan labels
```

The `labels` block is what makes RBAC tractable — roles in §21.8 grant access by label match (`role: vault` for "DBAs see Postgres only", etc.).

### 21.7 SSO via Keycloak (chapter 07 OIDC)

```bash
# (1) Create the Teleport OIDC client in Keycloak (chapter 07 §7.9)
# Via Keycloak admin UI:
#   Clients → Create
#   Client ID: teleport
#   Client authentication: On
#   Valid redirect URIs: https://teleport.africanunion.org/v1/webapi/oidc/callback
#   Web origins: https://teleport.africanunion.org

# Mappers: ensure 'groups' scope is added
# Capture the client secret → Vault
$ vault kv put kv/platform/keycloak/clients/teleport \
    client_id='teleport' \
    client_secret='<from KC>' \
    rotated_at="$(date -Iseconds)" \
    rotation_period_days=180

# (2) Configure Teleport's OIDC connector
$ tctl create -f <(cat <<EOF
kind: oidc
version: v3
metadata:
  name: keycloak
spec:
  redirect_url: "https://teleport.africanunion.org/v1/webapi/oidc/callback"
  client_id: teleport
  client_secret: $(vault kv get -field=client_secret kv/platform/keycloak/clients/teleport)
  issuer_url: "https://keycloak.africanunion.org/realms/au"
  scope: ["openid", "email", "profile", "groups"]
  claims_to_roles:
    - claim: groups
      value: au-platform-engineers
      roles: ["platform-admin"]
    - claim: groups
      value: au-platform-operators
      roles: ["platform-operator"]
    - claim: groups
      value: au-app-developers
      roles: ["app-developer"]
    - claim: groups
      value: au-dba
      roles: ["dba"]
EOF
)

# (3) Disable local-account login (everyone uses SSO; preserve a break-glass admin)
$ tctl edit cap/cluster-auth-preference
# Change type to oidc; keep allow_local_auth: true for the break-glass account only
```

Operators now `tsh login --proxy=teleport.africanunion.org` → browser opens → Keycloak → AD → certificate issued (15-min TTL). When the cert expires, run `tsh login` again — same SSO flow.

### 21.8 Roles + just-in-time access

Teleport roles are YAML resources stored in the Auth Service. Each role grants:

- **Allow rules** — what resources / actions the role grants
- **Deny rules** — explicit overrides that win over allows
- **Logins** — what Linux user the role can SSH as
- **Labels** — which nodes match the role
- **Commands** — explicit per-command allowlist (optional; powerful)

Initial roles:

```bash
# platform-admin: full access (replaces "everyone has root" pattern)
$ tctl create -f <(cat <<'EOF'
kind: role
version: v7
metadata:
  name: platform-admin
spec:
  allow:
    logins: ['root', 'ubuntu']
    node_labels:
      '*': '*'
    rules:
      - resources: ['*']
        verbs: ['*']
  options:
    max_session_ttl: 8h
    require_session_mfa: true
EOF
)

# platform-operator: read everywhere, write only with JIT (just-in-time) elevation
$ tctl create -f <(cat <<'EOF'
kind: role
version: v7
metadata:
  name: platform-operator
spec:
  allow:
    logins: ['ubuntu']
    node_labels:
      env: prod
    rules:
      - resources: ['session', 'node']
        verbs: ['list', 'read']
    request:
      roles: ['platform-admin']        # may request elevation
      thresholds:
        - approve: 1
          deny: 1
  options:
    max_session_ttl: 4h
    require_session_mfa: true
EOF
)

# dba: SSH only to Postgres VMs; psql access via tsh db
$ tctl create -f <(cat <<'EOF'
kind: role
version: v7
metadata:
  name: dba
spec:
  allow:
    logins: ['postgres']
    node_labels:
      role: postgres
    db_labels:
      env: prod
    db_users: ['postgres', 'app_*']
    db_names: ['*']
  options:
    max_session_ttl: 4h
    require_session_mfa: true
EOF
)

# app-developer: SSH to App VLAN only; app + log access via tsh app
$ tctl create -f <(cat <<'EOF'
kind: role
version: v7
metadata:
  name: app-developer
spec:
  allow:
    logins: ['ubuntu']
    node_labels:
      vlan: app
    app_labels:
      env: prod
  options:
    max_session_ttl: 4h
    require_session_mfa: true
EOF
)
```

**Just-in-time access**: `platform-operator` can request `platform-admin` elevation for a specific incident, citing reason. Another operator approves; the elevation is time-boxed and logged. The default state for everyone is "viewer" — elevation is the exception, not the norm.

```bash
# Operator requests elevation
$ tsh request create --roles=platform-admin --reason="incident #4521: Postgres failover"

# Approver reviews + approves (or denies) via web UI or CLI
$ tsh request review --approve <request-id> --reason="Approved per oncall rotation"

# Operator's tsh login refreshes; cert now includes platform-admin
$ tsh login
$ tsh ssh root@auishqosrpdb01
```

Quarterly RBAC audit: dump all roles to GitLab; diff against last quarter; review every role grant against actual usage in audit logs.

### 21.9 Application access + database access

Teleport proxies more than SSH. Apps and databases gain the same audit trail.

**Application access** — proxy internal web UIs through Teleport:

```bash
# Vault, GitLab, Grafana, MinIO console, Nomad UI, Consul UI all become tsh app...
$ tctl create -f <(cat <<'EOF'
kind: app
version: v3
metadata:
  name: vault
  description: HashiCorp Vault UI
  labels:
    env: prod
    role: vault
spec:
  uri: https://vault.au-internal:8200
  insecure_skip_verify: false
  rewrite:
    headers:
      - "X-Forwarded-Proto: https"
EOF
)

# Operator usage
$ tsh app login vault
$ tsh app config vault
# Outputs a curl command with a short-lived token; or open the rewritten URL in browser
```

Same pattern for GitLab, Grafana, MinIO console, etc. The benefit: every UI click against an admin interface is recorded in Teleport's audit log.

**Database access** — psql + redis-cli through `tsh db`:

```bash
$ tctl create -f <(cat <<'EOF'
kind: db
version: v3
metadata:
  name: postgres-app
  description: Application Postgres cluster (RW endpoint)
  labels:
    env: prod
    role: postgres
spec:
  protocol: postgres
  uri: pg-rw.au-internal:5433
  tls:
    mode: verify-ca
    ca_cert: /etc/teleport/au-internal-ca.pem
EOF
)

# DBA usage
$ tsh db login --db-user=postgres postgres-app
$ tsh db connect postgres-app
# Drops into psql; every query logged to Teleport audit
```

The DBA never sees the actual Postgres password; Teleport mints a short-lived cert, Postgres validates via the cert chain. **This is the bridge to chapter 22 (Dynamic Vault secrets)** — Teleport's DB cert can be backed by Vault's PKI engine for full lifecycle control.

### 21.10 Session recording + audit

Every interactive session is recorded:

- **SSH sessions** — every keystroke + every server-side response, replayable via `tsh play <session-id>`
- **Database sessions** — every query + response (truncated for huge result sets)
- **Application sessions** — each HTTP request + response headers (bodies optional)

Storage: chunks land on the node's local disk first, sync asynchronously to MinIO `teleport-recordings` bucket (set up in §21.4). Object Lock GOVERNANCE prevents tamper; chapter 19 §19.7 quarterly drills verify recordings are replayable.

```bash
# Search audit log for a specific user / time range
$ tctl get audit | jq '.[] | select(.user == "binalfew@africanunion.org") | select(.time > "2026-05-01")'

# Replay a session
$ tsh play <session-id>

# Export sessions for compliance review
$ tctl audit search --from=2026-05-01 --to=2026-05-31 --user=binalfew@africanunion.org > /tmp/audit.json
```

The audit log itself ships to Loki via the Teleport audit_events_uri Postgres table (Promtail watches the rows, ships them to Loki — same pattern as Vault audit). Chapter 12's ruler gets a new alert:

```yaml
# Add to chapter 12 §12.7 Loki ruleset
- alert: TeleportSessionRecordingFailed
  expr: |
    sum(rate({role="teleport"} |~ "session recording failed|upload failed" [10m])) > 0
  for: 5m
  labels:
    severity: critical
    service: teleport
  annotations:
    summary: "Teleport session recording is failing — audit gap is forming"

- alert: TeleportFailedLogins
  expr: |
    sum by (user) (rate({role="teleport"} |~ "login failed" [5m])) > 3
  for: 5m
  labels:
    severity: warning
    service: teleport
  annotations:
    summary: "{{ $labels.user }}: >3 failed Teleport logins/min"
```

### 21.11 Migration from chapter 02 simple bastion

The Phase 1 bastion stays operational throughout migration. Operators move at their own pace within a 90-day window:

| Day        | Milestone                                                                                |
| ---------- | ---------------------------------------------------------------------------------------- |
| Day 0      | Teleport Auth + Proxies + Node agents fully deployed; SSO works                          |
| Days 1-30  | Each operator does first `tsh login`; verifies they can SSH everywhere needed            |
| Days 31-60 | Operators encouraged to use Teleport exclusively; legacy bastion access logged + visible |
| Days 61-89 | Legacy bastion access requires written justification; weekly review by team lead         |
| Day 90     | Legacy bastion decommissioned (§21.13)                                                   |

**Operator self-service migration** — published once Teleport is up:

```bash
# (1) Install tsh client on operator's workstation
$ brew install --cask teleport-suite     # macOS
$ # (Linux/Windows installers similar — see Teleport docs)

# (2) Log in via SSO
$ tsh login --proxy=teleport.africanunion.org:443 --auth=keycloak
# Browser opens → AD login → cert issued

# (3) List accessible servers
$ tsh ls
# Expected: every node the operator's role permits, with labels

# (4) SSH in
$ tsh ssh root@auishqosrvlt01
# Same shell experience as before; session recording is invisible

# (5) Database access
$ tsh db ls
$ tsh db login --db-user=postgres postgres-app
$ tsh db connect postgres-app

# (6) Application access
$ tsh app ls
$ tsh app login vault
```

### 21.12 UFW + Verification

```bash
# [auishqostele01]
$ sudo ufw allow from 10.111.30.95 to any port 3025 proto tcp comment 'Auth ← Proxy01'
$ sudo ufw allow from 10.111.30.96 to any port 3025 proto tcp comment 'Auth ← Proxy02'

# [auishqostele-px01-02]
$ sudo ufw allow from 10.111.30.0/24 to any port 443 proto tcp comment 'Proxy ← App VLAN'
$ sudo ufw allow from 10.111.40.0/24 to any port 443 proto tcp comment 'Proxy ← Ops VLAN'

# [every node-agent host]
$ sudo ufw allow from 10.111.30.95 to any port 3022 proto tcp comment 'Teleport ← Proxy01'
$ sudo ufw allow from 10.111.30.96 to any port 3022 proto tcp comment 'Teleport ← Proxy02'

# Critically: nodes can REMOVE prior SSH-from-bastion rules once migration completes
# (don't do this until day 90)

# (Verification)
# (1) Auth Service healthy
$ tctl status

# (2) Every platform VM registered
$ tctl nodes ls --format=json | jq 'length'
# Expected: count matches platform VM total

# (3) End-to-end operator login
$ tsh login --proxy=teleport.africanunion.org
$ tsh ls
$ tsh ssh ubuntu@<some-node>

# (4) Session recording lands in MinIO
$ mc ls --recursive au-platform/teleport-recordings/ | head -5
# Expected: recent session-recording files

# (5) Replay a recent session
$ tsh play <session-id>
# Expected: terminal UI replays the session

# (6) JIT request flow
$ tsh request create --roles=platform-admin --reason="verification drill"
$ # Approver:
$ tsh request review --approve <id>
$ # Requestor's next tsh login picks up the elevation
```

### 21.13 Decommissioning chapter 02's bastion

Day 90 milestone:

```bash
# (1) Confirm zero legacy-bastion logins for 14 days
$ ssh au-bastion 'sudo last -F | head -50'
# Expected: no operator logins beyond the verification drills

# (2) Block all SSH access at chapter 02's UFW
$ ssh au-bastion 'sudo ufw delete allow 22/tcp'
$ ssh au-bastion 'sudo ufw allow from <emergency-ip> to any port 22 proto tcp comment "break-glass only"'

# (3) Remove all SSH key authorisations from operator account
$ ssh au-bastion 'sudo cp /home/operators/.ssh/authorized_keys /tmp/legacy-keys-archive.$(date +%F)'
$ ssh au-bastion 'sudo : > /home/operators/.ssh/authorized_keys'

# (4) Update DNS — au-bastion still resolves but only the break-glass operator can connect
# (Keep the host running for emergency Teleport-down recovery; see chapter 41 incident response)

# (5) Update CLAUDE.md / runbooks: "all operator access now via Teleport (chapter 21)"
```

The chapter 02 bastion remains as a **break-glass fallback** — if Teleport itself is fully down, operators with the emergency cert can still SSH in. Tested as part of the chapter 19 §19.7 Q4 full-platform DR drill.

---
