# 01 — Pre-flight: preparing all three VMs

> **Phase**: bring-up · **Run on**: ALL THREE VMs (`auishqosrarp01` DMZ, `auishqosrgbwbs01` app, `auishqosrgbdbs01` db) · **Time**: ~30 min per VM
>
> Hardened-baseline configuration that every step after this assumes is in place: same OS image, fully patched, hostnames + `/etc/hosts`, NTP-synced clocks, SSH key-only auth, UFW restrictive defaults, fail2ban watching SSH, unattended security upgrades, and a non-sudo `deployer` user on the App VM only.
>
> **Per-VM scope**:
>
> - **DB VM** (`auishqosrgbdbs01`, 10.111.11.50): §1.1–§1.7. Skip §1.8.
> - **App VM** (`auishqosrgbwbs01`, 10.111.11.51): §1.1–§1.8 (full).
> - **DMZ VM** (`auishqosrarp01`, 172.16.177.50, public IP TBD): §1.1–§1.7. Skip §1.8.
>
> The DMZ VM differs from the others in two places only: §1.6 UFW also accepts public 80/443 once chapter 12 §12.3 runs (see the DMZ-specific note in §1.6 below); §1.7 fail2ban watches SSH from a wider IP range because the DMZ is internet-exposed.
>
> **Next**: [02 — Database VM setup](02-db-vm-setup.md) · **Index**: [README](README.md)

---

## Contents

