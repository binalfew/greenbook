# 04 — App VM Docker setup

> **Phase**: bring-up · **Run on**: App VM (`auishqosrgbwbs01`, 10.111.11.51) · **Time**: ~15 min
>
> Docker Engine + Compose v2 + buildx from Docker's official apt repo. Removes any conflicting old packages, configures the daemon, and grants the `deployer` user (created in [01](01-pre-flight.md)) docker-group membership.
>
> **Prev**: [03 — Database VM backups](03-db-vm-backups.md) · **Next**: [05 — Application container](05-app-vm-container.md) · **Index**: [README](README.md)

---

## Contents

- [§5.1 Remove any pre-installed Docker packages](#51-remove-any-pre-installed-docker-packages)
- [§5.2 Add the Docker apt repository](#52-add-the-docker-apt-repository)
- [§5.3 Install Docker Engine, CLI, Compose, and Buildx](#53-install-docker-engine-cli-compose-and-buildx)
- [§5.4 Enable the Docker service and verify](#54-enable-the-docker-service-and-verify)
- [§5.5 Grant the deploy user access to Docker](#55-grant-the-deploy-user-access-to-docker)
- [§5.6 Lay out the app directory](#56-lay-out-the-app-directory)

## 5. App VM setup: Docker Engine

This section installs Docker CE from Docker’s official apt repository. Ubuntu ships a docker.io package but it lags upstream significantly and does not include the Compose v2 plugin.

### 5.1 Remove any pre-installed Docker packages

```bash
# [auishqosrgbwbs01]
$ for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
  sudo apt remove -y $pkg 2>/dev/null || true
done
#   for VAR in LIST; do CMD; done
#                            shell loop — runs CMD once per item in LIST.
#   sudo apt remove -y PKG   uninstall PKG and dependencies; -y = non-interactive.
#   2>/dev/null              redirect stderr (file descriptor 2) to /dev/null,
#                            silencing "Package X is not installed" noise.
#   || true                  if the remove fails (e.g. package not installed),
#                            still exit 0 so the loop continues.
# This cleans out any conflicting older Docker packages that may exist from a
# previous experiment. On a fresh 24.04 VM, no output.
```

### 5.2 Add the Docker apt repository

```bash
# [auishqosrgbwbs01]
$ sudo apt update
$ sudo apt install -y ca-certificates curl gnupg
# Already installed in pre-flight; repeating is a no-op.

$ sudo install -m 0755 -d /etc/apt/keyrings
#   install -m MODE -d DIR    create DIR with mode MODE. 0755 is rwxr-xr-x —
#                             the standard mode for apt keyring dirs.

$ sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
#   curl flags:
#     -f      fail on HTTP errors (don't save error pages as if they were the key).
#     -s      silent mode (no progress bar).
#     -S      but still show errors — lets you see problems when they happen.
#     -L      follow redirects.
#   -o PATH   write the body to PATH.

$ sudo chmod a+r /etc/apt/keyrings/docker.asc
#   a+r      ADD (+) read permission for ALL (a = user, group, other).
#            apt reads this file as _apt user; world-readable is safe for
#            a public signing key.

$ echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
#   echo "deb [...] URL CODENAME stable"
#     Assembles the apt sources.list line:
#       arch=amd64 / arm64    restrict to this machine's architecture.
#       signed-by=PATH         trust anchor for the repo.
#       URL                    the Docker apt repository.
#       CODENAME               distro codename (noble, jammy, etc.).
#       stable                 repo channel ("stable" is what most people want).
#   $(dpkg --print-architecture)    current arch: amd64, arm64, etc.
#   $(. /etc/os-release && echo "$VERSION_CODENAME")
#                              source the os-release file to get
#                              $VERSION_CODENAME ("noble"), then echo it.
#   | sudo tee FILE > /dev/null
#                              pipe the echo to tee, which writes to FILE
#                              (with sudo's privileges). Redirect tee's own
#                              stdout to /dev/null so we don't double-print.

$ sudo apt update
# Refresh package lists so apt learns about the Docker repo contents.
```

### 5.3 Install Docker Engine, CLI, Compose, and Buildx

```bash
# [auishqosrgbwbs01]
$ sudo apt install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin
#   docker-ce              the Docker daemon (dockerd).
#   docker-ce-cli          the 'docker' command-line client.
#   containerd.io          the underlying container runtime.
#   docker-buildx-plugin   extended build backend (BuildKit); required for
#                           advanced Dockerfile features.
#   docker-compose-plugin  v2 compose, invoked as 'docker compose' (no hyphen).

$ docker --version
# Expected: Docker version 29.x.x or newer.

$ docker compose version
# Expected: Docker Compose version v2.x.x.
```

> **ℹ Why docker compose, not docker-compose**
>
> The modern tool is "docker compose" (a subcommand of the docker CLI, provided by the docker-compose-plugin package). The legacy Python tool "docker-compose" (hyphenated) is deprecated and should not be installed. Every compose command in this document uses the v2 syntax.

### 5.4 Enable the Docker service and verify

```bash
# [auishqosrgbwbs01]
$ sudo systemctl enable --now docker
#   enable      start automatically on boot.
#   --now       also start it right now.

$ sudo systemctl status docker --no-pager
# Expected: "active (running)".

$ sudo docker run --rm hello-world
#   docker run IMAGE    run a new container from IMAGE.
#   --rm                 delete the container when it exits (no cleanup needed).
#   hello-world          a 13 kB image whose only job is printing a success msg.
# Expected: the "Hello from Docker!" message block, ending with "run 'docker run
# -it ubuntu bash'..." This proves: daemon works, can pull images, can run them.
```

### 5.5 Grant the deploy user access to Docker

```bash
# [auishqosrgbwbs01]
$ sudo usermod -aG docker deployer
#   usermod         modify an existing user.
#   -a              append (add to supplementary groups WITHOUT removing
#                    existing memberships — without -a you overwrite them).
#   -G docker       supplementary group to add.
#   deployer        target user.

# The group change only takes effect in NEW logins (not in the current shell).
$ sudo -iu deployer
#   sudo -i        simulate a full login shell for the target user.
#   -u deployer    target user.

$ docker ps
# Expected: empty table (no containers yet, but the command succeeds without
# "permission denied" on /var/run/docker.sock).

$ exit
# Leave the deployer shell.
```

> **⚠ The docker group is root-equivalent**
>
> Adding a user to the docker group effectively gives them root on the host, because they can mount arbitrary host paths into containers (for example, mount / into a container and read /etc/shadow). Only trusted deploy operators belong in this group. The deployer system user we created in §3.8 is specifically for this purpose — your personal admin account should stay out of the docker group.

### 5.6 Lay out the app directory

```bash
# [auishqosrgbwbs01]
$ sudo -iu deployer

$ mkdir -p /opt/greenbook/releases
#   /opt/greenbook              root of the deployment; will hold docker-compose.yml
#                                and a .env file with the current version.
#   /opt/greenbook/releases     each deploy goes into a dated subdirectory.

$ cd /opt/greenbook
# Compose files we write later go here.

$ exit
```

---
