# 12 — DMZ shared reverse proxy

> **Phase**: bring-up · **Run on**: DMZ VM (`auishqosrarp01`, 172.16.177.50, public IP TBD) · **Time**: ~45 min
>
> Edge nginx in the AU DMZ that terminates TLS and reverse-proxies HTTP traffic to internal app VMs. **Shared infrastructure** — once the AU wildcard cert and the shared TLS / rate-limit configs are in place, adding a new app behind the proxy is a three-command operation (drop in a new server-block file, symlink, reload). Greenbook is the worked example throughout this chapter; the same pattern applies to every future AU app that comes online behind this proxy.
>
> **Prev**: [11 — Future Graylog deployment](11-future-graylog.md) · **Index**: [README](README.md)

---

## Contents

- [§12.1 DMZ VM pre-flight](#121-dmz-vm-pre-flight)
- [§12.2 Install Nginx on the DMZ VM](#122-install-nginx-on-the-dmz-vm)
- [§12.3 Open ports 80 and 443 in UFW](#123-open-ports-80-and-443-in-ufw)
- [§12.4 Install the AU wildcard certificate](#124-install-the-au-wildcard-certificate)
  - [§12.4.1 Copy the already-extracted cert from the app VM](#1241-copy-the-already-extracted-cert-from-the-app-vm)
  - [§12.4.2 Import from a fresh PFX](#1242-import-from-a-fresh-pfx)
- [§12.5 Shared edge configs (TLS + rate-limit zones)](#125-shared-edge-configs-tls--rate-limit-zones)
- [§12.6 Add greenbook as the first proxied app](#126-add-greenbook-as-the-first-proxied-app)
- [§12.7 Adding future apps behind the same proxy](#127-adding-future-apps-behind-the-same-proxy)
- [§12.8 Modify the app VM for the two-tier topology](#128-modify-the-app-vm-for-the-two-tier-topology)
- [§12.9 Test the TLS deployment](#129-test-the-tls-deployment)
- [§12.10 Renewal](#1210-renewal)

## 12. DMZ shared reverse proxy

The DMZ VM `auishqosrarp01` sits in the AU DMZ subnet (172.16.177.0/24) with one foot in the public-facing path and one foot routable to the internal app subnet (10.111.11.0/24 where greenbook's app + DB VMs live). Its job is single-purpose:

1. Terminate TLS for `*.africanunion.org` traffic using the AU wildcard cert.
2. Apply edge-tier rate limiting and security headers.
3. Reverse-proxy plain HTTP to the right internal app VM based on `server_name`.

The internal app VMs see only HTTP traffic from a single trusted source (this DMZ VM) and have UFW pinned accordingly. There is **no plaintext anywhere on the public internet**; the LAN between DMZ and app VMs is the trust boundary.

```
Internet
   │
   ▼  (DMZ public IP — TBD)
[ DMZ VM auishqosrarp01 — 172.16.177.50 ]
   nginx 1.24, AU wildcard cert at /etc/ssl/au/
   TLS terminator + edge rate-limit + security headers
   │
   ▼  (private subnet, plain HTTP — LAN is the trust boundary)
[ App VM auishqosrgbwbs01 — 10.111.11.51 ]
   nginx :80, accepts only from 172.16.177.50
   docker → greenbook container on 127.0.0.1:3000
   │
   ▼
[ DB VM auishqosrgbdbs01 — 10.111.11.50 ]
```

This chapter follows the same structural beats as [06 — Nginx and TLS](06-app-vm-nginx-tls.md) (install nginx, open ports, install cert, write config, test, renew), but the configs are shaped for a **multi-tenant edge**: shared TLS / rate-limit blocks under `/etc/nginx/conf.d/` plus one `sites-available/<app>.conf` per backend app. Adding the second AU app behind this proxy collapses to three commands ([§12.7](#127-adding-future-apps-behind-the-same-proxy)).

The companion change on the app VM side — drop TLS, listen on plain HTTP, pin source IP to the DMZ VM — is in [§12.8](#128-modify-the-app-vm-for-the-two-tier-topology).

### 12.1 DMZ VM pre-flight

The DMZ VM gets the same hardened baseline as the other VMs (Ubuntu 24.04, SSH key auth, UFW restrictive defaults, fail2ban, unattended security updates), but **nothing else** — no Docker, no Postgres. Start from [01 — Pre-flight](01-pre-flight.md) §1.1 through §1.7. Skip §1.8 (the `deployer` user is for the app VMs only; the DMZ VM is operated by your sudo-capable admin account).

If the VM was already provisioned with hostname `auishqosrarp01` and internal IP `172.16.177.50`, you mostly just need to confirm the hardening is in place:

```bash
# [auishqosrarp01]
$ lsb_release -d                                       # Ubuntu 24.04.x LTS
$ sudo systemctl is-active unattended-upgrades         # active
$ sudo ufw status verbose                              # restrictive default
$ sudo systemctl is-active fail2ban                    # active
$ sudo sshd -T 2>/dev/null | grep -E "passwordauthentication|permitrootlogin|pubkeyauthentication"
# Expected:
#   passwordauthentication no
#   permitrootlogin no
#   pubkeyauthentication yes
```

### 12.2 Install Nginx on the DMZ VM

Same as [06 §6.1](06-app-vm-nginx-tls.md#61-install-nginx) but on the DMZ VM. Pasted here for self-contained running:

```bash
# [auishqosrarp01]
$ sudo apt install -y nginx
$ nginx -v                                             # nginx/1.24.x (Ubuntu)
$ sudo systemctl enable --now nginx
$ sudo systemctl status nginx --no-pager               # active (running)
$ curl -I http://127.0.0.1/                            # HTTP/1.1 200 OK (default)
```

### 12.3 Open ports 80 and 443 in UFW

```bash
# [auishqosrarp01]
$ sudo ufw allow 'Nginx Full'
#   Same UFW profile 06 §6.2 uses on the app VM. Opens 80/tcp + 443/tcp
#   on both IPv4 and IPv6.

$ sudo ufw status verbose
# Expected: 80/tcp + 443/tcp ALLOW IN, both v4 and v6.
```

> **ℹ The DMZ VM's UFW is permissive on 80/443 by design**
>
> Unlike the app VM (where UFW pins 80 to a single source IP — see [§12.8](#128-modify-the-app-vm-for-the-two-tier-topology)), the DMZ VM accepts public traffic on 80/443 from anywhere. That's the whole point: it's the public-facing host. Defence in depth comes from (a) the edge rate-limit zones in [§12.5](#125-shared-edge-configs-tls--rate-limit-zones), (b) modern TLS only, (c) `fail2ban` watching `/var/log/nginx/error.log` for repeated bad-cert / bad-host probes if you choose to wire that up.

### 12.4 Install the AU wildcard certificate

The DMZ VM holds the **only copy** of the AU wildcard cert in production. Once [§12.6](#126-add-greenbook-as-the-first-proxied-app) onward bring up app server-blocks behind it, none of the internal app VMs need their own cert — TLS terminates here and the LAN between DMZ and apps is plain HTTP.

**Two paths in**, depending on where the cert lives today:

- **[§12.4.1](#1241-copy-the-already-extracted-cert-from-the-app-vm)** — copy from the app VM. Use this when [06 §6.7.3](06-app-vm-nginx-tls.md#673-install-the-wildcard-certificate-from-a-pfx--p12-bundle-aus-actual-path) has already run (the original single-tier setup) — the wildcard `.fullchain.pem` and `.key` are at `/etc/ssl/greenbook/` on the app VM and the PFX itself was shredded per §6.7.3 step 8. Faster (no `openssl pkcs12` extraction; no PFX password) and uses files you've already validated end-to-end on the app VM.
- **[§12.4.2](#1242-import-from-a-fresh-pfx)** — import a fresh PFX bundle from AU IT. Use this for greenfield bring-up (DMZ is the first place the cert lands) and for annual renewals. Mirrors [06 §6.7.3](06-app-vm-nginx-tls.md#673-install-the-wildcard-certificate-from-a-pfx--p12-bundle-aus-actual-path) but lands files under `/etc/ssl/au/`.

After either path, the DMZ VM has the cert at the canonical paths every per-app server block in [§12.5](#125-shared-edge-configs-tls--rate-limit-zones)+ expects:

```
/etc/ssl/au/wildcard.africanunion.org.fullchain.pem    644 root:root
/etc/ssl/au/wildcard.africanunion.org.key              640 root:www-data
```

#### 12.4.1 Copy the already-extracted cert from the app VM

Two-hop the files via your laptop. (Direct VM-to-VM ssh would also work if your network allows it; via-laptop is the assumption-free version.)

```bash
# (a) On your laptop — pull the two files off the app VM. The .key is
#     mode 640 root:www-data, so your greenbook account can't `cat` it
#     directly; piping `sudo cat` over ssh streams it through the
#     existing SSH session without ever writing to disk on the app VM.
$ ssh greenbook@10.111.11.51 \
    'sudo cat /etc/ssl/greenbook/wildcard.africanunion.org.fullchain.pem' \
  > /tmp/wildcard.fullchain.pem
$ ssh greenbook@10.111.11.51 \
    'sudo cat /etc/ssl/greenbook/wildcard.africanunion.org.key' \
  > /tmp/wildcard.key
$ chmod 600 /tmp/wildcard.fullchain.pem /tmp/wildcard.key
#   Lock down the laptop staging. .fullchain.pem isn't secret (nginx
#   sends it to every client) but the .key is — same files, same
#   sensitivity tier as the original PFX.

# (b) On your laptop — push them to the DMZ VM:
$ scp /tmp/wildcard.fullchain.pem /tmp/wildcard.key \
      <admin>@172.16.177.50:~/

# (c) On the DMZ VM as your admin account — install at /etc/ssl/au/
#     with the right ownership and modes for nginx (www-data) to read
#     the key.
$ ssh <admin>@172.16.177.50

# [auishqosrarp01]
$ sudo install -d -m 750 -o root -g www-data /etc/ssl/au
$ sudo install -m 644 -o root -g root \
    ~/wildcard.fullchain.pem \
    /etc/ssl/au/wildcard.africanunion.org.fullchain.pem
$ sudo install -m 640 -o root -g www-data \
    ~/wildcard.key \
    /etc/ssl/au/wildcard.africanunion.org.key

# (d) Shred staging copies on the DMZ home directory and back on the
#     laptop. Same sensitivity reasoning as 06 §6.7.3 step 8.
$ shred -u ~/wildcard.fullchain.pem ~/wildcard.key
$ exit                                                # back to laptop
$ shred -u /tmp/wildcard.fullchain.pem /tmp/wildcard.key

# (e) Spot-check on the DMZ VM. Re-running the full chain / key-match /
#     SAN verifications from 06 §6.7.3 steps 5-7 here is optional —
#     they passed when the files were first generated and bytes don't
#     drift over scp. The lightweight smoke check below proves the
#     files are at the right paths with the right contents:
$ ssh <admin>@172.16.177.50

# [auishqosrarp01]
$ ls -l /etc/ssl/au/
# Expected:
#   -rw-r----- root www-data  wildcard.africanunion.org.key            (640)
#   -rw-r--r-- root root      wildcard.africanunion.org.fullchain.pem  (644)

$ openssl x509 -in /etc/ssl/au/wildcard.africanunion.org.fullchain.pem \
    -noout -ext subjectAltName -dates
# Expected: DNS:*.africanunion.org (and possibly DNS:africanunion.org),
# notAfter date matching what was on the app VM.
```

> **ℹ Two copies during cutover, one copy after — don't skip §12.8(c)**
>
> While both VMs hold the cert, an issue at the DMZ falls back to a working app-VM TLS cert via DNS rollback. That's the right safety net during the cutover window. After [§12.8(c)](#128-modify-the-app-vm-for-the-two-tier-topology) deletes `/etc/ssl/greenbook/` on the app VM, you're back to a single copy on the DMZ — the steady state. Long-lived duplicate keys multiply the rotation surface area; do the cleanup once the DMZ is verified green.

Continue with [§12.5](#125-shared-edge-configs-tls--rate-limit-zones).

#### 12.4.2 Import from a fresh PFX

Use this when the DMZ VM is the first place the cert lands (greenfield, or annual renewal). The procedure mirrors [06 §6.7.3](06-app-vm-nginx-tls.md#673-install-the-wildcard-certificate-from-a-pfx--p12-bundle-aus-actual-path) but the destination directory is `/etc/ssl/au/` rather than `/etc/ssl/greenbook/`.

```bash
# (1a) On your laptop — scp the AU-supplied wildcard PFX to your sudo
#      account on the DMZ VM. The PFX is delivered by AU IT with a
#      separate password; rotate the password if both arrived in the
#      same channel (06 §6.7.3 explains why).
$ scp wildcard.africanunion.org.pfx <admin>@172.16.177.50:~/

# (1b) SSH to the DMZ VM as the same admin account:
$ ssh <admin>@172.16.177.50

# [auishqosrarp01]
$ sudo install -d -m 750 -o root -g www-data /etc/ssl/au
$ sudo install -m 600 -o root -g root \
    ~/wildcard.africanunion.org.pfx \
    /etc/ssl/au/wildcard.africanunion.org.pfx
$ rm ~/wildcard.africanunion.org.pfx

# (2) Extract the private key. -legacy loads the OpenSSL 3 legacy
#     provider so RC2-40-CBC PFX bundles (Windows / IIS / many CA
#     portals) extract cleanly. Full background in 06 §6.7.3.
$ sudo openssl pkcs12 -legacy \
    -in  /etc/ssl/au/wildcard.africanunion.org.pfx \
    -out /etc/ssl/au/wildcard.africanunion.org.key \
    -nocerts -nodes
# Enter Import Password: <type the AU-supplied password>

$ sudo chmod 640 /etc/ssl/au/wildcard.africanunion.org.key
$ sudo chown root:www-data /etc/ssl/au/wildcard.africanunion.org.key

# (3) Extract the leaf certificate.
$ sudo openssl pkcs12 -legacy \
    -in  /etc/ssl/au/wildcard.africanunion.org.pfx \
    -out /etc/ssl/au/wildcard.africanunion.org.fullchain.pem \
    -nokeys -clcerts -nodes

# (4) Append the CA chain. Single-sudo bash -c (06 §6.7.3 explains
#     why piping `sudo openssl ... | sudo tee -a` fails on /dev/tty
#     contention).
$ sudo bash -c 'openssl pkcs12 -legacy \
    -in  /etc/ssl/au/wildcard.africanunion.org.pfx \
    -nokeys -cacerts -nodes \
  >> /etc/ssl/au/wildcard.africanunion.org.fullchain.pem'

$ sudo chmod 644 /etc/ssl/au/wildcard.africanunion.org.fullchain.pem

# (5) Verify chain order, key/cert match, SAN.
$ openssl crl2pkcs7 -nocrl \
    -certfile /etc/ssl/au/wildcard.africanunion.org.fullchain.pem \
  | openssl pkcs7 -print_certs -noout | grep -E "subject=|issuer="
# Expected: leaf "*.africanunion.org" first, intermediate(s) below.

$ sudo bash -c '
    diff <(openssl x509 -in /etc/ssl/au/wildcard.africanunion.org.fullchain.pem -pubkey -noout) \
         <(openssl pkey -in /etc/ssl/au/wildcard.africanunion.org.key -pubout)
'
# Empty output = key matches cert. Any diff = re-export bundle from AU IT.

$ openssl x509 -in /etc/ssl/au/wildcard.africanunion.org.fullchain.pem -noout -ext subjectAltName
# Expected: DNS:*.africanunion.org (and possibly DNS:africanunion.org).

# (6) Shred the PFX once extracted.
$ sudo shred -u /etc/ssl/au/wildcard.africanunion.org.pfx

# (7) Final layout:
$ ls -l /etc/ssl/au/
# Expected:
#   -rw-r----- root www-data  wildcard.africanunion.org.key            (640)
#   -rw-r--r-- root root      wildcard.africanunion.org.fullchain.pem  (644)
```

### 12.5 Shared edge configs (TLS + rate-limit zones)

Three files in [appendix/edge/](appendix/edge/) carry the canonical shared configuration for the DMZ proxy. Every per-app server block on the DMZ VM inherits these implicitly (nginx auto-loads `/etc/nginx/conf.d/*.conf` before any `sites-enabled/*` and `include`s the snippets in `location` blocks). Set these once; every onboarding app reuses them.

| File                                                                       | Lives at                                    | Purpose                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| [appendix/edge/00-au-tls.conf](appendix/edge/00-au-tls.conf)               | `/etc/nginx/conf.d/00-au-tls.conf`          | TLS protocols, ciphers, OCSP stapling, security headers, WebSocket upgrade `map` |
| [appendix/edge/01-au-rate-limit.conf](appendix/edge/01-au-rate-limit.conf) | `/etc/nginx/conf.d/01-au-rate-limit.conf`   | Per-IP rate-limit zones (`edge_general`, `edge_auth`)                            |
| [appendix/edge/au-proxy-headers.conf](appendix/edge/au-proxy-headers.conf) | `/etc/nginx/snippets/au-proxy-headers.conf` | `proxy_set_header` + timeouts every per-app `location` `include`s                |

Install all three:

```bash
# (a) From your laptop:
$ scp docs/deployment/appendix/edge/00-au-tls.conf \
      docs/deployment/appendix/edge/01-au-rate-limit.conf \
      docs/deployment/appendix/edge/au-proxy-headers.conf \
      <admin>@172.16.177.50:~/

# (b) On the DMZ VM as your admin account:
$ sudo install -m 644 -o root -g root \
    ~/00-au-tls.conf       /etc/nginx/conf.d/00-au-tls.conf
$ sudo install -m 644 -o root -g root \
    ~/01-au-rate-limit.conf /etc/nginx/conf.d/01-au-rate-limit.conf
$ sudo install -d -m 755 /etc/nginx/snippets
$ sudo install -m 644 -o root -g root \
    ~/au-proxy-headers.conf /etc/nginx/snippets/au-proxy-headers.conf
$ rm ~/00-au-tls.conf ~/01-au-rate-limit.conf ~/au-proxy-headers.conf
```

The `00-` and `01-` prefixes ensure these load before per-app `sites-enabled/` files alphabetically — `limit_req_zone` and `map` directives must be defined at `http {}` scope before any server block that uses them, or nginx fails to start with "unknown zone" / "map ... is not allowed here" errors.

> **ℹ Why three small files instead of one big one**
>
> Each file is single-concern (TLS terminator policy, rate-limit zones, proxy headers). A new AU app onboarding only needs to know about one file: its own `sites-available/<app>.conf`. The shared building blocks don't move. When an app eventually needs a per-app rate-limit zone (e.g. a public API that takes more traffic), you add a new line to `01-au-rate-limit.conf` and reference it from one server block — no change to TLS or proxy headers.

### 12.6 Add greenbook as the first proxied app

The per-app server block lives at `/etc/nginx/sites-available/greenbook.conf`. It declares `server_name greenbook.africanunion.org` and proxies to the greenbook app VM at `10.111.11.51:80`. Canonical source: [appendix/edge/greenbook.conf](appendix/edge/greenbook.conf).

```bash
# (a) From your laptop:
$ scp docs/deployment/appendix/edge/greenbook.conf \
      <admin>@172.16.177.50:~/greenbook.conf

# (b) On the DMZ VM as your admin account:
$ sudo install -m 644 -o root -g root \
    ~/greenbook.conf \
    /etc/nginx/sites-available/greenbook.conf
$ rm ~/greenbook.conf

$ sudo ln -sf /etc/nginx/sites-available/greenbook.conf \
              /etc/nginx/sites-enabled/greenbook.conf

# Remove the default welcome-page site:
$ sudo rm -f /etc/nginx/sites-enabled/default

$ sudo nginx -t
# Expected: "syntax is ok" / "test is successful". The TLS cert paths
# point at /etc/ssl/au/wildcard.africanunion.org.* which §12.4 already
# created — no snake-oil bootstrap needed (unlike 06 §6.3, where TLS
# was bootstrapped against an as-yet-unissued Let's Encrypt cert).

$ sudo systemctl reload nginx
```

### 12.7 Adding future apps behind the same proxy

When a second AU app onboards, the DMZ work collapses to **three commands plus one edited config file**. The wildcard cert + shared TLS / rate-limit configs are already in place from greenbook's onboarding.

For an app at internal IP `10.111.11.X` reachable as `<app>.africanunion.org`:

```bash
# (1) Copy greenbook.conf to <app>.conf as the template:
$ sudo cp /etc/nginx/sites-available/greenbook.conf \
          /etc/nginx/sites-available/<app>.conf

# (2) Edit two host-specific lines + two cosmetic ones (upstream
#     name + access_log path). Review by hand — sed alone may not
#     catch every place to update.
$ sudo $EDITOR /etc/nginx/sites-available/<app>.conf
# Change:
#   server_name greenbook.africanunion.org;
#   → server_name <app>.africanunion.org;
#
#   server 10.111.11.51:80;
#   → server 10.111.11.X:80;
#
#   upstream greenbook_app { ... }            and proxy_pass http://greenbook_app
#   → upstream <app>_app { ... }              and proxy_pass http://<app>_app
#
#   access_log /var/log/nginx/greenbook-edge.access.log;
#   error_log  /var/log/nginx/greenbook-edge.error.log warn;
#   → access_log /var/log/nginx/<app>-edge.access.log;
#   → error_log  /var/log/nginx/<app>-edge.error.log warn;
#
# Auth-path location regex may also need to change if the new app
# uses different routes for login / SSO / etc.

# (3) Symlink, test, reload:
$ sudo ln -sf /etc/nginx/sites-available/<app>.conf \
              /etc/nginx/sites-enabled/<app>.conf
$ sudo nginx -t
$ sudo systemctl reload nginx
```

The new app's **internal-side configuration** (its own VM's nginx pinned to accept only DMZ traffic, its own UFW rule, its own `trust proxy` hop count) follows the same pattern as [§12.8](#128-modify-the-app-vm-for-the-two-tier-topology) and is **independent of greenbook's setup** — onboarding a new app doesn't disturb anything already running.

> **ℹ Add the new hostname to public DNS too**
>
> AU IT needs to add `<app>.africanunion.org` to the same public DNS zone that points greenbook at the DMZ VM's public IP. The wildcard cert already covers any `*.africanunion.org` hostname, so no new cert work — just the A / CNAME record.

### 12.8 Modify the app VM for the two-tier topology

The greenbook app VM `auishqosrgbwbs01` was originally configured per [06 — Nginx and TLS](06-app-vm-nginx-tls.md) for the **single-tier** shape: TLS termination on :443 with the wildcard cert installed locally, public traffic accepted directly. With the DMZ in front, the app VM's role narrows: accept HTTP only from the DMZ VM's source IP, terminate no TLS, trust the DMZ VM's `X-Forwarded-*` headers.

The App VM nginx is **multi-tenant** (one shared `conf.d/00-app-vm-shared.conf` + one shared `snippets/app-vm-proxy-headers.conf` + one `sites-available/<app>.conf` per backend, per [06 §6.3](06-app-vm-nginx-tls.md#63-the-nginx-server-config)). The two-tier conversion touches the **per-app server blocks** and the host-level UFW + cert; the shared files stay untouched.

Three changes on `auishqosrgbwbs01`:

#### (a) Modify each per-app server block

For every `/etc/nginx/sites-available/<app>.conf` (greenbook today, additional apps later), apply the same diff: delete the HTTPS server block, narrow the HTTP block to the DMZ VM's source IP, add `set_real_ip_from`, drop the four `add_header` security headers (those move to the edge once at the DMZ — `/etc/nginx/conf.d/00-au-tls.conf`).

Concretely, starting from the §6.3.2 `greenbook.conf`:

1. **Delete the `server { listen 443 ssl http2; ... }` block in its entirety.** No TLS on the App VM in two-tier — that's the DMZ's job.
2. **Narrow the remaining `server { listen 80; ... }` block to plain HTTP** (no more `return 301 https://...` redirect — the DMZ already handled the redirect, and a redirect from the inner tier would loop). Keep `server_name greenbook.africanunion.org;`.
3. **Add `allow 172.16.177.50; deny all;`** as belt-and-braces over UFW inside the `server { }` block.
4. **Drop the four `add_header` lines** (`Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) from the (deleted) HTTPS block — already gone with step 1, called out here so the diff is explicit.
5. **Drop the `/.well-known/acme-challenge/` location** (no Certbot on the App VM in two-tier — the DMZ owns the cert).
6. **Move the cache snippet `include` and the auth-strict + catch-all `location` blocks** (the meaningful proxy work) into the surviving HTTP server block. The `include /etc/nginx/snippets/app-vm-proxy-headers.conf;` references inside the location blocks stay as-is — they're the same shared snippet either way.

Add **once per file** (above the `server { }` block, inside the file but outside any block) so nginx rewrites `$remote_addr` to the real client IP for logging + rate-limiting (instead of treating every request as coming from the DMZ VM):

```nginx
set_real_ip_from 172.16.177.50;
real_ip_header   X-Forwarded-For;
real_ip_recursive on;
```

The shared `app_general` / `app_auth` rate-limit zones in `/etc/nginx/conf.d/00-app-vm-shared.conf` keep working unchanged — they key on `$binary_remote_addr`, which `set_real_ip_from` now points at the real client. Inner-tier rate limits stack with the DMZ's `edge_general` / `edge_auth` zones, and both buckets see the same remote-IP key.

The resulting per-app server block is short:

```nginx
# /etc/nginx/sites-available/greenbook.conf  (TWO-TIER VERSION)
# Receives plain HTTP from the DMZ proxy at 172.16.177.50 only.

upstream greenbook_app {
    server 127.0.0.1:3000;
    keepalive 32;
}

set_real_ip_from 172.16.177.50;
real_ip_header   X-Forwarded-For;
real_ip_recursive on;

server {
    listen 80;
    listen [::]:80;
    server_name greenbook.africanunion.org;

    allow 172.16.177.50;
    deny  all;

    client_max_body_size 20m;
    access_log /var/log/nginx/greenbook.access.log;
    error_log  /var/log/nginx/greenbook.error.log warn;

    include /etc/nginx/snippets/greenbook-cache-policy.conf;

    location ~ ^/(login|forgot-password|api/auth|api/sso) {
        limit_req zone=app_auth burst=20 nodelay;
        proxy_pass http://greenbook_app;
        include /etc/nginx/snippets/app-vm-proxy-headers.conf;
    }

    location / {
        limit_req zone=app_general burst=200 nodelay;
        proxy_pass http://greenbook_app;
        include /etc/nginx/snippets/app-vm-proxy-headers.conf;
    }
}
```

The shared `00-app-vm-shared.conf` (WebSocket upgrade map, rate-limit zones) and the shared `app-vm-proxy-headers.conf` snippet (`proxy_set_header` block, timeouts, buffering) are **unchanged** from §6.3.1 — they're already correctly shaped for both topologies. Only the per-app server block changes shape.

The four security headers (`Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) are **gone** from this file — they're now set once at the edge (`/etc/nginx/conf.d/00-au-tls.conf` on the DMZ VM). nginx merges `add_header always` from the `http {}` scope of the edge into every response that flows through the proxy, so the headers reach browsers exactly as before; just from one source of truth.

The `ssl_certificate` paths, the `listen 443 ssl http2` block, OCSP stapling, the resolver — all gone. None of those concerns belong on an internal-only nginx that never speaks TLS.

Repeat steps 1-6 for every `<app>.conf` in `/etc/nginx/sites-available/` — each per-app file converts independently with the same diff.

#### (b) UFW rule changes on the app VM

Revoke the public 80/443 allow; replace with a source-pinned rule for the DMZ VM only:

```bash
# [auishqosrgbwbs01]
$ sudo ufw delete allow 'Nginx Full'
#   The 06 §6.2 rule that opened 80/443 to public.

$ sudo ufw allow from 172.16.177.50 to any port 80 proto tcp
#   New rule. ONLY the DMZ VM can reach :80 on the app VM.

$ sudo ufw status verbose
# Expected:
#   80/tcp ALLOW IN from 172.16.177.50
#   (no public 80 / 443 rules anymore)
```

Once 06's wildcard cert is removed too (next step), the app VM's TLS exposure to the public internet is fully cut.

#### (c) Remove the wildcard cert from the app VM

Now that the DMZ VM has the wildcard cert and the app VM nginx no longer references it:

```bash
# [auishqosrgbwbs01]
$ sudo rm -rf /etc/ssl/greenbook
#   The wildcard cert + key from 06 §6.7. Removing one of two copies
#   of secret material; the DMZ VM's copy is now the only one.
```

#### (d) Bump the `trust proxy` hop count in greenbook

Greenbook's `server/app.ts` currently has `app.set("trust proxy", 1)`. With the DMZ in front, there are now **two** trusted proxies between the client and Express (DMZ nginx → app VM nginx → Express). Without the bump, Express will trust only the immediate upstream (the app VM nginx) and treat the DMZ VM's IP as the client — breaking rate-limiting that keys on `req.ip`.

Edit `server/app.ts`:

```ts
// Before:
app.set("trust proxy", 1);

// After (env-var-driven so a fork without DMZ doesn't have to fork the code):
app.set("trust proxy", Number(process.env.TRUSTED_PROXIES ?? 1));
```

Then set `TRUSTED_PROXIES=2` in `/etc/greenbook.env` on the app VM and recreate the container ([07 §7.3.2](07-deploy-workflow.md#732-env-file-lifecycle-across-deploys) explains the env-file-recreate flow).

#### (e) Reload nginx + recreate the container

```bash
# [auishqosrgbwbs01]
$ sudo nginx -t && sudo systemctl reload nginx
# Expected: "syntax is ok" / "test is successful". With TLS gone the
# config is shorter; nginx -t finishes quickly with no warnings.

$ docker compose -f /opt/greenbook/docker-compose.yml up -d --force-recreate
# Picks up TRUSTED_PROXIES=2 from the env file.
```

### 12.9 Test the TLS deployment

Until AU IT cuts DNS over from Azure to the DMZ VM's public IP, the public hostname still resolves elsewhere. Test the DMZ proxy directly via its public IP with a `Host:` header override:

```bash
# From your laptop OR any host that can reach the DMZ VM's public IP.
# <DMZ_PUBLIC_IP> = the public IP AU IT assigns to auishqosrarp01.
$ curl -k -sI -H "Host: greenbook.africanunion.org" https://<DMZ_PUBLIC_IP>/
# Expected:
#   HTTP/2 200 (or a 30x redirect from the app)
#   strict-transport-security: max-age=31536000; includeSubDomains
#   x-content-type-options: nosniff
#   x-frame-options: DENY
#   referrer-policy: strict-origin-when-cross-origin
# -k ignores the cert mismatch warning ("you connected by IP, not by
#  name") but the cert itself is the real AU wildcard.
```

When DNS is cut over (Azure CNAME → A record pointing at `<DMZ_PUBLIC_IP>`), repeat without `-k` and `-H`:

```bash
$ curl -sI https://greenbook.africanunion.org/
# Expected: HTTP/2 200 + the same headers, with no cert warnings.

$ openssl s_client -connect greenbook.africanunion.org:443 \
    -servername greenbook.africanunion.org </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
# Expected: subject CN=*.africanunion.org, issuer = your CA's
# intermediate, SAN includes *.africanunion.org.
```

End-to-end verification through the whole chain (public → DMZ → app VM → docker → DB):

```bash
$ curl -s https://greenbook.africanunion.org/healthz | head -c 400
# Expected: {"status":"ok", "version":"<release version>",
#            "checks":{"process":"ok","db":"ok"}, ...}
# Confirms TLS + edge proxy + app VM proxy + container + DB are all alive.
```

### 12.10 Renewal

The wildcard cert in `/etc/ssl/au/` does not auto-renew. Set a calendar reminder 30 days before `notAfter`. The renewal procedure is the same shape as [§12.4](#124-install-the-au-wildcard-certificate): AU IT issues a new PFX, you scp + extract on the DMZ VM, replace the two files, `nginx -t && systemctl reload nginx`. <2 minutes per renewal.

```bash
# [auishqosrarp01] — check expiry
$ sudo openssl x509 -in /etc/ssl/au/wildcard.africanunion.org.fullchain.pem \
    -noout -dates
# Expected: notAfter date well in the future.
```

The cert-expiry probe in [08 §8.3](08-day-2-operations.md#83-simple-monitoring-script) and the [09 §9.6](09-hardening-checklist.md#96-observability) hardening item both probe the public hostname (`greenbook.africanunion.org`) once DNS is cut over — they don't need DMZ-specific updates because they use `openssl s_client` against the public name, which lands at the DMZ VM and sees the wildcard cert.

---
