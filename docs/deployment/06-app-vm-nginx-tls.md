# 06 — Nginx and TLS

> **Phase**: bring-up · **Run on**: App VM (`auishqosrgbwbs01`) · **Time**: ~45 min
>
> Host-installed Nginx terminating TLS on 443 and reverse-proxying to the container at `127.0.0.1:3000`. Tuned for React Router 7's streaming SSR + SSE (`proxy_buffering off`, long `proxy_read_timeout`), greenbook's PWA service worker (short cache on `/sw.js`, immutable on `/assets/*`), and correlation-ID forwarding. Three TLS paths: Let's Encrypt HTTP-01, Let's Encrypt DNS-01, and an internal CA for air-gapped intranet.
>
> **Prev**: [05 — Application container](05-app-vm-container.md) · **Next**: [07 — Deploy workflow](07-deploy-workflow.md) · **Index**: [README](README.md)

---

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

Replace the default Nginx site with a config that proxies to the greenbook container. Create `/etc/nginx/sites-available/greenbook.conf`:

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
    server_name greenbook.au.int;

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

    server_name greenbook.au.int;

    # Certbot will fill in certificate paths here. Placeholders shown below.
    ssl_certificate     /etc/letsencrypt/live/greenbook.au.int/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/greenbook.au.int/privkey.pem;

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

$ sudo nginx -t
#   -t              test the config for syntax errors. Do NOT skip this.
# Expected: "syntax is ok" and "test is successful". Any other output means
# fix the error before reloading.

$ sudo systemctl reload nginx
#   reload          graceful — SIGHUP. Nginx starts new workers with the new
#                   config and retires the old ones as they finish current
#                   requests. No dropped connections.
```

> **⚠ HTTPS will return an error until certificates are installed**
>
> At this point `https://greenbook.au.int` will produce a TLS handshake error because the `ssl_certificate` paths in the config point to files that do not yet exist. That is expected and fixed by the Certbot step below, which creates the files AND reloads Nginx. The HTTP site on port 80 works already; test HTTPS AFTER Certbot runs.

### 7.4 TLS with Let’s Encrypt (public internet or public DNS)

Let’s Encrypt issues free, automatically-renewing TLS certificates. It offers two validation methods: HTTP-01 (the default, used by certbot --nginx) and DNS-01 (for servers that are not reachable from the public internet). Which one you can use depends on how the VM is networked.

> **ℹ Which validation method applies to your deployment?**
>
> HTTP-01 requires that Let’s Encrypt’s servers can reach your VM over plain HTTP on port 80. That means (a) your public DNS record must resolve to a publicly-routable IP, and (b) port 80 on that IP must be open to the internet.
>
> If your VM has only an internal IP (e.g. 10.111.11.x) and your DNS record resolves to that internal IP, HTTP-01 WILL FAIL. Let's Encrypt's servers cannot reach 10.111.11.x (or any RFC 1918 private range) from the public internet regardless of how accessible port 80 is on the intranet.
>
> If your VM has an internal IP but the domain has PUBLIC DNS records (a common AU setup — public greenbook.au.int record pointing at a publicly-routable IP that is routed to the VM via a NAT or reverse proxy), both methods can work.
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
$ sudo certbot --nginx -d greenbook.au.int \
  --email ops@au.int --agree-tos --no-eff-email --redirect
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
- You need wildcard certificates (\*.au.int) — HTTP-01 cannot issue wildcards; DNS-01 can.

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
  -d greenbook.au.int \
  --email ops@au.int --agree-tos --no-eff-email
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
#                                         "-d *.au.int" for a wildcard
#                                         (DNS-01 supports wildcards).
# Certificate files land under /etc/letsencrypt/live/greenbook.au.int/ —
# exactly where the Nginx config in §7.3 expects them. After success:

$ sudo nginx -t && sudo systemctl reload nginx
# Test and reload. Nginx now serves the real cert.

# The same "certbot renew --dry-run" applies; the plugin remembers the
# DNS method used to issue each cert and renews it the same way.
```

### 7.5 Test the TLS deployment

```bash
# From your workstation (not the VM):
$ curl -I https://greenbook.au.int/
# Expected: HTTP/2 200  (or an application redirect).
# Expected header: strict-transport-security: max-age=31536000; includeSubDomains

$ openssl s_client -connect greenbook.au.int:443 \
  -servername greenbook.au.int </dev/null 2>/dev/null | \
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
#   subject=CN = greenbook.au.int
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
  -out /etc/ssl/greenbook/greenbook.au.int.key
# Then create a CSR (certificate signing request), submit it to your CA, and
# install the signed cert plus intermediate chain at /etc/ssl/greenbook/.

# In the Nginx server block in §7.3, change the ssl_certificate paths:
#   ssl_certificate     /etc/ssl/greenbook/greenbook.au.int.fullchain.pem;
#   ssl_certificate_key /etc/ssl/greenbook/greenbook.au.int.key;
# (fullchain = server cert FOLLOWED BY the intermediate chain, in one file)

$ sudo chmod 640 /etc/ssl/greenbook/*.key
$ sudo chmod 644 /etc/ssl/greenbook/*.pem

$ sudo nginx -t && sudo systemctl reload nginx
```

Every workstation that will visit the site must trust your internal CA’s root certificate. AU-managed endpoints should have this deployed via the OS image or MDM; for one-off devices, import the root cert into the OS trust store manually.

---
