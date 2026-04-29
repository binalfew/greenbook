# 06 — App VM nginx (inner tier)

> **Phase**: bring-up · **Run on**: App VM (`auishqosrgbwbs01`) · **Time**: ~30 min
>
> Host-installed nginx as the App VM's inner-tier reverse proxy. Listens on plain HTTP from the DMZ VM only (172.16.177.50), routes by `Host:` header to the right docker container on `127.0.0.1`, applies inner-tier rate limits, and serves greenbook's PWA cache headers. Tuned for React Router 7's streaming SSR + SSE (`proxy_buffering off`, long `proxy_read_timeout`) and correlation-ID forwarding.
>
> **TLS lives on the DMZ VM, not here** — the App VM never holds the wildcard cert and never accepts public traffic. See [12 — DMZ shared reverse proxy](12-dmz-reverse-proxy.md) for cert installation and the public-facing edge.
>
> **Prev**: [05 — Application container](05-app-vm-container.md) · **Next**: [07 — Deploy workflow](07-deploy-workflow.md) · **Index**: [README](README.md)

---

## Contents

- [§6.1 Install Nginx](#61-install-nginx)
- [§6.2 Open port 80 in UFW (DMZ source-pinned)](#62-open-port-80-in-ufw-dmz-source-pinned)
- [§6.3 The Nginx server config](#63-the-nginx-server-config)
  - [§6.3.1 Install the shared App VM nginx configs](#631-install-the-shared-app-vm-nginx-configs)
  - [§6.3.2 Add greenbook as the first proxied app](#632-add-greenbook-as-the-first-proxied-app)
- [§6.4 Test the App VM nginx](#64-test-the-app-vm-nginx)
- [§6.5 Adding a second app on the App VM](#65-adding-a-second-app-on-the-app-vm)
- [§6.6 Migrating a legacy single-tier App VM](#66-migrating-a-legacy-single-tier-app-vm)

## 6. App VM nginx (inner tier)

Nginx sits on the host (not in a container) on the App VM. Its job is narrow: accept plain HTTP from the DMZ reverse proxy ([chapter 12](12-dmz-reverse-proxy.md)), route by `Host:` header to the right docker container on `127.0.0.1`, and apply inner-tier rate limits + greenbook's PWA cache headers. That's the entire role.

Three things this nginx **does not** do, by design:

- **Terminate TLS.** TLS lives on the DMZ VM. The App VM never holds the wildcard cert; the LAN between DMZ and App VM is plain HTTP, with the LAN itself as the trust boundary.
- **Set the four security headers** (`Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`). Those are set once at the edge — see [12 §12.5](12-dmz-reverse-proxy.md#125-shared-edge-configs-tls--rate-limit-zones).
- **Accept public traffic.** UFW + nginx `allow / deny` both pin :80 to the DMZ VM's source IP (172.16.177.50). The App VM has no public IP exposure.

Putting nginx on the host (not in a container) keeps it independent of app container restarts and lets multiple apps share the same App VM via per-app `sites-available/<app>.conf` files (see [§6.5](#65-adding-a-second-app-on-the-app-vm)).

> **ℹ Already running a single-tier (TLS-on-App-VM) deployment?**
>
> If your App VM was set up against an earlier version of this guide that put TLS termination + the wildcard cert on the App VM directly, follow [§6.6](#66-migrating-a-legacy-single-tier-app-vm) to convert to the two-tier inner shape. The migration is a single atomic swap with no downtime; it drops the HTTPS server block, swaps UFW rules, and moves the security headers to the DMZ.

### 6.1 Install Nginx

```bash
# [auishqosrgbwbs01]
$ sudo apt install -y nginx
#   Ubuntu 24.04 ships nginx 1.24 in the standard repo. That version is
#   used throughout this document; the HTTP/2 syntax we use (see §6.3)
#   is compatible with both 1.24 and the newer 1.25+ from the upstream
#   Nginx repo, so you can swap later without touching the config.

$ nginx -v
# Expected: "nginx version: nginx/1.24.x (Ubuntu)".

$ sudo systemctl enable --now nginx
#   enable --now    start at boot AND start right now.

$ sudo systemctl status nginx --no-pager
# Expected: "active (running)".

$ curl -I http://127.0.0.1/
#   -I              HEAD-only request.
# Expected: HTTP/1.1 200 OK from the default Nginx welcome page. Proves
# Nginx is running and listening on port 80.
```

### 6.2 Open port 80 in UFW (DMZ source-pinned)

The App VM accepts HTTP from one source only — the DMZ VM at `172.16.177.50`. No public 80/443 rules; no general-purpose `Nginx Full` profile.

```bash
# [auishqosrgbwbs01]
$ sudo ufw allow from 172.16.177.50 to any port 80 proto tcp
#   from IP   only allow inbound packets from this source address.
#   to any port 80    destination port 80 on any local interface.
#   proto tcp         TCP only. The DMZ proxy uses HTTP/1.1; UDP isn't relevant.

$ sudo ufw status verbose
# Expected:
#   80/tcp ALLOW IN from 172.16.177.50
#   (no public 80 rule, no 443 rule)
# Plus the SSH ALLOW from 01 §1.6 — verify that's still there.
```

> **ℹ Defence in depth**
>
> The per-app server block in §6.3 also has `allow 172.16.177.50; deny all;` at the nginx layer. UFW + nginx both enforce the same source pin; either one alone would be sufficient, but having both means a misconfiguration of one doesn't expose the App VM. Don't simplify by dropping one.

### 6.3 The Nginx server config

The App VM's nginx is a **multi-tenant reverse proxy** — it can host more than one docker app, each on its own port and `server_name`. Greenbook is the worked example throughout this chapter; if a second AU app later runs on the same App VM (e.g., `report-builder.africanunion.org` on `127.0.0.1:3001`), it onboards via [§6.5](#65-adding-a-second-app-on-the-app-vm) — three commands plus one edited per-app config file. The shape of the App VM's nginx mirrors the DMZ proxy in [chapter 12](12-dmz-reverse-proxy.md): shared `http {}` config + shared snippets + one `sites-available/<app>.conf` per backend.

Three layers of config to install (under [`appendix/app-vm/`](appendix/app-vm/)):

| File                                                                                         | Lives at                                          | Purpose                                                                      |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`appendix/app-vm/00-app-vm-shared.conf`](appendix/app-vm/00-app-vm-shared.conf)             | `/etc/nginx/conf.d/00-app-vm-shared.conf`         | WebSocket upgrade `map`, shared rate-limit zones (`app_general`, `app_auth`) |
| [`appendix/app-vm/app-vm-proxy-headers.conf`](appendix/app-vm/app-vm-proxy-headers.conf)     | `/etc/nginx/snippets/app-vm-proxy-headers.conf`   | Shared `proxy_set_header` block + timeouts + buffering policy                |
| [`appendix/app-vm/greenbook-cache-policy.conf`](appendix/app-vm/greenbook-cache-policy.conf) | `/etc/nginx/snippets/greenbook-cache-policy.conf` | Greenbook PWA-specific routing (`/sw.js`, `/assets/*`, `/manifest.json`)     |
| [`appendix/app-vm/greenbook.conf`](appendix/app-vm/greenbook.conf)                           | `/etc/nginx/sites-available/greenbook.conf`       | Per-app server block — one of N (greenbook today; future apps in §6.5)       |

Rationale: shared concerns (rate-limit zones, proxy headers, WebSocket map) live in one place so a second app onboarding doesn't have to copy/paste them. Per-app concerns (cache policy for `/assets/*`, framework-specific URL patterns, the upstream port) stay in each app's own files.

Two hops for every `scp` of these files because `/etc/nginx/{conf.d,snippets,sites-available}/` are root-owned and the `deployer` account is intentionally no-sudo (per [09 §9.1](09-hardening-checklist.md#91-operating-system)). Use your personal sudo-capable admin account on the App VM — `greenbook` in the AU's setup; substitute your own.

#### 6.3.1 Install the shared App VM nginx configs

Two files, installed once. Every per-app server block inherits them implicitly via nginx's `conf.d/*.conf` auto-load and `include` mechanisms.

```bash
# (a) From your laptop:
$ scp docs/deployment/appendix/app-vm/00-app-vm-shared.conf \
      docs/deployment/appendix/app-vm/app-vm-proxy-headers.conf \
      greenbook@10.111.11.51:~/

# (b) On the App VM as your admin account:
$ ssh greenbook@10.111.11.51

# [auishqosrgbwbs01]
$ sudo install -m 644 -o root -g root \
    ~/00-app-vm-shared.conf /etc/nginx/conf.d/00-app-vm-shared.conf
$ sudo install -d -m 755 /etc/nginx/snippets
$ sudo install -m 644 -o root -g root \
    ~/app-vm-proxy-headers.conf /etc/nginx/snippets/app-vm-proxy-headers.conf
$ rm ~/00-app-vm-shared.conf ~/app-vm-proxy-headers.conf
```

Don't reload nginx yet — there's no per-app server block referencing these zones. The reload happens at the end of §6.3.2.

#### 6.3.2 Add greenbook as the first proxied app

Two more files: greenbook's per-app cache snippet and greenbook's server block.

```bash
# (a) From your laptop:
$ scp docs/deployment/appendix/app-vm/greenbook-cache-policy.conf \
      docs/deployment/appendix/app-vm/greenbook.conf \
      greenbook@10.111.11.51:~/

# (b) On the App VM:
$ ssh greenbook@10.111.11.51

# [auishqosrgbwbs01]
$ sudo install -m 644 -o root -g root \
    ~/greenbook-cache-policy.conf \
    /etc/nginx/snippets/greenbook-cache-policy.conf

$ sudo install -m 644 -o root -g root \
    ~/greenbook.conf \
    /etc/nginx/sites-available/greenbook.conf

$ sudo ln -sf /etc/nginx/sites-available/greenbook.conf \
              /etc/nginx/sites-enabled/greenbook.conf
$ sudo rm -f /etc/nginx/sites-enabled/default

$ rm ~/greenbook-cache-policy.conf ~/greenbook.conf
```

The full annotated content of the per-app `greenbook.conf` (also in [`appendix/app-vm/greenbook.conf`](appendix/app-vm/greenbook.conf)):

```nginx
# /etc/nginx/sites-available/greenbook.conf  (App VM, two-tier inner)
# Plain HTTP listen on :80 from 172.16.177.50 (the DMZ VM) only.
# No TLS — that's the DMZ's job (chapter 12).
# Inherits from /etc/nginx/conf.d/00-app-vm-shared.conf (WebSocket map +
# rate-limit zones) and /etc/nginx/snippets/{app-vm-proxy-headers,
# greenbook-cache-policy}.conf — don't duplicate those concerns here.

upstream greenbook_app {
    server 127.0.0.1:3000;     # Loopback to the docker container.
    keepalive 32;
}

# Trust X-Forwarded-* headers from the DMZ VM. nginx rewrites $remote_addr
# to the real client IP for logging + rate-limit keying; without this,
# every request looks like it came from 172.16.177.50.
set_real_ip_from 172.16.177.50;
real_ip_header   X-Forwarded-For;
real_ip_recursive on;

server {
    listen      80;
    listen      [::]:80;
    server_name greenbook.africanunion.org;

    # Belt-and-braces over UFW (§6.2). Either layer alone would block
    # non-DMZ traffic; both layers means a misconfiguration of one
    # doesn't expose the App VM.
    allow 172.16.177.50;
    deny  all;

    client_max_body_size 20m;
    access_log /var/log/nginx/greenbook.access.log;
    error_log  /var/log/nginx/greenbook.error.log warn;

    # Greenbook PWA-specific cache routing (sw.js / /assets/ / /manifest.json).
    include /etc/nginx/snippets/greenbook-cache-policy.conf;

    # Auth-strict rate limit on credential / SSO endpoints. Stacks with
    # the DMZ's edge_auth zone — defence in depth.
    location ~ ^/(login|forgot-password|api/auth|api/sso) {
        limit_req zone=app_auth burst=20 nodelay;
        proxy_pass http://greenbook_app;
        include /etc/nginx/snippets/app-vm-proxy-headers.conf;
        proxy_buffering         off;
        proxy_request_buffering on;
    }

    # Catch-all → docker container (SSR + SSE + API). Streaming-aware
    # buffering (off) per-location, NOT in the shared snippet — see the
    # NOTE in app-vm-proxy-headers.conf for why.
    location / {
        limit_req zone=app_general burst=200 nodelay;
        proxy_pass http://greenbook_app;
        include /etc/nginx/snippets/app-vm-proxy-headers.conf;
        proxy_buffering         off;
        proxy_request_buffering on;
    }
}
```

The four files (`00-app-vm-shared.conf`, `app-vm-proxy-headers.conf`, `greenbook-cache-policy.conf`, and `greenbook.conf`) live in [`appendix/app-vm/`](appendix/app-vm/) — that's the canonical scp-able source.

Test the config and reload:

```bash
# [auishqosrgbwbs01]
$ sudo nginx -t
#   -t              test the config for syntax errors. Do NOT skip this.
# Expected: "syntax is ok" and "test is successful". Any other output
# means fix the error before reloading.

$ sudo systemctl reload nginx
#   reload          graceful — SIGHUP. Nginx starts new workers with the
#                   new config and retires the old ones as they finish
#                   current requests. No dropped connections.
```

> **ℹ The App VM nginx is a partial system until the DMZ tier is up**
>
> A request to `greenbook.africanunion.org` ends at the DMZ VM (where TLS terminates and the public DNS record points). Until [chapter 12](12-dmz-reverse-proxy.md) is brought up, no public traffic reaches the App VM at all. You can verify the App VM nginx in isolation via loopback ([§6.4](#64-test-the-app-vm-nginx)) — that's enough to confirm the bring-up succeeded; end-to-end public traffic is gated on chapter 12 + AU IT publishing the public DNS record.

### 6.4 Test the App VM nginx

The App VM is unreachable from the public internet by design — there's no public DNS record pointing at it, no public IP exposure, and UFW + nginx both pin :80 to the DMZ source IP. So bare `curl https://greenbook.africanunion.org/` from a laptop will fail with `Could not resolve host` (and even from the AU LAN it would only resolve if AU IT has an internal DNS record). That's expected at this stage.

Verify the App VM nginx in isolation via loopback or LAN-direct, bypassing DNS:

```bash
# (a) From the App VM itself — loopback. nginx terminates on :80, so use
#     plain HTTP. The --resolve flag is what bypasses DNS; --connect-to
#     would also work. SNI is not relevant on plain HTTP.
# [auishqosrgbwbs01]
$ curl -I --resolve greenbook.africanunion.org:80:127.0.0.1 \
    http://greenbook.africanunion.org/
# Expected: HTTP/1.1 200 OK and Express-flavoured response headers
# (server: nginx, x-correlation-id, x-powered-by: Express, ratelimit-*).
# 403 Forbidden = the allow/deny block in greenbook.conf is rejecting
# loopback. Add `allow 127.0.0.1;` above `allow 172.16.177.50;` if you
# want loopback testing to work without the --resolve trick.

# (b) From any host on the AU LAN that can reach 10.111.11.51 (e.g. the
#     DMZ VM during bring-up) — same idea, via the App VM's LAN IP.
# [from DMZ VM or any LAN host]
$ curl -I --resolve greenbook.africanunion.org:80:10.111.11.51 \
    -H 'X-Forwarded-For: 1.2.3.4' \
    http://greenbook.africanunion.org/
# X-Forwarded-For simulates what the DMZ proxy will set in production.
# Without it, `set_real_ip_from` in greenbook.conf has nothing to
# overwrite $remote_addr with — the test still works, just doesn't
# exercise the real-IP path.
```

End-to-end testing (real client over HTTPS via the public hostname) belongs to chapter 12 once the DMZ tier is up; the App VM in isolation can only verify that nginx + the docker container are wired correctly.

### 6.5 Adding a second app on the App VM

When a second AU app onboards on the same App VM, the work collapses to **three commands plus one edited per-app config file**. The shared configs (`/etc/nginx/conf.d/00-app-vm-shared.conf`, `/etc/nginx/snippets/app-vm-proxy-headers.conf`) are already in place from greenbook's onboarding (§6.3.1) and are reused as-is — no edits.

> **ℹ App VM built against an earlier version of this guide?**
>
> Check `ls /etc/nginx/conf.d/00-app-vm-shared.conf` AND `grep -l 'listen 443' /etc/nginx/sites-enabled/*.conf`. If the shared file is missing OR any site-block still has `listen 443`, your App VM is still in the legacy single-tier shape. Run [§6.6](#66-migrating-a-legacy-single-tier-app-vm) **first** — adding a second app on top of either a monolithic config or a TLS-terminating App VM will fail at `nginx -t` (duplicate zones) or break the trust model (TLS in two places).

For an app whose docker container exposes its loopback port at `127.0.0.1:Y` (a different port from greenbook's `:3000`), reachable as `<app>.africanunion.org`:

```bash
# [auishqosrgbwbs01]

# (1) Copy greenbook.conf to <app>.conf as the template:
$ sudo cp /etc/nginx/sites-available/greenbook.conf \
          /etc/nginx/sites-available/<app>.conf

# (2) Edit the per-app lines. Review by hand — sed alone may not catch
#     every place to update.
$ sudo $EDITOR /etc/nginx/sites-available/<app>.conf
# Change:
#   server_name greenbook.africanunion.org;
#   → server_name <app>.africanunion.org;
#
#   upstream greenbook_app { server 127.0.0.1:3000; ... }
#   → upstream <app>_app   { server 127.0.0.1:Y;    ... }
#   And every proxy_pass http://greenbook_app   →   http://<app>_app
#
#   access_log /var/log/nginx/greenbook.access.log;
#   error_log  /var/log/nginx/greenbook.error.log warn;
#   → access_log /var/log/nginx/<app>.access.log;
#   → error_log  /var/log/nginx/<app>.error.log warn;
#
# Drop the `include /etc/nginx/snippets/greenbook-cache-policy.conf;`
# line if the new app isn't a React Router 7 PWA. Replace with the
# new app's own cache snippet if it has one (see §6.3 — per-app cache
# concerns are framework-specific).
#
# Adjust the auth-strict location regex (^/(login|forgot-password|api/auth|api/sso))
# to the new app's actual auth route paths. Keep the catch-all
# `location /` block unchanged — every app needs it.
#
# Don't touch: `set_real_ip_from 172.16.177.50;`, `allow 172.16.177.50;`,
# `deny all;` — these are infrastructure, not per-app concerns. Same
# DMZ source for every app; same trust pin for every app.

# (3) Symlink, test, reload:
$ sudo ln -sf /etc/nginx/sites-available/<app>.conf \
              /etc/nginx/sites-enabled/<app>.conf
$ sudo nginx -t
$ sudo systemctl reload nginx
```

The new app inherits the shared rate-limit zones (`app_general`, `app_auth`), the shared proxy-header / timeout / streaming policy (via `include /etc/nginx/snippets/app-vm-proxy-headers.conf`), and the WebSocket upgrade map — all defined once in §6.3.1, no duplication. Onboarding a second app does not disturb anything already running for greenbook.

> **ℹ Don't forget the DMZ side**
>
> Every new App VM app also needs a per-app server block on the DMZ — that's where TLS terminates, the public hostname is routed, and the wildcard cert serves traffic. See [12 §12.7](12-dmz-reverse-proxy.md#127-adding-future-apps-behind-the-same-proxy). Order: App VM block first (this section), then DMZ block. The wildcard cert at `*.africanunion.org` already covers any new hostname under the apex, so no new cert work — just a public DNS A / CNAME record from AU IT and a new `<app>.conf` on the DMZ VM.

### 6.6 Migrating a legacy single-tier App VM

If your App VM was set up against an earlier version of this guide and currently terminates TLS itself (single-tier shape), this section converts it to the two-tier inner shape this chapter now documents. Two flavours of legacy are covered:

- **Monolithic-with-TLS**: a single `/etc/nginx/sites-available/greenbook.conf` containing everything inlined (rate-limit zones, WebSocket map, proxy headers, cache rules, HTTPS server block, security headers, ssl_certificate paths). One file, ~210 lines.
- **Split-with-TLS**: the multi-file shape with a shared `00-app-vm-shared.conf` + snippets, but the per-app `greenbook.conf` still has the HTTPS server block, security headers, and cert paths. This is what AU has right now after the most recent file-split migration.

Both end at the same destination — the App VM listening on plain HTTP from the DMZ source IP only, with TLS, security headers, and the wildcard cert all moved to the DMZ tier ([chapter 12](12-dmz-reverse-proxy.md)).

> **⚠ Bring up chapter 12 FIRST**
>
> This migration drops TLS from the App VM. If chapter 12 (the DMZ tier) isn't up yet — or if AU IT hasn't pointed public DNS for `greenbook.africanunion.org` at the DMZ VM's public IP — running this migration breaks public access. Order:
>
> 1. Complete [chapter 12 §12.1–§12.7](12-dmz-reverse-proxy.md) (DMZ VM provisioned, cert installed at `/etc/ssl/au/`, edge nginx serving).
> 2. Coordinate the DNS cutover with AU IT — public A record for `greenbook.africanunion.org` flips from the App VM's public IP (or NAT) to the DMZ VM's public IP.
> 3. Verify the DMZ is serving end-to-end via the new DNS or `--resolve` to the DMZ public IP.
> 4. **Then** run this migration to drop TLS from the App VM.

The migration is mostly an atomic file swap; the trailing UFW + env + cert-removal steps cement the cut.

```bash
# (a) From your laptop — scp the four new files in one shot. These files
#     ship the HTTP-only inner-tier shape: no HTTPS block, no security
#     headers, no ssl_certificate paths, source-pinned to 172.16.177.50.
$ scp docs/deployment/appendix/app-vm/00-app-vm-shared.conf \
      docs/deployment/appendix/app-vm/app-vm-proxy-headers.conf \
      docs/deployment/appendix/app-vm/greenbook-cache-policy.conf \
      docs/deployment/appendix/app-vm/greenbook.conf \
      greenbook@10.111.11.51:~/

# (b) On the App VM as your admin account:
$ ssh greenbook@10.111.11.51

# Sanity checks BEFORE the swap. Confirm the upstream port hasn't been
# customised — if it has, edit ~/greenbook.conf to match before installing.
# [auishqosrgbwbs01]
$ sudo grep "server 127" /etc/nginx/sites-available/greenbook.conf
# Old (live). Note the upstream port (e.g. 127.0.0.1:3000).

$ grep "server 127" ~/greenbook.conf
# New (staged). Must match the old. Edit ~/greenbook.conf if they don't
# before proceeding.

# (c) Atomic install — all four files. The new greenbook.conf has NO
#     inline zones/map/headers AND no HTTPS server block. After this
#     install nginx -t will see exactly one definition of each shared
#     directive (no duplicates), and no ssl_certificate references at all.
$ sudo install -m 644 -o root -g root \
    ~/00-app-vm-shared.conf /etc/nginx/conf.d/00-app-vm-shared.conf

$ sudo install -d -m 755 /etc/nginx/snippets
$ sudo install -m 644 -o root -g root \
    ~/app-vm-proxy-headers.conf /etc/nginx/snippets/app-vm-proxy-headers.conf
$ sudo install -m 644 -o root -g root \
    ~/greenbook-cache-policy.conf /etc/nginx/snippets/greenbook-cache-policy.conf

$ sudo install -m 644 -o root -g root \
    ~/greenbook.conf /etc/nginx/sites-available/greenbook.conf
#   ↑ Overwrites the previous (single-tier) version. The symlink in
#     /etc/nginx/sites-enabled/greenbook.conf already points at this path
#     from the original bring-up, so no symlink work needed.

$ rm ~/00-app-vm-shared.conf ~/app-vm-proxy-headers.conf \
     ~/greenbook-cache-policy.conf ~/greenbook.conf

# (d) UFW: revoke public 80/443, add a single source-pinned :80 rule.
$ sudo ufw delete allow 'Nginx Full'
#   Removes the public 80/443 rule from the original §6.2 (single-tier
#   version). If your VM had explicit `ufw allow 80/tcp` and
#   `ufw allow 443/tcp` rules instead, delete those too.

$ sudo ufw allow from 172.16.177.50 to any port 80 proto tcp
$ sudo ufw status verbose
# Expected:
#   80/tcp ALLOW IN from 172.16.177.50
#   (no public 80 / 443 rules anymore)

# (e) Test + reload nginx:
$ sudo nginx -t
# Expected: "syntax is ok" / "test is successful".
#
# Failure mode 1 — "duplicate zone" / "duplicate map":
#   An old greenbook.conf still has inline `limit_req_zone` or
#   `map $http_upgrade` definitions. Re-run step (c) for greenbook.conf
#   only and verify the new file actually overwrote the monolithic one.
#
# Failure mode 2 — "<directive> directive is duplicate" (e.g.
# proxy_buffering, proxy_set_header, expires):
#   Your /etc/nginx/snippets/ files predate commit 83a91a6 (which moved
#   proxy_buffering out of the shared snippet). Re-fetch and reinstall
#   the three affected files (`git pull` + scp + `install` of
#   app-vm-proxy-headers.conf, greenbook-cache-policy.conf, greenbook.conf).

$ sudo systemctl reload nginx
# Graceful — SIGHUP. Existing connections continue on old workers; new
# connections land on the workers loaded with the HTTP-only config.

# (f) Bump TRUSTED_PROXIES in /etc/greenbook.env from 1 to 2. The
#     Express layer (server/app.ts) reads this to set `app.set("trust
#     proxy", N)`. With the DMZ in front there are now TWO trusted
#     proxies between the client and Express (DMZ nginx → App VM nginx).
#     Without the bump, Express trusts only the App VM nginx and treats
#     the DMZ VM's IP as the client — breaking rate limiting that keys
#     on req.ip.
$ sudo sed -i 's/^TRUSTED_PROXIES=1$/TRUSTED_PROXIES=2/' /etc/greenbook.env
$ sudo grep '^TRUSTED_PROXIES=' /etc/greenbook.env
# Expected: TRUSTED_PROXIES=2
# If the line doesn't exist, add it: echo 'TRUSTED_PROXIES=2' | sudo tee -a /etc/greenbook.env

# (g) Recreate the container to pick up the env-file change. docker
#     compose only reads env_file at container START — `up -d` alone
#     won't reload it, you need --force-recreate.
$ sudo -u deployer docker compose \
    -f /opt/greenbook/docker-compose.yml \
    up -d --force-recreate
# Wait for the container to come back healthy:
$ sudo -u deployer docker compose \
    -f /opt/greenbook/docker-compose.yml ps
# Expected: greenbook  Up (healthy)

# (h) Remove the wildcard cert from the App VM. The DMZ now holds the
#     only copy in production — fewer copies of secret material to rotate
#     when the cert renews next year. Don't run this step until you've
#     verified the Mac-side backup tarball (step g.5) AND the DMZ is
#     serving end-to-end (12 §12.9). Once those two are green, the App
#     VM's copy is redundant.
$ sudo rm -rf /etc/ssl/greenbook
# Done. The App VM has no cert, no PFX, no key on disk.

# (i) Spot-check via the App VM nginx — bypass DNS, hit loopback:
$ curl -I --resolve greenbook.africanunion.org:80:127.0.0.1 \
    http://greenbook.africanunion.org/
# Expected: HTTP/1.1 200 OK from nginx, with x-correlation-id and
# x-powered-by: Express (proves nginx → docker hand-off works).
# 403 Forbidden = the allow/deny in greenbook.conf is rejecting
# loopback (expected if you didn't add `allow 127.0.0.1;`).

# (j) Verify end-to-end through the DMZ — bypass DNS, hit DMZ public IP:
$ curl -I --resolve greenbook.africanunion.org:443:196.188.248.25 \
    https://greenbook.africanunion.org/
# Expected: HTTP/2 200 with strict-transport-security and the four
# security headers — now set at the DMZ tier, not here. The hop count in
# x-forwarded-for should reflect both proxies (DMZ → App VM → Express).
```

> **ℹ Rollback**
>
> Rolling back from two-tier to single-tier requires undoing all of (c)–(h): restore the previous `greenbook.conf` from git, re-add public 80/443 to UFW, set `TRUSTED_PROXIES=1`, recreate the container, restore `/etc/ssl/greenbook/` (re-run [12 §12.4](12-dmz-reverse-proxy.md#124-install-the-au-wildcard-certificate) against the PFX or restore from the Mac-side backup tarball), point public DNS back at the App VM. This is genuinely involved — much easier to fix forward by debugging the DMZ tier than to roll back. Ensure the DMZ is verified green ([chapter 12 §12.9](12-dmz-reverse-proxy.md#129-test-the-tls-deployment)) before running this migration so rollback never becomes necessary.

---