- [§1.1 Verify the OS and update packages](#11-verify-the-os-and-update-packages)
- [§1.2 Set the hostname and /etc/hosts](#12-set-the-hostname-and-etchosts)
- [§1.3 Set the time zone and enable NTP](#13-set-the-time-zone-and-enable-ntp)
- [§1.4 Enable automatic security updates](#14-enable-automatic-security-updates)
- [§1.5 Harden SSH](#15-harden-ssh)
- [§1.6 Enable UFW with restrictive defaults](#16-enable-ufw-with-restrictive-defaults)
- [§1.7 Enable fail2ban for SSH](#17-enable-fail2ban-for-ssh)
- [§1.8 Create a dedicated deploy user on the app VM](#18-create-a-dedicated-deploy-user-on-the-app-vm)

## 1. Pre-flight: preparing all three VMs

Run these steps on all three VMs (DMZ, App, DB) before anything else. They establish a consistent baseline: same time zone, same packages, firewall on, SSH hardened, unattended security patches on. Each command below is annotated with what it does.

The DMZ VM and DB VM run §1.1 through §1.7 only — §1.8 (the `deployer` user) lives on the App VM exclusively.

### 1.1 Verify the OS and update packages

```bash
# On EVERY VM (DMZ, App, DB)

$ lsb_release -a
#   lsb_release     prints Linux Standard Base release info
#   -a              "all" — show distributor ID, release, codename, description
# Expected output includes: "Ubuntu 24.04 LTS" and codename "noble".
# If the VM is on a different release, stop here — the rest of this document
# assumes Noble (24.04). Commands for 22.04 will mostly work; commands for
# anything older will not.
```

```bash
$ sudo apt update
#   apt update      download fresh package lists from configured repositories.
#                   Does NOT install or upgrade anything — only refreshes
#                   the index of what is available.

$ sudo apt upgrade -y
#   apt upgrade     install newer versions of already-installed packages.
#   -y              answer "yes" to every confirmation prompt (non-interactive).
# Safe on a fresh VM. On a running production box, upgrade during a window —
# kernel updates may require a reboot (check /var/run/reboot-required after).

$ sudo apt install -y curl ca-certificates gnupg lsb-release \
                    ufw fail2ban unattended-upgrades htop net-tools
#   apt install PKG...    install the listed packages and their dependencies.
#   -y                     non-interactive.
#   The packages, line by line:
#     curl              HTTP client — fetching repo signing keys, health probes
#     ca-certificates   root CA bundle — so HTTPS verifies server certs
#     gnupg             PGP tooling — verifying signed apt repositories
#     lsb-release       lets scripts read the distro codename ("noble")
#     ufw               "Uncomplicated Firewall" — wrapper over iptables
#     fail2ban          monitors auth logs and bans IPs after repeated failures
#     unattended-upgrades  daemon that applies security updates automatically
#     htop              better "top" — interactive process viewer
#     net-tools         netstat, ifconfig, route (deprecated but often useful)
```

### 1.2 Set the hostname and /etc/hosts

```bash
# [auishqosrarp01]  (DMZ VM)
$ sudo hostnamectl set-hostname auishqosrarp01
#   hostnamectl     systemd tool for managing the system hostname.
#   set-hostname    sets both the transient and static hostnames.
# Effective immediately for new shells; existing prompts may show the old name.

# [auishqosrgbwbs01]  (App VM)
$ sudo hostnamectl set-hostname auishqosrgbwbs01

# [auishqosrgbdbs01]  (DB VM)
$ sudo hostnamectl set-hostname auishqosrgbdbs01
```

```bash
# On EVERY VM (DMZ, App, DB): edit /etc/hosts so each VM resolves the other by name
$ sudo tee -a /etc/hosts <<'EOF'
172.16.177.50   auishqosrarp01
10.111.11.51    auishqosrgbwbs01
10.111.11.50    auishqosrgbdbs01
EOF
#   tee -a FILE           write stdin to FILE, appending (-a) rather than replacing.
#                          Used with sudo because /etc/hosts is root-owned —
#                          "sudo echo ... >> /etc/hosts" would fail because
#                          the redirect is handled by the user's shell, not sudo.
#   <<'EOF' ... EOF        heredoc — everything between the markers is stdin.
#                          The single quotes around EOF prevent the shell from
#                          expanding $variables or backticks inside the block.
# After this, "ping auishqosrgbdbs01" from the app VM resolves to 10.111.11.50 without DNS.
```

### 1.3 Set the time zone and enable NTP

Consistent clocks matter: TLS certificates, log correlation, and SCRAM authentication all rely on accurate time. Ubuntu 24.04 ships systemd-timesyncd enabled by default, so there is usually nothing to install — we only need to pick a time zone.

```bash
# Pick one time zone for both VMs. For the AU deployment this is typical:
$ sudo timedatectl set-timezone Africa/Addis_Ababa
#   timedatectl         systemd tool for date/time/timezone management.
#   set-timezone ZONE   set the system zone, where ZONE is a path under
#                       /usr/share/zoneinfo (e.g. "UTC", "America/New_York",
#                       "Africa/Addis_Ababa"). List candidates with:
#                       timedatectl list-timezones | grep Africa

$ timedatectl status
#   Without arguments, shows current status: local time, UTC time, zone,
#   whether system clock is synchronised, whether NTP service is active.
# Expected: "System clock synchronized: yes" and "NTP service: active"
```

### 1.4 Enable automatic security updates

#### Why this step matters

A long-lived production VM accumulates CVEs over time — kernel flaws, OpenSSL bugs, sudo privilege-escalations, Postgres patches, and so on. Someone has to apply those patches. `unattended-upgrades` is the Ubuntu-supplied daemon that does it for you, **scoped strictly to the security pocket** (`noble-security`, not `noble-updates` or `noble-backports`), so it only touches packages the Ubuntu security team has flagged as a vulnerability fix. Regular feature updates are left alone.

Without this step you're relying on a human to SSH in and run `apt upgrade` regularly. In practice that means patches lag, and a routine `sudo` / `openssl` / kernel CVE sits exposed for weeks. Turning this on is the highest-leverage single hardening action for a production VM — and it costs nothing.

#### What each command does

- **`sudo dpkg-reconfigure --priority=low unattended-upgrades`** runs the package's post-install wizard. The one question that matters is "Automatically download and install stable updates?" — answer **Yes**. That writes `/etc/apt/apt.conf.d/20auto-upgrades` with two lines that together mean "once a day, refresh the package index and install any security updates".
- **`systemctl status unattended-upgrades`** verifies the systemd unit is active. `active (exited)` is normal — the daemon wakes up on a timer, runs, and exits; it is not long-running.
- **`cat /etc/apt/apt.conf.d/20auto-upgrades`** confirms the wizard actually wrote the two lines. Both must be `"1"`; if either is `"0"` or missing, the feature is off despite the package being installed.

#### Day-to-day behaviour

Every ~24 h a systemd timer fires `apt-get update` and then installs any package whose source matches `${distro_id}:${distro_codename}-security`. Results are logged to `/var/log/unattended-upgrades/`. On both greenbook VMs you should expect a short `apt` run most nights with nothing user-visible unless a reboot is required (see below).

```bash
$ sudo dpkg-reconfigure --priority=low unattended-upgrades
#   dpkg-reconfigure         re-run a package's post-install configuration.
#   --priority=low           show all questions, not just high-priority ones.
#   unattended-upgrades      the package to reconfigure.
# You will be asked "Automatically download and install stable updates?" — YES.
# This creates /etc/apt/apt.conf.d/20auto-upgrades with daily-update settings.

$ sudo systemctl status unattended-upgrades --no-pager
#   systemctl status SERVICE    show current state of a systemd unit.
#   --no-pager                  print all output at once (don't use a pager).
# Expected: "active (running)" or "active (exited)".

$ cat /etc/apt/apt.conf.d/20auto-upgrades
#   cat FILE    print file contents to stdout.
# Expected content (both lines must be present):
#     APT::Periodic::Update-Package-Lists "1";
#     APT::Periodic::Unattended-Upgrade "1";
```

#### Important caveats — read these before relying on it

> **⚠ Kernel updates install but do NOT reboot automatically**
>
> If a security patch touches the kernel, the new kernel lands on disk but the running kernel is still the old (vulnerable) one until you reboot. Kernel patches don't protect you until that happens. Check `/var/run/reboot-required` at least weekly — §8.5 shows the one-liner — and schedule a maintenance reboot during a quiet window. On the app VM the container restarts automatically (`restart: unless-stopped`); on the DB VM you'll briefly drop the Postgres pool and Prisma will reconnect.

> **⚠ Docker and PostgreSQL are NOT updated by default**
>
> Both ship from third-party apt repos (`download.docker.com` and `apt.postgresql.org`), and by default `unattended-upgrades` only touches the Ubuntu **security** pocket. Docker Engine upgrades and Postgres minor-version bumps are left for you to schedule deliberately — which is what you want, because a surprise Docker daemon restart would recreate every container, and a surprise Postgres restart would drop every live connection. If you DO want security-only updates from those origins too, add them to the `Unattended-Upgrade::Allowed-Origins` list in `/etc/apt/apt.conf.d/50unattended-upgrades`, but weigh the trade-off first.

> **ℹ Safe by design**
>
> `unattended-upgrades` will never remove packages, never cross a major Ubuntu release boundary, and never replace a held package. The worst realistic outcome is a benign overnight upgrade of something like `openssl` that requires a service restart the next time you touch it. Leave it on.

### 1.5 Harden SSH

Disable password authentication and root login. This assumes you have already copied your public key to the target user (via ssh-copy-id from your workstation) and verified you can log in with keys.

```bash
# On EVERY VM (DMZ, App, DB), as a sudo user:
$ sudo tee /etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
KbdInteractiveAuthentication no
X11Forwarding no
MaxAuthTries 3
LoginGraceTime 30
EOF
#   We write a DROP-IN file in /etc/ssh/sshd_config.d/ instead of editing the
#   main /etc/ssh/sshd_config. Files in that directory are read AFTER the main
#   config, and later settings override earlier ones. Benefits:
#     · openssh-server upgrades will not overwrite your hardening.
#     · Easy to revert — just remove the one file.
#
#   The directives:
#     PermitRootLogin no           — disallow root login even with a key.
#                                     Attackers try "root" first; make it a
#                                     dead end. Use sudo from a regular account.
#     PasswordAuthentication no    — no password-based auth at all. Keys only.
#     PubkeyAuthentication yes     — belt-and-braces: explicitly enable keys.
#     KbdInteractiveAuthentication no  — disables PAM-based password prompts.
#     X11Forwarding no             — we never forward GUIs from a server.
#     MaxAuthTries 3               — per-connection limit before disconnect.
#     LoginGraceTime 30            — kill unauthenticated connections after 30s.
```

```bash
$ sudo sshd -t
#   sshd -t     "test mode" — parse the config and report errors WITHOUT
#               applying changes. Always run this before any reload/restart.
# Expected: no output on success. Any output means a syntax error — fix it
# before reloading, or you risk breaking SSH entirely.

$ sudo systemctl reload ssh
#   systemctl reload SERVICE    send SIGHUP (or the equivalent) — reload
#                               config without dropping existing connections.
# Your existing SSH session stays open. New connections use the new config.
```

> **⚠ Before you reload SSH**
>
> Keep your current SSH session open. From a SECOND terminal (a new SSH connection, not a new tmux pane in the old one), verify that key-based login still works before you end the first session. If you lock yourself out, console access to the VM is your only recovery.

### 1.6 Enable UFW with restrictive defaults

```bash
$ sudo ufw default deny incoming
#   ufw default POLICY DIRECTION   set the default policy for DIRECTION traffic.
#   deny incoming                  drop every inbound packet that no rule allows.
# Security posture: start with everything denied, open explicitly.

$ sudo ufw default allow outgoing
#   allow outgoing                 VM can make outbound connections freely.
# Needed so apt can fetch packages, curl can hit HTTPS, etc.

$ sudo ufw allow OpenSSH
#   ufw allow PROFILE|PORT         open the named app profile or a port number.
#   OpenSSH                        a built-in profile equivalent to "22/tcp".
# Without this rule, "ufw enable" below would cut your SSH connection.

$ sudo ufw --force enable
#   ufw enable         activate the firewall — rules take effect now.
#   --force            skip the "May disrupt existing SSH connections"
#                      interactive confirmation (safe because we allowed SSH).

$ sudo ufw status verbose
#   ufw status verbose    list all rules with default policies and logging level.
# Expected: "Status: active" and at minimum an OpenSSH (22/tcp) allow rule.
```

> **ℹ UFW and Docker**
>
> Docker installs iptables rules directly and does not, by default, honour UFW rules for published container ports. On the app VM we work around this by publishing the container port only to 127.0.0.1 (not 0.0.0.0). Because 127.0.0.1 is never reachable from off-host, UFW does not need to protect it. All external traffic to the app arrives via Nginx on ports 80/443, which UFW does control normally.

> **ℹ Per-VM UFW rules added later**
>
> §1.6 only opens SSH. Each chapter adds the rules its VM needs:
>
> - **DB VM** ([02 §2.7](02-db-vm-setup.md)): allow 5432/tcp from the App VM's IP only.
> - **App VM** ([06 §6.2](06-app-vm-nginx-tls.md#62-open-port-80-in-ufw-dmz-source-pinned)): allow 80/tcp from the DMZ VM's IP only (172.16.177.50). Never public.
> - **DMZ VM** ([12 §12.3](12-dmz-reverse-proxy.md#123-open-ports-80-and-443-in-ufw)): allow public 80/tcp + 443/tcp. The DMZ is the only host with public-internet exposure.
>
> Don't add those rules now — they assume infrastructure (other VM IPs, nginx) that doesn't exist yet. Each chapter will add them at the right moment.

### 1.7 Enable fail2ban for SSH

fail2ban watches log files, matches patterns (e.g. "Failed password" lines), and adds short-term iptables bans for offending IPs. The default configuration ships with an SSH jail ready to use.

```bash
$ sudo systemctl enable --now fail2ban
#   systemctl enable SERVICE    start SERVICE automatically on boot.
#   --now                        ALSO start it right now (not just next reboot).
# To verify: sudo systemctl is-active fail2ban    → "active"

$ sudo fail2ban-client status sshd
#   fail2ban-client ACTION      talk to the running fail2ban daemon.
#   status sshd                  show the current state of the "sshd" jail:
#                                currently banned IPs, total bans, failed attempts.
# Fresh install shows zero bans — expected.
```

> **ℹ The DMZ VM gets the most fail2ban traffic**
>
> SSH on the DB and App VMs is reachable only from your admin source IP via UFW (§1.6) — fail2ban is belt-and-braces. The DMZ VM is the only host with broader SSH exposure (it has a public IP for 80/443; even though SSH stays restricted via UFW, the host is internet-routable), so its fail2ban logs see real attack traffic. After the DMZ has been up for a week, `sudo fail2ban-client status sshd` on the DMZ will typically show a non-zero "Total banned" count — that's expected and the system working as intended.

### 1.8 Create a dedicated deploy user on the app VM

The "deployer" user owns the app directories and is the account that runs docker commands. Keeping it separate from your personal sudo login limits blast radius if deploy credentials are ever compromised.

```bash
# [auishqosrgbwbs01] only
$ sudo useradd --system --create-home --shell /bin/bash deployer
#   useradd              create a new account.
#   --system             mark as a system account (uid < 1000). Some services
#                         treat system accounts specially (e.g. login.defs
#                         skips them for UID recycling).
#   --create-home        create /home/deployer and populate from /etc/skel.
#   --shell /bin/bash    give them an interactive shell — we will SSH in as them.
#   deployer             the username.

$ sudo mkdir -p /opt/greenbook
#   mkdir -p PATH        create PATH and any missing parent directories.
#                         Idempotent — no error if it already exists.

$ sudo chown deployer:deployer /opt/greenbook
#   chown USER:GROUP FILE    set ownership. After this, deployer can create
#                             and modify files under /opt/greenbook without sudo.
```

```bash
# If you want to SSH in as 'deployer', authorise your key:
$ sudo mkdir -p /home/deployer/.ssh

$ sudo cp ~/.ssh/authorized_keys /home/deployer/.ssh/
#   cp SRC DST    copy. We copy YOUR already-authorised keys into deployer's
#                  account so the same physical key works for both logins.

$ sudo chown -R deployer:deployer /home/deployer/.ssh
#   chown -R      recursive — apply to the directory and everything inside.
#                  SSH refuses to use keys not owned by the target user.

$ sudo chmod 700 /home/deployer/.ssh
$ sudo chmod 600 /home/deployer/.ssh/authorized_keys
#   chmod MODE FILE    set permissions. SSH is strict:
#                       700 on .ssh       — rwx only for owner (deployer).
#                       600 on keys file  — rw only for owner.
#                      SSH refuses to use keys that are group- or world-readable.
```

> **ℹ The `deployer` account has NO password — by design**
>
> `useradd` above does not set a password. The `/etc/shadow` entry for `deployer` contains `!` where the hash would be, which means password-based login is mathematically impossible — no typed password can ever authenticate. This is intentional and is what you want:
>
> - **The account cannot be brute-forced over SSH** because "the deployer password" does not exist.
> - **Login is SSH-key-only** via the `authorized_keys` file we just installed. The same private key on your laptop that logs you in as your sudo admin account now also logs you in as `deployer`.
> - **`sudo -iu deployer` from your admin account** switches to the deployer shell **without any password** (sudo authenticates against YOUR admin password, not deployer's). This is the pattern used throughout §4 and §5.
> - **`deployer` deliberately has no sudo rights.** Its only privileges are ownership of `/opt/greenbook` (just done) and membership in the `docker` group (added in §4.5). If `deployer` is ever compromised (leaked key, forgotten session), the blast radius is the app container and `/opt/greenbook` — nothing else on the box.

#### Verify SSH works before moving on

From your **laptop** (new terminal), try logging in as deployer:

```bash
$ ssh deployer@10.111.11.51
#   You should land in deployer's shell with NO prompt at all. First-time
#   connection will ask you to accept the host fingerprint — type "yes" once.
```

Once in, confirm the identity:

```bash
$ whoami                  # → deployer
$ id                      # → uid=NNN(deployer) gid=NNN(deployer) groups=NNN(deployer)
$ pwd                     # → /home/deployer
$ ls -ld /opt/greenbook   # → owned by deployer:deployer
```

If this works silently, you're set. Type `exit` (or `Ctrl-D`) to return to your laptop.

> **⚠ If you get a password prompt instead of a key-auth login**
>
> A password prompt means SSH key auth failed AND the server is still allowing password auth as a fallback (§1.5 hasn't been applied yet, or sshd wasn't reloaded). **Do not try to guess a password — `deployer` has none. Press Ctrl-C and follow the troubleshooting block below.** The fact that you're getting a password prompt at all is actually useful: it means you're not locked out, and you can still reach the box as your admin user to fix the key.

#### Troubleshooting "Permission denied" / unexpected password prompt

**Step 1 — Diagnose from your laptop.** Run with `-v` (verbose) and filter to the authentication lines:

```bash
$ ssh -v deployer@10.111.11.51 2>&1 | grep -E "Offering|Authentications|denied|accepted"
```

You'll see lines like `Offering public key: /Users/you/.ssh/id_ed25519` and `Authentications that can continue: publickey,password`. If no offered key is accepted, the server does not have the matching public key in `/home/deployer/.ssh/authorized_keys`.

**Step 2 — Log in as your admin user to fix it.** Use the sudo-capable account you used in §1.1–3.7 (NOT `deployer`):

```bash
$ ssh YOUR_ADMIN_USER@10.111.11.51
```

**Step 3a — If `~/.ssh/authorized_keys` already exists on your admin user.** Re-run the key-authorisation block, being careful that the target path ends in `authorized_keys` (not just the directory):

```bash
# Check your admin user actually has an authorized_keys file:
$ ls -la ~/.ssh/authorized_keys

$ sudo mkdir -p /home/deployer/.ssh
$ sudo cp ~/.ssh/authorized_keys /home/deployer/.ssh/authorized_keys
$ sudo chown -R deployer:deployer /home/deployer/.ssh
$ sudo chmod 700 /home/deployer/.ssh
$ sudo chmod 600 /home/deployer/.ssh/authorized_keys

# Verify:
$ sudo ls -la /home/deployer/.ssh
# Expected:
#   drwx------  2 deployer deployer ... .
#   -rw-------  1 deployer deployer ... authorized_keys
```

**Step 3b — If `~/.ssh/authorized_keys` does NOT exist on your admin user.** This happens if the VM was provisioned with cloud-init that writes the key somewhere else, or you've been using password auth until now. Paste the public key directly. On your laptop:

```bash
$ cat ~/.ssh/id_ed25519.pub       # or id_rsa.pub — use whichever key you log in with
```

Copy the whole single line (starts with `ssh-ed25519 ` or `ssh-rsa `, ends with a comment like `you@laptop`). Then, on the VM as your admin user:

```bash
$ sudo mkdir -p /home/deployer/.ssh
$ sudo tee /home/deployer/.ssh/authorized_keys > /dev/null <<'EOF'
ssh-ed25519 AAAA...paste-your-public-key-line-here... you@laptop
EOF
$ sudo chown -R deployer:deployer /home/deployer/.ssh
$ sudo chmod 700 /home/deployer/.ssh
$ sudo chmod 600 /home/deployer/.ssh/authorized_keys
```

**Step 4 — Retest from your laptop:**

```bash
$ ssh deployer@10.111.11.51
```

No prompt, straight to shell. That's success.

**Common gotchas if it still fails:**

1. **Wrong key offered.** If you have multiple keys in `~/.ssh/`, SSH offers them in a default order and may trip the server's `MaxAuthTries` before reaching the right one. Force the right key: `ssh -i ~/.ssh/id_ed25519 -o IdentitiesOnly=yes deployer@10.111.11.51`.
2. **`/home/deployer` itself is group/world-writable.** `useradd --create-home` usually gets this right but some images don't. Fix: `sudo chmod 755 /home/deployer`.
3. **Wrong ownership on `/home/deployer/.ssh/*`.** SSH silently refuses keys not owned by the target user. Re-run `sudo chown -R deployer:deployer /home/deployer/.ssh`.
4. **Wrong file pasted in step 3b.** Check for: pasted the _private_ key by mistake (never starts with `ssh-`), wrapped over multiple lines, or accidental leading whitespace. `sudo cat /home/deployer/.ssh/authorized_keys` should show one line per key, no wrapping. If the line wraps in the display, it may or may not be a single logical line — delete and re-paste using the heredoc from 3b.
5. **sshd config override.** On odd base images, `/etc/ssh/sshd_config` can have `AuthorizedKeysFile` pointed elsewhere. Check: `sudo grep -i authorizedkeysfile /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf`. Default is `.ssh/authorized_keys` relative to the user's home; anything else means you need to put the key there instead.
6. **SELinux/AppArmor.** Not an issue on stock Ubuntu 24.04; skip unless you've enabled extra mandatory-access controls.

Once `ssh deployer@10.111.11.51` works with no prompt at all, go complete §1.5 (disable password auth everywhere) — until then the VM still accepts passwords from any account that has one, which defeats the point of key-only auth.

We will add deployer to the docker group later, after Docker is installed.

> **✓ Checkpoint**
>
> At this point all three VMs (DMZ, App, DB) should: be on Ubuntu 24.04, be fully patched, have correct hostnames and `/etc/hosts` entries, have NTP-synced clocks, have SSH key-only auth, have UFW active with only 22/tcp open (per-VM rules added later by 02 / 06 / 12), have fail2ban watching SSH, and have unattended-upgrades running. The App VM additionally has a non-sudo `deployer` user from §1.8. Verify this before moving on — everything that follows assumes it.
>
> ```bash
> # Same audit on each VM. Run as your sudo-capable admin account.
> $ lsb_release -d                                       # Ubuntu 24.04.x LTS
> $ sudo systemctl is-active unattended-upgrades         # active
> $ sudo ufw status verbose                              # active, default deny incoming
> $ sudo systemctl is-active fail2ban                    # active
> $ sudo sshd -T 2>/dev/null | grep -E "passwordauthentication|permitrootlogin|pubkeyauthentication"
> # Expected:
> #   passwordauthentication no
> #   permitrootlogin no
> #   pubkeyauthentication yes
> ```

---
