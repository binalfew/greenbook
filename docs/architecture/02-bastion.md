# 02 — Bastion

> **Phase**: 1 (developer foothold) · **Run on**: 2× bastion VMs (`auishqosrbst01`, `auishqosrbst02`) · **Time**: ~90 min for the pair
>
> Hardened single-purpose SSH jump hosts. The **only** way operators reach internal platform VMs is through these two boxes. Active/passive pair for HA; running OpenSSH only — no other services. Logs every session for audit.
>
> This chapter establishes the **Phase 1 simple bastion**: OpenSSH + key auth + auditd + ProxyJump pattern. Phase 5 [chapter 21 — Teleport](21-teleport.md) upgrades this to session recording, RBAC, and certificate-based auth without breaking any of the patterns established here.
>
> **Prev**: [01 — Capacity & sizing](01-capacity-sizing.md) · **Next**: [03 — Vault](03-vault.md) · **Index**: [README](README.md)

---

## Contents

- [§2.1 Role + threat model](#21-role-threat-model)
- [§2.2 Pre-flight (base OS hardening)](#22-pre-flight-base-os-hardening)
- [§2.3 SSH daemon hardening](#23-ssh-daemon-hardening)
- [§2.4 Operator account model + groups](#24-operator-account-model-groups)
- [§2.5 SSH key authentication setup](#25-ssh-key-authentication-setup)
- [§2.6 ProxyJump pattern (operator workflow)](#26-proxyjump-pattern-operator-workflow)
- [§2.7 Audit logging (auditd + auth.log retention)](#27-audit-logging-auditd-authlog-retention)
- [§2.8 UFW + perimeter firewall rules](#28-ufw-perimeter-firewall-rules)
- [§2.9 HA: active/passive pattern](#29-ha-activepassive-pattern)
- [§2.10 Verification](#210-verification)
- [§2.11 Path to Phase 5 (Teleport upgrade)](#211-path-to-phase-5-teleport-upgrade)

## 2. Bastion

### 2.1 Role + threat model

The bastion is the **single ingress point** for operator SSH traffic into the platform. Two design constraints flow from that:

1. **Highest-value target on the platform.** Compromising a bastion gives an attacker a stepping stone to every other VM. Defence is correspondingly aggressive: minimal surface area, strict access controls, exhaustive audit logging.
2. **Single-purpose.** No application code runs here. No web services, no databases, no Docker. Only OpenSSH, fail2ban, auditd, the OS itself, and Ansible's pull mechanism if used. Every additional service is an additional attack surface.

**Threat model — what we defend against:**

| Threat                                     | Mitigation                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Internet-facing SSH brute force            | UFW pins SSH to known operator source IPs only; fail2ban catches stragglers                            |
| Stolen operator SSH key                    | Per-operator keys in `~/.ssh/authorized_keys` (revocable individually); MFA via Yubikey in Phase 5     |
| Bastion host compromise → lateral movement | Each downstream VM has its own UFW source-pin to bastion IPs only; sudo on downstream requires re-auth |
| Insider threat / accidental damage         | Every session logged via auditd; reviewed in Phase 5 incident-response runbooks                        |
| Bastion outage cuts off all access         | Active/passive pair (§2.9); break-glass console access via hypervisor                                  |

**What we explicitly DO NOT defend against in Phase 1:**

- Sophisticated actor with valid operator credentials + Yubikey + TOTP. Phase 5 (Teleport) adds session recording for this case.
- Side-channel attacks on the underlying hypervisor. AU IT operates the hypervisor; trust boundary is at the VM level.
- DDoS at the SSH layer. Cloudflare doesn't terminate SSH; the AU perimeter firewall is the first line. Acceptable risk given operator-only audience.

### 2.2 Pre-flight (base OS hardening)

The bastions are Ubuntu 24.04 VMs hardened to AU's base standard. This is identical to greenbook's deployment [chapter 01](../deployment/01-pre-flight.md) but with stricter SSH defaults applied in §2.3. Run §1.1–§1.7 from greenbook's chapter 01 on **both** bastion VMs first; that gets you:

- Ubuntu 24.04 LTS, fully patched
- Hostname + `/etc/hosts`
- NTP sync
- Unattended security updates
- SSH key-only auth (no passwords, no root)
- UFW active with only SSH allowed from your admin source
- fail2ban watching SSH

Skip §1.8 — the `deployer` user is for App-tier VMs only; bastions don't run app workloads.

```bash
# Cross-reference; complete chapter 01 §1.1-§1.7 on both bastions, then:

# [auishqosrbst01]
$ lsb_release -d                                       # Ubuntu 24.04.x LTS
$ sudo systemctl is-active unattended-upgrades         # active
$ sudo ufw status verbose                              # active, default deny incoming
$ sudo systemctl is-active fail2ban                    # active
$ sudo sshd -T 2>/dev/null | grep -E "passwordauthentication|permitrootlogin|pubkeyauthentication"
# Expected:
#   passwordauthentication no
#   permitrootlogin no
#   pubkeyauthentication yes
```

### 2.3 SSH daemon hardening

Bastion SSH is stricter than the AU base. Install an additional drop-in config:

```bash
# [auishqosrbst01 + auishqosrbst02]

# (1) Create the bastion-specific drop-in
$ sudo tee /etc/ssh/sshd_config.d/99-bastion.conf > /dev/null <<'EOF'
# Bastion SSH hardening — supersedes AU base where stricter
#
# These settings layer on top of /etc/ssh/sshd_config.d/99-hardening.conf
# (the AU base from 01 §1.5). Keep both files; don't merge.

# Operators only — no service accounts.
AllowGroups operators

# Forbid agent / X11 / TCP forwarding except for ProxyJump (which uses
# direct-tcpip; that's controlled by AllowTcpForwarding, not Forward*).
AllowAgentForwarding no
X11Forwarding no
PermitTunnel no

# ProxyJump requires AllowTcpForwarding yes. We'd rather not, but
# without it operators can't reach downstream VMs through this bastion.
# The tradeoff is worth it; lock it down with a Match rule below.
AllowTcpForwarding yes

# Limit how many simultaneous unauthenticated connections — slows
# brute-force attempts even if fail2ban is bypassed somehow.
MaxStartups 5:30:20

# Tight session limits: 10 minutes of idle = disconnect.
ClientAliveInterval 300
ClientAliveCountMax 2

# Strong KEX / ciphers / MACs only. Anything older is rejected.
KexAlgorithms curve25519-sha256@libssh.org,curve25519-sha256
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com

# Each operator's authorized_keys file is owned by them; sshd reads it
# from the user's home dir (default behaviour, just being explicit).
AuthorizedKeysFile %h/.ssh/authorized_keys

# Banner shown before any auth — reminds operators of audit + acceptable
# use. Provide as a separate file, not inline:
Banner /etc/issue.net
EOF

# (2) Drop in the operator banner
$ sudo tee /etc/issue.net > /dev/null <<'EOF'
###############################################################################
#  AU Internal Application Platform — Bastion Host                            #
#                                                                             #
#  This system is for authorised AU platform engineers only.                  #
#  All sessions are logged for security audit.                                #
#  Disconnect immediately if you are not an authorised operator.              #
###############################################################################
EOF

# (3) Test config (catches typos before reload)
$ sudo sshd -t
# Expected: no output. Any output = error; fix before reload.

# (4) Reload sshd — does NOT drop existing sessions
$ sudo systemctl reload sshd
$ sudo systemctl is-active sshd                        # active
```

> **⚠ Test from a second terminal before logging out**
>
> The first time these settings land, **always** keep your existing SSH session open while you open a _new_ SSH session in a separate terminal to verify auth still works. If the new session fails (e.g., your key isn't accepted because of a typo in `AuthorizedKeysFile` or `AllowGroups`), the original session is your only recovery path. If you logged out first, you'd need hypervisor console access to fix it.

### 2.4 Operator account model + groups

Single group (`operators`) — every human who needs SSH access to _anywhere_ on the platform belongs to this group on **both** bastions. No per-app groups; that's overkill for AU's scale and would multiply group-membership-management.

```bash
# [auishqosrbst01 + auishqosrbst02]

# (1) Create the operators group (no GID — system picks one)
$ sudo groupadd --system operators

# (2) Create individual operator accounts. ONE per human; never share.
#     Replace 'binalfew' with your operator's username.
$ sudo useradd --create-home --shell /bin/bash --groups operators binalfew
$ sudo passwd -l binalfew         # lock the password — key auth only
#   useradd     standard account creation
#   --create-home  create /home/<user> with default skeleton
#   --shell /bin/bash    default shell (operators want a real shell)
#   --groups operators   add to the AllowGroups-permitted group
#   passwd -l   lock the password (no password auth at all anywhere)

# (3) Verify the user can't password-auth to sudo (we'll grant sudo via
#     a separate file in §2.4 step 5)
$ sudo -u binalfew sudo -nv 2>&1 | head -1
# Expected: "sudo: a password is required" — confirms locked pw +
# user is in sudoers (we haven't put them there yet, but the response
# changes shape once we do)

# (4) For each operator, create the ssh dir + give them ownership.
#     They'll add their own public keys via §2.5.
$ sudo install -d -m 700 -o binalfew -g binalfew /home/binalfew/.ssh
$ sudo install -m 600 -o binalfew -g binalfew /dev/null \
    /home/binalfew/.ssh/authorized_keys

# (5) Sudo policy — operators get full sudo on the bastion (they need it
#     for system administration on this box). Use a drop-in file, NOT
#     /etc/sudoers, to keep changes auditable + revertable per file.
$ sudo tee /etc/sudoers.d/10-operators > /dev/null <<'EOF'
# AU bastion operator sudo policy
# Members of 'operators' get full sudo with password authentication.
# Password auth is required even though SSH password auth is disabled —
# sudo prompts for the user's account password, which is locked here.
# Effectively: operators MUST set a password via `sudo passwd <self>`
# after first SSH login if they want to use sudo on this host.
#
# Alternative considered: NOPASSWD. Rejected — too easy for a stolen
# SSH session to escalate silently. Forcing a typed password ensures
# any sudo action is at least an interactive moment.

%operators ALL=(ALL:ALL) ALL
EOF
$ sudo chmod 0440 /etc/sudoers.d/10-operators
$ sudo visudo -c                    # validate sudoers syntax
# Expected: "/etc/sudoers: parsed OK" + same for /etc/sudoers.d/*
```

> **ℹ Why force passwords for sudo when SSH is key-only**
>
> Two-factor by accident: an attacker with a stolen SSH key still needs the operator's account password to escalate to root. Operators set their own password via `sudo passwd <self>` after first login — they pick something unique to this account, not their AU-wide password.

### 2.5 SSH key authentication setup

```bash
# [operator workstation, e.g., your Mac]

# (1) Generate a strong key pair if you don't have one yet.
#     Ed25519 is the modern default — small, fast, secure.
$ ssh-keygen -t ed25519 -C "<operator-email>@africanunion.org" \
    -f ~/.ssh/au-bastion
#   -t ed25519        algorithm choice (Ed25519 > RSA-3072 in every dimension)
#   -C COMMENT        identifies the key; appears in known_hosts on remote
#   -f PATH           don't overwrite an existing key
# Use a strong passphrase when prompted — this key is high value.

# (2) Print the public key to copy
$ cat ~/.ssh/au-bastion.pub

# (3) Append the public key to the operator's authorized_keys on BOTH
#     bastions. Do this via your existing emergency / break-glass access
#     (hypervisor console for the first operator; subsequent operators
#     are added by an existing operator).
#
# [auishqosrbst01 + auishqosrbst02]   — as root via console for first
#                                       operator; then as the operator
#                                       themselves for subsequent ones.
$ sudo -u binalfew tee -a /home/binalfew/.ssh/authorized_keys <<'EOF'
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... <operator-email>@africanunion.org
EOF
$ sudo chmod 600 /home/binalfew/.ssh/authorized_keys
$ sudo chown binalfew:binalfew /home/binalfew/.ssh/authorized_keys

# (4) Test from operator workstation
$ ssh -i ~/.ssh/au-bastion binalfew@auishqosrbst01.africanunion.org
# Should land at the AU banner + a shell. No password prompt.
```

> **ℹ Add operators to BOTH bastions**
>
> Every operator account, every key, every group membership must be identical on both bastions. Otherwise during failover you lose access to half your operators. Phase 5 (Teleport) centralises this; Phase 1 you do it twice.

### 2.6 ProxyJump pattern (operator workflow)

Operators don't SSH to the bastion to do work. They **jump through** the bastion to reach internal VMs. The bastion is invisible in the daily workflow; it's just a transit point.

**Local SSH config** (operator's `~/.ssh/config` on their workstation):

```ssh
# ~/.ssh/config

# The bastion entry — ssh au-bastion lands you on the bastion itself
Host au-bastion auishqosrbst01.africanunion.org
    HostName auishqosrbst01.africanunion.org
    User binalfew
    IdentityFile ~/.ssh/au-bastion
    IdentitiesOnly yes
    Port 22

# Failover bastion
Host au-bastion-2 auishqosrbst02.africanunion.org
    HostName auishqosrbst02.africanunion.org
    User binalfew
    IdentityFile ~/.ssh/au-bastion
    IdentitiesOnly yes
    Port 22

# Pattern for ALL internal platform VMs — auto-jump via bastion.
# Match: any hostname ending in .au-internal (a local convention)
Host *.au-internal
    User binalfew
    IdentityFile ~/.ssh/au-bastion
    IdentitiesOnly yes
    ProxyJump au-bastion

# Per-host overrides for specific VMs you reach often
Host vault01
    HostName auishqosrvlt01
    User binalfew
    IdentityFile ~/.ssh/au-bastion
    ProxyJump au-bastion
```

**Daily operator workflow:**

```bash
# Reach the bastion itself (rare — only for bastion admin)
$ ssh au-bastion

# Reach an internal VM via ProxyJump (common — every other operation)
$ ssh vault01
$ ssh -J au-bastion auishqosrvlt01.africanunion.org   # explicit form
$ ssh nomad-server-01.au-internal                     # if you've set up the wildcard pattern

# Run a one-off command on an internal VM without keeping a session
$ ssh vault01 'sudo systemctl status vault'

# Copy a file to an internal VM (scp uses ProxyJump automatically when
# OpenSSH 8.0+ — Mac sonoma+ ships it)
$ scp -J au-bastion local-file.txt binalfew@vault01:/tmp/
```

> **ℹ ProxyJump uses `direct-tcpip`, not interactive shell**
>
> When you `ssh -J au-bastion vault01`, your client opens an SSH connection to the bastion, then asks the bastion to open a TCP tunnel to `vault01:22`, then runs the SSH protocol over that tunnel. The bastion sees a brief authenticated connection that opens a single TCP forward — no shell session is created on the bastion itself for jumps. Audit logging captures this differently from interactive sessions; see [§2.7](#27-audit-logging-auditd-authlog-retention).

### 2.7 Audit logging (auditd + auth.log retention)

Two log streams matter on the bastion:

1. **`/var/log/auth.log`** — sshd's own log. Records every connection attempt, every key-auth event, every channel open (including ProxyJump tunnels), every disconnect. Default retention: 4 weeks via `logrotate`. Bump to 90 days for the bastion.
2. **`auditd`** — kernel audit subsystem. Records syscalls, filesystem changes, sudo invocations, anything you write a rule for. Default retention: indefinite up to disk; configure rotation.

```bash
# [auishqosrbst01 + auishqosrbst02]

# (1) Install auditd
$ sudo apt install -y auditd audispd-plugins

# (2) Tighten auth.log rotation — 90 days, compressed
$ sudo tee /etc/logrotate.d/rsyslog-bastion > /dev/null <<'EOF'
# AU bastion — extended auth.log retention for security audit
# Overrides the default /etc/logrotate.d/rsyslog for auth.log only.
/var/log/auth.log {
    daily
    rotate 90
    missingok
    notifempty
    compress
    delaycompress
    sharedscripts
    postrotate
        /usr/lib/rsyslog/rsyslog-rotate
    endscript
}
EOF
# Note: the default rsyslog logrotate file rotates auth.log differently;
# our drop-in takes precedence by being lexically earlier? It actually
# doesn't — logrotate processes them in order. Easier: comment out
# auth.log handling in /etc/logrotate.d/rsyslog and let our file own it.
$ sudo sed -i.bak 's|^\(/var/log/auth\.log\)|#&|' /etc/logrotate.d/rsyslog
# Or remove the auth.log line entirely; either works.

# (3) Add audit rules — what to record
$ sudo tee /etc/audit/rules.d/99-bastion.rules > /dev/null <<'EOF'
# AU bastion auditd rules
#
# What we record:
#   - All sudo invocations (who became root for what)
#   - All ssh* binary executions
#   - Any modification to /etc/passwd, /etc/shadow, /etc/sudoers*
#   - Any modification to /etc/ssh/* (config tampering)
#   - Any modification to authorized_keys files (key tampering)

# Persistent rules — survive reboot
-w /usr/bin/sudo -p x -k privilege_escalation
-w /usr/bin/su -p x -k privilege_escalation

# Identity files
-w /etc/passwd -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/group -p wa -k identity
-w /etc/sudoers -p wa -k identity
-w /etc/sudoers.d/ -p wa -k identity

# SSH config
-w /etc/ssh/ -p wa -k ssh_config

# All authorized_keys files (regardless of operator)
-a always,exit -F dir=/home -F name=authorized_keys -F perm=wa -k ssh_keys

# Lock the rules — no further changes without reboot
-e 2
EOF

# (4) Reload audit rules
$ sudo augenrules --load
$ sudo systemctl restart auditd
$ sudo auditctl -l | head -10                          # confirm rules loaded

# (5) Verify a test event lands in the audit log
$ sudo touch /etc/sudoers.d/test-audit && sudo rm /etc/sudoers.d/test-audit
$ sudo ausearch -k identity --start recent | head -20
# Expected: events for both the touch and the rm. Confirms auditd is
# capturing changes.
```

**Querying the audit log later** (incident triage):

```bash
# All sudo invocations in the last 24h
$ sudo ausearch -k privilege_escalation --start 1day-ago

# Everything operator 'binalfew' did today
$ sudo aureport -u --start today | grep binalfew

# All SSH key file modifications
$ sudo ausearch -k ssh_keys
```

The bastion's audit log is a primary input to chapter 41 — incident response. Phase 1 stops at "logs are captured"; Phase 5 adds tooling to ingest these into Loki for unified search across the platform.

### 2.8 UFW + perimeter firewall rules

The bastion only accepts SSH from authorised operator workstations. No public SSH; no SSH from internal VLANs.

```bash
# [auishqosrbst01 + auishqosrbst02]

# (1) Reset UFW to a known state. Default deny incoming.
$ sudo ufw default deny incoming
$ sudo ufw default allow outgoing

# (2) Allow SSH ONLY from the operator subnet(s). Replace
#     <OPERATOR_SUBNET> with whatever AU's admin VPN or on-site
#     operator office subnet uses.
#
#     Common patterns:
#       - AU on-site operator office: 10.x.x.0/24
#       - AU admin VPN subnet: 10.y.y.0/24
#       - Off-site break-glass jump (if any): specific /32
$ sudo ufw allow from <OPERATOR_SUBNET> to any port 22 proto tcp \
    comment 'Operator workstation subnet'

# Examples (replace with real values):
# $ sudo ufw allow from 10.50.0.0/16 to any port 22 proto tcp comment 'AU office'
# $ sudo ufw allow from 10.99.0.0/24 to any port 22 proto tcp comment 'Admin VPN'

# (3) Activate
$ sudo ufw --force enable
$ sudo ufw status verbose
# Expected: only 22/tcp ALLOW IN entries from your specific subnets.

# (4) Verify SSH from a non-operator subnet is blocked
#     (test from an unauthorised IP if you can; this isn't required
#     for the chapter to be valid, but confirming the rule is recommended)
```

**Perimeter firewall (AU IT's job, not ours):**

> Inbound TCP 22 to `auishqosrbst01.africanunion.org` and `auishqosrbst02.africanunion.org` (their public IPs, TBD by AU IT) — allow from operator subnets and admin VPN ranges only. No public-internet allowlist.
>
> Reject all other inbound traffic to these hosts (no HTTP, no HTTPS, no anything else).

The bastions themselves only need outbound HTTPS for `apt update` + GitLab/Vault if you eventually run platform-tier admin actions from the bastion (Phase 5). Phase 1: outbound TCP 80/443 is fine; outbound DNS is fine.

### 2.9 HA: active/passive pattern

Two bastions, one active, one warm standby. DNS-driven failover (simple) or VRRP (faster but more setup). Phase 1 picks **DNS-driven**:

- `bastion.africanunion.org` is a DNS A record managed by AU IT
- Normal: points at `auishqosrbst01`'s public IP
- During an `auishqosrbst01` outage, AU IT updates the record to `auishqosrbst02`'s IP
- TTL on the record: 60s (fast cutover) or 300s (less DNS chatter; acceptable bastion downtime)

**Operator workstation `~/.ssh/config` should reference both:**

```ssh
Host au-bastion
    HostName bastion.africanunion.org
    User binalfew
    # ... rest of config

# Manual override during failover testing:
Host au-bastion-failover
    HostName auishqosrbst02.africanunion.org
    User binalfew
    # ... rest of config
```

**Monthly drill** (recommended):

1. Coordinate with operators for a 5-minute window.
2. AU IT updates `bastion.africanunion.org` to `auishqosrbst02`'s IP.
3. Operators verify they can SSH through the secondary bastion to a known-internal VM.
4. AU IT reverts the DNS record (or leaves it on bst02 until next failover).
5. Confirm in the audit log that bst02 captured the test sessions.

> **ℹ Why not VRRP / floating IP**
>
> VRRP gives sub-second failover via a shared VIP. The complexity is real (keepalived configuration, multicast on the DMZ subnet, split-brain risk during network partitions). For a bastion — where downtime tolerance is "minutes, not seconds" — DNS-driven is dramatically simpler. Reconsider VRRP if SSH session continuity through failure becomes a real requirement (rare for operator workflows).

### 2.10 Verification

```bash
# (1) From operator workstation — connect to the bastion
$ ssh -v au-bastion 2>&1 | grep -E "Authenticated|debug1: pubkey"
# Expected: "Authenticated to ... using publickey"
# Banner from /etc/issue.net visible after handshake.

# (2) From operator workstation — ProxyJump to a downstream VM
$ ssh -v -J au-bastion vault01 2>&1 | grep -E "Authenticated|ProxyJump"
# Expected: two "Authenticated" lines (one for bastion, one for target).

# (3) On the bastion — verify your session was logged
# [auishqosrbst01]
$ sudo grep "$(whoami)" /var/log/auth.log | tail -5
# Expected: lines for "Accepted publickey", "session opened", etc.
$ sudo ausearch -k privilege_escalation --start 1hour-ago | tail -5
# Expected: any sudo you ran is captured.

# (4) Verify config integrity
$ sudo sshd -T 2>&1 | grep -E "passwordauthentication|allowgroups|allowtcpforwarding|x11forwarding|allowagentforwarding"
# Expected:
#   passwordauthentication no
#   allowgroups operators
#   allowtcpforwarding yes
#   x11forwarding no
#   allowagentforwarding no

# (5) Verify UFW
$ sudo ufw status verbose | head -10
# Expected: 22/tcp ALLOW IN from your operator subnet(s) only.

# (6) Verify auditd is running and rules are loaded
$ sudo systemctl is-active auditd                      # active
$ sudo auditctl -l | wc -l                              # > 0 rules

# (7) From operator workstation — verify the failover bastion works
$ ssh -i ~/.ssh/au-bastion binalfew@auishqosrbst02.africanunion.org
# Same banner, same auth, same shell. Confirms operator account +
# keys are in sync between bst01 and bst02.
```

**Common failures and remedies:**

| Symptom                                                         | Cause                                                     | Fix                                                                                                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Permission denied (publickey)` on first login                  | Public key not in `~/.ssh/authorized_keys` on the bastion | Add via console (first operator) or via existing operator (subsequent). Verify file mode 600 + owned by user.                                                        |
| `Permission denied (publickey)` after operator change           | Operator removed from `operators` group; or key revoked   | Verify `groups <operator>` includes `operators`; verify key still in their authorized_keys                                                                           |
| `Connection refused` from operator                              | UFW blocking source IP                                    | `sudo ufw status verbose` — confirm the source subnet is in the allow list                                                                                           |
| `kex_exchange_identification: Connection closed by remote host` | fail2ban banned the source IP after repeated failures     | `sudo fail2ban-client status sshd`; `sudo fail2ban-client set sshd unbanip <source-ip>`                                                                              |
| ProxyJump fails: `Connection to bastion closed by remote host`  | `AllowTcpForwarding` set to `no` in `99-bastion.conf`     | Set to `yes` (we documented this in §2.3); reload sshd                                                                                                               |
| Operator can SSH to bastion but can't `sudo`                    | Locked password, no sudoers entry, or wrong group         | (a) operator runs `sudo passwd <self>` from console; (b) verify they're in `operators` group; (c) verify `/etc/sudoers.d/10-operators` exists with correct mode 0440 |
| Audit rules not loading after `augenrules --load`               | Syntax error in rules file                                | `sudo auditctl -R /etc/audit/rules.d/99-bastion.rules` — outputs the failing line                                                                                    |
| auth.log filling disk fast                                      | Brute-force attack flooding log; rotation not catching up | Confirm `/etc/logrotate.d/rsyslog-bastion` is in place; consider adding rate-limiting in fail2ban (`maxretry` lower)                                                 |

### 2.11 Path to Phase 5 (Teleport upgrade)

Phase 1 simple bastion is intentionally minimal. Phase 5 [chapter 21 — Teleport](21-teleport.md) replaces this with:

| Capability              | Phase 1 (this chapter)                          | Phase 5 (Teleport)                                                                                          |
| ----------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Authentication          | SSH keys (one per operator)                     | Short-lived SSH certificates issued by Teleport via Vault PKI; MFA via Yubikey or TOTP enforced at issuance |
| Authorisation           | Linux group `operators` + sudoers               | Teleport roles with fine-grained per-host / per-resource ACL                                                |
| Session recording       | Just auth.log entries (no contents)             | Full session recording — every keystroke + every screen, replayable                                         |
| User lifecycle          | Manual (`useradd` per operator on each bastion) | Automatic from Keycloak/AD via SSO                                                                          |
| Failover                | DNS-driven (manual)                             | Teleport's own clustering (automatic)                                                                       |
| Workload-machine access | Same SSH+key model                              | Teleport's machine identity certificates (workload-bound)                                                   |

**The Phase 1 patterns survive the upgrade:**

- ProxyJump-style operator workflow continues to work; Teleport supports OpenSSH clients natively
- The `operators` group concept maps cleanly to a Teleport role
- The audit-log streams continue alongside Teleport's session recording (defence in depth)

So nothing in this chapter becomes throwaway when Phase 5 lands. The bastion VMs themselves get reconfigured (Teleport agent installed, sshd disabled in favour of Teleport's tsh-server), but the operator account model and audit pipeline stay.

---
