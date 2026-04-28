# 06 — Nginx and TLS

> **Phase**: bring-up · **Run on**: App VM (`auishqosrgbwbs01`) · **Time**: ~45 min
>
> Host-installed Nginx terminating TLS on 443 and reverse-proxying to the container at `127.0.0.1:3000`. Tuned for React Router 7's streaming SSR + SSE (`proxy_buffering off`, long `proxy_read_timeout`), greenbook's PWA service worker (short cache on `/sw.js`, immutable on `/assets/*`), and correlation-ID forwarding. Three TLS paths: Let's Encrypt HTTP-01, Let's Encrypt DNS-01, and an internal CA for air-gapped intranet.
>
> **Prev**: [05 — Application container](05-app-vm-container.md) · **Next**: [07 — Deploy workflow](07-deploy-workflow.md) · **Index**: [README](README.md)

---

## Contents

- [§7.1 Install Nginx](#71-install-nginx)
- [§7.2 Open ports 80 and 443 in UFW](#72-open-ports-80-and-443-in-ufw)
- [§7.3 The Nginx server config](#73-the-nginx-server-config)
- [§7.4 TLS with Let's Encrypt (public internet or public DNS)](#74-tls-with-lets-encrypt-public-internet-or-public-dns)
  - [§7.4.1 HTTP-01 validation (VM reachable on public internet, port 80)](#741-http-01-validation-vm-reachable-on-public-internet-port-80)
  - [§7.4.2 DNS-01 validation (VM not publicly reachable but has public DNS)](#742-dns-01-validation-vm-not-publicly-reachable-but-has-public-dns)
- [§7.5 Test the TLS deployment](#75-test-the-tls-deployment)
- [§7.6 Using an internal CA instead of Let's Encrypt](#76-using-an-internal-ca-instead-of-lets-encrypt)
- [§7.7 Using a pre-purchased commercial certificate](#77-using-a-pre-purchased-commercial-certificate)
  - [§7.7.1 Generate the CSR on the VM](#771-generate-the-csr-on-the-vm)
  - [§7.7.2 Install the issued certificate (PEM bundle delivery)](#772-install-the-issued-certificate-pem-bundle-delivery)
  - [§7.7.3 Install the wildcard certificate from a .pfx / .p12 bundle (AU's actual path)](#773-install-the-wildcard-certificate-from-a-pfx--p12-bundle-aus-actual-path)
  - [§7.7.4 Point Nginx at the new files](#774-point-nginx-at-the-new-files)
  - [§7.7.5 Renewal](#775-renewal)

## 7. Nginx and TLS

Nginx sits on the host (not in a container) and terminates TLS on port 443. It forwards decrypted HTTP to the Node container at 127.0.0.1:3000 and adds security headers. Putting Nginx on the host (not in a container) keeps TLS certificates on the host filesystem, makes Certbot integration straightforward, and lets Nginx survive app container restarts.

### 7.1 Install Nginx

```bash
# [auishqosrgbwbs01]
$ sudo apt install -y nginx
#   Ubuntu 24.04 ships nginx 1.24 in the standard repo. That version is
#   used throughout this document; the HTTP/2 syntax we use (see §7.3)
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

### 7.2 Open ports 80 and 443 in UFW

```bash
# [auishqosrgbwbs01]
$ sudo ufw allow 'Nginx Full'
#   'Nginx Full'      a built-in UFW application profile (created by the
#                     nginx package) that opens 80/tcp AND 443/tcp in one
#                     rule. Equivalent to two explicit "ufw allow 80/tcp"
#                     and "ufw allow 443/tcp" lines.

$ sudo ufw status verbose
# Expected: entries for 80/tcp AND 443/tcp (IPv4 and IPv6).
```

### 7.3 The Nginx server config

Replace the default Nginx site with a config that proxies to the greenbook container. The canonical source is shipped as a standalone file in [appendix/greenbook.conf](appendix/greenbook.conf) — copy it to the app VM in **two hops**, because `/etc/nginx/sites-available/` is root-owned (so scp can't write there directly) AND `deployer` is intentionally no-sudo per [09 §11.1](09-hardening-checklist.md#111-operating-system). Use your personal sudo-capable admin account instead — `greenbook` in the AU's setup; substitute your own VM admin username:

```bash
# (a) From your laptop, with this repo cloned — scp into the admin
#     account's home directory (NOT deployer's):
$ scp docs/deployment/appendix/greenbook.conf \
      greenbook@10.111.11.51:~/greenbook.conf

# (b) SSH in as the same admin account and install with sudo:
$ ssh greenbook@10.111.11.51

# [auishqosrgbwbs01]
$ sudo install -m 644 -o root -g root \
    ~/greenbook.conf \
    /etc/nginx/sites-available/greenbook.conf
$ rm ~/greenbook.conf
#   install -m 644 -o root -g root  cp + chown + chmod atomically.
#                                    /etc/nginx/sites-available/ contents
#                                    are root:root 644 by Ubuntu convention.
```

The full annotated content (also in the appendix file):

```
# /etc/nginx/sites-available/greenbook.conf
# Nginx reverse-proxy for the greenbook container.

# ----- Upstream definition ---------------------------------------------------
upstream greenbook_upstream {
    server 127.0.0.1:3000;
    #  Where Nginx forwards requests. 127.0.0.1:3000 is the host-side
    #  mapping of the container's :3000 (see 07 §8.2.3 ports: line).

    keepalive 32;
    #  Maintain up to 32 idle TCP connections to the backend, avoiding the
    #  cost of a fresh connection on every request. Works with the
    #  proxy_http_version 1.1 + Connection "" settings below.
}

# ----- Rate limiting at the edge (defence in depth) -------------------------
# Greenbook has its own rate limiter at the Express layer (server/security.ts,
# three tiers). The nginx-level limits below run BEFORE that and protect the
# Node process from floods — Express can't rate-limit a request it never gets.
# Zones are cheap (1 MB ~= 16k tracked IPs). Tune burst to match your public
# traffic profile.
limit_req_zone $binary_remote_addr zone=greenbook_general:10m rate=30r/s;
limit_req_zone $binary_remote_addr zone=greenbook_auth:1m    rate=5r/s;

# ----- WebSocket support -----------------------------------------------------
# Build a "Connection" header value based on whether the client asked to
# upgrade. For non-WebSocket requests this becomes empty, which is exactly
# what keepalive needs.
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      '';
}

# ----- HTTP server: redirects to HTTPS + ACME challenge ---------------------
server {
    listen      80;
    listen      [::]:80;
    server_name greenbook.africanunion.org;

    # Serve Certbot's ACME HTTP-01 challenge files on port 80.
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Everything else: 301-redirect to HTTPS.
    location / {
        return 301 https://$host$request_uri;
    }
}

# ----- HTTPS server ---------------------------------------------------------
server {
    listen      443 ssl http2;
    listen      [::]:443 ssl http2;
    #  "listen 443 ssl http2" — the form that works on BOTH nginx 1.24 (which
    #  Ubuntu 24.04 ships) and nginx 1.25.1+ (from the upstream Nginx repo).
    #  On 1.25+ it prints a deprecation warning; on 1.24 it is the ONLY
    #  syntax that enables HTTP/2. The standalone "http2 on;" directive
    #  only exists from 1.25.1 and would break the config on 1.24.

    server_name greenbook.africanunion.org;

    # Certbot will fill in certificate paths here. Placeholders shown below.
    ssl_certificate     /etc/letsencrypt/live/greenbook.africanunion.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/greenbook.africanunion.org/privkey.pem;

    # Modern TLS configuration (see Mozilla's "intermediate" profile).
    ssl_protocols         TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    # TLS 1.3 cipher order is client-preference by design; TLS 1.2 server-
    # preference doesn't matter once you have the protocol floor at 1.2.

    ssl_session_cache     shared:SSL:10m;
    #  Shared SSL cache: stores session tickets so clients can resume a TLS
    #  session without a full handshake. 10 MB holds ~40,000 sessions.
    ssl_session_timeout   1d;
    ssl_session_tickets   off;
    # Session tickets off = forward secrecy is preserved even if a ticket key
    # leaks. Trade-off: slightly slower reconnects. Worth it for a server app.

    # OCSP stapling: Nginx periodically fetches the CA's revocation response
    # and attaches it to the TLS handshake, so clients don't need to contact
    # the CA separately.
    ssl_stapling        on;
    ssl_stapling_verify on;
    resolver            1.1.1.1 9.9.9.9 valid=300s;
    resolver_timeout    5s;
    # resolver is required for OCSP fetches (Nginx needs DNS to find the CA
    # URL). 1.1.1.1 and 9.9.9.9 are public resolvers; replace with the AU's
    # internal recursive resolvers if required by policy.

    # ----- Security headers ----------------------------------------------
    add_header Strict-Transport-Security  "max-age=31536000; includeSubDomains" always;
    #  HSTS: tell browsers to refuse plain HTTP for this host for 1 year.
    #  'always' ensures the header is sent even on error responses.
    add_header X-Content-Type-Options     "nosniff"                               always;
    #  Prevents the browser from overriding Content-Type via MIME sniffing.
    add_header X-Frame-Options            "DENY"                                  always;
    #  Disallows being embedded in <iframe>. Combined with CSP frame-ancestors
    #  if your CSP is strict enough.
    add_header Referrer-Policy            "strict-origin-when-cross-origin"       always;
    #  Sends the full referrer on same-origin, only the origin cross-origin.

    # ----- Upload size ---------------------------------------------------
    client_max_body_size 20m;
    # Bigger than default (1 MB). Adjust to the largest legitimate upload
    # your app accepts. This is the WIRE size, before body parsing.

    # ----- Access / error logs ------------------------------------------
    access_log /var/log/nginx/greenbook.access.log;
    error_log  /var/log/nginx/greenbook.error.log warn;
    # Per-vhost logs keep /var/log/nginx/access.log clean for default traffic.

    # ----- Greenbook service worker: short cache, never stale --------
    # sw.js is special — browsers fetch it on every pageview to check for
    # updates. Long cache would strand users on an old version. The origin
    # (/public/sw.js at build time) has no cache headers, so nginx sets them.
    location = /sw.js {
        proxy_pass            http://greenbook_upstream;
        proxy_set_header      Host              $host;
        proxy_set_header      X-Real-IP         $remote_addr;
        proxy_set_header      X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header      X-Forwarded-Proto $scheme;
        proxy_set_header      X-Forwarded-Host  $host;
        add_header Cache-Control "public, max-age=0, must-revalidate" always;
        # max-age=0 + must-revalidate = "check for updates on every pageview
        # but allow serving stale bytes while revalidating". Matches the
        # browser-side SW update check greenbook does in app/utils/offline/.
    }

    # ----- Long-cache immutable assets (hashed filenames) -----------
    # React Router emits client assets with content-hashed filenames
    # (e.g. /assets/entry.client-abc123.js). They never change for a given
    # hash, so we can cache them for a year. Greenbook's server.js already
    # sets this via express.static; the nginx rule below reinforces it so
    # CDNs and intermediary caches see it even if the origin ever loses it.
    location ^~ /assets/ {
        proxy_pass            http://greenbook_upstream;
        proxy_set_header      Host              $host;
        proxy_set_header      X-Real-IP         $remote_addr;
        proxy_set_header      X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header      X-Forwarded-Proto $scheme;
        proxy_set_header      X-Forwarded-Host  $host;
        proxy_buffering       on;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        expires                1y;
    }

    # ----- Manifest + robots — short cache OK ----------------------
    location = /manifest.json {
        proxy_pass            http://greenbook_upstream;
        proxy_set_header      Host              $host;
        proxy_set_header      X-Real-IP         $remote_addr;
        proxy_set_header      X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header      X-Forwarded-Proto $scheme;
        add_header Cache-Control "public, max-age=3600" always;
    }

    # ----- Reverse proxy to the Node container (SSR + SSE + API) ------
    location / {
        proxy_pass         http://greenbook_upstream;
        #  Forward to the upstream block defined above.

        proxy_http_version 1.1;
        #  Required for keepalive to the backend. Default is 1.0 which
        #  closes after each request.
        proxy_set_header   Connection         $connection_upgrade;
        #  For SSE / WebSocket requests, passes "upgrade"; otherwise empty.

        # Forward standard headers the backend needs to know who the client is.
        # greenbook's server/app.ts has `app.set("trust proxy", 1)` which
        # means "trust exactly one upstream proxy's X-Forwarded-For". Keep
        # that hop count in sync: if a WAF or ingress LB sits IN FRONT OF
        # nginx, change the trust-proxy value to the total hop count or the
        # rate limiter will key on nginx's IP for every request.
        proxy_set_header   Host               $host;
        proxy_set_header   X-Real-IP          $remote_addr;
        proxy_set_header   X-Forwarded-For    $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto  $scheme;
        proxy_set_header   X-Forwarded-Host   $host;
        proxy_set_header   Upgrade            $http_upgrade;
        proxy_set_header   X-Correlation-Id   $http_x_correlation_id;
        # Forward any client-supplied correlation ID; if absent, greenbook's
        # correlationMiddleware (server/correlation.js) generates one and
        # echoes it back on the response.

        # Timeouts — allow slow streaming SSR but don't hang forever.
        # SSE connections can legitimately stay open; we cap at 1 hour via
        # proxy_read_timeout to recycle idle connections.
        proxy_connect_timeout 10s;
        proxy_send_timeout    60s;
        proxy_read_timeout    3600s;

        proxy_buffering off;
        #  Two reasons greenbook needs buffering off:
        #    1. React Router 7 streams HTML (Suspense boundaries, deferred
        #       loaders); buffered responses delay time-to-first-byte.
        #    2. SSE (text/event-stream) MUST flush each event immediately;
        #       buffered SSE stalls the browser's EventSource indefinitely.
        # Static assets are handled by the /assets/ block above with
        # proxy_buffering on — they benefit from it.

        proxy_request_buffering on;
        # Inbound side CAN buffer — that actually helps for large form
        # posts, and doesn't interfere with streaming responses.
    }
}
```

Enable the site and remove the default:

```bash
# [auishqosrgbwbs01]
$ sudo ln -s /etc/nginx/sites-available/greenbook.conf /etc/nginx/sites-enabled/
#   ln -s SOURCE TARGET    create a symbolic link at TARGET pointing to SOURCE.
#   Nginx reads every file in sites-enabled/ as part of its config. The
#   two-directory pattern (available/enabled) lets you keep a site config
#   around without actually serving it — just delete the symlink to disable.

$ sudo rm /etc/nginx/sites-enabled/default
#   Removes the symlink to the default "welcome to nginx" site. The original
#   file in sites-available/ stays on disk in case you want it back.
```

Bootstrap a placeholder certificate. The HTTPS server block above references `ssl_certificate` files that Certbot creates in §7.4 — but `nginx -t` opens those files at config-test time and refuses the whole config if either is missing. That means the test (and any reload) fails BEFORE you ever get to run Certbot. Drop in a 1-day self-signed cert at the exact paths the config expects; Certbot overwrites both files on first run, so the placeholder is genuinely temporary.

```bash
# [auishqosrgbwbs01]
$ sudo mkdir -p /etc/letsencrypt/live/greenbook.africanunion.org

$ sudo openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/letsencrypt/live/greenbook.africanunion.org/privkey.pem \
    -out    /etc/letsencrypt/live/greenbook.africanunion.org/fullchain.pem \
    -subj   "/CN=greenbook.africanunion.org"
#   req -x509 -nodes    self-signed cert, no passphrase on the key.
#   -newkey rsa:2048    generate a fresh 2048-bit RSA key alongside the cert.
#                        The real Let's Encrypt cert in §7.4 may land as ECDSA
#                        — fine, nginx loads whichever algorithm the file holds.
#   -days 1             expires in 24 hours. Short on purpose: if you forget
#                        to run Certbot, browsers will scream loudly.
#   -subj "/CN=..."     non-interactive subject. Skips the DN prompts.

$ sudo chmod 600 /etc/letsencrypt/live/greenbook.africanunion.org/privkey.pem
#   Lock the placeholder key down to root-only — same mode Certbot uses
#   when it overwrites the file.
```

> **ℹ Expect an `"ssl_stapling" ignored, issuer certificate not found` warning**
>
> The next `nginx -t` will print that warning against the placeholder cert. It is benign and self-resolving: OCSP stapling needs the issuer's intermediate cert to fetch a revocation response, and a self-signed cert has no separate issuer. Nginx silently disables stapling for the placeholder and continues loading the config — that's why the test still ends in "syntax is ok / test is successful." Once Certbot installs the real Let's Encrypt chain in §7.4, OCSP stapling activates and the warning disappears.

> **ℹ Skip the snake-oil if you already have the AU's wildcard PFX on disk**
>
> The placeholder above exists because Let's Encrypt creates the cert files only AFTER `nginx -t` runs. If you're using the AU-procured wildcard certificate (§7.7) — delivered as `wildcard.africanunion.org.pfx` with a separately-supplied password — extract it now per [§7.7.3](#773-install-the-wildcard-certificate-from-a-pfx--p12-bundle-aus-actual-path) and change the two `ssl_certificate` paths in greenbook.conf to `/etc/ssl/greenbook/wildcard.africanunion.org.*` per [§7.7.4](#774-point-nginx-at-the-new-files). `nginx -t` then passes against the real cert directly, no snake-oil needed. The placeholder is only useful when cert acquisition (Certbot, an in-flight CSR) hasn't completed.

Test the config and reload:

```bash
# [auishqosrgbwbs01]
$ sudo nginx -t
#   -t              test the config for syntax errors. Do NOT skip this.
# Expected: "syntax is ok" and "test is successful". Any other output means
# fix the error before reloading.

$ sudo systemctl reload nginx
#   reload          graceful — SIGHUP. Nginx starts new workers with the new
#                   config and retires the old ones as they finish current
#                   requests. No dropped connections.
```

> **⚠ HTTPS will show a "not trusted" warning until Certbot runs**
>
> The placeholder cert above lets `nginx -t` pass and lets nginx start, but a browser visiting `https://greenbook.africanunion.org` will see a self-signed / "not trusted" warning until §7.4 issues the real Let's Encrypt cert. The HTTP site on port 80 works already (it 301-redirects to HTTPS, where the browser then warns). **Don't share the public URL with anyone before §7.4 completes.**

### 7.4 TLS with Let’s Encrypt (public internet or public DNS)

Let’s Encrypt issues free, automatically-renewing TLS certificates. It offers two validation methods: HTTP-01 (the default, used by certbot --nginx) and DNS-01 (for servers that are not reachable from the public internet). Which one you can use depends on how the VM is networked.

> **ℹ Which validation method applies to your deployment?**
>
> HTTP-01 requires that Let’s Encrypt’s servers can reach your VM over plain HTTP on port 80. That means (a) your public DNS record must resolve to a publicly-routable IP, and (b) port 80 on that IP must be open to the internet.
>
> If your VM has only an internal IP (e.g. 10.111.11.x) and your DNS record resolves to that internal IP, HTTP-01 WILL FAIL. Let's Encrypt's servers cannot reach 10.111.11.x (or any RFC 1918 private range) from the public internet regardless of how accessible port 80 is on the intranet.
>
> If your VM has an internal IP but the domain has PUBLIC DNS records (a common AU setup — public greenbook.africanunion.org record pointing at a publicly-routable IP that is routed to the VM via a NAT or reverse proxy), both methods can work.
>
> If your VM is air-gapped from the internet entirely, use an internal CA instead (§7.6).

#### 7.4.1 HTTP-01 validation (VM reachable on public internet, port 80)

Certbot is best installed from snap rather than apt. The apt version lags upstream and the snap version is the method officially recommended by Let’s Encrypt.

```bash
# [auishqosrgbwbs01]
$ sudo snap install core
$ sudo snap refresh core
#   snap install NAME    install a snap package. "core" is the snap runtime.
#   snap refresh NAME    update snap-managed packages.

$ sudo snap install --classic certbot
#   --classic            certbot needs to break out of snap's strict sandbox
#                         to write files under /etc/letsencrypt.

$ sudo ln -s /snap/bin/certbot /usr/bin/certbot
#   Put certbot on PATH under /usr/bin/ so bare "certbot" works without
#   qualifying /snap/bin/certbot.

$ certbot --version
# Expected: "certbot 3.x.x" (or newer).
```

Create the webroot that Nginx serves the ACME challenges from (the /.well-known/acme-challenge location in §7.3):

```bash
# [auishqosrgbwbs01]
$ sudo mkdir -p /var/www/certbot
$ sudo chown www-data:www-data /var/www/certbot
#   www-data    the user Nginx runs as on Ubuntu. Certbot will write challenge
#               files here that Nginx serves on plain HTTP.
```

```bash
# [auishqosrgbwbs01]
$ sudo certbot --nginx -d greenbook.africanunion.org \
  --email ops@africanunion.org --agree-tos --no-eff-email --redirect
#   --nginx              use the nginx plugin: certbot reads and edits the
#                         nginx config automatically.
#   -d DOMAIN             domain to certify. Repeat -d for multi-SAN certs.
#   --email ADDRESS       Let's Encrypt uses this for renewal failure notices.
#   --agree-tos           accept the Let's Encrypt subscriber agreement.
#   --no-eff-email        don't sign up for EFF newsletters.
#   --redirect            add an HTTP→HTTPS redirect if not present. (Ours
#                          already has one, so this is a no-op.)
# Runtime: 15-30 seconds. Certbot will write certificate files, edit
# /etc/nginx/sites-enabled/greenbook.conf to point at them, and reload nginx.

$ sudo certbot renew --dry-run
#   renew               test all installed certs can be renewed.
#   --dry-run           go through the motions against LE's staging server;
#                        nothing is persisted.
# Expected: "Congratulations, all simulated renewals succeeded".
```

The snap version of Certbot installs a systemd timer that attempts renewal twice per day — check with:

```bash
# [auishqosrgbwbs01]
$ sudo systemctl list-timers | grep -i certbot
# Expected: an active "snap.certbot.renew.timer" entry.
```

#### 7.4.2 DNS-01 validation (VM not publicly reachable but has public DNS)

DNS-01 works entirely over outbound HTTPS — Let’s Encrypt never contacts the VM. It validates the certificate request by checking a DNS TXT record, which your DNS provider’s API creates on the fly. This is the right choice when:

- The VM has only an internal IP (no public port 80 reachability).
- Your DNS records are public (resolvable on the internet) even if the target IPs are not.
- You need wildcard certificates (\*.africanunion.org) — HTTP-01 cannot issue wildcards; DNS-01 can.

Certbot ships DNS plugins for the major providers. Install the plugin for your DNS host:

```bash
# [auishqosrgbwbs01] — examples of DNS plugins; install only the one that matches your provider
$ sudo snap install certbot-dns-route53     # AWS Route 53
$ sudo snap install certbot-dns-cloudflare  # Cloudflare
$ sudo snap install certbot-dns-google      # Google Cloud DNS
$ sudo snap install certbot-dns-rfc2136     # generic RFC2136 (e.g. PowerDNS, BIND with TSIG)
# For other providers, see:  certbot plugins
```

Create a credentials file for the plugin (Cloudflare example):

```bash
# [auishqosrgbwbs01] — as root
$ sudo install -d -m 700 /etc/letsencrypt/secrets
#   /etc/letsencrypt/secrets    directory for credential files. 700 locks it
#                                down to root — plugin auth tokens live here.

$ sudo tee /etc/letsencrypt/secrets/cloudflare.ini <<'EOF'
# Cloudflare API token with Zone:DNS:Edit scope for your zone.
# Create at: https://dash.cloudflare.com/profile/api-tokens
dns_cloudflare_api_token = YOUR_SCOPED_TOKEN_HERE
EOF

$ sudo chmod 600 /etc/letsencrypt/secrets/cloudflare.ini
# 600 is REQUIRED — the cloudflare plugin refuses to use group/world-readable
# credentials. Good hygiene; do not override.
```

Request the cert. Note: DNS-01 does NOT need the --nginx plugin (no ACME challenge over HTTP) — we let certbot obtain the cert standalone and point Nginx at it ourselves:

```bash
# [auishqosrgbwbs01]
$ sudo certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/secrets/cloudflare.ini \
  --dns-cloudflare-propagation-seconds 30 \
  -d greenbook.africanunion.org \
  --email ops@africanunion.org --agree-tos --no-eff-email
#   certonly                            obtain the cert but don't edit any
#                                        webserver config.
#   --dns-cloudflare                     use the Cloudflare DNS plugin.
#   --dns-cloudflare-credentials FILE    the API token file above.
#   --dns-cloudflare-propagation-seconds N
#                                        wait N seconds after creating the
#                                        TXT record before asking LE to
#                                        verify it. 30s is typical for
#                                        Cloudflare; slower providers may
#                                        need 60-120s.
#   -d DOMAIN                             domain to certify. Can also be
#                                         "-d *.africanunion.org" for a wildcard
#                                         (DNS-01 supports wildcards).
# Certificate files land under /etc/letsencrypt/live/greenbook.africanunion.org/ —
# exactly where the Nginx config in §7.3 expects them. After success:

$ sudo nginx -t && sudo systemctl reload nginx
# Test and reload. Nginx now serves the real cert.

# The same "certbot renew --dry-run" applies; the plugin remembers the
# DNS method used to issue each cert and renews it the same way.
```

### 7.5 Test the TLS deployment

```bash
# From your workstation (not the VM):
$ curl -I https://greenbook.africanunion.org/
# Expected: HTTP/2 200  (or an application redirect).
# Expected header: strict-transport-security: max-age=31536000; includeSubDomains

$ openssl s_client -connect greenbook.africanunion.org:443 \
  -servername greenbook.africanunion.org </dev/null 2>/dev/null | \
  openssl x509 -noout -subject -issuer -dates
#   openssl s_client        open a raw TLS connection.
#   -connect HOST:PORT      what to connect to.
#   -servername NAME        SNI — indicate which vhost the connection is for.
#                            REQUIRED if multiple HTTPS sites live on the same IP.
#   </dev/null              empty stdin — don't wait for interactive input.
#   2>/dev/null             discard stderr (progress chatter).
#   | openssl x509 -noout -subject -issuer -dates
#                            parse the server cert from s_client's output
#                            and show who issued it, for whom, and validity.
# Expected:
#   subject=CN = greenbook.africanunion.org
#   issuer=C = US, O = Let's Encrypt, CN = R10  (or similar)
#   notBefore=...   notAfter=...   (typically 90 days apart)
```

> **✓ Check your grade**
>
> Test the HTTPS config at https://www.ssllabs.com/ssltest/ (public) or a private equivalent for internal hosts. With the config in §7.3, expect a solid "A" rating.

### 7.6 Using an internal CA instead of Let’s Encrypt

For an air-gapped AU intranet where neither HTTP-01 nor DNS-01 is workable (no outbound internet, no public DNS), use certificates issued by your organisation’s internal CA. The Nginx config in §7.3 is unchanged apart from the certificate paths.

```bash
# [auishqosrgbwbs01]
$ sudo install -d -m 750 -o root -g www-data /etc/ssl/greenbook
#   -m 750 owned by root:www-data. www-data (nginx worker) can read but
#   not write; root can do both.

# Place your cert bundle and private key here. Exact method depends on your
# CA — typical approach with an internal PKI is to generate a CSR on the VM,
# submit it to the CA, and install the returned cert:

# Generate an ECDSA private key (smaller, faster, equal security to RSA-3072).
$ sudo openssl ecparam -name prime256v1 -genkey \
  -out /etc/ssl/greenbook/greenbook.africanunion.org.key
# Then create a CSR (certificate signing request), submit it to your CA, and
# install the signed cert plus intermediate chain at /etc/ssl/greenbook/.

# In the Nginx server block in §7.3, change the ssl_certificate paths:
#   ssl_certificate     /etc/ssl/greenbook/greenbook.africanunion.org.fullchain.pem;
#   ssl_certificate_key /etc/ssl/greenbook/greenbook.africanunion.org.key;
# (fullchain = server cert FOLLOWED BY the intermediate chain, in one file)

$ sudo chmod 640 /etc/ssl/greenbook/*.key
$ sudo chmod 644 /etc/ssl/greenbook/*.pem

$ sudo nginx -t && sudo systemctl reload nginx
```

Every workstation that will visit the site must trust your internal CA’s root certificate. AU-managed endpoints should have this deployed via the OS image or MDM; for one-off devices, import the root cert into the OS trust store manually.

### 7.7 Using a pre-purchased commercial certificate

This is the African Union's chosen TLS path: a commercial certificate procured from a public CA (e.g. DigiCert, Sectigo, GlobalSign, GoDaddy). Commercial certs are trusted by every browser and OS out of the box, so unlike §7.6 there is no client-side trust step.

**AU's actual delivery — what to read first**

The AU has a **wildcard certificate** for `*.africanunion.org` delivered as a single password-protected `.pfx` (PKCS#12) bundle. The wildcard means the same cert covers `greenbook.africanunion.org` AND any future host under `africanunion.org` (e.g. another internal app), so the file naming below uses `wildcard.africanunion.org.*` rather than a per-host name. AU operators on this path:

- Skip [§7.7.1](#771-generate-the-csr-on-the-vm) — the CSR was generated centrally by AU IT, not on the VM.
- Skip [§7.7.2](#772-install-the-issued-certificate-pem-bundle-delivery) — that's the PEM-bundle delivery shape; you have a PFX.
- Go to **[§7.7.3 (Install from `.pfx` / `.p12`)](#773-install-the-wildcard-certificate-from-a-pfx--p12-bundle-aus-actual-path)** + **[§7.7.4 (Point Nginx at the new files)](#774-point-nginx-at-the-new-files)** + **[§7.7.5 (Renewal)](#775-renewal)**.

The Nginx config in §7.3 needs **only one change** for any of these paths: the two `ssl_certificate` paths at the bottom of the HTTPS server block, swapped from `/etc/letsencrypt/live/...` to `/etc/ssl/greenbook/wildcard.africanunion.org.*` (matching §7.6's convention for hand-installed certs). TLS protocols, ciphers, OCSP stapling, security headers, the `/sw.js` / `/assets/` / `/manifest.json` / `/` location blocks all stay identical.

#### 7.7.1 Generate the CSR on the VM

Generating the CSR on the target server is preferred over receiving a pre-generated key from AU IT, because the private key never leaves the VM and you don't have to trust the channel that delivers it. Skip to §7.7.3 if AU IT generated the CSR centrally and is delivering you a `.pfx` / `.p12` bundle.

```bash
# [auishqosrgbwbs01]
$ sudo install -d -m 750 -o root -g www-data /etc/ssl/greenbook
#   Same directory + perms as §7.6 — owned root, readable by nginx (www-data),
#   not world-readable.

# Generate an ECDSA P-256 private key (smaller, faster, equal security to RSA-3072).
$ sudo openssl ecparam -name prime256v1 -genkey -noout \
    -out /etc/ssl/greenbook/greenbook.africanunion.org.key
$ sudo chmod 640 /etc/ssl/greenbook/greenbook.africanunion.org.key
#   The key NEVER leaves this VM. If you ever regenerate it, the old CSR
#   and any cert issued against it become useless — you'd need a new CSR.

# Build the CSR with the right SAN (Subject Alternative Name). Modern CAs
# require a SAN; CN-only CSRs are rejected.
$ sudo openssl req -new \
    -key /etc/ssl/greenbook/greenbook.africanunion.org.key \
    -out /etc/ssl/greenbook/greenbook.africanunion.org.csr \
    -subj "/C=ET/ST=Addis Ababa/L=Addis Ababa/O=African Union/CN=greenbook.africanunion.org" \
    -addext "subjectAltName=DNS:greenbook.africanunion.org"
#   -subj          non-interactive Distinguished Name. Adjust C/ST/L/O to
#                   whatever AU IT/security want on the issued cert (they
#                   may have a procurement template — ask before submitting).
#   -addext SAN    Subject Alternative Name. For a wildcard, use:
#                   -addext "subjectAltName=DNS:*.africanunion.org,DNS:africanunion.org"

# Inspect the CSR before submitting:
$ openssl req -in /etc/ssl/greenbook/greenbook.africanunion.org.csr -noout -text \
  | grep -E "Subject:|DNS:"
# Expected: a Subject line (matches your -subj) and a "DNS:greenbook.africanunion.org"
# SAN entry. If SAN is missing, the CA will reject the CSR.

# Print the CSR so you can email/paste it to AU IT — the .csr is safe to
# share, contains no secrets:
$ sudo cat /etc/ssl/greenbook/greenbook.africanunion.org.csr
```

#### 7.7.2 Install the issued certificate (PEM bundle delivery)

The CA returns the signed certificate, typically with the issuer's intermediate(s). Common file shapes:

| File                                            | Contents                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| `greenbook.africanunion.org.crt` (or `.pem`)    | Server certificate (the leaf)                                        |
| `intermediate.crt` / `chain.crt` / `bundle.crt` | One or more intermediate CA certs                                    |
| `root.crt` (sometimes)                          | The CA's root — **NOT required**; browsers and OSes already trust it |

Build a **fullchain** in the right order: server certificate FIRST, then each intermediate in chain order. Order matters — out-of-order chains cause "incomplete chain" warnings on SSL Labs and break some older clients.

```bash
# [auishqosrgbwbs01]
# Place the issued files in /etc/ssl/greenbook/ first. The exact filenames
# depend on what the CA delivered; rename them to the conventions below
# so the rest of the procedure / the nginx config paths match.
#   - greenbook.africanunion.org.crt    (server cert / leaf)
#   - intermediate.crt                  (CA intermediate, or chain bundle)

# Concatenate server + intermediate(s) into fullchain.pem:
$ sudo bash -c 'cat /etc/ssl/greenbook/greenbook.africanunion.org.crt \
                    /etc/ssl/greenbook/intermediate.crt \
                  > /etc/ssl/greenbook/greenbook.africanunion.org.fullchain.pem'
$ sudo chmod 644 /etc/ssl/greenbook/greenbook.africanunion.org.fullchain.pem

# Verify the chain is well-formed (server cert at top, intermediates next):
$ openssl crl2pkcs7 -nocrl \
    -certfile /etc/ssl/greenbook/greenbook.africanunion.org.fullchain.pem \
  | openssl pkcs7 -print_certs -noout \
  | grep -E "subject=|issuer="
# Expected order:
#   subject= server CN              issuer= intermediate CA CN
#   subject= intermediate CA CN     issuer= root CA CN
# If the order is reversed, regenerate fullchain.pem with cat in the right
# order — leaf first, then intermediate(s).

# Verify the leaf and key actually match (catches "wrong key for this cert"
# delivery mistakes before they hit nginx):
$ sudo bash -c '
    diff <(openssl x509 -in /etc/ssl/greenbook/greenbook.africanunion.org.fullchain.pem -pubkey -noout) \
         <(openssl pkey -in /etc/ssl/greenbook/greenbook.africanunion.org.key -pubout)
'
# Empty output = match. Any diff output = the cert was issued against a
# different key; do not proceed.

# Final perms check:
$ ls -l /etc/ssl/greenbook/
# Expected (at minimum):
#   -rw-r----- root www-data  greenbook.africanunion.org.key            (640)
#   -rw-r--r-- root www-data  greenbook.africanunion.org.fullchain.pem  (644)
```

#### 7.7.3 Install the wildcard certificate from a `.pfx` / `.p12` bundle (AU's actual path)

This is what to do when AU IT delivers a `wildcard.africanunion.org.pfx` (or similarly-named) file plus a password. The PFX contains three things in one encrypted blob: the wildcard certificate, its private key, and the CA chain. The procedure below extracts each part to a separate file on disk, in the conventional layout that the Nginx config in §7.7.4 expects.

> **⚠ Handle the PFX password carefully**
>
> Two practical rules:
>
> 1. **Don't pass the password on the command line** with `-passin pass:<value>` — it lands in shell history (`.bash_history` / `.zsh_history`) and `ps auxf` for any other user during the brief moment openssl is running. Use the interactive prompt below (default behaviour: openssl asks for "Enter Import Password:") or the `-passin file:<path>` form pointing at a 600-mode root-owned file you `shred -u` after.
> 2. **If the .pfx and the password arrived through the same channel** (e.g. both in a single email, or both attached to the same ticket), rotate before installing — the cert+password pair is one factor, not two, when they share a delivery path. AU IT can re-export the bundle with a new password without reissuing the cert.

> **⚠ Add `-legacy` to every `openssl pkcs12` invocation below**
>
> PKCS#12 bundles produced by Windows Server / IIS and several commercial CA portals (including DigiCert and Sectigo) encrypt the certificate portion with `RC2-40-CBC` by default. OpenSSL 3.0+ — which Ubuntu 24.04 ships as 3.0.x — moved RC2 into the "legacy" provider, which is **not loaded by default** anymore. Without `-legacy` you'll see:
>
> ```
> Error outputting keys and certificates
> error:0308010C:digital envelope routines:inner_evp_generic_fetch:unsupported
>     Algorithm (RC2-40-CBC : 0), Properties ()
> ```
>
> Adding `-legacy` to `openssl pkcs12 -in ...` loads the legacy provider on top of the default provider — modern algorithms still work, RC2 also works. The flag is a no-op on PFX bundles that don't use legacy ciphers, so the procedure below leaves it on unconditionally. (You don't need to pre-register the legacy provider in `/etc/ssl/openssl.cnf`; the `-legacy` flag is per-command.)

```bash
# 1. Transfer the PFX from your laptop to the VM, then move it into
#    /etc/ssl/greenbook/ with restrictive ownership.
#
#    USER NOTE: cert installation is HOST-level admin work. Use your
#    personal sudo-capable account on the VM — `greenbook` in the AU's
#    setup; substitute your own. Do NOT use `deployer` here:
#      · `deployer` was provisioned without a password (key-only login,
#        per 01 §3.8), so `sudo` has no password to accept.
#      · `deployer` is also explicitly NOT in the sudoers file
#        (09 §11.1 — "deployer (app VM only, no sudo)"). It exists only
#        to run `docker compose` for app deploys.
#    All sudo-bearing commands in steps 1–8 below run as `greenbook`.

# (1a) On your laptop — scp the PFX into your admin account's home
#      directory. /home/greenbook is mode 700 on Ubuntu 24.04
#      (HOME_MODE=0700 in /etc/login.defs), so the file is unreadable to
#      any other local user while it sits there during staging. Prefer
#      this over /tmp, which is world-traversable.
$ scp wildcard.africanunion.org.pfx greenbook@10.111.11.51:~/
#   scp SOURCE USER@HOST:DEST    secure copy over SSH. Uses the same key-
#                                 based auth you already use to ssh in
#                                 as `greenbook` for sudo work elsewhere
#                                 in 06.
#   ~/                            shorthand for the remote user's home
#                                 directory — i.e. /home/greenbook/. The
#                                 file lands as
#                                   /home/greenbook/wildcard.africanunion.org.pfx
#   The transfer itself is encrypted by SSH; the PFX's own password gives
#   you a second layer of protection at rest.
# (If your local PFX has a different filename, scp it as-is; you can rename
#  on the VM in step 1b. The procedure expects wildcard.africanunion.org.pfx
#  for the rest of this section.)

# (1b) SSH into the VM as your admin account, then create the cert
#      directory and move the PFX into it with root:root 600 perms.
$ ssh greenbook@10.111.11.51

# [auishqosrgbwbs01]
$ sudo install -d -m 750 -o root -g www-data /etc/ssl/greenbook
#   install -d        create the directory if absent.
#   -m 750            rwx for owner (root), rx for group (www-data, the
#                      nginx worker user), nothing for other.
#   -o root -g www-data    ownership.

$ sudo install -m 600 -o root -g root \
    ~/wildcard.africanunion.org.pfx \
    /etc/ssl/greenbook/wildcard.africanunion.org.pfx
#   install -m 600    rw for owner only. The PFX still contains the
#                      encrypted private key until extracted in steps 3-4
#                      below; tighten it before unwrapping.
#   The single install(1) call does cp + chown + chmod atomically — there
#   is no window where the file is in place with the wrong perms.

$ rm ~/wildcard.africanunion.org.pfx
#   Remove the staging copy. /home/greenbook/ is mode 700 so the staging
#   copy was never publicly readable, but deleting after the move keeps
#   secret-material accounting tidy.

# 2. Extract the private key. openssl prompts for the PFX password
#    interactively — type it, hit enter, no shell history exposure.
$ sudo openssl pkcs12 -legacy \
    -in  /etc/ssl/greenbook/wildcard.africanunion.org.pfx \
    -out /etc/ssl/greenbook/wildcard.africanunion.org.key \
    -nocerts -nodes
#   -legacy      load the legacy provider so RC2-40-CBC (the default cert
#                 encryption algorithm in PFX exports from Windows / IIS /
#                 several commercial CA portals) is recognised. See the ⚠
#                 callout above. No-op on modern PFX exports.
#   -nocerts     only output the private key, no certs.
#   -nodes       do NOT encrypt the output key. nginx won't prompt for a
#                 passphrase at startup; encrypted-on-disk keys would need
#                 a passphrase agent, which is more operational complexity
#                 than disk-permissions on a server we already trust.
# Enter Import Password:  ← type the AU-supplied password here.

$ sudo chmod 640 /etc/ssl/greenbook/wildcard.africanunion.org.key
$ sudo chown root:www-data /etc/ssl/greenbook/wildcard.africanunion.org.key
#   640 root:www-data so nginx (running as www-data) can read it but no
#   other unprivileged user can. Same convention as §7.6.

# 3. Extract the leaf (wildcard) certificate. Prompts for the password again.
$ sudo openssl pkcs12 -legacy \
    -in  /etc/ssl/greenbook/wildcard.africanunion.org.pfx \
    -out /etc/ssl/greenbook/wildcard.africanunion.org.fullchain.pem \
    -nokeys -clcerts -nodes

# 4. Append the CA chain from the same PFX. Prompts for the password again.
#
#    Important: do NOT pipe `sudo openssl ... | sudo tee -a ...`. Two
#    sudos in one pipeline both grab /dev/tty, and openssl's tcsetattr()
#    call (to disable echo for password input) fails — you'll see
#    "Can't read Password" right after the prompt. Wrap everything in a
#    single `sudo bash -c '...'` so there's only one tty owner, and use
#    shell-level append (`>>`) instead of `| sudo tee -a`.
$ sudo bash -c 'openssl pkcs12 -legacy \
    -in  /etc/ssl/greenbook/wildcard.africanunion.org.pfx \
    -nokeys -cacerts -nodes \
  >> /etc/ssl/greenbook/wildcard.africanunion.org.fullchain.pem'
# fullchain.pem now contains the wildcard leaf followed by the intermediate(s).

$ sudo chmod 644 /etc/ssl/greenbook/wildcard.africanunion.org.fullchain.pem
$ sudo chown root:root /etc/ssl/greenbook/wildcard.africanunion.org.fullchain.pem
#   644 root:root — public part, world-readable is fine (it's what nginx
#   sends to every client during the TLS handshake).

# 5. Verify chain order: leaf at top, intermediate(s) next.
$ openssl crl2pkcs7 -nocrl \
    -certfile /etc/ssl/greenbook/wildcard.africanunion.org.fullchain.pem \
  | openssl pkcs7 -print_certs -noout | grep -E "subject=|issuer="
# Expected:
#   subject= ... CN = *.africanunion.org    issuer= ... intermediate CN
#   subject= ... intermediate CN            issuer= ... root CN

# 6. Verify the leaf and key actually match (catches "wrong key for this
#    cert" bundle errors before they hit nginx as obscure SSL mismatches).
$ sudo bash -c '
    diff <(openssl x509 -in /etc/ssl/greenbook/wildcard.africanunion.org.fullchain.pem -pubkey -noout) \
         <(openssl pkey -in /etc/ssl/greenbook/wildcard.africanunion.org.key -pubout)
'
# Empty output = match. Any diff output = the cert was issued against a
# different key. Don't proceed — go back to AU IT for a re-export.

# 7. Confirm the SAN actually covers greenbook.africanunion.org.
$ openssl x509 -in /etc/ssl/greenbook/wildcard.africanunion.org.fullchain.pem \
    -noout -ext subjectAltName
# Expected: DNS:*.africanunion.org (and possibly DNS:africanunion.org).
# A wildcard *.africanunion.org matches greenbook.africanunion.org. If the
# SAN is only the bare apex (africanunion.org) without the wildcard, the
# cert will NOT serve subdomains — go back to AU IT.

# 8. Once extraction succeeded and verifications pass, shred the PFX — the
#    secret material is now on disk as the .key file and there's no reason
#    to keep two copies.
$ sudo shred -u /etc/ssl/greenbook/wildcard.africanunion.org.pfx

# Final layout in /etc/ssl/greenbook/:
$ ls -l /etc/ssl/greenbook/
# Expected:
#   -rw-r----- root www-data  wildcard.africanunion.org.key            (640)
#   -rw-r--r-- root root      wildcard.africanunion.org.fullchain.pem  (644)
```

#### 7.7.4 Point Nginx at the new files

Edit `/etc/nginx/sites-available/greenbook.conf` (or rerun `scp` with an updated [`appendix/greenbook.conf`](appendix/greenbook.conf)). Change the two `ssl_certificate` paths in the HTTPS server block:

```diff
- ssl_certificate     /etc/letsencrypt/live/greenbook.africanunion.org/fullchain.pem;
- ssl_certificate_key /etc/letsencrypt/live/greenbook.africanunion.org/privkey.pem;
+ ssl_certificate     /etc/ssl/greenbook/wildcard.africanunion.org.fullchain.pem;
+ ssl_certificate_key /etc/ssl/greenbook/wildcard.africanunion.org.key;
```

`server_name` stays `greenbook.africanunion.org` — a wildcard cert matches the host, but nginx still routes by `server_name`, not by what the cert covers. (If you later add another AU host on the same VM, you'd add a second `server { ... }` block with its own `server_name` and the same two `ssl_certificate` paths, reusing the wildcard.)

Then test and reload:

```bash
# [auishqosrgbwbs01]
$ sudo nginx -t
# Expected: "syntax is ok" / "test is successful". The "ssl_stapling
# ignored" warning from the §7.3 placeholder should be gone — the
# commercial chain has a real intermediate, so OCSP stapling activates.

$ sudo systemctl reload nginx

# Verify the live cert is the AU wildcard (not the leftover snake-oil):
$ echo | openssl s_client -connect 127.0.0.1:443 \
    -servername greenbook.africanunion.org 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
# Expected:
#   subject=CN = *.africanunion.org
#   issuer=    your CA's intermediate (DigiCert/Sectigo/etc.)
#   notBefore=...   notAfter=...   (typically 1 year apart)
#   X509v3 Subject Alternative Name:
#       DNS:*.africanunion.org, DNS:africanunion.org
```

If the snake-oil from §7.3 is still on disk (it expires in 24h anyway), it's harmless once nginx is pointed elsewhere. You can delete `/etc/letsencrypt/live/greenbook.africanunion.org/` if you'd rather keep `/etc/letsencrypt/` reserved for actual Let's Encrypt material.

#### 7.7.5 Renewal

Commercial certificates do **not** auto-renew. Validity is typically 1 year (with a 397-day cap per Apple/Google policies; some vendors now offer 90-day commercial certs to align with industry direction). Two paths:

1. **Manual renewal** — set a calendar reminder 30 days before `notAfter`. The renewal flow is identical to §7.7.1: reuse the existing key (or rotate it as a discipline), submit a fresh CSR, install per §7.7.2, `nginx -t && systemctl reload nginx`. AU IT may supply the renewed cert without a new CSR if they retained the original key — confirm their procurement workflow up front.

2. **Vendor ACME** — some commercial CAs now expose ACME endpoints (Sectigo, ZeroSSL, BuyPass, DigiCert all do at the time of writing). If yours does and AU IT enables ACME on the AU account, you can drive renewals with Certbot or `acme.sh` against the vendor's ACME URL via `--server`. Renewal becomes automated, like §7.4. Confirm with AU IT whether ACME is enabled.

Check current expiry on demand:

```bash
# [auishqosrgbwbs01]
$ sudo openssl x509 -in /etc/ssl/greenbook/wildcard.africanunion.org.fullchain.pem \
    -noout -dates
# Expected:
#   notBefore=...
#   notAfter=...     ← put a calendar reminder for ~30 days before this date.
```

Both [§9.3 (monitoring script)](08-day-2-operations.md#93-simple-monitoring-script) and [09 §11.6 (Observability hardening)](09-hardening-checklist.md#116-observability) probe cert expiry; the monitoring script alerts when ≤14 days remain. Don't rely solely on the calendar reminder — wire one or both of those in so a forgotten cert pages someone.

> **ℹ OCSP stapling on the AU intranet — confirm outbound to the CA's responder**
>
> The Nginx config has `ssl_stapling on; resolver 1.1.1.1 9.9.9.9` so it can fetch OCSP responses from the CA. If outbound HTTPS to the CA's OCSP responder is blocked from the VM (common on locked-down intranets), nginx logs `ssl_stapling_responder failed` or `OCSP_basic_verify() failed` warnings — the config still loads, but stapling is silently off and clients fall back to fetching OCSP themselves. Two fixes: (a) ask network ops to allow outbound HTTPS to your CA's OCSP URL (DigiCert: `ocsp.digicert.com`, Sectigo: `ocsp.sectigo.com`, GlobalSign: `ocsp.globalsign.com`); or (b) accept the regression and disable stapling in [`appendix/greenbook.conf`](appendix/greenbook.conf) by setting `ssl_stapling off; ssl_stapling_verify off;`. Stapling is a latency optimisation, not a security feature — modern clients cope fine without it.

---
