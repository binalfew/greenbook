# 06 — Nginx and TLS

> **Phase**: bring-up · **Run on**: App VM (`auishqosrgbwbs01`) · **Time**: ~45 min
>
> Host-installed Nginx terminating TLS on 443 and reverse-proxying to the container at `127.0.0.1:3000`. Tuned for React Router 7's streaming SSR + SSE (`proxy_buffering off`, long `proxy_read_timeout`), greenbook's PWA service worker (short cache on `/sw.js`, immutable on `/assets/*`), and correlation-ID forwarding. TLS uses the AU-procured wildcard certificate for `*.africanunion.org`, delivered as a password-protected PFX bundle.
>
> **Prev**: [05 — Application container](05-app-vm-container.md) · **Next**: [07 — Deploy workflow](07-deploy-workflow.md) · **Index**: [README](README.md)

---

## Contents

- [§6.1 Install Nginx](#61-install-nginx)
- [§6.2 Open ports 80 and 443 in UFW](#62-open-ports-80-and-443-in-ufw)
- [§6.3 The Nginx server config](#63-the-nginx-server-config)
  - [§6.3.1 Install the shared App VM nginx configs](#631-install-the-shared-app-vm-nginx-configs)
  - [§6.3.2 Add greenbook as the first proxied app](#632-add-greenbook-as-the-first-proxied-app)
- [§6.4 Install the AU wildcard TLS certificate](#64-install-the-au-wildcard-tls-certificate)
  - [§6.4.1 Generate the CSR on the VM](#641-generate-the-csr-on-the-vm)
  - [§6.4.2 Install the issued certificate (PEM bundle delivery)](#642-install-the-issued-certificate-pem-bundle-delivery)
  - [§6.4.3 Install the wildcard certificate from a .pfx / .p12 bundle (AU's actual path)](#643-install-the-wildcard-certificate-from-a-pfx--p12-bundle-aus-actual-path)
  - [§6.4.4 Point Nginx at the new files](#644-point-nginx-at-the-new-files)
  - [§6.4.5 Renewal](#645-renewal)
- [§6.5 Test the TLS deployment](#65-test-the-tls-deployment)
- [§6.6 Adding a second app on the App VM](#66-adding-a-second-app-on-the-app-vm)

## 6. Nginx and TLS

Nginx sits on the host (not in a container) and terminates TLS on port 443. It forwards decrypted HTTP to the Node container at 127.0.0.1:3000 and adds security headers. Putting Nginx on the host (not in a container) keeps TLS certificates on the host filesystem, makes Certbot integration straightforward, and lets Nginx survive app container restarts.

> **ℹ Single-tier (this chapter) vs two-tier (chapter 12) topology**
>
> This chapter documents the **single-tier** shape — nginx on the app VM faces the public internet directly, terminates TLS, and proxies to the container. That's the simplest deployment and what you'll have at the end of the bring-up.
>
> If you're running greenbook behind a separate **DMZ reverse proxy** ([12 — DMZ shared reverse proxy](12-dmz-reverse-proxy.md)), the app VM nginx role narrows: TLS terminates at the DMZ edge, the app VM listens on plain HTTP only, and UFW pins :80 to the DMZ VM's source IP. The configs in this chapter are the right starting point either way; chapter 12 §12.8 lists the four diffs to apply on the app VM after the DMZ tier is in place (drop the HTTPS server block, add `set_real_ip_from`, swap UFW rules, drop the security headers — they move to the edge).

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

### 6.2 Open ports 80 and 443 in UFW

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

### 6.3 The Nginx server config

The App VM's nginx is a **multi-tenant reverse proxy** — it can host more than one docker app, each on its own port and `server_name`. Greenbook is the worked example throughout this chapter; if a second AU app later runs on the same App VM (e.g., `report-builder.africanunion.org` on `127.0.0.1:3001`), it onboards via [§6.6](#66-adding-a-second-app-on-the-app-vm) — three commands plus one edited per-app config file. The shape of the App VM's nginx mirrors the DMZ proxy in [chapter 12](12-dmz-reverse-proxy.md): shared `http {}` config + shared snippets + one `sites-available/<app>.conf` per backend.

Three layers of config to install (under [`appendix/app-vm/`](appendix/app-vm/)):

| File                                                                                         | Lives at                                          | Purpose                                                                      |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`appendix/app-vm/00-app-vm-shared.conf`](appendix/app-vm/00-app-vm-shared.conf)             | `/etc/nginx/conf.d/00-app-vm-shared.conf`         | WebSocket upgrade `map`, shared rate-limit zones (`app_general`, `app_auth`) |
| [`appendix/app-vm/app-vm-proxy-headers.conf`](appendix/app-vm/app-vm-proxy-headers.conf)     | `/etc/nginx/snippets/app-vm-proxy-headers.conf`   | Shared `proxy_set_header` block + timeouts + buffering policy                |
| [`appendix/app-vm/greenbook-cache-policy.conf`](appendix/app-vm/greenbook-cache-policy.conf) | `/etc/nginx/snippets/greenbook-cache-policy.conf` | Greenbook PWA-specific routing (`/sw.js`, `/assets/*`, `/manifest.json`)     |
| [`appendix/app-vm/greenbook.conf`](appendix/app-vm/greenbook.conf)                           | `/etc/nginx/sites-available/greenbook.conf`       | Per-app server block — one of N (greenbook today; future apps in §6.6)       |

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
# /etc/nginx/sites-available/greenbook.conf  (App VM, single-tier)
# Inherits from /etc/nginx/conf.d/00-app-vm-shared.conf (WebSocket map +
# rate-limit zones) and /etc/nginx/snippets/{app-vm-proxy-headers,
# greenbook-cache-policy}.conf — don't duplicate those concerns here.

upstream greenbook_app {
    server 127.0.0.1:3000;     # Loopback to the docker container.
    keepalive 32;
}

# HTTP — redirect to HTTPS + ACME challenge slot
server {
    listen      80;
    listen      [::]:80;
    server_name greenbook.africanunion.org;

    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location /                            { return 301 https://$host$request_uri; }
}

# HTTPS — TLS terminator + reverse proxy
server {
    listen      443 ssl http2;
    listen      [::]:443 ssl http2;
    server_name greenbook.africanunion.org;

    # TLS cert path — the AU wildcard (§6.4). Same two files serve every
    # per-app server block on this VM (one wildcard, all hostnames).
    ssl_certificate     /etc/ssl/greenbook/wildcard.africanunion.org.fullchain.pem;
    ssl_certificate_key /etc/ssl/greenbook/wildcard.africanunion.org.key;

    # Modern TLS (Mozilla "intermediate"). Same settings every per-app
    # server block on this VM ends up using; could be lifted into a
    # shared `conf.d/01-tls.conf` if more apps onboard.
    ssl_protocols         TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache     shared:SSL:10m;
    ssl_session_timeout   1d;
    ssl_session_tickets   off;
    ssl_stapling          on;
    ssl_stapling_verify   on;
    resolver              1.1.1.1 9.9.9.9 valid=300s;
    resolver_timeout      5s;

    # Security headers — single-tier only. Drop these in the two-tier
    # diff (12 §12.8); they move to the DMZ tier in that topology.
    add_header Strict-Transport-Security  "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options     "nosniff"                              always;
    add_header X-Frame-Options            "DENY"                                 always;
    add_header Referrer-Policy            "strict-origin-when-cross-origin"      always;

    client_max_body_size 20m;
    access_log /var/log/nginx/greenbook.access.log;
    error_log  /var/log/nginx/greenbook.error.log warn;

    # Greenbook PWA-specific cache routing (sw.js / /assets/ / /manifest.json).
    include /etc/nginx/snippets/greenbook-cache-policy.conf;

    # Auth-strict rate limit on credential / SSO endpoints.
    location ~ ^/(login|forgot-password|api/auth|api/sso) {
        limit_req zone=app_auth burst=20 nodelay;
        proxy_pass http://greenbook_app;
        include /etc/nginx/snippets/app-vm-proxy-headers.conf;
    }

    # Catch-all → docker container (SSR + SSE + API).
    location / {
        limit_req zone=app_general burst=200 nodelay;
        proxy_pass http://greenbook_app;
        include /etc/nginx/snippets/app-vm-proxy-headers.conf;
    }
}
```

The full annotated forms of all four files (`00-app-vm-shared.conf`, `app-vm-proxy-headers.conf`, `greenbook-cache-policy.conf`, and `greenbook.conf`) live in [`appendix/app-vm/`](appendix/app-vm/) — that's the canonical scp-able source.

**Two orderings depending on whether you have the cert files already.**

The HTTPS server block above references `ssl_certificate` files at `/etc/ssl/greenbook/wildcard.africanunion.org.*`. `nginx -t` opens those files at config-test time and refuses the whole config if either is missing — so the test (and any reload) fails until the cert is on disk. Pick whichever order matches your situation:

- **(A) Cert already extracted** — if AU IT delivered the PFX before nginx setup, run [§6.4.3](#643-install-the-wildcard-certificate-from-a-pfx--p12-bundle-aus-actual-path) **first**, then come back here and `nginx -t && systemctl reload nginx`. No placeholder needed; this is the recommended path.
- **(B) Cert not yet in hand** — if you're doing infrastructure setup ahead of cert procurement, drop a 1-day self-signed placeholder at the exact paths the config expects, get nginx running, then replace the placeholder when [§6.4.3](#643-install-the-wildcard-certificate-from-a-pfx--p12-bundle-aus-actual-path) lands. The 1-day expiry forces the issue if cert procurement stalls.

Path (B) — the placeholder bootstrap:

```bash
# [auishqosrgbwbs01]
$ sudo install -d -m 750 -o root -g www-data /etc/ssl/greenbook

$ sudo openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/ssl/greenbook/wildcard.africanunion.org.key \
    -out    /etc/ssl/greenbook/wildcard.africanunion.org.fullchain.pem \
    -subj   "/CN=greenbook.africanunion.org"
#   req -x509 -nodes    self-signed cert, no passphrase on the key.
#   -newkey rsa:2048    generate a fresh 2048-bit RSA key alongside the cert.
#                        The real wildcard cert in §6.4.3 lands as RSA-2048
#                        or RSA-4096 from AU IT's PKI; nginx loads whichever
#                        algorithm the file holds.
#   -days 1             expires in 24 hours. Short on purpose: if you forget
#                        to install the real cert, browsers will scream loudly.
#   -subj "/CN=..."     non-interactive subject. Skips the DN prompts.

$ sudo chmod 640 /etc/ssl/greenbook/wildcard.africanunion.org.key
$ sudo chown root:www-data /etc/ssl/greenbook/wildcard.africanunion.org.key
#   Same perms the real key uses (§6.4.3), so the swap-in is a no-op for nginx.
```

> **ℹ Expect an `"ssl_stapling" ignored, issuer certificate not found` warning**
>
> The next `nginx -t` will print that warning against the placeholder cert. It is benign and self-resolving: OCSP stapling needs the issuer's intermediate cert to fetch a revocation response, and a self-signed cert has no separate issuer. Nginx silently disables stapling for the placeholder and continues loading the config — that's why the test still ends in "syntax is ok / test is successful." Once §6.4.3 installs the real wildcard chain, OCSP stapling activates and the warning disappears.

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

> **⚠ HTTPS will show a "not trusted" warning until §6.4 installs the real cert**
>
> The placeholder cert above lets `nginx -t` pass and lets nginx start, but a browser visiting `https://greenbook.africanunion.org` will see a self-signed / "not trusted" warning until §6.4 installs the AU wildcard. The HTTP site on port 80 works already (it 301-redirects to HTTPS, where the browser then warns). **Don't share the public URL with anyone before §6.4 completes.**

### 6.4 Install the AU wildcard TLS certificate

This is the African Union's chosen TLS path: a commercial wildcard certificate procured from a public CA (DigiCert, Sectigo, GlobalSign, GoDaddy — depends on the AU's current vendor). Wildcard `*.africanunion.org` covers `greenbook.africanunion.org` AND every other host under the same apex (a future internal app, staging, etc.), so the file naming below uses `wildcard.africanunion.org.*` rather than a per-host name. Trusted by every browser and OS out of the box, so there is no client-side trust step.

**Three sub-paths depending on how AU IT delivers the cert:**

- **PFX / `.p12` bundle (the actual AU path).** AU IT generated the CSR centrally and delivers a single password-protected `.pfx` containing leaf + chain + private key. **Skip §6.4.1 + §6.4.2 — go directly to [§6.4.3](#643-install-the-wildcard-certificate-from-a-pfx--p12-bundle-aus-actual-path) → [§6.4.4](#644-point-nginx-at-the-new-files) → [§6.4.5](#645-renewal).**
- **PEM bundle delivery.** AU IT (or the CA portal) delivers a `fullchain.pem` + `privkey.pem` directly. Skip §6.4.1, follow §6.4.2 + §6.4.4 + §6.4.5.
- **CSR-on-VM.** You generate the CSR locally, hand it to AU IT, get back the signed cert. Follow §6.4.1 + §6.4.2 + §6.4.4 + §6.4.5.

The Nginx config in §6.3 needs **only one change** for any of these paths: the two `ssl_certificate` paths in [`appendix/app-vm/greenbook.conf`](appendix/app-vm/greenbook.conf) point at `/etc/ssl/greenbook/wildcard.africanunion.org.fullchain.pem` and `.key` by default — that's already correct. TLS protocols, ciphers, OCSP stapling, security headers, and every `location` block stay identical.

> **ℹ If you don't have an AU wildcard PFX (forks / non-AU deployments)**
>
> The deployment guide is intentionally focused on AU's procurement reality. If you're forking greenbook for a different organisation: (a) for free auto-renewing certs against a public domain, see [Certbot's official guide](https://certbot.eff.org/instructions); (b) for an internal/air-gapped CA, generate a key + CSR per §6.4.1, submit it to your PKI team, then install the returned PEM bundle per §6.4.2. Either way the Nginx config in §6.3 stays the same — only the `ssl_certificate` paths change.

#### 6.4.1 Generate the CSR on the VM

Generating the CSR on the target server is preferred over receiving a pre-generated key from AU IT, because the private key never leaves the VM and you don't have to trust the channel that delivers it. Skip to §6.4.3 if AU IT generated the CSR centrally and is delivering you a `.pfx` / `.p12` bundle.

```bash
# [auishqosrgbwbs01]
$ sudo install -d -m 750 -o root -g www-data /etc/ssl/greenbook
#   -m 750 owned by root:www-data. www-data (nginx worker) can read but
#   not write; root can do both.

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

#### 6.4.2 Install the issued certificate (PEM bundle delivery)

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

#### 6.4.3 Install the wildcard certificate from a `.pfx` / `.p12` bundle (AU's actual path)

This is what to do when AU IT delivers a `wildcard.africanunion.org.pfx` (or similarly-named) file plus a password. The PFX contains three things in one encrypted blob: the wildcard certificate, its private key, and the CA chain. The procedure below extracts each part to a separate file on disk, in the conventional layout that the Nginx config in §6.4.4 expects.

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
#        per 01 §1.8), so `sudo` has no password to accept.
#      · `deployer` is also explicitly NOT in the sudoers file
#        (09 §9.1 — "deployer (app VM only, no sudo)"). It exists only
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
#   other unprivileged user can. Same perms as the placeholder in §6.3.2.

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

#### 6.4.4 Point Nginx at the new files

Edit `/etc/nginx/sites-available/greenbook.conf` (or rerun `scp` with an updated [`appendix/app-vm/greenbook.conf`](appendix/app-vm/greenbook.conf)). Change the two `ssl_certificate` paths in the HTTPS server block:

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
# ignored" warning from the §6.3 placeholder should be gone — the
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

If the snake-oil from §6.3 is still on disk (it expires in 24h anyway), it's harmless once nginx is pointed elsewhere. You can delete `/etc/letsencrypt/live/greenbook.africanunion.org/` if you'd rather keep `/etc/letsencrypt/` reserved for actual Let's Encrypt material.

#### 6.4.5 Renewal

Commercial certificates do **not** auto-renew. Validity is typically 1 year (with a 397-day cap per Apple/Google policies; some vendors now offer 90-day commercial certs to align with industry direction). Two paths:

1. **Manual renewal** — set a calendar reminder 30 days before `notAfter`. The renewal flow is identical to §6.4.1: reuse the existing key (or rotate it as a discipline), submit a fresh CSR, install per §6.4.2, `nginx -t && systemctl reload nginx`. AU IT may supply the renewed cert without a new CSR if they retained the original key — confirm their procurement workflow up front. For PFX renewal (the AU's actual path) re-run §6.4.3 against the new bundle, then `nginx -t && systemctl reload nginx`.

2. **Vendor ACME** — some commercial CAs now expose ACME endpoints (Sectigo, ZeroSSL, BuyPass, DigiCert all do at the time of writing). If yours does and AU IT enables ACME on the AU account, you can drive renewals with Certbot or `acme.sh` against the vendor's ACME URL via `--server`. Renewal becomes automated. Confirm with AU IT whether ACME is enabled.

Check current expiry on demand:

```bash
# [auishqosrgbwbs01]
$ sudo openssl x509 -in /etc/ssl/greenbook/wildcard.africanunion.org.fullchain.pem \
    -noout -dates
# Expected:
#   notBefore=...
#   notAfter=...     ← put a calendar reminder for ~30 days before this date.
```

Both [§8.3 (monitoring script)](08-day-2-operations.md#83-simple-monitoring-script) and [09 §9.6 (Observability hardening)](09-hardening-checklist.md#96-observability) probe cert expiry; the monitoring script alerts when ≤14 days remain. Don't rely solely on the calendar reminder — wire one or both of those in so a forgotten cert pages someone.

> **ℹ OCSP stapling on the AU intranet — confirm outbound to the CA's responder**
>
> The Nginx config has `ssl_stapling on; resolver 1.1.1.1 9.9.9.9` so it can fetch OCSP responses from the CA. If outbound HTTPS to the CA's OCSP responder is blocked from the VM (common on locked-down intranets), nginx logs `ssl_stapling_responder failed` or `OCSP_basic_verify() failed` warnings — the config still loads, but stapling is silently off and clients fall back to fetching OCSP themselves. Two fixes: (a) ask network ops to allow outbound HTTPS to your CA's OCSP URL (DigiCert: `ocsp.digicert.com`, Sectigo: `ocsp.sectigo.com`, GlobalSign: `ocsp.globalsign.com`); or (b) accept the regression and disable stapling in [`appendix/app-vm/greenbook.conf`](appendix/app-vm/greenbook.conf) by setting `ssl_stapling off; ssl_stapling_verify off;`. Stapling is a latency optimisation, not a security feature — modern clients cope fine without it.

### 6.5 Test the TLS deployment

```bash
# From your workstation (not the VM):
$ curl -I https://greenbook.africanunion.org/
# Expected: HTTP/2 200  (or an application redirect).
# Expected header: strict-transport-security: max-age=31536000; includeSubDomains

$ openssl s_client -connect greenbook.africanunion.org:443 \
  -servername greenbook.africanunion.org </dev/null 2>/dev/null | \
  openssl x509 -noout -subject -issuer -dates -ext subjectAltName
#   openssl s_client        open a raw TLS connection.
#   -connect HOST:PORT      what to connect to.
#   -servername NAME        SNI — indicate which vhost the connection is for.
#                            REQUIRED if multiple HTTPS sites live on the same IP.
#   </dev/null              empty stdin — don't wait for interactive input.
#   2>/dev/null             discard stderr (progress chatter).
#   | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
#                            parse the server cert from s_client's output
#                            and show who issued it, for whom, validity, and SAN.
# Expected (AU wildcard):
#   subject=CN = *.africanunion.org
#   issuer=    AU's CA's intermediate (DigiCert/Sectigo/etc.)
#   notBefore=...   notAfter=...   (typically 1 year apart)
#   X509v3 Subject Alternative Name:
#       DNS:*.africanunion.org, DNS:africanunion.org
```

> **✓ Check your grade**
>
> Test the HTTPS config at https://www.ssllabs.com/ssltest/ (public) or a private equivalent for internal hosts. With the config in §6.3, expect a solid "A" rating.

### 6.6 Adding a second app on the App VM

When a second AU app onboards on the same App VM, the work collapses to **three commands plus one edited per-app config file**. The shared configs (`/etc/nginx/conf.d/00-app-vm-shared.conf`, `/etc/nginx/snippets/app-vm-proxy-headers.conf`) are already in place from greenbook's onboarding (§6.3.1) and are reused as-is — no edits.

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
#   → server_name <app>.africanunion.org;          (both server blocks)
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

# (3) Symlink, test, reload:
$ sudo ln -sf /etc/nginx/sites-available/<app>.conf \
              /etc/nginx/sites-enabled/<app>.conf
$ sudo nginx -t
$ sudo systemctl reload nginx
```

The new app inherits the shared rate-limit zones (`app_general`, `app_auth`), the shared proxy-header / timeout / streaming policy (via `include /etc/nginx/snippets/app-vm-proxy-headers.conf`), and the WebSocket upgrade map — all defined once in §6.3.1, no duplication. Onboarding a second app does not disturb anything already running for greenbook.

> **ℹ Wildcard cert covers any `*.africanunion.org` hostname**
>
> The `ssl_certificate` paths in `<app>.conf` stay pointed at `/etc/ssl/greenbook/wildcard.africanunion.org.{fullchain.pem,key}` (the same files greenbook uses, per §6.4). One cert serves every per-app server block on this VM, so adding `<app>.africanunion.org` needs no new cert work — just the public DNS A / CNAME record from AU IT.

> **ℹ For the two-tier (DMZ-fronted) topology, see [12 §12.7](12-dmz-reverse-proxy.md#127-adding-future-apps-behind-the-same-proxy)**
>
> If you're running greenbook (and its sibling apps) behind the DMZ shared reverse proxy, every new App VM app **also** needs a per-app server block on the DMZ side. Onboard the App VM block first (this section), then the DMZ block. The two have the same shape but different concerns — DMZ does TLS + edge rate-limit + security headers; App VM does auth-rate-limit + cache policy + container hand-off.

---
