# 03 — Vault

> **Phase**: 1 (developer foothold) · **Run on**: 3× Vault VMs (`auishqosrvlt01-03`) · **Time**: ~3 hours for the cluster
>
> The platform's secret store. Every static credential (DB passwords, API keys, TLS material) lives here; every workload (apps + platform services) fetches from here at runtime. 3-node HA cluster with Raft integrated storage; manual Shamir unseal for Phase 1.
>
> Phase 5 [chapter 22 — Dynamic Vault secrets](22-vault-dynamic.md) upgrades from KV-only to dynamic database credentials and PKI-issued certificates without breaking any of the patterns established here.
>
> **Prev**: [02 — Bastion](02-bastion.md) · **Next**: [04 — GitLab CE](04-gitlab.md) · **Index**: [README](README.md)

---

## Contents

- [§3.1 Role + threat model](#31-role-threat-model)
- [§3.2 Pre-flight (3 hardened VMs)](#32-pre-flight-3-hardened-vms)
- [§3.3 Install Vault on each node](#33-install-vault-on-each-node)
- [§3.4 Cluster configuration (vault.hcl + TLS)](#34-cluster-configuration-vaulthcl-tls)
- [§3.5 Cluster bootstrap (init + unseal + join)](#35-cluster-bootstrap-init-unseal-join)
- [§3.6 Root token + unseal key custody](#36-root-token-unseal-key-custody)
- [§3.7 Operator authentication](#37-operator-authentication)
- [§3.8 Policies (operator + workload templates)](#38-policies-operator-workload-templates)
- [§3.9 Secrets engines: KV v2](#39-secrets-engines-kv-v2)
- [§3.10 Audit device](#310-audit-device)
- [§3.11 Snapshot strategy](#311-snapshot-strategy)
- [§3.12 UFW + firewall rules](#312-ufw-firewall-rules)
- [§3.13 Verification](#313-verification)
- [§3.14 Path to Phase 5](#314-path-to-phase-5)

## 3. Vault

### 3.1 Role + threat model

Vault is the **single source of truth for secrets** on the platform. Two consequences:

1. **Compromising Vault compromises every app's secrets.** Defence: short-lived tokens, fine-grained policies, exhaustive audit logging, Raft consensus so no single node can be silently subverted, unseal keys split via Shamir so no single human holds the keys to the kingdom.
2. **Vault outage stops every workload that needs secrets at startup.** Existing in-memory secrets continue to work, but new container starts (deploy, restart, scale-out, node failure) fail until Vault is healthy. HA via 3 nodes is therefore mandatory, not optional.

**Threat model — what we defend against:**

| Threat                                    | Mitigation                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Vault binary / config tampering           | auditd on each host watches `/etc/vault.d/`; binary integrity verified on install                                   |
| Storage tampering (Raft files modified)   | Filesystem audit; Raft's hash chain detects tampering; quorum-based commit rejects single-node forgeries            |
| Network MITM between client and Vault     | TLS on all API endpoints (port 8200); cluster traffic on 8201 also TLS-encrypted                                    |
| Compromised root token                    | Root token revoked after bootstrap; operators authenticate via OIDC (Phase 2) or per-operator tokens (Phase 1)      |
| Lost unseal keys                          | Shamir 5-of-3 split — any 3 of 5 keys reconstruct the master key. Distribute across ≥5 independent custodians.      |
| Single host compromise                    | Other 2 nodes still serve; that 1 node becomes an attacker outpost but can't decrypt without the master key         |
| Operator collusion (3 unseal-key holders) | Accept the residual risk; Phase 5 adds Vault Enterprise's auto-unseal via cloud KMS to remove human-in-loop sealing |

**What we explicitly DO NOT do in Phase 1:**

- **Auto-unseal via cloud KMS** — enterprise feature, requires AWS KMS / Azure Key Vault / similar. Not applicable to AU's on-prem deployment without a separate cloud account. Manual Shamir unseal is the Phase 1 reality; documented restart procedures live in [chapter 41 — Incident response](41-incident.md).
- **Vault PKI for workload certs** — Phase 1 uses a static AU wildcard cert for Vault's own TLS. Phase 5 (chapter 22) introduces Vault PKI as a CA for app-to-app mTLS.
- **Dynamic database credentials** — Phase 1 stores static DB passwords in KV v2. Phase 5 upgrades to Vault generating per-workload DB credentials with short TTL.

### 3.2 Pre-flight (3 hardened VMs)

Three Ubuntu 24.04 VMs hardened to AU base (greenbook chapter 01 §1.1-§1.7). Skip §1.8 (no `deployer` user). Add operator account membership (chapter 02 §2.4) so platform engineers can SSH in via the bastion.

Per-node specs (from PLAN.md):

| Resource | Per node  | Why                                                                               |
| -------- | --------- | --------------------------------------------------------------------------------- |
| vCPU     | 2         | Vault is I/O-bound, not CPU-bound; 2 vCPU handles thousands of req/s              |
| RAM      | 8 GB      | Raft keeps data in memory; 8 GB comfortable for the data volumes Phase 1 produces |
| Disk     | 80 GB SSD | Raft logs + snapshots; SSD required for low write latency on Raft commits         |

Hostnames: `auishqosrvlt01`, `auishqosrvlt02`, `auishqosrvlt03`. All three on VLAN 4 (Platform). Internal IPs (per [§0.3](00-architecture.md#03-network-segmentation-ip-allocation)): `10.111.30.10`, `10.111.30.11`, `10.111.30.12`.

```bash
# [each Vault VM]

# Confirm pre-flight passed
$ lsb_release -d
$ sudo systemctl is-active unattended-upgrades
$ sudo ufw status verbose
$ sudo systemctl is-active fail2ban

# Confirm operators group exists + your account is in it
$ groups | grep operators
```

### 3.3 Install Vault on each node

HashiCorp's official apt repository — same procedure on all three nodes.

```bash
# [auishqosrvlt01 + auishqosrvlt02 + auishqosrvlt03]

# (1) Add HashiCorp's GPG key + repository
$ wget -O- https://apt.releases.hashicorp.com/gpg \
    | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg

$ echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] \
    https://apt.releases.hashicorp.com $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/hashicorp.list

# (2) Install vault — installs binary, systemd unit, and creates the
#     vault user/group automatically
$ sudo apt update
$ sudo apt install -y vault

# (3) Verify install
$ vault version
# Expected: Vault v1.x.x (version pinned to AU's chosen release)

$ id vault
# Expected: uid=999(vault) gid=999(vault) groups=999(vault) — system user

$ ls -ld /etc/vault.d /opt/vault/data
# Expected: both directories owned by vault:vault
```

> **ℹ Pin a known Vault version**
>
> Production deployments pin to a specific Vault version, not "latest". HashiCorp publishes a [changelog](https://github.com/hashicorp/vault/blob/main/CHANGELOG.md) and we follow the LTS line. Update the version in apt's hold list, document the chosen version in [appendix C](appendix-c-references.md), and re-evaluate quarterly.
>
> ```bash
> $ sudo apt-mark hold vault     # prevent automatic upgrades
> ```

### 3.4 Cluster configuration (vault.hcl + TLS)

Each node's `/etc/vault.d/vault.hcl` declares its own listen addresses, its node ID for Raft, and how to find peers.

**TLS material** (Phase 1 uses the AU wildcard cert; Phase 5 [chapter 22](22-vault-dynamic.md) replaces with Vault-issued per-cluster certs):

```bash
# [each Vault VM]

# (1) Place the AU wildcard cert + key under /etc/vault.d/tls/
#     Same cert used by the DMZ HAProxy and other platform services.
#     Get the cert bundle from the platform secrets store (initially:
#     scp from a known-good source — chicken-and-egg ensures the FIRST
#     install of the FIRST platform component is bootstrap-via-operator).
$ sudo install -d -m 750 -o vault -g vault /etc/vault.d/tls
$ sudo install -m 644 -o vault -g vault \
    wildcard.africanunion.org.fullchain.pem \
    /etc/vault.d/tls/cert.pem
$ sudo install -m 640 -o vault -g vault \
    wildcard.africanunion.org.key \
    /etc/vault.d/tls/key.pem

$ ls -l /etc/vault.d/tls/
# Expected:
#   -rw-r--r-- vault vault  cert.pem  (644)
#   -rw-r----- vault vault  key.pem   (640)
```

**Configuration** — write `/etc/vault.d/vault.hcl` per node (the `node_id` and `api_addr` differ per node; everything else is identical):

```bash
# [auishqosrvlt01]
$ sudo tee /etc/vault.d/vault.hcl > /dev/null <<'EOF'
# Vault configuration — auishqosrvlt01 (node 1 of 3)
# See vaultproject.io/docs/configuration for parameter reference.

# Storage backend — Raft integrated storage. No external dependency.
storage "raft" {
  path    = "/opt/vault/data"
  node_id = "vlt01"

  # Each peer's IP + cluster port (8201). Listed identically on every
  # node; the node will skip itself based on its own bind address.
  retry_join {
    leader_api_addr = "https://10.111.30.10:8200"
  }
  retry_join {
    leader_api_addr = "https://10.111.30.11:8200"
  }
  retry_join {
    leader_api_addr = "https://10.111.30.12:8200"
  }
}

# API listener — clients connect here for read/write
listener "tcp" {
  address       = "0.0.0.0:8200"
  tls_cert_file = "/etc/vault.d/tls/cert.pem"
  tls_key_file  = "/etc/vault.d/tls/key.pem"
}

# Cluster identity — unique per node. Used by other nodes to reach this one.
api_addr     = "https://10.111.30.10:8200"
cluster_addr = "https://10.111.30.10:8201"

# UI on the API port — disabled in production after Phase 2 (Keycloak SSO);
# enabled here for the bootstrap window.
ui = true

# Disable mlock(). vault user lacks CAP_IPC_LOCK by default; either grant
# the cap (preferred for production) or set this. We grant the cap below.
disable_mlock = false
EOF

# [auishqosrvlt02] — same file, three changes:
#   storage "raft" { node_id = "vlt02" ... }
#   api_addr     = "https://10.111.30.11:8200"
#   cluster_addr = "https://10.111.30.11:8201"
# [auishqosrvlt03] — same again with node_id = "vlt03" + IP .12
```

**Grant `CAP_IPC_LOCK` so Vault can mlock its memory** (prevents swapping secrets to disk):

```bash
# [each Vault VM]
$ sudo setcap cap_ipc_lock=+ep /usr/bin/vault
# Verify:
$ sudo getcap /usr/bin/vault
# Expected: /usr/bin/vault cap_ipc_lock=ep
```

**systemd service** is installed by the apt package; just enable + start:

```bash
# [each Vault VM]
$ sudo systemctl enable vault
$ sudo systemctl start vault
$ sudo systemctl status vault --no-pager | head -10
# Expected: "active (running)"

# Set the env var operators will use so vault CLI talks TLS to localhost
$ echo 'export VAULT_ADDR=https://127.0.0.1:8200' | sudo tee /etc/profile.d/vault.sh
$ source /etc/profile.d/vault.sh

# Confirm Vault is up but sealed (expected on first start)
$ vault status
# Expected:
#   Initialized: false   ← we haven't run `vault operator init` yet
#   Sealed:      true    ← Vault is always sealed when first started
```

### 3.5 Cluster bootstrap (init + unseal + join)

Bootstrap happens in three steps: init the first node (produces unseal keys + root token), unseal, then have nodes 2 + 3 join.

```bash
# [auishqosrvlt01] — first node only

# (1) Init the cluster. Produces 5 unseal keys + 1 root token.
#     Threshold of 3 means any 3 of 5 keys can unseal.
#     Output goes to a JSON file — distribute the keys per §3.6 then SHRED.
$ vault operator init -format=json -key-shares=5 -key-threshold=3 \
    > /tmp/vault-init.json
$ sudo chmod 600 /tmp/vault-init.json

# (2) Inspect — DO NOT cat to terminal in shared screen sessions
$ sudo cat /tmp/vault-init.json | jq '{
    keys: .unseal_keys_b64,
    root: .root_token,
    nonce: .root_token_accessor }'
# Expected JSON with 5 unseal keys + 1 root token + accessor.

# (3) Distribute the 5 keys to 5 separate custodians per §3.6 BEFORE
#     proceeding. The keys must be off this VM and out of /tmp/ before
#     the bootstrap moves further.

# (4) Unseal node 1 — provide 3 of 5 keys (one per command)
$ vault operator unseal <KEY-1>
# Output: Unseal Progress: 1/3
$ vault operator unseal <KEY-2>
# Output: Unseal Progress: 2/3
$ vault operator unseal <KEY-3>
# Output: Sealed: false   ← node 1 is unsealed

# (5) Login as root for the bootstrap operations only
$ vault login <ROOT-TOKEN>

# (6) Verify cluster status
$ vault status
# Expected:
#   Initialized: true
#   Sealed:      false
#   HA Enabled:  true
#   HA Mode:     active   ← node 1 is the leader
#   Raft Applied Index: <some number>
```

```bash
# [auishqosrvlt02] — second node

# Vault on node 2 is already running but sealed. retry_join in vault.hcl
# means it's been trying to find the leader; once node 1 is unsealed,
# node 2 just needs its own unseal keys to come online.

$ vault operator unseal <KEY-1>
$ vault operator unseal <KEY-2>
$ vault operator unseal <KEY-3>

$ vault status
# Expected:
#   Initialized: true
#   Sealed:      false
#   HA Mode:     standby
```

```bash
# [auishqosrvlt03] — third node, same procedure

$ vault operator unseal <KEY-1>
$ vault operator unseal <KEY-2>
$ vault operator unseal <KEY-3>

$ vault status
# HA Mode: standby
```

```bash
# [any node] — verify all 3 in the Raft peer set
$ vault operator raft list-peers
# Expected: 3 rows, one per node, all in "voter" role.
#   ID     Address                State     Voter
#   vlt01  10.111.30.10:8201      leader    true
#   vlt02  10.111.30.11:8201      follower  true
#   vlt03  10.111.30.12:8201      follower  true
```

> **⚠ The /tmp/vault-init.json file MUST be shredded after key distribution**
>
> ```bash
> $ sudo shred -u /tmp/vault-init.json
> ```
>
> Once shredded, the unseal keys exist only in their custodians' separate stores. There is **no recovery** if all custodians lose their keys — the cluster is unrecoverable and must be re-bootstrapped from snapshot.

### 3.6 Root token + unseal key custody

The 5 unseal keys are split via Shamir's secret sharing. To unseal, any 3 of 5 keys must be combined. To use the keys for malicious purposes, an attacker would need 3 separate compromises.

**Distribute as follows:**

| Key | Holder                              | Storage                                             |
| --- | ----------------------------------- | --------------------------------------------------- |
| 1   | Platform engineering lead           | 1Password / Bitwarden personal vault, MFA-protected |
| 2   | Platform engineering deputy         | 1Password / Bitwarden personal vault, MFA-protected |
| 3   | AU IT director (security delegate)  | AU's existing key-escrow procedure                  |
| 4   | Off-site / DR custodian             | Sealed envelope in fire safe, audited annually      |
| 5   | Off-site / DR custodian (different) | Different fire safe / different facility from key 4 |

The threshold of 3 means **any 3 of these 5 must agree** to unseal. The configuration deliberately ensures no single person, no single facility, and no single account compromise can unseal Vault unilaterally.

**Root token handling**:

```bash
# [any node] — login with root token, create operator-tier admin tokens,
# revoke the root token

# (1) Login as root (one last time)
$ vault login <ROOT-TOKEN>

# (2) Create per-operator admin tokens (one per platform engineer).
#     Phase 1 token-based auth — Phase 2 replaces with Keycloak OIDC.
$ vault token create -policy=operator-admin -display-name=binalfew-admin \
    -ttl=720h -renewable=true
# Output includes a token. Give it to the operator securely (out-of-band,
# 1Password / encrypted email / etc.).

# (3) After every operator has their own token, REVOKE the root token.
$ vault token revoke <ROOT-TOKEN>
# Verify:
$ vault token lookup <ROOT-TOKEN>
# Expected: "permission denied" — token is gone.
```

> **ℹ A new root token can be generated when needed**
>
> If the bootstrap root token is lost or revoked, generating a new root token requires **a quorum of unseal keys** (3 of 5) cooperating via `vault operator generate-root`. This is exactly what we want: getting back to "god mode" requires the same level of consensus that unsealing requires. Document the procedure in [chapter 41 — Incident response](41-incident.md).

### 3.7 Operator authentication

Phase 1 uses **token-based auth** (one token per operator, distributed at bootstrap). Phase 2 [chapter 07 — Keycloak](07-keycloak.md) introduces OIDC auth so operators authenticate via SSO.

```bash
# [any node]

# (1) Each operator's daily login
$ vault login <OPERATOR-TOKEN>
# Operator now has whatever permissions their policy grants.

# (2) Renew before expiry (token TTL was 720h = 30 days)
$ vault token renew
# Resets TTL clock; works as long as operator is currently authenticated.

# (3) Lookup own token info
$ vault token lookup
# Shows display_name, policies, ttl, creation_time.
```

**Token TTL discipline**: 30-day TTL forces operators to renew monthly. If an operator leaves AU, their token's natural expiry guarantees offboarding within 30 days even if the explicit revoke-token step is missed. Phase 2's Keycloak federation makes offboarding immediate (revoke in AD → immediate effect on Vault sessions).

### 3.8 Policies (operator + workload templates)

Vault policies are HCL files attaching capabilities to API paths. Two foundational policies in Phase 1:

```bash
# [any node]

# (1) Operator-admin policy — full access for platform engineers
$ vault policy write operator-admin - <<'EOF'
# Phase 1 operator-admin: broad capabilities for bootstrap + day-2 ops.
# Phase 2 narrows this further once OIDC + per-team policies land.

path "*" {
  capabilities = ["create", "read", "update", "delete", "list", "sudo"]
}
EOF

# (2) App-readonly template — apps can read their own secrets, no writes,
#     no enumeration of other apps' paths.
$ vault policy write app-readonly-template - <<'EOF'
# Per-app readonly policy. Substitute <APP> with the app name when
# materialising for a specific app (e.g., `greenbook`, `hr-portal`).
# Phase 5 dynamic secrets will replace this with capability-bound
# per-workload policies issued by Nomad's Vault integration.

path "kv/data/apps/<APP>/*" {
  capabilities = ["read"]
}

path "kv/metadata/apps/<APP>/*" {
  capabilities = ["read", "list"]
}
EOF

# (3) Verify policies loaded
$ vault policy list
# Expected: default, operator-admin, app-readonly-template, root
```

**App secret namespace convention**:

```
kv/data/apps/<app>/<env>/<key>
```

Examples:

- `kv/data/apps/greenbook/prod/database_url`
- `kv/data/apps/greenbook/prod/session_secret`
- `kv/data/apps/hr-portal/staging/smtp_password`

This convention (a) groups secrets by app, (b) separates environments, (c) makes per-app policies trivial to materialise from the template above.

### 3.9 Secrets engines: KV v2

```bash
# [any node]

# (1) Enable KV v2 at the conventional `kv/` path
$ vault secrets enable -path=kv kv-v2
# Output: Success! Enabled the kv-v2 secrets engine at: kv/

# (2) Verify
$ vault secrets list
# Expected:
#   kv/    kv      kv_<id>     KV Version 2 (versioned secrets)
#   ...

# (3) Smoke test — write + read a sample secret
$ vault kv put kv/apps/example/dev/test-secret value=hello-world
$ vault kv get kv/apps/example/dev/test-secret
# Output:
#   ====== Data ======
#   Key      Value
#   ---      -----
#   value    hello-world

# (4) Clean up the test secret
$ vault kv metadata delete kv/apps/example/dev/test-secret
```

**KV v2 features used in Phase 1**:

- **Versioning**: every write creates a new version; old versions retrievable. Critical for "we rotated a password and now nothing works" recovery.
- **Soft delete**: `vault kv delete` marks the latest version deleted but retains it; `vault kv undelete` restores. Hard delete via `vault kv metadata delete`.
- **Check-and-set**: optional optimistic concurrency for paths where multiple writers might race.

Phase 5 keeps KV v2 alongside the new dynamic-secrets engines; this isn't a temporary choice.

### 3.10 Audit device

Vault's audit device records **every API request** — who, what, when, why. Critical for incident triage.

```bash
# [any node]

# (1) Create the audit log directory on each Vault node
#     (audit device is a per-node config; enabling on the leader
#     applies cluster-wide via Raft replication of the config)
$ for h in auishqosrvlt01 auishqosrvlt02 auishqosrvlt03; do
    ssh $h.au-internal "sudo install -d -m 750 -o vault -g vault /var/log/vault"
  done

# (2) Enable file audit device on the cluster
$ vault audit enable file file_path=/var/log/vault/audit.log
# Output: Success! Enabled the file audit device at: file/

# (3) Verify
$ vault audit list
# Expected:
#   file/    file     file_xxx    file_path=/var/log/vault/audit.log
```

**Audit log contents**:

```bash
# [any Vault node]
$ sudo tail -1 /var/log/vault/audit.log | jq
# Output: a JSON document with:
#   - request: who (token accessor), what (path + operation), client IP
#   - response: HTTP status, mount point, lease info
#   - timestamps
# Each entry is HMAC'd — secrets in the request/response are NOT
# logged in plaintext.
```

**Log rotation** (auditd's audit-log isn't subject to logrotate by default; we add a rule):

```bash
# [each Vault node]
$ sudo tee /etc/logrotate.d/vault > /dev/null <<'EOF'
/var/log/vault/audit.log {
    daily
    rotate 90
    missingok
    notifempty
    compress
    delaycompress
    sharedscripts
    postrotate
        # Vault holds an open file descriptor on audit.log; signal it
        # to reopen via SIGHUP. Service handles this cleanly.
        systemctl kill -s HUP vault
    endscript
}
EOF
```

90-day retention is consistent with the bastion's auth.log retention from chapter 02 §2.7.

### 3.11 Snapshot strategy

Raft snapshots are point-in-time copies of all Vault data. Take them frequently; restore from them if Raft state corrupts.

```bash
# [auishqosrvlt01] — only the leader can take snapshots

# (1) Manual snapshot — useful for testing or pre-upgrade safety net
$ vault operator raft snapshot save /tmp/vault-snapshot-$(date +%Y%m%d-%H%M).snap
$ ls -lh /tmp/vault-snapshot-*.snap
# Expected: ~1-10 MB for a small cluster

# (2) Automate via systemd timer — run hourly on the leader, store
#     under /var/lib/vault/snapshots, retain last 24
$ sudo install -d -m 750 -o vault -g vault /var/lib/vault/snapshots

$ sudo tee /usr/local/bin/vault-snapshot.sh > /dev/null <<'EOF'
#!/usr/bin/env bash
# Vault Raft snapshot — runs hourly on the leader. Skips on followers.
set -euo pipefail

# Only run on the leader
LEADER=$(VAULT_ADDR=https://127.0.0.1:8200 vault status -format=json \
  | jq -r '.is_self // false')
if [[ "${LEADER}" != "true" ]]; then
  echo "Not the leader; skipping snapshot."
  exit 0
fi

# Take the snapshot. VAULT_TOKEN must be set via systemd EnvironmentFile.
TIMESTAMP=$(date +%Y%m%d-%H%M)
DEST=/var/lib/vault/snapshots/vault-${TIMESTAMP}.snap
vault operator raft snapshot save "${DEST}"
chmod 600 "${DEST}"

# Retain only the last 24 snapshots
ls -1t /var/lib/vault/snapshots/vault-*.snap | tail -n +25 | xargs -r rm
EOF
$ sudo chmod 750 /usr/local/bin/vault-snapshot.sh

$ sudo tee /etc/systemd/system/vault-snapshot.service > /dev/null <<'EOF'
[Unit]
Description=Vault Raft snapshot
After=vault.service

[Service]
Type=oneshot
User=vault
Group=vault
EnvironmentFile=/etc/vault.d/snapshot.env
ExecStart=/usr/local/bin/vault-snapshot.sh
EOF

$ sudo tee /etc/systemd/system/vault-snapshot.timer > /dev/null <<'EOF'
[Unit]
Description=Hourly Vault Raft snapshot

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
EOF

# (3) Provide the snapshot service with a Vault token (a dedicated one
#     with sudo on /sys/storage/raft/snapshot only — narrowly scoped)
$ vault token create -policy=snapshot-operator -ttl=8760h -renewable=true \
    -display-name="raft-snapshot"
# Save the token to the env file
$ sudo tee /etc/vault.d/snapshot.env > /dev/null <<EOF
VAULT_ADDR=https://127.0.0.1:8200
VAULT_TOKEN=<TOKEN-FROM-PREVIOUS-COMMAND>
EOF
$ sudo chmod 640 /etc/vault.d/snapshot.env
$ sudo chown root:vault /etc/vault.d/snapshot.env

# (4) Snapshot policy
$ vault policy write snapshot-operator - <<'EOF'
path "sys/storage/raft/snapshot" {
  capabilities = ["read"]
}
EOF

# (5) Enable + start the timer (do this on ALL three nodes; the script
#     itself checks "am I the leader" before acting)
$ sudo systemctl daemon-reload
$ sudo systemctl enable --now vault-snapshot.timer
$ sudo systemctl list-timers vault-snapshot.timer
```

**Off-site replication of snapshots** (Phase 4 [chapter 19 — Backup strategy](19-backups.md) handles this fully — for Phase 1, accept that all snapshots live on the leader's local disk and a node-loss event reconstructs from another node's Raft log, not from snapshots).

### 3.12 UFW + firewall rules

```bash
# [each Vault VM]

# Allow Vault API + cluster ports from the Platform VLAN + App VLAN
# (apps need to read secrets at startup)
$ sudo ufw allow from 10.111.10.0/24 to any port 8200 proto tcp \
    comment 'App VLAN → Vault API'
$ sudo ufw allow from 10.111.30.0/24 to any port 8200 proto tcp \
    comment 'Platform VLAN → Vault API'

# Inter-Vault cluster traffic on 8201 — peers only
$ sudo ufw allow from 10.111.30.10 to any port 8201 proto tcp comment 'vlt01'
$ sudo ufw allow from 10.111.30.11 to any port 8201 proto tcp comment 'vlt02'
$ sudo ufw allow from 10.111.30.12 to any port 8201 proto tcp comment 'vlt03'

$ sudo ufw status verbose | grep -E '8200|8201'
```

The bastion can already SSH in via the operators-group rule from chapter 02 §2.4; no extra UFW for SSH.

### 3.13 Verification

```bash
# (1) Cluster healthy?
$ vault status
# Expected on leader: HA Mode: active
# Expected on followers: HA Mode: standby

$ vault operator raft list-peers
# Expected: 3 peers, all voters

# (2) Auth + policy works?
$ vault token lookup
# Expected: your operator token info, with operator-admin policy

# (3) KV engine works?
$ vault kv put kv/apps/example/test value=verify-$(date +%s)
$ vault kv get kv/apps/example/test
# Expected: the value you just wrote
$ vault kv metadata delete kv/apps/example/test

# (4) Audit log capturing?
$ sudo tail -3 /var/log/vault/audit.log | jq -r '.request.path'
# Expected: paths from your recent operations

# (5) Snapshot timer running?
$ systemctl list-timers vault-snapshot.timer | head -5
# Expected: Next: <some-time-in-the-next-hour>; Last: <recent>
$ ls -lh /var/lib/vault/snapshots/ | head -5
# Expected: at least one snapshot file (after first run)

# (6) Sealing test — verify any node CAN be sealed and re-unsealed
#     (don't run this on the leader without coordinating!)
# [auishqosrvlt03 — a follower]
$ vault operator seal
$ vault status     # Sealed: true
# Now unseal it back
$ vault operator unseal <KEY-1>
$ vault operator unseal <KEY-2>
$ vault operator unseal <KEY-3>
$ vault status     # Sealed: false; HA Mode: standby
```

**Common failures and remedies:**

| Symptom                                                              | Cause                                                          | Fix                                                                                                                             |
| -------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `vault operator init` returns "Vault is already initialized"         | Cluster was init'd previously; data dir not empty              | Determined intentional? Use existing keys. Otherwise: stop vault on all nodes, `rm -rf /opt/vault/data/*`, re-init.             |
| `unseal progress 1/3` then no further progress                       | Provided unseal key is wrong (typo / from different cluster)   | Verify key against the `vault-init.json` issued at bootstrap. Wrong keys make 0 progress, not partial.                          |
| Followers stuck in "standby" with `Initialized: false`               | retry_join in vault.hcl pointing at the wrong leader IP / cert | Check `journalctl -u vault` on follower; look for "failed to retry join" lines. Fix the IP / TLS hostname mismatch.             |
| `vault status` returns `permission denied` for operator              | Token expired                                                  | `vault login <TOKEN>` if token still valid; if not, generate new operator token via root key quorum (chapter 41)                |
| Audit device fails: `failed to enable: cannot mkdir /var/log/vault/` | Directory not created on all 3 nodes before enabling           | `sudo install -d -m 750 -o vault -g vault /var/log/vault` on each node, then retry                                              |
| Snapshot script fails with "permission denied" on path               | snapshot-operator policy too narrow                            | Verify `path "sys/storage/raft/snapshot" { capabilities = ["read"] }` is in the policy; re-create policy if missing             |
| Cluster split-brain after network partition                          | Raft fall-back to "no leader" — quorum (2 of 3) lost           | Reconnect the partitioned nodes; Raft re-elects automatically. If permanently lost: restore from latest snapshot per chapter 41 |

### 3.14 Path to Phase 5

Phase 5 [chapter 22 — Dynamic Vault secrets](22-vault-dynamic.md) extends without breaking what's here:

| Capability              | Phase 1 (this chapter)                           | Phase 5 (chapter 22)                                                                            |
| ----------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Operator authentication | Per-operator tokens with 30-day TTL              | Keycloak OIDC (chapter 07) → Vault auth method; SSO; immediate revocation on AD offboarding     |
| Database credentials    | Static passwords stored in KV v2                 | Vault `database` engine generates per-workload credentials with short TTL; rotation automatic   |
| TLS material            | Static AU wildcard cert in `/etc/vault.d/tls/`   | Vault PKI engine generates per-cluster certs; renews automatically before expiry                |
| Sealing                 | Manual Shamir unseal after restart (3 of 5 keys) | Auto-unseal via on-prem Transit-mode Vault on a separate cluster (no humans needed for restart) |
| Workload identity       | Each app uses an operator-issued static token    | Nomad workload identity → Vault JWT auth → workload-bound credentials at job startup            |

The KV v2 engine + audit device + snapshot pipeline + 3-node Raft cluster all carry over unchanged. Phase 5 adds new features alongside; it doesn't reshape the foundation.

---
