# 22 — Dynamic Vault secrets

> **Phase**: 5 (operational maturity) · **Run on**: existing Vault cluster (chapter 03); per-app Vault Agent sidecars on Nomad clients · **Time**: ~4 hours platform setup; per-app rollout 30 min each
>
> Upgrade Vault from KV-only (chapter 03) to dynamic secret engines: short-lived per-session credentials for Postgres, mTLS certs from Vault PKI, encryption-as-a-service via Transit, and SSH cert authority. Static rotated passwords from chapters 13/14/15/16 become per-session leases with TTL ≤ 1 hour. The "stolen credential blast radius" shrinks from 90 days to 1 hour.
>
> Phase 5 chapter 2 of 3.
>
> **Prev**: [21 — Teleport bastion](21-teleport.md) · **Next**: [23 — Runbook automation](23-runbook-automation.md) · **Index**: [README](README.md)

---

## Contents

- [§22.1 Role + threat model](#221-role-threat-model)
- [§22.2 The four engines we enable](#222-the-four-engines-we-enable)
- [§22.3 Pre-flight (existing Vault cluster + agent sidecars)](#223-pre-flight-existing-vault-cluster-agent-sidecars)
- [§22.4 Database engine — dynamic Postgres credentials](#224-database-engine-dynamic-postgres-credentials)
- [§22.5 PKI engine — mTLS certs for app-to-backend](#225-pki-engine-mtls-certs-for-app-to-backend)
- [§22.6 Transit engine — encryption-as-a-service](#226-transit-engine-encryption-as-a-service)
- [§22.7 SSH CA — replaces static keys (where Teleport doesn't reach)](#227-ssh-ca-replaces-static-keys-where-teleport-doesnt-reach)
- [§22.8 Vault Agent sidecar pattern](#228-vault-agent-sidecar-pattern)
- [§22.9 Per-app rollout playbook](#229-per-app-rollout-playbook)
- [§22.10 Verification](#2210-verification)
- [§22.11 Path to chapter 24 (Patroni-aware DB engine)](#2211-path-to-chapter-24-patroni-aware-db-engine)

## 22. Dynamic Vault secrets

### 22.1 Role + threat model

Static credentials are the ambient risk in any platform. Phases 1-4 minimised them: short rotation windows (90 days for app DB passwords, 180 days for Redis), Vault as the only durable home, audit logs on every read. But "minimised" is not "eliminated" — a stolen 90-day password is still 90 days of exposure.

Vault's dynamic secret engines change the model: instead of "fetch a long-lived password from KV," apps "request a credential" and receive a fresh one every time, with a short TTL (15 min - 1 hour typical). When the TTL expires, the credential is automatically revoked at the source (e.g., the Postgres role is dropped, the cert is added to a CRL).

Three consequences:

1. **Compromise = 1-hour blast radius (not 90 days).** A stolen credential is useless after its lease expires. Defence: aggressive TTLs; revocation propagated within seconds; alerts on credential reuse from unexpected IPs.
2. **Outage of Vault = apps can't get new credentials.** With a 1-hour TTL, apps lose access ~1 hour after Vault goes down. Mitigation: 3-node Vault HA from chapter 03 already tolerates 1-node loss; cached credentials survive briefly via Vault Agent's auto-renew.
3. **Database role explosion is the realistic failure mode.** Each app session creates a Postgres role; idle leases that don't get cleaned up accumulate. Defence: max-lease cap; explicit revoke on app shutdown; nightly orphan-role cleanup job; alert on role count growth.

**Threat model — what we defend against:**

| Threat                                        | Mitigation                                                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Stolen long-lived static password             | Eliminated for engines covered here — credentials are 1-hour leases                                      |
| Compromised Vault Agent leaks credentials     | Per-app workload identity (chapter 05 §5.9 JWT) — Agent only gets creds for ITS app's role               |
| Database role accumulation                    | `max_ttl` enforces hard ceiling; nightly cleanup + alert (§22.10)                                        |
| Cert lifecycle abuse (long-lived stolen cert) | Vault PKI default 30-day expiry on issued certs; CRL distributed; OCSP stapling                          |
| Transit encryption key compromise             | Vault Transit keys never leave Vault; external systems get only encrypt/decrypt RPC, not keys themselves |
| Credential reuse from unexpected IP           | Loki rule on Vault audit + Postgres pgaudit — match credential ID to source IP, alert on anomaly         |
| Apps not migrating from static to dynamic     | Phase-out timeline + per-app rollout playbook (§22.9); audit of static credentials still in use          |

**Phase 5 deliberate non-goals:**

- **Hardware Security Module (HSM) backing for Vault** — Vault's auto-unseal can use an HSM; out of scope for AU's compliance posture today. Revisit if compliance requires FIPS-validated key storage.
- **Inter-cluster replication (Vault DR)** — chapter 20 ships snapshots; Vault Enterprise's Performance Standby would give sub-1-min DR RTO but is paid-tier.
- **Per-row encryption inside the database** — Transit can encrypt fields, but the app-level integration is per-app (greenbook chooses per-row vs per-table). Platform layer provides the engine; apps choose how to use it.
- **Federation with external secret managers (AWS Secrets, Azure KV)** — out of scope; AU's secret needs are entirely on-prem-served by Vault.

### 22.2 The four engines we enable

Phase 5 chapter 22 turns on four Vault engines:

| Engine   | Replaces / adds                                               | Documented in § | Migration impact (per app)          |
| -------- | ------------------------------------------------------------- | --------------- | ----------------------------------- |
| Database | Static rotated passwords (chs 13, 14, 15, 16)                 | §22.4           | DSN config + Vault Agent template   |
| PKI      | "Phase 5 mTLS" deferrals (chs 15, 16, 17 referenced)          | §22.5           | Cert install + nginx/HAProxy reload |
| Transit  | App-side encryption needs; replaces MinIO built-in KES        | §22.6           | App library integration             |
| SSH      | Bastion SSH keys (where Teleport doesn't reach — break-glass) | §22.7           | Operator workflow change            |

Vault's KV engine from chapter 03 doesn't go away — it stays for everything that doesn't fit a dynamic model (e.g., Cloudflare API tokens, Keycloak admin password). Dynamic engines layer on top.

### 22.3 Pre-flight (existing Vault cluster + agent sidecars)

No new VMs. Engine enablement happens on the existing 3-node Vault Raft cluster from chapter 03. Apps gain a **Vault Agent sidecar** on each Nomad allocation (or systemd unit on bare-metal apps) — Vault Agent does authentication via Nomad workload identity (chapter 05 §5.9), fetches credentials, writes them to a tmpfs file the app reads, renews leases automatically.

```bash
# [auishqosrvlt01-03] — verify Vault is on 1.15+ (need recent engine versions)
$ vault version

# (Confirm Vault is healthy as the chapter starts)
$ vault status
```

Per-app prerequisite: each app's Nomad job spec already has the workload-identity block from chapter 05 §5.9. We're adding a Vault Agent sidecar that uses that identity.

### 22.4 Database engine — dynamic Postgres credentials

This is the biggest change in chapter 22 — replaces every per-app static password from chapter 13 §13.8.

```bash
# [bastion]

# (1) Enable the database secrets engine
$ vault secrets enable -path=database database

# (2) Configure the connection to the Postgres app cluster (via PgBouncer)
#     The "vault_admin" role on Postgres has CREATE ROLE permission only
$ ssh -J au-bastion auishqosrpdb01.au-internal "sudo -u postgres psql <<'EOF'
  CREATE ROLE vault_admin WITH LOGIN PASSWORD 'BOOTSTRAP_VAULT_ADMIN' \
                              CREATEROLE;
  -- Limit what vault_admin can do — can create roles + grant on schemas, but not become superuser
EOF"

$ VAULT_PG_PASS=$(openssl rand -base64 32)
$ ssh auishqosrpdb01 "sudo -u postgres psql -c \"ALTER ROLE vault_admin PASSWORD '$VAULT_PG_PASS';\""

$ vault write database/config/postgres-app \
    plugin_name=postgresql-database-plugin \
    allowed_roles="app-role-greenbook,app-role-keycloak,app-role-readonly" \
    connection_url="postgresql://{{username}}:{{password}}@pgbouncer.au-internal:6432/postgres?sslmode=require" \
    username="vault_admin" \
    password="$VAULT_PG_PASS"

# Force vault_admin password rotation (Vault now manages it)
$ vault write -force database/rotate-root/postgres-app

# (3) Define a dynamic role per app — what creds Vault will issue + their TTL + the SQL to create them
$ vault write database/roles/app-role-greenbook \
    db_name=postgres-app \
    creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}' INHERIT; \
                          GRANT app_greenbook TO \"{{name}}\";" \
    revocation_statements="DROP ROLE IF EXISTS \"{{name}}\";" \
    default_ttl="1h" \
    max_ttl="24h"

# Read-only dynamic role for analytics / reporting
$ vault write database/roles/app-role-greenbook-ro \
    db_name=postgres-app \
    creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}' INHERIT; \
                          GRANT app_greenbook_ro TO \"{{name}}\";" \
    revocation_statements="DROP ROLE IF EXISTS \"{{name}}\";" \
    default_ttl="1h" \
    max_ttl="24h"

# (4) Vault policy that lets greenbook's workload identity request the credential
$ vault policy write greenbook-db -<<'EOF'
path "database/creds/app-role-greenbook" {
  capabilities = ["read"]
}
path "database/creds/app-role-greenbook-ro" {
  capabilities = ["read"]
}
EOF

# Bind the policy to the JWT workload role (chapter 05 §5.9 already created the JWT auth backend)
$ vault write auth/nomad-workload/role/greenbook \
    bound_audiences="vault.io" \
    user_claim="/nomad_job_id" \
    bound_claims='{"nomad_namespace":"default","nomad_job_id":"greenbook"}' \
    token_policies="default,greenbook-db" \
    token_ttl=1h
```

**Apps' Nomad job spec gains a Vault block + a sidecar:**

```hcl
job "greenbook" {
  ...
  group "app" {
    vault {
      role = "greenbook"
    }

    task "vault-agent" {
      driver = "docker"
      config {
        image = "hashicorp/vault:1.15"
        args  = ["agent", "-config=/local/agent.hcl"]
      }
      template {
        destination = "local/agent.hcl"
        data = <<EOF
auto_auth {
  method "jwt" {
    config = {
      role = "greenbook"
      path = "/nomad/secrets/api_token"
    }
  }
  sink "file" { config = { path = "/secrets/.vault-token" } }
}
template {
  source      = "/local/db.tmpl"
  destination = "/secrets/db.env"
  perms       = "0600"
}
EOF
      }
      template {
        destination = "local/db.tmpl"
        data = <<EOF
{{ with secret "database/creds/app-role-greenbook" }}
DATABASE_URL=postgresql://{{ .Data.username }}:{{ .Data.password }}@pgbouncer.au-internal:6432/greenbook?sslmode=require
{{ end }}
EOF
      }
    }

    task "app" {
      driver = "docker"
      config {
        image = "registry.au-internal/greenbook:latest"
      }
      template {
        destination = "secrets/db.env"
        env         = true
        data        = "{{ file `secrets/db.env` }}"
        change_mode = "restart"
      }
    }
  }
}
```

**Result**: every greenbook task instance gets a unique Postgres role (`v-jwt-greenbook-abc123`) with a 1-hour TTL. When the TTL approaches, Vault Agent re-fetches automatically, restart-on-change triggers app reload with the new credential. After 1 hour of idle (or app shutdown), the role is dropped from Postgres.

The static `app_greenbook` role from chapter 13 §13.8 stays — but only as the parent role that dynamic roles `GRANT TO`. No app uses its password directly anymore.

### 22.5 PKI engine — mTLS certs for app-to-backend

Many earlier chapters deferred mTLS to "Phase 5":

- Chapter 14 §14.1 — Redis client mTLS
- Chapter 15 §15.1 — MinIO Authenticated Origin Pulls (Phase 5)
- Chapter 16 §16.1 — PgBouncer per-app TLS client certs
- Chapter 17 §17.1 — HAProxy stats API mTLS

Vault PKI is the issuer for all of them.

```bash
# (1) Enable two PKI engines: a root CA (rare-use, offline-ish) and an intermediate CA (issues all certs)
$ vault secrets enable -path=pki-root pki
$ vault secrets enable -path=pki-int  pki

# Long-lived root, short-lived intermediate
$ vault secrets tune -max-lease-ttl=87600h  pki-root      # 10 years
$ vault secrets tune -max-lease-ttl=8760h   pki-int       # 1 year

# (2) Generate the root CA (one-time; export the cert + secure the private key)
$ vault write -field=certificate pki-root/root/generate/internal \
    common_name="AU Platform Root CA" \
    ttl=87600h > /tmp/au-platform-root-ca.crt

# (3) Generate intermediate CA, sign with root
$ vault write -format=json pki-int/intermediate/generate/internal \
    common_name="AU Platform Intermediate CA" \
    | jq -r '.data.csr' > /tmp/pki-int.csr

$ vault write -format=json pki-root/root/sign-intermediate \
    csr=@/tmp/pki-int.csr \
    format=pem_bundle ttl=8760h \
    | jq -r '.data.certificate' > /tmp/pki-int.crt

$ vault write pki-int/intermediate/set-signed certificate=@/tmp/pki-int.crt

# (4) Configure CRL + OCSP distribution
$ vault write pki-int/config/urls \
    issuing_certificates="https://vault.au-internal:8200/v1/pki-int/ca" \
    crl_distribution_points="https://vault.au-internal:8200/v1/pki-int/crl" \
    ocsp_servers="https://vault.au-internal:8200/v1/pki-int/ocsp"

# (5) Define roles per use-case
# Server certs (apps' nginx, HAProxy, etc.)
$ vault write pki-int/roles/au-internal-server \
    allowed_domains="au-internal" \
    allow_subdomains=true \
    max_ttl="720h" \
    server_flag=true client_flag=false \
    key_type=ec key_bits=256

# Client certs (apps connecting to MinIO with Authenticated Origin Pulls, PgBouncer mTLS, etc.)
$ vault write pki-int/roles/au-internal-client \
    allowed_domains="au-internal" \
    allow_subdomains=true \
    max_ttl="24h" \
    server_flag=false client_flag=true \
    key_type=ec key_bits=256

# (6) Per-app policy
$ vault policy write greenbook-pki -<<'EOF'
path "pki-int/issue/au-internal-server" { capabilities = ["create","update"] }
path "pki-int/issue/au-internal-client" { capabilities = ["create","update"] }
EOF

$ vault write auth/nomad-workload/role/greenbook \
    bound_audiences="vault.io" \
    user_claim="/nomad_job_id" \
    bound_claims='{"nomad_job_id":"greenbook"}' \
    token_policies="default,greenbook-db,greenbook-pki" \
    token_ttl=1h
```

**Vault Agent template for a server cert** (similar to §22.4):

```hcl
template {
  destination = "/secrets/cert.pem"
  data = <<EOF
{{ with secret "pki-int/issue/au-internal-server" "common_name=greenbook.au-internal" "ttl=24h" }}
{{ .Data.certificate }}
{{ .Data.issuing_ca }}
{{ end }}
EOF
}
template {
  destination = "/secrets/key.pem"
  data = <<EOF
{{ with secret "pki-int/issue/au-internal-server" "common_name=greenbook.au-internal" "ttl=24h" }}
{{ .Data.private_key }}
{{ end }}
EOF
  perms = "0600"
}
```

When a cert nears expiry, Vault Agent re-issues. App's nginx reloads on file change. No 90-day cert rotation runbook.

**MinIO Authenticated Origin Pulls** (chapter 15 §15.1's deferral):

```bash
# Issue a client cert specifically for Cloudflare → MinIO
$ vault write -format=json pki-int/issue/au-internal-client \
    common_name="cloudflare.au-internal" ttl=8760h \
    > /tmp/cf-client-cert.json

# Install at MinIO's nginx as the trusted client CA
# Configure Cloudflare's Authenticated Origin Pulls to present this cert
```

### 22.6 Transit engine — encryption-as-a-service

Apps that need to encrypt fields (PII columns, sensitive cookies, etc.) call Vault's Transit engine. Vault holds the keys; apps never see them.

```bash
# (1) Enable
$ vault secrets enable -path=transit transit

# (2) Create per-app encryption keys
$ vault write -f transit/keys/greenbook-pii type=aes256-gcm96
$ vault write transit/keys/greenbook-pii/config \
    deletion_allowed=false \
    min_decryption_version=1 \
    min_encryption_version=0          # use latest version for new encrypts

# (3) Per-app policy
$ vault policy write greenbook-transit -<<'EOF'
path "transit/encrypt/greenbook-pii" { capabilities = ["update"] }
path "transit/decrypt/greenbook-pii" { capabilities = ["update"] }
path "transit/datakey/plaintext/greenbook-pii" { capabilities = ["update"] }
EOF
```

**App-side usage** (greenbook's TypeScript code):

```typescript
// Encrypt
const encResponse = await vaultClient.write("transit/encrypt/greenbook-pii", {
  plaintext: Buffer.from(plainValue).toString("base64"),
});
// Store encResponse.ciphertext in Postgres — NOT the plaintext

// Decrypt
const decResponse = await vaultClient.write("transit/decrypt/greenbook-pii", {
  ciphertext: storedCiphertext,
});
const plain = Buffer.from(decResponse.plaintext, "base64").toString();
```

**Key rotation**: rotate the key version, leave both old + new readable for the migration window:

```bash
$ vault write -f transit/keys/greenbook-pii/rotate
$ vault write transit/keys/greenbook-pii/config min_decryption_version=2  # after re-encrypt sweep
```

For high-throughput cases (per-row encryption of a 100M-row table), use **datakeys** — Vault issues a wrapped DEK per session; app does the bulk encryption locally with the DEK; only the wrap/unwrap calls to Vault. Apps don't see the master key.

**MinIO at-rest encryption** can move from chapter 15's built-in KES to Vault Transit:

```bash
# Tell MinIO to use Vault for SSE-KMS instead of built-in KES
$ mc admin config set au-platform identity_openid \
    config_url=https://keycloak.africanunion.org/realms/au/.well-known/openid-configuration \
    client_id=minio
$ mc admin kms key create au-platform au-master-key
# Re-encrypt existing objects in the background; Vault Transit becomes the master key holder
```

### 22.7 SSH CA — replaces static keys (where Teleport doesn't reach)

Chapter 21 covers operator SSH access via Teleport. There's a residual case: **emergency break-glass access when Teleport itself is down** (chapter 21 §21.13). Currently that uses a static SSH key on the legacy bastion. Vault SSH CA replaces it with short-lived signed certs.

```bash
# (1) Enable SSH CA
$ vault secrets enable -path=ssh-ca ssh

# (2) Generate the CA
$ vault write -field=public_key ssh-ca/config/ca generate_signing_key=true \
    > /tmp/au-ssh-ca.pub

# Distribute /tmp/au-ssh-ca.pub to every host's /etc/ssh/ssh_au_ca.pub
# Tell sshd to trust certs signed by it:
$ for host in $(tctl nodes ls -f json | jq -r '.[].spec.hostname'); do
    ssh root@$host 'echo "TrustedUserCAKeys /etc/ssh/ssh_au_ca.pub" >> /etc/ssh/sshd_config; \
                    systemctl reload ssh'
  done

# (3) Define a role for break-glass access — short TTL, root login allowed, audit critical
$ vault write ssh-ca/roles/break-glass-root \
    key_type=ca \
    default_user=root \
    allowed_users=root \
    ttl=60m \
    max_ttl=2h \
    allowed_extensions="permit-pty,permit-X11-forwarding,permit-port-forwarding"

# (4) Tight policy — only the break-glass operator group can sign these certs
$ vault policy write break-glass-ssh -<<'EOF'
path "ssh-ca/sign/break-glass-root" {
  capabilities = ["create","update"]
}
EOF

# Bind to the operator's Keycloak group via Vault's OIDC auth method (separate from
# Nomad workload identity)
```

Operator workflow during a Teleport outage:

```bash
# (1) Operator authenticates to Vault via OIDC (Keycloak)
$ vault login -method=oidc role=break-glass-operator

# (2) Generate a short-lived SSH cert
$ vault write -field=signed_key ssh-ca/sign/break-glass-root \
    public_key=@~/.ssh/id_ed25519.pub > ~/.ssh/break-glass-cert.pub

# (3) SSH using cert
$ ssh -i ~/.ssh/break-glass-cert.pub -i ~/.ssh/id_ed25519 root@auishqosrvlt01

# Cert expires in 1 hour; cleanup is automatic
```

### 22.8 Vault Agent sidecar pattern

Established in §22.4 — the canonical way apps consume dynamic secrets. Three responsibilities:

1. **Auth** — fetch a Vault token using the workload identity (Nomad JWT in our case)
2. **Render** — fetch dynamic secrets, render to template files, drop on tmpfs
3. **Renew** — keep the lease alive; re-render on rotation; signal the app to reload

Phase 5 ch23 (Ansible) automates the per-app Nomad job spec generation including the Vault Agent sidecar — operators don't write the boilerplate per app.

The pattern uniformly applies to all four engines:

| Need              | Template clause                                  |
| ----------------- | ------------------------------------------------ |
| DB credential     | `{{ with secret "database/creds/<role>" }} ...`  |
| Server cert + key | `{{ with secret "pki-int/issue/<role>" "..." }}` |
| Encryption key    | (apps call Transit RPC; Agent only renews token) |
| KV value (legacy) | `{{ with secret "kv/data/apps/<app>/key" }} ...` |

### 22.9 Per-app rollout playbook

Same shape as chapter 21's operator migration: run alongside the static-cred path; phased move; verify; decommission.

| Step | What it adds                                                                       |
| ---- | ---------------------------------------------------------------------------------- |
| 1    | Add greenbook's Vault policy + JWT workload role binding (§22.4)                   |
| 2    | Add Vault Agent sidecar to greenbook's Nomad job spec; render `/secrets/db.env`    |
| 3    | App reads from `/secrets/db.env` (env var) — backwards-compatible with static path |
| 4    | Roll out to staging; verify lease rotation works (force a 5-min TTL; observe app)  |
| 5    | Promote to production; observe normal 1-hour TTL behaviour                         |
| 6    | Once stable for 30 days: revoke the static `kv/apps/greenbook/database` password   |
| 7    | After 90 days: drop the static role from Postgres if no longer GRANTed             |

Order to migrate apps: **smallest blast radius first**. Greenbook (single app) → other apps in order of complexity → infrastructure-tier consumers (PgBouncer's `pgbouncer_authuser` — careful, this is the cred PgBouncer needs to do auth_query; migrating it requires PgBouncer 1.22+'s dynamic auth).

### 22.10 Verification

```bash
# (1) Engines enabled
$ vault secrets list | grep -E 'database|pki-int|transit|ssh-ca'
# Expected: 4 lines

# (2) Database role issues short-lived credentials
$ vault read database/creds/app-role-greenbook
# Outputs username (v-jwt-greenbook-...), password, lease_duration: 3600

# (3) Postgres role exists and works
$ PGPASSWORD=<above-password> psql "host=pgbouncer.au-internal port=6432 dbname=greenbook \
    user=<above-username> sslmode=require" -c "SELECT 1"
# Expected: 1

# (4) Lease expires at 1h; role is dropped
$ vault lease lookup <lease_id>
# Expected: ttl ≤ 3600; renewable: true
$ # ...wait or revoke...
$ vault lease revoke <lease_id>
$ ssh auishqosrpdb01 "sudo -u postgres psql -tAc \"SELECT count(*) FROM pg_roles WHERE rolname = 'v-jwt-greenbook-...';\""
# Expected: 0

# (5) PKI cert issued
$ vault write -format=json pki-int/issue/au-internal-server \
    common_name=greenbook.au-internal ttl=24h \
    | jq -r '.data.certificate' | openssl x509 -noout -dates -subject

# (6) Transit encrypt/decrypt round-trip
$ CIPHER=$(vault write -field=ciphertext transit/encrypt/greenbook-pii \
    plaintext=$(echo "test-pii-value" | base64))
$ vault write -field=plaintext transit/decrypt/greenbook-pii \
    ciphertext="$CIPHER" | base64 -d
# Expected: "test-pii-value"

# (7) SSH CA cert can be signed + used
$ vault write -field=signed_key ssh-ca/sign/break-glass-root \
    public_key=@~/.ssh/id_ed25519.pub > /tmp/test-cert.pub
$ ssh-keygen -L -f /tmp/test-cert.pub
# Expected: cert info; valid for 1h

# (8) Postgres dynamic role count is bounded
$ ssh auishqosrpdb01 "sudo -u postgres psql -tAc \"SELECT count(*) FROM pg_roles WHERE rolname LIKE 'v-jwt-%';\""
# Expected: ~ (number of running app instances); growing unbounded → role-leak alert
```

Add chapter 12 alerts:

```yaml
# Add to chapter 12 §12.6 Mimir ruler
- alert: VaultDynamicRoleLeak
  expr: |
    (
      label_replace(
        vault_secret_lease_count{secret_engine="database"}, "engine", "$1", "secret_engine", "(.*)"
      ) > 1000
    )
  for: 30m
  labels:
    severity: warning
    service: vault
  annotations:
    summary: 'Vault has {{ $value }} active database leases — possible role leak'

- alert: VaultDynamicCredentialReuseFromUnexpectedIP
  # Loki rule: parse vault audit + postgres pgaudit for credential ID + source IP
  # Match credential issued to job ID X; if a connection from a different VLAN appears,
  # alert. Implementation depends on Loki's join capabilities; sketch only.
  ...
```

### 22.11 Path to chapter 24 (Patroni-aware DB engine)

The database engine in §22.4 connects to `pgbouncer.au-internal:6432` — through chapter 17's HAProxy → PgBouncer → Postgres primary chain. When Postgres fails over (chapter 13 §13.10), HAProxy auto-discovers the new primary; Vault's database connection continues to work without reconfiguration.

A Phase 5+ enhancement (referenced as ch24 in chapters 13/16/17): **Patroni for automated Postgres failover**. With Patroni, the failover RTO drops from "manual + DNS TTL" (~30 sec) to "automated via etcd consensus" (<10 sec). Vault's database engine config doesn't need to change — it points at HAProxy, HAProxy points at the current primary via Patroni's REST API health check.

The two changes Patroni introduces that interact with chapter 22:

1. **Patroni's REST API replaces the xinetd `pg-isprimary`** (chapter 17 §17.5.2). HAProxy's HTTP health-check moves to the Patroni endpoint.
2. **Vault root-credential rotation** can use Patroni's `pg_rewind` to keep the old primary in sync, allowing Vault to rotate the root password without a write outage.

Chapter 24 (slot reserved) covers the full Patroni + etcd setup. Chapter 22's dynamic engines work seamlessly across primary failovers regardless of whether Patroni is yet deployed — that's the loose coupling pattern the architecture has emphasised throughout.

---
