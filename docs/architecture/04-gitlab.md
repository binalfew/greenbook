# 04 — GitLab CE

> **Phase**: 1 (developer foothold) · **Run on**: 1× GitLab VM (`auishqosrgit01`) · **Time**: ~2.5 hours
>
> Self-hosted GitLab Community Edition: VCS + CI/CD + container registry + package registry, all in one Omnibus install. The single biggest VM on the platform (16 GB RAM, ~200 GB initial). Single instance — CE doesn't HA without Premium tier; backup-driven recovery is the Phase 1 strategy.
>
> Phase 2 [chapter 07 — Keycloak](07-keycloak.md) + [chapter 08 — Keycloak federated to AD](08-keycloak-ad.md) introduce SSO; until then, GitLab manages its own user accounts.
>
> **Prev**: [03 — Vault](03-vault.md) · **Next**: [05 — Nomad cluster](05-nomad-cluster.md) · **Index**: [README](README.md)

---

## Contents

- [§4.1 Role + threat model](#41-role-threat-model)
- [§4.2 Pre-flight (single big VM)](#42-pre-flight-single-big-vm)
- [§4.3 Install GitLab CE (Omnibus)](#43-install-gitlab-ce-omnibus)
- [§4.4 Initial configuration (gitlab.rb)](#44-initial-configuration-gitlabrb)
- [§4.5 TLS termination](#45-tls-termination)
- [§4.6 First admin login + root token rotation](#46-first-admin-login-root-token-rotation)
- [§4.7 Container registry](#47-container-registry)
- [§4.8 Package registry](#48-package-registry)
- [§4.9 GitLab Runners (registration + Vault integration)](#49-gitlab-runners-registration-vault-integration)
- [§4.10 Backup strategy](#410-backup-strategy)
- [§4.11 Audit logging](#411-audit-logging)
- [§4.12 UFW + firewall rules](#412-ufw-firewall-rules)
- [§4.13 Verification](#413-verification)
- [§4.14 Path to Phase 2 (Keycloak SSO)](#414-path-to-phase-2-keycloak-sso)

## 4. GitLab CE

### 4.1 Role + threat model

GitLab is the platform's **developer-facing surface**: source code, build pipelines, container images, packages. Three consequences:

1. **Compromise = source code disclosure + supply chain compromise.** An attacker with admin access to GitLab can read every repo, modify CI templates to inject malicious build steps, push backdoored container images to the registry that downstream Nomad jobs auto-pull. Defence: TLS, no public ingress (only via DMZ), aggressive backup, OIDC SSO in Phase 2 to remove standing local admin accounts.
2. **Outage = no deploys, no merges, no commits.** App teams continue working locally; CI/CD halts; ongoing incidents can't be patched via the normal path. Mitigation: backup every 4 hours; documented restore procedure (≤30 min RTO from a fresh VM).
3. **Single VM (CE limitation).** GitLab CE doesn't HA cleanly without paying for Premium tier. We accept the single point of failure and compensate with aggressive backups + tested restore. Phase 4 [chapter 19 — Backup strategy](19-backups.md) hardens this further.

**Threat model — what we defend against:**

| Threat                                                        | Mitigation                                                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Public-internet exposure of GitLab UI                         | GitLab listens on internal IP only; reached via DMZ (Phase 3 [chapter 17 — HAProxy](17-haproxy.md)) for off-prem operators |
| Brute force against admin login                               | rack-attack throttling enabled in `gitlab.rb`; fail2ban on the host as belt-and-braces                                     |
| Stolen runner registration token = trojan runner registration | Tokens stored in Vault, not in source/wiki; tokens scoped per-runner; tokens rotated on suspicion                          |
| Container image tampering in registry                         | GitLab's built-in container scanning runs on push; signed pushes via cosign in Phase 5                                     |
| Lost data on the GitLab VM                                    | `gitlab-rake gitlab:backup:create` every 4 hours; backups streamed to MinIO (Phase 3) + off-site (Phase 4)                 |
| Supply chain attacks via malicious commits                    | Branch protection rules; required code review; CI sec scanning; signed commits enforced for production branches            |

**Phase 1 deliberate non-goals:**

- **HA via GitLab Premium** — out of scope; backup-driven recovery is acceptable for AU's RTO.
- **GitLab Geo replication** — Premium-tier feature; deferred.
- **Custom OmniAuth providers beyond Keycloak** — Phase 2 sets up Keycloak; no other identity providers.
- **GitLab Pages** — not part of the platform's app set; can be enabled later if a static-site use case appears.

### 4.2 Pre-flight (single big VM)

One Ubuntu 24.04 VM hardened to AU base (greenbook chapter 01 §1.1-§1.7). Skip §1.8. Operator account membership per chapter 02 §2.4.

Resource specs:

| Resource | Value                             | Why                                                                                                          |
| -------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| vCPU     | 4                                 | GitLab is multi-process (Puma, Sidekiq, Workhorse, Gitaly, Postgres, Redis); 4 vCPU is the recommended floor |
| RAM      | 16 GB                             | Omnibus' bundled services use ~10 GB at idle; 16 GB leaves headroom for CI runner picker queries             |
| Disk     | 200 GB SSD (root) + 500 GB (data) | Root holds the binary install; data disk holds repos + registry + packages — grows with usage                |

Hostname: `auishqosrgit01`. Internal IP (per [§0.3](00-architecture.md#03-network-segmentation-ip-allocation)): `10.111.30.20`. VLAN 4 (Platform).

```bash
# [auishqosrgit01]

# Confirm pre-flight passed
$ lsb_release -d
$ sudo systemctl is-active unattended-upgrades fail2ban
$ groups | grep operators

# Check the data disk is mounted at /var/opt/gitlab
$ mount | grep gitlab
# Expected: /dev/sdb (or whatever the data disk is) on /var/opt/gitlab
# This dir is created by GitLab's install but the mount must exist first.
# If not mounted yet:
$ sudo install -d -m 755 /var/opt/gitlab
$ sudo mount -o defaults <DATA_DEVICE> /var/opt/gitlab
# Add to /etc/fstab so it persists across reboot.
```

### 4.3 Install GitLab CE (Omnibus)

GitLab's Omnibus package bundles Postgres, Redis, nginx, Workhorse, Sidekiq, Gitaly, the registry, mail, and the Rails app — one apt install, one config file, one upgrade path.

```bash
# [auishqosrgit01]

# (1) Install dependencies
$ sudo apt install -y curl openssh-server ca-certificates tzdata perl

# (2) Add GitLab's official apt repository (CE, not EE)
$ curl https://packages.gitlab.com/install/repositories/gitlab/gitlab-ce/script.deb.sh \
    | sudo bash

# (3) Install GitLab CE — the version is pinned via the package name.
#     Set EXTERNAL_URL upfront so the post-install hook configures TLS
#     with the AU wildcard cert (placed at the canonical path before
#     install, see step 4).
$ sudo EXTERNAL_URL="https://gitlab.africanunion.org" apt install -y gitlab-ce
# Install runs ~5 min; finishes with "Thank you for installing GitLab!"

# (4) The TLS cert paths the Omnibus post-install hook expects are:
#     /etc/gitlab/ssl/gitlab.africanunion.org.crt   (fullchain)
#     /etc/gitlab/ssl/gitlab.africanunion.org.key
#     If they exist before the install, GitLab uses them. If not, the
#     install warns and falls back to HTTP. Either path works:
#     install with HTTP first, then add cert + run gitlab-ctl reconfigure.

# (5) Post-install: the Omnibus reconfigure runs automatically and
#     prints the location of the initial root password.
$ sudo cat /etc/gitlab/initial_root_password
# Expected: a 24-character random password. THIS FILE GETS DELETED
# AUTOMATICALLY 24 HOURS AFTER INSTALL. Capture the password into
# Vault NOW (see §4.6).
```

> **ℹ Pin the GitLab CE version**
>
> Same discipline as Vault — pin the version, hold against auto-upgrades, document the version in [appendix C](appendix-c-references.md), re-evaluate quarterly.
>
> ```bash
> $ sudo apt-mark hold gitlab-ce
> ```

### 4.4 Initial configuration (gitlab.rb)

GitLab's Omnibus is configured via `/etc/gitlab/gitlab.rb`. The file is large; we set only what differs from defaults.

```bash
# [auishqosrgit01]

# (1) Edit the config — minimal Phase 1 changes
$ sudo $EDITOR /etc/gitlab/gitlab.rb

# Set or update these directives (the rest of the file stays default):
external_url 'https://gitlab.africanunion.org'

# Disable services we don't use Phase 1 (Pages, Mattermost) to reduce
# memory footprint
gitlab_pages['enable'] = false
mattermost['enable'] = false

# rack-attack throttling — protects against brute force. Defaults are
# conservative; tighten for an internal-only deployment.
gitlab_rails['rack_attack_git_basic_auth'] = {
  'enabled' => true,
  'ip_whitelist' => ["127.0.0.1"],
  'maxretry' => 5,
  'findtime' => 60,
  'bantime' => 3600
}

# SMTP settings — point at AU's existing SMTP relay (operator can
# configure later via UI; baseline here for Phase 1)
gitlab_rails['smtp_enable'] = false
# When SMTP is configured:
# gitlab_rails['smtp_enable'] = true
# gitlab_rails['smtp_address'] = "smtp.africanunion.org"
# gitlab_rails['smtp_port'] = 587
# gitlab_rails['smtp_authentication'] = "login"
# gitlab_rails['smtp_enable_starttls_auto'] = true
# gitlab_rails['smtp_user_name'] = "gitlab@africanunion.org"
# gitlab_rails['smtp_password'] = "<from Vault>"

# Backup destination — local for Phase 1; Phase 3+ swaps to MinIO
gitlab_rails['backup_path'] = "/var/opt/gitlab/backups"
gitlab_rails['backup_keep_time'] = 604800  # 7 days, in seconds

# Container registry — same domain as GitLab + a path prefix to keep
# the cert wildcard valid (no separate subdomain in Phase 1)
registry_external_url 'https://gitlab.africanunion.org:5050'
gitlab_rails['registry_enabled'] = true

# (2) Apply config
$ sudo gitlab-ctl reconfigure
# Runs ~3 min. Look for "gitlab Reconfigured!" at the end.

# (3) Confirm services are healthy
$ sudo gitlab-ctl status
# Expected: all services "run: <name>: (pid <num>) <uptime>; run:"
```

### 4.5 TLS termination

Omnibus' bundled nginx terminates TLS using the AU wildcard cert (same cert used by Vault and the DMZ — single source).

```bash
# [auishqosrgit01]

# (1) Place the cert + key (root-owned, gitlab-www readable)
$ sudo install -d -m 755 /etc/gitlab/ssl
$ sudo install -m 644 -o root -g root \
    wildcard.africanunion.org.fullchain.pem \
    /etc/gitlab/ssl/gitlab.africanunion.org.crt
$ sudo install -m 600 -o root -g root \
    wildcard.africanunion.org.key \
    /etc/gitlab/ssl/gitlab.africanunion.org.key

# (2) Same for the registry endpoint (same cert; different file name
#     because GitLab expects it per `registry_external_url`)
$ sudo install -m 644 -o root -g root \
    /etc/gitlab/ssl/gitlab.africanunion.org.crt \
    /etc/gitlab/ssl/gitlab.africanunion.org-registry.crt
$ sudo install -m 600 -o root -g root \
    /etc/gitlab/ssl/gitlab.africanunion.org.key \
    /etc/gitlab/ssl/gitlab.africanunion.org-registry.key

# (3) Reconfigure to apply
$ sudo gitlab-ctl reconfigure

# (4) Verify TLS works
$ curl -kI https://gitlab.africanunion.org/users/sign_in
# Expected: HTTP/2 200, real cert presented
$ curl -kI https://gitlab.africanunion.org:5050/v2/
# Expected: HTTP/2 401 (registry requires auth — correct behaviour)

# (5) Verify cert chain on the wire
$ echo | openssl s_client -connect 127.0.0.1:443 \
    -servername gitlab.africanunion.org 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
# Expected: subject=CN=*.africanunion.org; valid dates; SAN matches.
```

### 4.6 First admin login + root token rotation

The bootstrap root password is in `/etc/gitlab/initial_root_password` and gets deleted automatically 24 hours after install. **Capture it into Vault and rotate the password before the file expires.**

```bash
# [auishqosrgit01]

# (1) Read the bootstrap password
$ sudo cat /etc/gitlab/initial_root_password
# Output: Password: <24-char-random-string>

# (2) Login at https://gitlab.africanunion.org/ as `root` with that
#     password (use a browser; the GitLab UI requires an interactive
#     session for password change).

# (3) IMMEDIATELY change the root password to a strong, unique value.
#     User Settings → Account → Edit profile → Password.

# (4) Store the NEW root password in Vault
$ vault kv put kv/platform/gitlab/root_password \
    password='<new-strong-password>' \
    rotated_at="$(date -Iseconds)" \
    rotation_period_days=90

# (5) Delete the bootstrap file (don't wait for the 24h auto-expiry)
$ sudo shred -u /etc/gitlab/initial_root_password

# (6) Create per-operator admin accounts (Phase 1; Phase 2 replaces with
#     Keycloak SSO):
#     Admin Area → Users → New user → check "Administrator"
#     Each operator gets one account; they set their own password on first login.

# (7) Once every operator has admin, consider the root account "break-glass":
#     - Don't use it for daily work
#     - Audit usage: Admin Area → Audit Events
#     - Disable + re-enable only when needed (User Settings → Block this user)
```

> **ℹ Why a Vault-stored root password vs none at all**
>
> The root account can't be deleted without breaking GitLab's internal references. We disable it (Block this user) but the password still has to exist for an emergency where every operator account is locked out. The Vault-stored value is the recovery path — and accessing it requires Vault auth, which provides the audit trail.

### 4.7 Container registry

Already enabled via `registry_external_url` in §4.4. Verify and create the first project:

```bash
# Test the registry endpoint
$ curl -k https://gitlab.africanunion.org:5050/v2/
# Expected: 401 with WWW-Authenticate: Bearer header. Confirms the
# registry is up and authentication-gated.

# Login from a developer workstation (after creating a personal access token):
# In GitLab UI → User Settings → Access Tokens → create token with `read_registry, write_registry` scope
$ docker login gitlab.africanunion.org:5050
# Username: <gitlab-username>
# Password: <personal-access-token>
# Login Succeeded

# Push a test image
$ docker tag alpine:latest gitlab.africanunion.org:5050/<group>/<project>/test:latest
$ docker push gitlab.africanunion.org:5050/<group>/<project>/test:latest
```

**Storage usage**: container images grow fast. Monitor `/var/opt/gitlab/gitlab-rails/shared/registry`. Phase 3 [chapter 15 — MinIO](15-minio.md) moves registry storage off the GitLab VM disk and onto MinIO; until then, watch disk space.

### 4.8 Package registry

Enabled by default in CE; supports Maven, npm, NuGet, PyPI, Composer, Conan, Helm, Generic. Configure per-project under Project → Settings → Packages & Registries.

For Phase 1, no extra config needed at the GitLab tier — the registry is per-project. Apps pull/push via:

```bash
# npm
$ npm config set @au:registry https://gitlab.africanunion.org/api/v4/projects/<id>/packages/npm/

# Maven
# settings.xml — point at https://gitlab.africanunion.org/api/v4/projects/<id>/packages/maven

# Generic — for arbitrary binaries
$ curl --header "PRIVATE-TOKEN: $TOKEN" \
    --upload-file my-binary.tar.gz \
    "https://gitlab.africanunion.org/api/v4/projects/<id>/packages/generic/my-binary/1.0.0/my-binary.tar.gz"
```

Per-app configuration belongs in [chapter 30 — App onboarding](30-app-onboarding.md).

### 4.9 GitLab Runners (registration + Vault integration)

GitLab Runners are the agents that execute CI/CD jobs. They are **not** installed on the GitLab VM — that's a separation-of-concerns decision: GitLab is the orchestrator, runners are the executors. Phase 1 installs runners on the same VMs as Nomad clients (chapter 05); they share infrastructure efficiently.

For now, prep the **registration tokens** in Vault so chapter 05 can pick them up.

```bash
# (1) Create a "shared" runner registration token in the GitLab UI:
#     Admin Area → CI/CD → Runners → "Register an instance runner"
#     Copy the token (looks like: glrt-...).

# (2) Store it in Vault for runner installs to consume
$ vault kv put kv/platform/gitlab/runner_registration_token \
    token='glrt-<the-token>' \
    scope='shared' \
    created_at="$(date -Iseconds)"

# (3) Optionally, create per-group tokens for tighter scoping:
#     Group → Settings → CI/CD → Runners → "Register a group runner"
#     Store under kv/platform/gitlab/runner_registration_token_group_<name>
```

The runners themselves install in chapter 05 §5.X (Nomad cluster bring-up — runners are co-located on Nomad clients in Phase 1).

### 4.10 Backup strategy

GitLab provides `gitlab-rake gitlab:backup:create` — produces a tarball with repos + DB + uploads + builds + everything else. We schedule it every 4 hours.

```bash
# [auishqosrgit01]

# (1) Test a manual backup first
$ sudo gitlab-rake gitlab:backup:create
# Output: ~5-30 min depending on data size.
# Final line: "2026_05_01_15_30_00_15.0.0_gitlab_backup.tar"
$ sudo ls -lh /var/opt/gitlab/backups/
# Confirm the tarball + size

# (2) Schedule via cron
$ sudo tee /etc/cron.d/gitlab-backup > /dev/null <<'EOF'
# GitLab backup every 4 hours
0 */4 * * * root /usr/bin/gitlab-rake gitlab:backup:create CRON=1
EOF

# (3) GitLab also writes "secrets" files NOT included in the backup
#     (the encryption keys for stored secrets, the database password,
#     etc.). These must be backed up separately because without them
#     a restore can't decrypt the backed-up data.
$ sudo tar -czf /var/opt/gitlab/backups/gitlab-secrets-$(date +%Y%m%d).tar.gz \
    /etc/gitlab
$ sudo chmod 600 /var/opt/gitlab/backups/gitlab-secrets-*.tar.gz

# (4) Schedule the secrets backup alongside the data backup
$ sudo tee -a /etc/cron.d/gitlab-backup > /dev/null <<'EOF'
0 */4 * * * root tar -czf /var/opt/gitlab/backups/gitlab-secrets-$(date +%Y\%m\%d-\%H).tar.gz /etc/gitlab && chmod 600 /var/opt/gitlab/backups/gitlab-secrets-*.tar.gz
EOF

# (5) Phase 3 swaps local backup destination for MinIO; Phase 4 adds
#     off-site replication. Until then, monitor disk space:
$ df -h /var/opt/gitlab/backups
```

**Backup retention**: `gitlab_rails['backup_keep_time'] = 604800` (7 days, set in §4.4). Local copies older than 7 days are pruned automatically. Off-site backups (Phase 4) get longer retention.

> **⚠ A backup without secrets is unrestorable**
>
> The `/etc/gitlab/gitlab-secrets.json` file holds encryption keys for CI variables, runner registration tokens, the database password, and more. Restoring `<timestamp>_gitlab_backup.tar` against a fresh GitLab install with a NEW `gitlab-secrets.json` produces a partially-broken system: repos and DB rows restore, but encrypted columns can't be decrypted. Always back up `/etc/gitlab/` alongside the main backup.

### 4.11 Audit logging

GitLab logs at multiple layers. Three matter:

- **`/var/log/gitlab/gitlab-rails/audit_json.log`** — Rails app's audit events (logins, permission changes, project creation, etc.)
- **`/var/log/gitlab/nginx/gitlab_access.log`** — every HTTP request
- **`/var/log/gitlab/gitlab-rails/api_json.log`** — every API call

```bash
# [auishqosrgit01]

# (1) Watch live audit events during operator activity
$ sudo tail -f /var/log/gitlab/gitlab-rails/audit_json.log | jq

# (2) Inspect a recent login
$ sudo grep '"action":"login"' /var/log/gitlab/gitlab-rails/audit_json.log \
  | tail -5 | jq '.author_name, .target_details, .created_at'

# (3) Failed login attempts — useful for incident triage
$ sudo grep -i 'failed' /var/log/gitlab/gitlab-rails/auth.log | tail -10
```

GitLab's logrotate is configured by Omnibus. Default retention is 30 days. The Phase 2 [chapter 09 — Loki + Grafana](09-loki.md) ingests these logs into the central observability stack so they're searchable across operator workflows.

### 4.12 UFW + firewall rules

```bash
# [auishqosrgit01]

# Allow HTTPS (web UI + git over HTTPS) from operator subnets + App VLAN + DMZ VLAN
$ sudo ufw allow from 10.111.10.0/24 to any port 443 proto tcp \
    comment 'App VLAN → GitLab HTTPS (CI runners + git pull)'
$ sudo ufw allow from 10.111.30.0/24 to any port 443 proto tcp \
    comment 'Platform VLAN → GitLab HTTPS'
$ sudo ufw allow from 10.111.40.0/24 to any port 443 proto tcp \
    comment 'Operations VLAN → GitLab HTTPS (operator ad-hoc)'
# DMZ won't normally hit GitLab (apps are reverse-proxied at the DMZ,
# but GitLab itself is internal-only); add a rule only if a DMZ-tier
# integration needs it.

# Container registry on 5050 — same source set
$ sudo ufw allow from 10.111.10.0/24 to any port 5050 proto tcp \
    comment 'App VLAN → registry (image pull)'
$ sudo ufw allow from 10.111.30.0/24 to any port 5050 proto tcp \
    comment 'Platform VLAN → registry'

# Git over SSH (port 22 already open via the operator-bastion rule from
# chapter 02; no separate rule needed). git@ over SSH from app VMs:
$ sudo ufw allow from 10.111.10.0/24 to any port 22 proto tcp \
    comment 'App VLAN → git over SSH'

$ sudo ufw status verbose | grep -E '443|5050|22'
```

GitLab is **not** publicly internet-exposed. Off-prem operators reach it via the bastion (SSH tunnel) or via the future DMZ tier (Phase 3 — but only if AU IT decides to expose GitLab publicly; default is internal-only).

### 4.13 Verification

```bash
# (1) Service status
$ sudo gitlab-ctl status
# Expected: all services "run:"

# (2) Web UI reachable + cert valid
$ curl -kI https://gitlab.africanunion.org/
# Expected: HTTP/2 200 or 302

# (3) Login works (via UI; check audit log captured the event)
$ sudo grep '"action":"login"' /var/log/gitlab/gitlab-rails/audit_json.log \
  | tail -1 | jq

# (4) Container registry up
$ curl -k https://gitlab.africanunion.org:5050/v2/
# Expected: HTTP/2 401 Unauthorized — auth required, registry up

# (5) Test push of a small image
$ docker pull alpine:latest
$ docker tag alpine:latest gitlab.africanunion.org:5050/test/test:latest
$ docker login gitlab.africanunion.org:5050
$ docker push gitlab.africanunion.org:5050/test/test:latest
# Expected: push succeeds; image visible in GitLab UI under the project

# (6) Backup runs
$ sudo gitlab-rake gitlab:backup:create
# Expected: completes in 5-30 min; tarball in /var/opt/gitlab/backups/

# (7) Restore-readiness — confirm `gitlab-secrets.json` is also being
#     backed up (without it, the data backup is unrestorable)
$ ls -1 /var/opt/gitlab/backups/gitlab-secrets-*.tar.gz | head -3
# Expected: at least one secrets tarball

# (8) Vault has the runner token + root password
$ vault kv get kv/platform/gitlab/runner_registration_token
$ vault kv get kv/platform/gitlab/root_password
# Expected: both present
```

**Common failures and remedies:**

| Symptom                                                      | Cause                                                    | Fix                                                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `gitlab-ctl reconfigure` hangs at "Recipe: postgresql::user" | Postgres bundled service crashed or wasn't initialised   | `sudo gitlab-ctl restart postgresql`; if persistent, `sudo gitlab-ctl tail postgresql` for actual error   |
| Web UI returns 502 Bad Gateway                               | Workhorse / Puma not running                             | `sudo gitlab-ctl restart`; if persistent, `sudo gitlab-ctl tail` to find the failing service              |
| `docker push` returns "denied: requested access ..."         | Personal access token missing `write_registry` scope     | Create new PAT with both `read_registry` AND `write_registry` scopes                                      |
| `docker push` returns "no basic auth credentials"            | docker login session expired (default 24h)               | `docker login gitlab.africanunion.org:5050` again                                                         |
| Backup fails with "FATAL: connection to PostgreSQL failed"   | Backup ran during a Postgres restart window              | Re-try; if persistent, check `sudo gitlab-ctl status postgresql`                                          |
| `gitlab-rake gitlab:backup:create` runs but tarball is tiny  | The data disk isn't mounted at `/var/opt/gitlab` — empty | Confirm mount: `mount \| grep gitlab`. If wrong, fix `/etc/fstab` and remount                             |
| TLS cert error on UI access                                  | Cert path or perms wrong                                 | Verify §4.5 step 1 perms: `.crt` 644 root:root, `.key` 600 root:root. `sudo gitlab-ctl reconfigure` again |
| Memory pressure / OOM kills                                  | 16 GB undersized for active CI load                      | Reduce concurrent runners (chapter 05); or scale VM to 32 GB; `free -h` confirms                          |

### 4.14 Path to Phase 2 (Keycloak SSO)

Phase 2 [chapter 07 — Keycloak](07-keycloak.md) introduces SSO across all platform services including GitLab. Once Keycloak is deployed and federated to AU AD ([chapter 08](08-keycloak-ad.md)), GitLab gets reconfigured to use OmniAuth + OIDC:

```ruby
# Future config (Phase 2): /etc/gitlab/gitlab.rb additions
gitlab_rails['omniauth_enabled'] = true
gitlab_rails['omniauth_allow_single_sign_on'] = ['openid_connect']
gitlab_rails['omniauth_block_auto_created_users'] = false
gitlab_rails['omniauth_auto_link_user'] = ['openid_connect']
gitlab_rails['omniauth_providers'] = [
  {
    'name' => 'openid_connect',
    'label' => 'AU SSO',
    'args' => {
      'name' => 'openid_connect',
      'scope' => ['openid', 'profile', 'email'],
      'response_type' => 'code',
      'issuer' => 'https://keycloak.africanunion.org/realms/au',
      # client_id + client_secret from Vault
      'client_options' => { ... }
    }
  }
]
```

**Migration path** (Phase 2):

1. Deploy Keycloak (chapter 07) + federate to AD (chapter 08)
2. Configure GitLab OmniAuth pointing at Keycloak realm
3. Each operator logs in via SSO once — GitLab links the SSO identity to their existing GitLab account by email
4. After all operators are linked, disable local-account password auth in GitLab admin UI
5. The `root` account stays as break-glass (Vault-stored password); every other account uses SSO only

The Phase 1 GitLab patterns survive: same backup, same registry, same runners, same UFW. Only the `omniauth_*` settings change.

---
