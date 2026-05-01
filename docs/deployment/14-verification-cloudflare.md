# 14 — Verification: Cloudflare in front of the deployment

> **Phase**: bring-up + day-2 · **Run on**: varies (some commands from your Mac, some from the DMZ VM) · **Time**: ~15 min for a clean run
>
> A standalone verification chapter for deployments where **Cloudflare sits between the public internet and the AU origin** (DMZ VM). Use alongside [chapter 13](13-verification.md) — Cloudflare adds two new layers in the request path that need their own tests:
>
> ```
> client → Cloudflare (TLS edge + WAF) → AU perimeter → DMZ VM → App VM → DB
> ```
>
> Cloudflare is the **public TLS terminator** in this topology. The AU wildcard cert at the DMZ is the **origin** cert (Cloudflare ↔ DMZ leg), not the public-facing cert. End users see Cloudflare's cert in their browser; only Cloudflare ever sees the AU wildcard cert.
>
> **Prev**: [13 — Verification](13-verification.md) · **Index**: [README](README.md)

---

## Contents

- [§14.1 What changes when Cloudflare is in the path](#141-what-changes-when-cloudflare-is-in-the-path)
- [§14.2 Confirm Cloudflare is fronting the hostname](#142-confirm-cloudflare-is-fronting-the-hostname)
- [§14.3 End-to-end test through Cloudflare](#143-end-to-end-test-through-cloudflare)
- [§14.4 Diagnose Cloudflare → origin failures (5xx codes)](#144-diagnose-cloudflare-origin-failures-5xx-codes)
- [§14.5 Verify TLS at the edge (Cloudflare ↔ client)](#145-verify-tls-at-the-edge-cloudflare-client)
- [§14.6 Verify TLS at the origin (Cloudflare ↔ DMZ)](#146-verify-tls-at-the-origin-cloudflare-dmz)
- [§14.7 Real client IP preservation through the chain](#147-real-client-ip-preservation-through-the-chain)
- [§14.8 Cloudflare error code reference](#148-cloudflare-error-code-reference)
- [§14.9 Symptoms to cause cheatsheet](#149-symptoms-to-cause-cheatsheet)
- [§14.10 Corporate web filter blocking \*.data POSTs](#1410-corporate-web-filter-blocking-data-posts)

## 14. Cloudflare verification

### 14.1 What changes when Cloudflare is in the path

Compared to the chapter 13 model where the DMZ VM is the public-facing TLS terminator, three things differ:

1. **Public DNS resolves to Cloudflare's anycast IPs**, not the AU public IP. Tools like `dig` will return Cloudflare ranges (`104.21.x.x`, `172.64.x.x`, `162.159.x.x`, `108.162.x.x`).
2. **Two TLS handshakes happen per request**: client ↔ Cloudflare (Cloudflare's cert), and Cloudflare ↔ origin (AU wildcard cert). Both must work; chapter 14 has separate sections for each.
3. **Origin is usually locked to Cloudflare IP ranges only**. Direct public access to the DMZ VM's `196.188.248.25:443` will be silently dropped or rejected — _that's intentional security_, not a bug. All verification has to go _through_ Cloudflare.

The AU IT side has to configure (these aren't VM-side concerns; you set them in the Cloudflare dashboard):

- **DNS proxied** (orange cloud) for `greenbook.africanunion.org` → origin IP
- **SSL/TLS mode**: "Full" or "Full (strict)" — never "Flexible" (which sends plain HTTP to origin and breaks our setup)
- **Edge cert**: Cloudflare's auto-issued universal SSL or a custom cert
- **Origin allowlist** (optional but recommended): AU perimeter firewall only accepts traffic from [Cloudflare's published IP ranges](https://www.cloudflare.com/ips/)

### 14.2 Confirm Cloudflare is fronting the hostname

```bash
# From your Mac (or any host on the public internet):

# (1) DNS resolution — should return Cloudflare anycast IPs
$ dig greenbook.africanunion.org +short
# Expected (Cloudflare IP ranges):
#   172.64.x.x      (172.64.0.0/13)
#   104.21.x.x      (104.16.0.0/13)
#   162.159.x.x     (162.159.0.0/16)
#   108.162.x.x     (108.162.192.0/18)
# AU's actual public IP (e.g., 196.188.248.25) appearing here = Cloudflare
#   isn't proxying yet (DNS-only mode / grey cloud)
# Empty output = AU IT hasn't published the DNS record at all

# (2) Show the full DNS response — useful for debugging delegation
$ dig greenbook.africanunion.org
# Look at:
#   ANSWER SECTION:    A records (Cloudflare IPs)
#   AUTHORITY SECTION: should reference Cloudflare nameservers
#                      (*.ns.cloudflare.com)

# (3) Confirm the zone is delegated to Cloudflare nameservers
$ dig africanunion.org NS +short
# Expected: 2 nameservers ending in .ns.cloudflare.com
# (e.g., max.ns.cloudflare.com, kate.ns.cloudflare.com)
# Other nameservers = the apex zone isn't on Cloudflare; only specific
#   records may be CNAME'd to a Cloudflare hostname

# (4) Reverse-confirm: are these IPs really Cloudflare's?
$ whois 172.64.35.109 | grep -i 'orgname\|netname\|cidr'
# Expected: NetName: CLOUDFLARENET, CIDR: 172.64.0.0/13
```

If (1) returns Cloudflare IPs, every command from §14.3 onwards is testing the production path.

### 14.3 End-to-end test through Cloudflare

This is the test that matters most. The whole stack — Cloudflare, AU perimeter, DMZ, App VM, container, DB — has to work end-to-end for this to succeed.

```bash
# From your Mac:

# (1) Basic HEAD request — does the public hostname work?
$ curl -sI https://greenbook.africanunion.org/
# Expected:
#   HTTP/2 200
#   server: cloudflare           ← confirms request hit Cloudflare
#   cf-ray: 8a3b...-LHR          ← unique request ID + Cloudflare datacenter
#   cf-cache-status: DYNAMIC     ← or HIT/MISS/EXPIRED for cacheable URLs
#   strict-transport-security: max-age=31536000; includeSubDomains
#   x-content-type-options: nosniff
#   x-frame-options: DENY
#   ratelimit-policy: 300;w=900   ← passed through from Express

# (2) Full healthz — proves Cloudflare → origin → app → DB chain works
$ curl -s https://greenbook.africanunion.org/healthz | head -c 400
# Expected:
#   {"status":"ok","version":"...","checks":{"process":"ok","db":"ok"},...}
# 5xx response (520-526) = Cloudflare can't reach origin — see §14.4
# 404 = healthz route not deployed (see [05 §5.3](05-app-vm-container.md))

# (3) Confirm cache-policy headers for static assets pass through
$ curl -sI https://greenbook.africanunion.org/manifest.json
# Expected:
#   HTTP/2 200
#   cache-control: public, max-age=3600
#   cf-cache-status: HIT (after first request) or MISS (first time)
# Cloudflare honours origin's Cache-Control by default.

$ curl -sI https://greenbook.africanunion.org/sw.js
# Expected:
#   cache-control: public, max-age=0, must-revalidate
#   cf-cache-status: BYPASS or DYNAMIC (must-revalidate prevents caching)

# (4) Performance smoke test — DNS + TLS + edge + origin combined timing
$ curl -w '\nDNS:%{time_namelookup} TLS:%{time_appconnect} TTFB:%{time_starttransfer}\n' \
    -o /dev/null -s https://greenbook.africanunion.org/
# Typical for Cloudflare-fronted:
#   DNS: ~0.05  TLS: ~0.20  TTFB: ~0.30
# (TLS is faster than direct because Cloudflare's edge is geographically
#  close. TTFB > 1.5s = origin is slow; check App VM / DB.)

# (5) Look at the Cloudflare datacenter you're hitting
$ curl -sI https://greenbook.africanunion.org/ | grep -i cf-ray
# Format: "cf-ray: <hex>-<airport>"
# Examples: -LHR (London), -ADD (Addis Ababa), -DXB (Dubai)
# Different datacenter on each request = anycast routing is healthy.
```

### 14.4 Diagnose Cloudflare → origin failures (5xx codes)

When the public hostname returns a Cloudflare-branded error page (HTTP 520–530), the failure is between Cloudflare and the origin. Cloudflare can serve that error page itself (it has reach to the client); it just can't proxy the actual request through.

```bash
# (1) Identify the specific Cloudflare error code
$ curl -sI https://greenbook.africanunion.org/
# Look at the HTTP status. Map to §14.8:
#   520-523 = origin connectivity (TCP layer)
#   524     = origin too slow (>100s default)
#   525-526 = origin TLS broken
#   530+1xxx = Cloudflare-specific (auth, plan limits)

# (2) Same request but verbose — see headers Cloudflare added
$ curl -v https://greenbook.africanunion.org/ 2>&1 | head -30
# Look for:
#   "cf-ray:" line — copy this. Cloudflare support / dashboard logs key
#                    on cf-ray for individual request tracing.
#   "server: cloudflare" — confirms request hit edge

# (3) From the DMZ VM — is Cloudflare actually reaching us?
# [auishqosrarp01]
$ sudo tail -20 /var/log/nginx/greenbook-edge.access.log
# Look for Cloudflare source IPs (within 172.64.0.0/13, 162.159.0.0/16,
# etc.). Each request should have:
#   - A Cloudflare source IP
#   - A "CF-RAY" header value matching what your Mac saw
# If NO Cloudflare IPs appear here, AU perimeter is blocking Cloudflare
# from reaching the DMZ.

# (4) Watch live what arrives during a public test
# [auishqosrarp01], in one terminal:
$ sudo tail -f /var/log/nginx/greenbook-edge.access.log
# In another terminal on your Mac:
$ for i in 1 2 3; do curl -sI https://greenbook.africanunion.org/ \
    | grep cf-ray; sleep 1; done
# 3 requests = should be 3 lines in the DMZ access log, each with a
# different Cloudflare source IP.

# (5) Look for Cloudflare attempts in the error log
# [auishqosrarp01]
$ sudo tail -50 /var/log/nginx/greenbook-edge.error.log | grep -iE 'cloudflare|172.64|162.159|104.21|108.162'
# "SSL_do_handshake() failed" from a Cloudflare IP = origin TLS issue
#   (525/526)
# "client closed connection while waiting" = Cloudflare gave up before
#   origin responded (524 — origin slow)
# No Cloudflare entries at all = Cloudflare can't even establish TCP
#   (521/522/523 — perimeter firewall blocks)
```

### 14.5 Verify TLS at the edge (Cloudflare ↔ client)

The cert your browser sees is Cloudflare's, not the AU wildcard. This validates Cloudflare's edge TLS configuration.

```bash
# From your Mac:

# (1) What cert is Cloudflare presenting?
$ echo | openssl s_client -connect greenbook.africanunion.org:443 \
    -servername greenbook.africanunion.org 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
# Expected:
#   subject= /CN=africanunion.org   (or *.africanunion.org)
#   issuer=  Google Trust Services / Cloudflare Inc / Sectigo / Let's
#            Encrypt — depends on AU's Cloudflare plan
#   notBefore: recent;  notAfter: 90 days out (auto-renewing on Cloudflare)
#   SAN includes greenbook.africanunion.org

# (2) Confirm modern protocols only (TLS 1.2 / 1.3)
$ echo | openssl s_client -connect greenbook.africanunion.org:443 \
    -servername greenbook.africanunion.org -tls1_3 2>&1 \
  | grep -iE 'protocol|cipher'
# Expected: Protocol: TLSv1.3, cipher TLS_AES_256_GCM_SHA384 or similar

# (3) Try TLS 1.0 / 1.1 — should be rejected by Cloudflare
$ echo | openssl s_client -connect greenbook.africanunion.org:443 \
    -servername greenbook.africanunion.org -tls1_1 2>&1 | head -5
# Expected: "alert protocol version" / handshake failure
# Cloudflare rejects pre-TLS-1.2 by default.

# (4) Online assessment (most thorough)
#     Open https://www.ssllabs.com/ssltest/analyze.html?d=greenbook.africanunion.org
#     in a browser. Should show:
#       - Grade A or A+
#       - Cert chain valid
#       - Modern protocols only
#       - HSTS preload eligible
#     The grade reflects Cloudflare's edge config — not anything on the
#     DMZ VM (which never speaks public TLS in this topology).

# (5) HSTS header passing through?
$ curl -sI https://greenbook.africanunion.org/ | grep -i strict
# Expected: strict-transport-security: max-age=31536000; includeSubDomains
# This is set by the DMZ nginx (00-au-tls.conf) and Cloudflare passes it
# through. Missing = check DMZ config.
```

### 14.6 Verify TLS at the origin (Cloudflare ↔ DMZ)

This leg uses the AU wildcard cert installed at `/etc/ssl/au/` on the DMZ VM. We can't easily test from outside (Cloudflare-only ingress means our Mac is blocked), but we can verify from inside.

```bash
# (1) From the DMZ VM — local TLS still works (smoke test)
# [auishqosrarp01]
$ curl -kI --resolve greenbook.africanunion.org:443:127.0.0.1 \
    https://greenbook.africanunion.org/
# Expected: HTTP/2 with status code (200 / 504 / etc. — see chapter 13).
# Confirms the AU wildcard cert + nginx TLS terminator are still working
# on this VM. If this fails, fix Layer 5 first ([13 §13.6](13-verification.md#136-layer-5-dmz-vm-nginx-tls-certificate)).

# (2) What cert does the DMZ present? (= what Cloudflare sees)
# [auishqosrarp01]
$ echo | openssl s_client -connect 127.0.0.1:443 \
    -servername greenbook.africanunion.org 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
# Expected:
#   subject=CN = *.africanunion.org
#   issuer=    AU's CA (DigiCert / Sectigo / etc.)
#   notAfter at least 30 days out
#   SAN: DNS:*.africanunion.org

# (3) Cloudflare's "SSL/TLS encryption mode" — what does it expect?
#     This is a Cloudflare dashboard setting; you can't query it from CLI
#     without the API. Settings:
#       - "Off"            = no TLS (insecure, never use)
#       - "Flexible"       = client→CF over TLS, CF→origin over plain HTTP
#                            BREAKS our setup (DMZ expects HTTPS)
#       - "Full"           = client→CF + CF→origin both over TLS,
#                            CF doesn't validate origin cert
#                            Works with self-signed origin certs
#       - "Full (strict)"  = same as Full but CF validates origin cert
#                            Works with our AU wildcard (publicly-issued)
#                            Recommended for AU's setup
#
#     If you have AU IT access:
#       Cloudflare dashboard → SSL/TLS → Overview → "SSL/TLS encryption mode"
#       Confirm: "Full (strict)"

# (4) From the DMZ — what IP is Cloudflare connecting from?
# [auishqosrarp01]
$ sudo tail -50 /var/log/nginx/greenbook-edge.access.log \
  | awk '{print $1}' | sort -u | head -20
# Expected: a list of Cloudflare source IPs. Should all be within
# the published Cloudflare ranges. If you see public-internet IPs other
# than Cloudflare's, the perimeter ACL isn't restricting properly.

# (5) Origin SSL handshake errors (Cloudflare → DMZ TLS broken)
# [auishqosrarp01]
$ sudo grep -iE 'SSL_do_handshake|SSL_read.*failed|sslv3 alert' \
    /var/log/nginx/error.log | tail -10
# These are signs of 525/526 from Cloudflare's view. Common causes:
#   - Cert expired (check §14.6 step 2)
#   - SAN doesn't cover greenbook.africanunion.org
#   - Cloudflare in "Full (strict)" but origin cert is self-signed
```

### 14.7 Real client IP preservation through the chain

With Cloudflare in front, `$remote_addr` at every node downstream is **a Cloudflare IP**, not the real client. Real client IP is preserved in headers:

- `CF-Connecting-IP`: real client IP (set by Cloudflare)
- `X-Forwarded-For`: append-style chain (real client → Cloudflare → DMZ)
- `True-Client-IP`: same as CF-Connecting-IP, on Cloudflare Enterprise

For accurate logging, rate-limiting, and audit at the App VM, the chain has to trust each hop and propagate the real IP. Tests:

```bash
# From your Mac:

# (1) Make a request and see what the App layer logged as your IP
$ MY_IP=$(curl -s ifconfig.me)
$ echo "My public IP: $MY_IP"
$ curl -sI -H "X-Trace: ${MY_IP}-test-$(date +%s)" \
    https://greenbook.africanunion.org/healthz

# (2) On the App VM — find that request in the logs
# [auishqosrgbwbs01]
$ sudo tail -50 /var/log/nginx/greenbook.access.log | grep "$MY_IP"
# Expected: a line with $MY_IP as the first field (after set_real_ip
# resolves it from the X-Forwarded-For chain).
# If you see a Cloudflare IP instead = the chain isn't trusting headers
# properly; chapter 06 §6.3 needs Cloudflare ranges in set_real_ip_from.

# (3) Inside the container — what does Express see?
# [auishqosrgbwbs01]
$ sudo -u deployer docker logs greenbook --tail 50 \
    | grep -i 'request' | tail -5
# Look at the logged IP. Should be your Mac's public IP, not a
# Cloudflare or App-VM IP.

# (4) Ask the app for its view of your IP
$ curl -s https://greenbook.africanunion.org/healthz | head -c 400
# If healthz includes the request's perceived client IP, compare to
# `curl ifconfig.me`. They should match.
```

If the logged IP isn't the real client, the trust chain is broken somewhere. Three places to check:

- **DMZ nginx**: must `set_real_ip_from <Cloudflare IP ranges>;` and `real_ip_header CF-Connecting-IP;` (or X-Forwarded-For)
- **App VM nginx**: must `set_real_ip_from 172.16.177.50;` (the DMZ) — already in our config
- **Express** (`server/app.ts`): must `app.set("trust proxy", N)` where N matches the proxy hop count (Cloudflare + DMZ + App VM = 3)

### 14.8 Cloudflare error code reference

Cloudflare-branded error pages (the `cloudflare.com` "Web server is down" / "Connection timed out" pages) use these codes:

| Code | Name                                           | Meaning                                                                                 | First place to check                                           |
| ---- | ---------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 520  | Web server returned an unknown error           | Origin returned empty / malformed response                                              | DMZ nginx error log; container logs                            |
| 521  | Web server is down                             | TCP connection to origin refused (perimeter firewall block, or origin nginx down)       | Perimeter firewall ACL allows Cloudflare ranges; nginx running |
| 522  | Connection timed out                           | TCP SYN to origin gets no SYN-ACK                                                       | Perimeter firewall is silently dropping                        |
| 523  | Origin is unreachable                          | Cloudflare has no route to origin IP                                                    | DNS at Cloudflare points at the right origin IP                |
| 524  | A timeout occurred                             | Origin accepted TCP, did TLS, but took >100s to return data                             | App VM logs for slow requests; DB query times                  |
| 525  | SSL handshake failed                           | TLS handshake between Cloudflare and origin failed                                      | DMZ cert expired / SAN wrong / nginx ssl_protocols too narrow  |
| 526  | Invalid SSL certificate                        | Cloudflare in "Full (strict)" can't validate origin cert (chain incomplete, name wrong) | Origin fullchain.pem includes intermediate; SAN matches host   |
| 530  | Cloudflare-specific (followed by 1xxx subcode) | DNS / authentication / plan limits                                                      | Cloudflare dashboard for the specific 1xxx subcode             |

### 14.9 Symptoms to cause cheatsheet

| What you observe                                                                     | Most likely cause                                                                                                | First test                                                                                  |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `dig` returns Cloudflare IPs                                                         | Cloudflare is fronting (expected)                                                                                | §14.3 step (1)                                                                              |
| `dig` returns AU public IP (not Cloudflare)                                          | Cloudflare proxy off (DNS-only mode)                                                                             | AU IT — toggle Cloudflare DNS record back to "Proxied" (orange cloud)                       |
| Browser cert warning                                                                 | Cloudflare edge cert misconfigured                                                                               | §14.5 step (1) / SSL Labs assessment                                                        |
| 521 (web server is down)                                                             | Perimeter firewall blocks Cloudflare ranges, or DMZ nginx not running on 443                                     | §14.4 step (3) — does Cloudflare appear in DMZ access log?                                  |
| 522 (timed out)                                                                      | Perimeter firewall silently drops Cloudflare traffic                                                             | AU IT — confirm Cloudflare ranges are allowed                                               |
| 523 (origin unreachable)                                                             | Cloudflare DNS for origin points at unreachable IP                                                               | AU IT — confirm Cloudflare DNS for `greenbook` points at correct AU public IP               |
| 524 (timeout)                                                                        | App VM / container slow                                                                                          | App VM logs for slow requests; DB query log                                                 |
| 525 (SSL handshake failed)                                                           | Origin TLS broken                                                                                                | §14.6 step (1) — does loopback HTTPS still work on DMZ?                                     |
| 526 (invalid SSL certificate)                                                        | Origin cert chain incomplete or name mismatch (Cloudflare in "Full (strict)")                                    | §14.6 step (2) — verify cert chain + SAN; ensure Full (strict) matches publicly-issued cert |
| HTTP 200 from public hostname but App VM logs show Cloudflare IP, not real client IP | Trust chain broken — DMZ nginx not configured to trust CF-Connecting-IP / X-Forwarded-For from Cloudflare ranges | §14.7 — check `set_real_ip_from` config on DMZ                                              |
| Public hostname works, no `cf-ray` header                                            | Cloudflare proxy disabled; request bypassing Cloudflare                                                          | §14.2 step (1) — confirm DNS returns Cloudflare IPs                                         |
| Direct test to `196.188.248.25:443` from your Mac fails                              | AU perimeter restricts origin to Cloudflare IPs only                                                             | This is **expected** in a Cloudflare-fronted deployment with proper ingress hardening       |
| `cf-cache-status: BYPASS` on every request                                           | Cache rules at Cloudflare or `Cache-Control: no-cache` from origin                                               | Inspect origin's Cache-Control headers; check Cloudflare Page Rules                         |

> **ℹ When to escalate to Cloudflare support**
>
> Cloudflare's free tier doesn't include direct support, but their community forum (community.cloudflare.com) is responsive when you provide a `cf-ray` ID. Capture the `cf-ray` from the failing request (`curl -sI ... | grep cf-ray`) and include it verbatim in any support thread.
>
> Paid plans give email/chat support that can read the actual edge logs for that `cf-ray`. For 525/526 issues that aren't reproducible from your tests, this is often the fastest path to root-cause.

### 14.10 Corporate web filter blocking \*.data POSTs

A common failure mode for greenbook deployments inside large enterprise networks (and the actual cause of a hard-to-debug login failure during AU's bring-up): a **corporate web security appliance** with TLS interception sits in path between internal users and the application. The appliance treats React Router 7's `*.data` action endpoints as file uploads (because of the URL extension) and blocks POSTs via its anti-malware sandbox / DLP policy.

**Symptom**

- Forms submit fine in dev / from machines outside the corporate network
- Inside the corporate network, POST to `*.data` endpoints (e.g. `/login.data`) returns a non-greenbook HTML page
- The page typically includes wording like "**Attention** / **File blocked** / **Quarantined File Name**" — corporate anti-malware vendor branding (Symantec WSS, Bluecoat ProxySG, Sophos, F5 Access Policy Manager, etc.)
- DMZ access log records the request as 403 with an unusually large response body (~20 KB — consistent with a vendor block page, not nginx's 200-byte default 403)

**Diagnosis**

Three commands localize the failure:

```bash
# (1) Capture the actual response body
$ curl -sk --resolve greenbook.africanunion.org:443:172.16.177.50 \
    -X POST -d 'test=1' \
    https://greenbook.africanunion.org/login.data \
  > /tmp/block.html
$ wc -c /tmp/block.html               # ~20 KB confirms vendor page
$ grep -iE 'block|quarantin|attention|file blocked' /tmp/block.html
# Hits = corporate appliance is the source. Look at <title>, any
# vendor logo, or block-ID / reference in the page.

# (2) Bypass the appliance — direct plain HTTP from DMZ to App VM
# [auishqosrarp01]
$ curl -v --max-time 5 -X POST \
    -H 'Host: greenbook.africanunion.org' \
    -d 'test=1' http://10.111.11.51/login.data 2>&1 | head -20
# Expected: 403 from greenbook's CSRF check (small body, helmet headers
# like X-XSS-Protection / X-Frame-Options) — proves the App VM stack
# is healthy and the block is upstream of plain-HTTP DMZ→App-VM path.
# A 20 KB "File blocked" page here would mean the appliance is on the
# DMZ→App-VM LAN segment too, which is a different (and more invasive)
# remediation.

# (3) Confirm your Mac has no system-level proxy
$ scutil --proxy
# Empty or just default exceptions (*.local, 169.254/16) = no system
# proxy. The interception is happening transparently at the network
# layer.
```

**Root cause**

The appliance has a corporate CA cert installed on every internal Mac (typically pushed via MDM). It transparently intercepts outbound HTTPS, decrypts using the corporate CA, inspects content, and blocks per policy. URL extensions like `.data`, `.dat`, `.bin` trigger generic "file upload" anti-malware rules even though they're legitimate React Router data-action endpoints carrying form-encoded bodies.

**Fix**

This is a **network/security team task**, not a deployment fix. The exact wording to send:

> Internal AU users on `greenbook.africanunion.org` are getting blocked when submitting any form. The corporate web security appliance is intercepting decrypted HTTPS traffic and treating React Router 7's `*.data` data-action endpoints as file uploads (the URL extension trips the sandbox / AV / DLP policy). The "Attention / File blocked" page is returned from the appliance itself, not from greenbook.
>
> Please add `*.africanunion.org` (or specifically `greenbook.africanunion.org`) to the appliance's bypass list for content inspection / sandbox / file-scanning. The site is internally-developed and `.data` is the standard React Router 7 form-action convention, not a file upload.

> **ℹ Why not change the URL convention instead**
>
> React Router 7's `.data` suffix is built into its data-loading protocol; changing it requires forking the framework or extensive route-shape gymnastics. Bypassing the appliance is the right fix — every React Router 7 deployment behind the same appliance will hit this same wall, and it's a one-time configuration change at the appliance.

---
