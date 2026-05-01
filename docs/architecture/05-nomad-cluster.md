# 05 — Nomad cluster

> **Phase**: 1 (developer foothold) · **Run on**: 3× Nomad servers (`auishqosrnmd01-03`) + 3+ Nomad clients (`auishqosrapp01-03`) · **Time**: ~4 hours
>
> The orchestrator. Every application workload on the platform runs as a Nomad job — containers scheduled across clients, secrets fetched from Vault at startup, services registered in Consul for discovery. Phase 1 brings up 3 servers (with Consul colocated for service discovery) plus an initial 3 clients (in the App VLAN) ready to run greenbook + future apps.
>
> Phase 5 [chapter 22 — Dynamic Vault secrets](22-vault-dynamic.md) extends Vault integration to dynamic database credentials; nothing in this chapter changes shape, only adds.
>
> **Prev**: [04 — GitLab CE](04-gitlab.md) · **Next**: [06 — Nexus](06-nexus.md) · **Index**: [README](README.md)

---

## Contents

- [§5.1 Role + threat model](#51-role-threat-model)
- [§5.2 Pre-flight (servers + clients)](#52-pre-flight-servers-clients)
- [§5.3 Install Nomad + Consul on servers](#53-install-nomad-consul-on-servers)
- [§5.4 mTLS for the cluster](#54-mtls-for-the-cluster)
- [§5.5 Server cluster bootstrap](#55-server-cluster-bootstrap)
- [§5.6 ACL bootstrap (Consul + Nomad)](#56-acl-bootstrap-consul-nomad)
- [§5.7 Install Nomad clients](#57-install-nomad-clients)
- [§5.8 Vault integration (JWT workload identity)](#58-vault-integration-jwt-workload-identity)
- [§5.9 First test job (end-to-end smoke)](#59-first-test-job-end-to-end-smoke)
- [§5.10 GitLab Runner co-location](#510-gitlab-runner-co-location)
- [§5.11 Audit logging](#511-audit-logging)
- [§5.12 Snapshot strategy](#512-snapshot-strategy)
- [§5.13 UFW + firewall rules](#513-ufw-firewall-rules)
- [§5.14 Verification](#514-verification)
- [§5.15 Path to Phase 5](#515-path-to-phase-5)

## 5. Nomad cluster

### 5.1 Role + threat model

Nomad is the **workload scheduler**. It accepts job specs, decides which client should run them, monitors health, restarts failures, and exposes APIs for deploys. Consul is paired with Nomad as the **service discovery + health-check** layer; every Nomad-scheduled service registers in Consul automatically and is reachable by other workloads via Consul DNS (`<service>.service.consul`).

Three consequences:

1. **Compromise of the Nomad servers = ability to schedule arbitrary workloads on every client.** An attacker with Nomad ACL admin can launch a privileged container on any client and pivot to host-level access. Defence: ACLs from day one, mTLS between all agents, audit logging, sealed-Vault dependency for workload secrets.
2. **Outage of the server quorum = no new deploys, no scaling, no rescheduling.** Existing running workloads keep running (clients operate independently of servers for already-scheduled jobs). New deploys fail. Mitigation: 3-server Raft consensus tolerates 1 server loss.
3. **Compromise of a single client = workloads on that client are exposed.** Other clients unaffected; servers unaffected. Defence: clients run only docker driver (no raw_exec), client-side resource limits, no secret material on disk after fetch.

**Threat model — what we defend against:**

| Threat                                           | Mitigation                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Unauthenticated agent joining the cluster        | mTLS for all agent-to-agent and client-to-server traffic; gossip encryption with shared key                              |
| Stolen ACL token                                 | Per-operator + per-workload tokens; short TTL; revocation propagates within seconds via gossip                           |
| Malicious job spec                               | ACL policies restrict who can submit jobs to which namespaces; namespace = blast-radius boundary                         |
| Workload escapes container                       | Docker driver with seccomp + capability drops; cgroup limits enforced; clients run nothing else of value                 |
| Vault token leakage from a workload              | Workload identity JWTs are short-lived (15 min); no static Vault tokens in job specs; auto-rotation via Nomad templating |
| Server data tampering (Raft state)               | Raft hash chain; quorum commits; nightly snapshot for recovery                                                           |
| Client-server clock skew breaks token validation | systemd-timesyncd on every node; chapter 02 §2.2 base hardening                                                          |

**Phase 1 deliberate non-goals:**

- **Consul Connect (mTLS service mesh)** — Phase 1 uses plain HTTP between workloads inside the App VLAN. Consul Connect adds workload-to-workload mTLS without app code changes; deferred to Phase 5 if compliance posture tightens.
- **Multi-region / multi-DC federation** — single datacenter (`dc1`), single region. Phase 4 [chapter 20 — DR site](20-dr.md) introduces a warm-standby region, not active-active.
- **Volume management beyond host volumes** — Phase 3 introduces Nomad CSI plugin for MinIO. Phase 1 uses Docker host volumes for stateful test workloads.
- **Spread / affinity sophistication** — basic constraints (`distinct_hosts`, datacenter) only. Tier-aware spreading (e.g., "put 1 instance per VLAN") deferred until apps actually need it.

### 5.2 Pre-flight (servers + clients)

**Servers** (`auishqosrnmd01`, `auishqosrnmd02`, `auishqosrnmd03`) — VLAN 4 (Platform), IPs `10.111.30.30/31/32`. Each runs both Nomad server + Consul server (colocated).

| Resource | Per server | Why                                                                       |
| -------- | ---------- | ------------------------------------------------------------------------- |
| vCPU     | 2          | Raft is I/O-bound; both Nomad and Consul are lightweight on idle clusters |
| RAM      | 4 GB       | Consul uses ~256 MB; Nomad ~256 MB; OS + headroom = 4 GB comfortable      |
| Disk     | 40 GB SSD  | Raft logs + state for both Nomad and Consul; snapshots                    |

**Clients** (`auishqosrapp01`, `auishqosrapp02`, `auishqosrapp03` initially) — VLAN 2 (App), IPs `10.111.10.10/11/12`. Each runs Nomad client + Docker + GitLab Runner.

| Resource | Per client | Why                                                                             |
| -------- | ---------- | ------------------------------------------------------------------------------- |
| vCPU     | 4          | Each runs N containerised workloads + 1-2 CI jobs concurrently                  |
| RAM      | 16 GB      | Per-workload limits enforce the budget; total across workloads stays under this |
| Disk     | 100 GB SSD | Docker layer cache + workload writable volumes + ephemeral CI workspaces        |

```bash
# [each Nomad server + each Nomad client]

# Confirm AU base hardening
$ lsb_release -d
$ sudo systemctl is-active unattended-upgrades fail2ban
$ groups | grep operators
```

**Clients additionally need Docker installed**:

```bash
# [each Nomad client] — Docker setup; same as greenbook deployment ch04 §4.1
$ sudo apt install -y ca-certificates curl gnupg
$ sudo install -m 0755 -d /etc/apt/keyrings
$ curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
$ echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list

$ sudo apt update
$ sudo apt install -y docker-ce docker-ce-cli containerd.io
$ sudo systemctl enable --now docker
$ docker --version
```

### 5.3 Install Nomad + Consul on servers

Same HashiCorp apt repo as Vault (chapter 03 §3.3):

```bash
# [auishqosrnmd01-03]

# (1) Add HashiCorp repo (skip if Vault was installed on this host first
#     — repo already present)
$ wget -O- https://apt.releases.hashicorp.com/gpg \
    | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
$ echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] \
    https://apt.releases.hashicorp.com $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/hashicorp.list

# (2) Install both binaries
$ sudo apt update
$ sudo apt install -y nomad consul

# (3) Pin versions
$ sudo apt-mark hold nomad consul

# (4) Verify
$ nomad version    # Nomad v1.x.x
$ consul version   # Consul v1.x.x
$ id nomad consul
# Expected: both system users with their own group; data dirs at
# /opt/nomad/data and /opt/consul/data created automatically.
```

### 5.4 mTLS for the cluster

Nomad and Consul both support full mTLS between agents. Generate a private CA + per-node certs once; distribute to every server and client.

```bash
# [operator workstation OR auishqosrnmd01]

# (1) Generate the CA + per-node certs using consul's built-in TLS tools
$ consul tls ca create
# Produces: consul-agent-ca.pem + consul-agent-ca-key.pem
# Keep the CA key safe — anything you sign with it joins the cluster.

# (2) Generate server certs (one per server, all in the same DC)
$ for i in 01 02 03; do
    consul tls cert create -server -dc dc1 \
      -additional-dnsname=auishqosrnmd${i} \
      -additional-ipaddress=10.111.30.$((29 + ${i#0}))
  done
# Produces: dc1-server-consul-{0,1,2}.pem + matching keys

# (3) Generate client certs (one per client)
$ for i in 01 02 03; do
    consul tls cert create -client -dc dc1
  done
# Produces: dc1-client-consul-{0,1,2}.pem + matching keys

# (4) Generate gossip-encryption key (Consul + Nomad both use one)
$ consul keygen
# Output: a base64-encoded key — copy it.

# (5) Generate Nomad gossip key separately (different from Consul's)
$ nomad operator gossip keyring generate
```

Distribute the per-node cert + CA bundle + gossip keys to each server and client under `/etc/nomad.d/tls/` and `/etc/consul.d/tls/`. Use Vault's KV engine to store the gossip keys + the CA private key (so future re-issuance is auditable).

```bash
# Stash gossip keys + CA in Vault
$ vault kv put kv/platform/nomad-consul/gossip \
    consul_key='<consul-keygen-output>' \
    nomad_key='<nomad-gossip-output>'

$ vault kv put kv/platform/nomad-consul/ca \
    cert="$(cat consul-agent-ca.pem)" \
    key="$(cat consul-agent-ca-key.pem)" \
    rotated_at="$(date -Iseconds)"
```

> **ℹ The CA key is the master key for cluster identity**
>
> Anyone with the CA private key can mint a cert that joins the cluster. Treat it the same as Vault's unseal keys: limited custody, audited access, periodic rotation. Phase 5 [chapter 22 — Dynamic Vault secrets](22-vault-dynamic.md) replaces this static CA with Vault PKI engine, removing the static-key custody problem entirely.

### 5.5 Server cluster bootstrap

```bash
# [each Nomad server — different node_id and addresses per node]

# (1) Consul server config
$ sudo tee /etc/consul.d/server.hcl > /dev/null <<'EOF'
datacenter         = "dc1"
data_dir           = "/opt/consul/data"
log_level          = "INFO"
server             = true
bootstrap_expect   = 3
ui_config { enabled = true }

# Bind addresses — REPLACE with this node's IP
bind_addr   = "10.111.30.30"
client_addr = "0.0.0.0"

# Peers — list all 3 servers; server skips itself
retry_join = [
  "10.111.30.30",
  "10.111.30.31",
  "10.111.30.32"
]

# mTLS
tls {
  defaults {
    ca_file        = "/etc/consul.d/tls/consul-agent-ca.pem"
    cert_file      = "/etc/consul.d/tls/dc1-server-consul-0.pem"
    key_file       = "/etc/consul.d/tls/dc1-server-consul-0-key.pem"
    verify_incoming        = true
    verify_outgoing        = true
    verify_server_hostname = true
  }
}

# Gossip encryption — substitute the consul keygen output
encrypt = "<CONSUL_GOSSIP_KEY>"

# ACLs — enabled in default-deny mode; bootstrap below
acl {
  enabled        = true
  default_policy = "deny"
  enable_token_persistence = true
}
EOF

$ sudo systemctl enable consul
$ sudo systemctl start consul

# (2) Nomad server config
$ sudo tee /etc/nomad.d/nomad.hcl > /dev/null <<'EOF'
datacenter = "dc1"
data_dir   = "/opt/nomad/data"
log_level  = "INFO"

server {
  enabled          = true
  bootstrap_expect = 3
  encrypt          = "<NOMAD_GOSSIP_KEY>"

  default_scheduler_config {
    scheduler_algorithm = "spread"
  }
}

client {
  enabled = false
}

# Bind to this node's IP
bind_addr = "10.111.30.30"

# Advertise the same IP to peers + clients
advertise {
  http = "10.111.30.30:4646"
  rpc  = "10.111.30.30:4647"
  serf = "10.111.30.30:4648"
}

# mTLS
tls {
  http = true
  rpc  = true
  ca_file   = "/etc/nomad.d/tls/consul-agent-ca.pem"
  cert_file = "/etc/nomad.d/tls/dc1-server-consul-0.pem"
  key_file  = "/etc/nomad.d/tls/dc1-server-consul-0-key.pem"
  verify_server_hostname = true
  verify_https_client    = true
}

# Consul integration — local agent on this same host
consul {
  address    = "127.0.0.1:8501"   # HTTPS API (mTLS-enabled)
  ssl        = true
  ca_file    = "/etc/nomad.d/tls/consul-agent-ca.pem"
  cert_file  = "/etc/nomad.d/tls/dc1-server-consul-0.pem"
  key_file   = "/etc/nomad.d/tls/dc1-server-consul-0-key.pem"
  auto_advertise      = true
  server_auto_join    = true
  client_auto_join    = true
}

# ACLs
acl {
  enabled = true
}
EOF

$ sudo systemctl enable nomad
$ sudo systemctl start nomad

# (3) Verify Consul cluster forms
$ consul members
# Expected: 3 servers, all "alive"

# (4) Verify Nomad cluster forms (after all 3 servers up)
$ nomad server members
# Expected: 3 servers in the leader/follower set
$ nomad operator raft list-peers
# Expected: 3 voters
```

### 5.6 ACL bootstrap (Consul + Nomad)

ACLs are enabled but unbootstrapped — every operation returns "permission denied" until we mint the initial management token.

```bash
# [auishqosrnmd01]

# (1) Bootstrap Consul ACL
$ consul acl bootstrap
# Output includes:
#   AccessorID: <accessor-id>
#   SecretID:   <secret-token> ← MANAGEMENT TOKEN, store in Vault
#   Description: Bootstrap Token (Global Management)
#   Policies: 00000000-0000-0000-0000-000000000001 - global-management

$ vault kv put kv/platform/nomad-consul/consul_bootstrap_token \
    accessor='<accessor-id>' \
    secret='<secret-token>' \
    created_at="$(date -Iseconds)"

# Set the env var for subsequent commands
$ export CONSUL_HTTP_TOKEN='<secret-token>'

# (2) Create per-operator policy + token (Phase 1; Phase 2 swaps to Keycloak)
$ consul acl policy create -name operator -rules @- <<'EOF'
operator   = "write"
agent_prefix "" {
  policy = "write"
}
node_prefix "" {
  policy = "write"
}
service_prefix "" {
  policy = "write"
}
key_prefix "" {
  policy = "write"
}
session_prefix "" {
  policy = "write"
}
EOF

$ consul acl token create -policy-name operator -description "binalfew-operator"
# Save the token for the operator

# (3) Bootstrap Nomad ACL
$ nomad acl bootstrap
# Output includes:
#   Accessor ID: <accessor-id>
#   Secret ID:   <secret-token> ← NOMAD MANAGEMENT TOKEN
#   Type:        management

$ vault kv put kv/platform/nomad-consul/nomad_bootstrap_token \
    accessor='<accessor-id>' \
    secret='<secret-token>' \
    created_at="$(date -Iseconds)"

$ export NOMAD_TOKEN='<secret-token>'

# (4) Create per-operator Nomad policy + token
$ nomad acl policy apply -description "Operator policy" operator-policy - <<'EOF'
namespace "*" {
  policy       = "write"
  capabilities = ["alloc-exec", "alloc-lifecycle"]
}
agent {
  policy = "write"
}
node {
  policy = "write"
}
operator {
  policy = "write"
}
EOF

$ nomad acl token create -name "binalfew-operator" -type=client \
    -policy=operator-policy
# Save the token for the operator
```

> **⚠ Consul + Nomad bootstrap tokens have no TTL — treat as root**
>
> Both bootstrap tokens are full-permissions, never-expiring management tokens. Once per-operator tokens are issued, **revoke the bootstrap tokens** if AU's policy allows, or seal them away in the same custody process as Vault's root token (chapter 03 §3.6). Phase 2 SSO removes the standing-token problem entirely.

### 5.7 Install Nomad clients

Repeat §5.3 (install Nomad + Consul) on each client VM. The configs differ:

```bash
# [each client — auishqosrapp01-03]

# Consul client config (NOT a server)
$ sudo tee /etc/consul.d/client.hcl > /dev/null <<'EOF'
datacenter = "dc1"
data_dir   = "/opt/consul/data"
server     = false
bind_addr  = "10.111.10.10"   # this client's IP
client_addr = "127.0.0.1"

retry_join = [
  "10.111.30.30",
  "10.111.30.31",
  "10.111.30.32"
]

tls {
  defaults {
    ca_file   = "/etc/consul.d/tls/consul-agent-ca.pem"
    cert_file = "/etc/consul.d/tls/dc1-client-consul-0.pem"
    key_file  = "/etc/consul.d/tls/dc1-client-consul-0-key.pem"
    verify_incoming        = true
    verify_outgoing        = true
    verify_server_hostname = true
  }
}

encrypt = "<CONSUL_GOSSIP_KEY>"

acl {
  enabled = true
  default_policy = "deny"
  tokens {
    default = "<consul-client-token>"
  }
}
EOF

# Nomad client config
$ sudo tee /etc/nomad.d/nomad.hcl > /dev/null <<'EOF'
datacenter = "dc1"
data_dir   = "/opt/nomad/data"
log_level  = "INFO"

server { enabled = false }

client {
  enabled = true
  servers = [
    "10.111.30.30:4647",
    "10.111.30.31:4647",
    "10.111.30.32:4647"
  ]

  # Resource limits visible to scheduler
  reserved {
    cpu    = 500   # MHz reserved for OS
    memory = 1024  # MB reserved for OS
  }

  # Drivers — Phase 1 docker only; raw_exec disabled (security)
  options {
    "driver.raw_exec.enable" = "0"
  }

  # Metadata for constraint-based scheduling
  meta {
    "tier" = "app"
  }
}

bind_addr = "10.111.10.10"
advertise {
  http = "10.111.10.10:4646"
  rpc  = "10.111.10.10:4647"
  serf = "10.111.10.10:4648"
}

tls {
  http = true
  rpc  = true
  ca_file   = "/etc/nomad.d/tls/consul-agent-ca.pem"
  cert_file = "/etc/nomad.d/tls/dc1-client-consul-0.pem"
  key_file  = "/etc/nomad.d/tls/dc1-client-consul-0-key.pem"
  verify_server_hostname = true
}

consul {
  address   = "127.0.0.1:8501"
  ssl       = true
  ca_file   = "/etc/nomad.d/tls/consul-agent-ca.pem"
  cert_file = "/etc/nomad.d/tls/dc1-client-consul-0.pem"
  key_file  = "/etc/nomad.d/tls/dc1-client-consul-0-key.pem"
  token     = "<consul-client-token>"
  auto_advertise = true
}

acl { enabled = true }

plugin "docker" {
  config {
    allow_privileged = false   # workloads can't request --privileged
    volumes {
      enabled = false           # no host-volume mounts in Phase 1
    }
  }
}
EOF

$ sudo systemctl enable consul nomad
$ sudo systemctl start consul nomad

# Verify
$ consul members | grep client    # this client visible
$ nomad node status               # this client visible to servers
```

### 5.8 Vault integration (JWT workload identity)

Nomad workloads request Vault tokens via **workload identity** — a JWT signed by Nomad and validated by Vault. No static Vault token in the job spec; the JWT is bound to the specific workload (job + task + alloc) and short-lived.

```bash
# [auishqosrnmd01 — operations from any management-token-having node]

# (1) Get Nomad's JWT signing public key (for Vault to verify JWTs)
$ nomad operator api /.well-known/jwks.json
# Output: a JWKS document with the public key.
# Take the .jwks_url for Vault config (the same /.well-known endpoint).

# (2) Configure Vault's JWT auth method to trust Nomad's JWTs
$ vault auth enable -path=nomad-workload jwt

$ vault write auth/nomad-workload/config \
    jwks_url="https://nomad.service.consul:4646/.well-known/jwks.json" \
    jwt_supported_algs="RS256,EdDSA" \
    bound_issuer="https://nomad.africanunion.org"

# (3) Create a default Vault role for Nomad workloads. The role binds
#     specific JWT claims (job ID, namespace, etc.) to Vault policies.
$ vault write auth/nomad-workload/role/nomad-workload \
    bound_audiences="vault.io" \
    user_claim="/nomad_job_id" \
    role_type="jwt" \
    token_policies="default,app-readonly-template" \
    token_period=900    # 15-minute token, auto-renew via Nomad template

# (4) On Nomad servers, configure Vault integration
#     /etc/nomad.d/vault.hcl additions:
$ sudo tee /etc/nomad.d/vault.hcl > /dev/null <<'EOF'
vault {
  enabled  = true
  address  = "https://vault.service.consul:8200"
  jwt_auth_backend_path = "nomad-workload"

  # Auto-renew token issued for Nomad's own use (the Nomad-server-to-
  # Vault token, separate from workload tokens)
  task_token_ttl = "1h"

  ca_file = "/etc/nomad.d/tls/consul-agent-ca.pem"
}
EOF

$ sudo systemctl restart nomad   # reload config
```

> **ℹ Workload identity is the modern Vault-Nomad pattern**
>
> Older deployments used static Vault tokens written into Nomad's config (`vault { token = "<long-lived-token>" }`). That meant every workload shared one token with broad permissions. Workload identity binds each JWT to a specific job + alloc, so Vault can issue policies scoped to "this job, this task, this allocation" — far smaller blast radius if a workload is compromised. Phase 1 uses workload identity; never go back to static tokens.

### 5.9 First test job (end-to-end smoke)

A trivial httpd job that registers in Consul, fetches a secret from Vault, and proves the whole pipeline works.

```bash
# [operator workstation — with NOMAD_TOKEN exported]

# (1) Submit a small test secret to Vault
$ vault kv put kv/apps/example/dev/test-secret value="hello-from-vault"

# (2) Job spec:
$ cat > /tmp/test-job.nomad.hcl <<'EOF'
job "test-job" {
  datacenters = ["dc1"]

  group "web" {
    count = 1

    network {
      port "http" { to = 80 }
    }

    service {
      name = "test-job"
      port = "http"
      check {
        type     = "http"
        path     = "/"
        interval = "10s"
        timeout  = "2s"
      }
    }

    task "nginx" {
      driver = "docker"

      config {
        image = "nginx:alpine"
        ports = ["http"]
      }

      # Workload identity for Vault — fetches a secret at startup,
      # places it in /local/secret.txt for the container to read
      identity {
        aud = ["vault.io"]
        ttl = "15m"
      }

      vault {
        policies = ["app-readonly-template"]
      }

      template {
        data = <<EOH
TEST_SECRET={{ with secret "kv/data/apps/example/dev/test-secret" }}{{ .Data.data.value }}{{ end }}
EOH
        destination = "/local/secret.txt"
      }

      resources {
        cpu    = 100
        memory = 64
      }
    }
  }
}
EOF

# (3) Submit
$ nomad job run /tmp/test-job.nomad.hcl
# Expected: "Job submitted successfully" + allocations created on
# clients

# (4) Watch it come up
$ nomad job status test-job
# Expected: status "running" with 1/1 allocations

# (5) Confirm Consul registered the service
$ consul catalog services
# Expected: "test-job" appears in the list
$ dig @127.0.0.1 -p 8600 test-job.service.consul +short
# Expected: an IP from the App VLAN

# (6) Confirm the workload fetched the secret
$ ALLOC_ID=$(nomad job allocs test-job | awk 'NR==2{print $1}')
$ nomad alloc exec $ALLOC_ID cat /local/secret.txt
# Expected: TEST_SECRET=hello-from-vault

# (7) Tear down the test
$ nomad job stop -purge test-job
$ vault kv metadata delete kv/apps/example/dev/test-secret
```

If steps (1)-(6) succeed, the entire Phase 1 stack is verified working: Vault → Nomad → Consul → Docker → workload, with audit logging and ACL enforcement at every step.

### 5.10 GitLab Runner co-location

GitLab Runners are CI executors. Phase 1 installs them on the Nomad clients (saves a VM tier; runners share the same hardware as workloads).

```bash
# [each Nomad client — auishqosrapp01-03]

# (1) Install GitLab Runner from the official repo
$ curl -L "https://packages.gitlab.com/install/repositories/runner/gitlab-runner/script.deb.sh" \
    | sudo bash
$ sudo apt install -y gitlab-runner

# (2) Register the runner — fetch the registration token from Vault
#     (chapter 04 §4.9 stored it in kv/platform/gitlab/runner_registration_token)
$ TOKEN=$(vault kv get -field=token kv/platform/gitlab/runner_registration_token)
$ sudo gitlab-runner register --non-interactive \
    --url https://gitlab.africanunion.org/ \
    --registration-token "$TOKEN" \
    --executor docker \
    --docker-image alpine:latest \
    --description "auishqosrapp01-runner" \
    --tag-list "platform-runner,docker" \
    --run-untagged="false" \
    --locked="false"

# (3) Verify
$ sudo gitlab-runner list
# Expected: this runner registered, executor=docker
$ sudo systemctl status gitlab-runner
# Expected: active (running)
```

After all 3 clients have a registered runner, the `platform-runner` tag pool has 3 concurrent CI jobs available.

### 5.11 Audit logging

Both Nomad and Consul write structured logs to stdout (captured by systemd journal) and optionally to file via `log_file`.

```bash
# [each Nomad / Consul host]

# (1) Confirm journald captures both
$ sudo journalctl -u nomad -n 20
$ sudo journalctl -u consul -n 20

# (2) Add audit logging — Consul writes audit events to a separate file
#     when configured (Enterprise feature). For Phase 1 we lean on
#     journald + Phase 2 Loki ingestion.

# (3) Common audit queries
$ sudo journalctl -u nomad --since '1 hour ago' | grep -i 'job\|alloc\|deploy'
$ sudo journalctl -u consul --since '1 hour ago' | grep -i 'acl\|register'
```

Phase 2 [chapter 09 — Loki + Grafana](09-loki.md) ingests these journald streams into the central observability stack.

### 5.12 Snapshot strategy

Both Nomad and Consul are Raft-based; both support snapshot save / restore. Schedule hourly snapshots on the leaders.

```bash
# [each Nomad server — same script handles both Nomad + Consul snapshots]

$ sudo install -d -m 750 -o nomad -g nomad /var/lib/nomad/snapshots
$ sudo install -d -m 750 -o consul -g consul /var/lib/consul/snapshots

$ sudo tee /usr/local/bin/nomad-consul-snapshot.sh > /dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
TS=$(date +%Y%m%d-%H%M)

# Nomad snapshot — only on the leader
if nomad agent-info | grep -q 'leader = true'; then
  nomad operator snapshot save \
    -token "$NOMAD_TOKEN" \
    "/var/lib/nomad/snapshots/nomad-${TS}.snap"
  ls -1t /var/lib/nomad/snapshots/nomad-*.snap | tail -n +25 | xargs -r rm
fi

# Consul snapshot — only on the leader
if consul info | grep -q 'leader = true'; then
  consul snapshot save \
    -token "$CONSUL_HTTP_TOKEN" \
    "/var/lib/consul/snapshots/consul-${TS}.snap"
  ls -1t /var/lib/consul/snapshots/consul-*.snap | tail -n +25 | xargs -r rm
fi
EOF
$ sudo chmod 750 /usr/local/bin/nomad-consul-snapshot.sh

# Tokens for the snapshot service
$ sudo tee /etc/nomad-consul-snapshot.env > /dev/null <<EOF
NOMAD_TOKEN=<nomad-management-token-or-snapshot-scoped-token>
CONSUL_HTTP_TOKEN=<consul-snapshot-token>
NOMAD_ADDR=https://127.0.0.1:4646
CONSUL_HTTP_ADDR=https://127.0.0.1:8501
EOF
$ sudo chmod 600 /etc/nomad-consul-snapshot.env

# systemd timer
$ sudo tee /etc/systemd/system/nomad-consul-snapshot.{service,timer} > /dev/null <<'EOF'
# (one .service + one .timer per file — split as needed)
EOF
# Enable + start
$ sudo systemctl daemon-reload
$ sudo systemctl enable --now nomad-consul-snapshot.timer
```

### 5.13 UFW + firewall rules

Many ports — Nomad and Consul each listen on multiple. Document inline:

```bash
# [each Nomad server]
$ sudo ufw allow from 10.111.30.0/24 to any port 4646 proto tcp comment 'Nomad HTTP API'
$ sudo ufw allow from 10.111.30.0/24 to any port 4647 proto tcp comment 'Nomad RPC (server-to-server + client-to-server)'
$ sudo ufw allow from 10.111.30.0/24 to any port 4648 proto any comment 'Nomad serf gossip'
$ sudo ufw allow from 10.111.10.0/24 to any port 4647 proto tcp comment 'Nomad client → server RPC'
$ sudo ufw allow from 10.111.10.0/24 to any port 4648 proto any comment 'Nomad client serf'

$ sudo ufw allow from 10.111.30.0/24 to any port 8500 proto tcp comment 'Consul HTTP'
$ sudo ufw allow from 10.111.30.0/24 to any port 8501 proto tcp comment 'Consul HTTPS'
$ sudo ufw allow from 10.111.30.0/24 to any port 8300 proto tcp comment 'Consul server RPC'
$ sudo ufw allow from 10.111.30.0/24 to any port 8301 proto any comment 'Consul serf LAN'
$ sudo ufw allow from 10.111.30.0/24 to any port 8302 proto any comment 'Consul serf WAN'
$ sudo ufw allow from 10.111.30.0/24 to any port 8600 proto any comment 'Consul DNS'
$ sudo ufw allow from 10.111.10.0/24 to any port 8501 proto tcp comment 'App VLAN → Consul HTTPS'
$ sudo ufw allow from 10.111.10.0/24 to any port 8301 proto any comment 'App VLAN → Consul serf'
$ sudo ufw allow from 10.111.10.0/24 to any port 8600 proto any comment 'App VLAN → Consul DNS'

# [each Nomad client]
$ sudo ufw allow from 10.111.30.0/24 to any port 4646 proto tcp comment 'Nomad HTTP from servers'
$ sudo ufw allow from 10.111.30.0/24 to any port 4648 proto any comment 'Nomad serf'
$ sudo ufw allow from 10.111.10.0/24 to any port 4648 proto any comment 'Inter-client serf'

$ sudo ufw status verbose | head -30
```

### 5.14 Verification

```bash
# (1) Cluster healthy?
$ nomad server members           # 3 servers alive
$ nomad node status              # all clients ready
$ consul members                 # 3 servers + N clients alive
$ nomad operator raft list-peers # 3 voters
$ consul operator raft list-peers # 3 voters

# (2) ACLs enforcing?
$ NOMAD_TOKEN="" nomad job status   # Expected: "Permission denied"
$ NOMAD_TOKEN=<operator-token> nomad job status   # Expected: success

# (3) Vault integration working?
#     Re-run the §5.9 test job; should succeed end-to-end.

# (4) GitLab Runners registered?
$ for h in 01 02 03; do
    ssh -J au-bastion auishqosrapp${h}.au-internal \
      'sudo gitlab-runner verify'
  done
# Expected: each runner reports "is alive!"

# (5) Snapshot timer running?
$ systemctl list-timers nomad-consul-snapshot.timer
$ ls -lh /var/lib/nomad/snapshots /var/lib/consul/snapshots

# (6) mTLS enforced?
$ nomad agent-info -address=http://10.111.30.30:4646
# Expected: connection refused / TLS error — plain HTTP rejected
```

**Common failures and remedies:**

| Symptom                                                    | Cause                                                           | Fix                                                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Servers stuck "no leader"                                  | <3 servers up; `bootstrap_expect = 3` not met                   | Bring all 3 servers online; check `journalctl -u nomad` for join failures (cert / IP mismatches)                 |
| Client can't connect: "RPC error: TLS handshake error"     | Client cert not signed by the cluster CA                        | Re-issue the client cert with `consul tls cert create -client -dc dc1`; place under `/etc/{nomad,consul}.d/tls/` |
| Job submission "ACL token not found"                       | NOMAD_TOKEN not set                                             | `export NOMAD_TOKEN=<operator-token>`; or specify `-token=<...>` per command                                     |
| Workload's `vault {}` block fails: "Vault is not enabled"  | Nomad servers' vault.hcl missing or `enabled = false`           | Verify `/etc/nomad.d/vault.hcl` has `enabled = true`; restart nomad service                                      |
| Workload's `template {}` fails to render Vault data        | Vault role missing or insufficient policies                     | Verify `vault read auth/nomad-workload/role/nomad-workload` returns the expected policies                        |
| Service registers in Consul but DNS query returns NXDOMAIN | Consul DNS port not exposed (8600) or query going to wrong port | Use `dig @127.0.0.1 -p 8600 <service>.service.consul`; check UFW for port 8600                                   |
| GitLab Runner registration: "couldn't execute POST"        | `gitlab.africanunion.org` not resolvable from client            | Add `/etc/hosts` entry on client OR fix internal DNS; Phase 2 Consul DNS makes this automatic                    |
| Snapshot script fails: "ACL not found"                     | Snapshot tokens not in `/etc/nomad-consul-snapshot.env`         | Re-issue tokens with snapshot-only policy; populate the env file                                                 |

### 5.15 Path to Phase 5

| Capability       | Phase 1 (this chapter)                    | Phase 5                                                                          |
| ---------------- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| Service mesh     | Plain HTTP between workloads              | Consul Connect — automatic mTLS between any two registered services              |
| CA management    | Static CA cert + key in Vault KV          | Vault PKI engine issues per-cluster certs with auto-renewal                      |
| Operator ACL     | Per-operator tokens with manual lifecycle | Keycloak SSO → Vault → Nomad/Consul ACL token issuance based on group membership |
| Workload secrets | Static KV secrets fetched via Vault role  | Dynamic DB credentials (chapter 22) generated per-workload with TTL              |
| Multi-region     | Single DC `dc1`                           | Phase 4 [chapter 20](20-dr.md) introduces a warm-standby DC; multi-DC federation |
| Volumes          | Docker host volumes + tmpfs only          | Nomad CSI plugin → MinIO for stateful workloads; pod-equivalent persistence      |

The job-spec format, ACL model, Consul DNS pattern, and operator workflow all carry over unchanged. Phase 5 adds new features alongside; nothing in this chapter becomes throwaway.

---
