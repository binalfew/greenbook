# 18 — Public DNS + Cloudflare

> **Phase**: 3 (app scaling + edge HA) · **Run on**: Cloudflare dashboard + AU IT changes (perimeter NAT, allowlist) + the existing DMZ nginx pair (from greenbook deployment ch12) · **Time**: ~4 hours including AU IT coordination
>
> Public-facing edge for the platform. Cloudflare in front of AU's perimeter NAT, which forwards to the DMZ nginx pair already deployed during greenbook's Phase 1. Folds in the hard-won lessons from greenbook deployment chapter 14 (Cloudflare 521s, TLS handshake failures, the corporate WAF blocking `*.data` POSTs). Closes Phase 3.
>
> Phase 3 chapter 6 of 6.
>
> **Prev**: [17 — HAProxy HA pair](17-haproxy.md) · **Next**: [19 — Backup strategy](19-backup-strategy.md) — _Phase 4_ · **Index**: [README](README.md)

---

## Contents

- [§18.1 Role + threat model](#181-role-threat-model)
- [§18.2 Topology recap (Cloudflare → AU NAT → DMZ → App)](#182-topology-recap-cloudflare-au-nat-dmz-app)
- [§18.3 Pre-flight (Cloudflare + AU IT prerequisites)](#183-pre-flight-cloudflare-au-it-prerequisites)
- [§18.4 Cloudflare zone configuration](#184-cloudflare-zone-configuration)
- [§18.5 Origin TLS — full strict mode + origin certificates](#185-origin-tls-full-strict-mode-origin-certificates)
- [§18.6 Origin IP allowlist (Cloudflare → DMZ only)](#186-origin-ip-allowlist-cloudflare-dmz-only)
- [§18.7 WAF rules + rate limiting](#187-waf-rules-rate-limiting)
- [§18.8 Cache rules](#188-cache-rules)
- [§18.9 Per-app DNS + cert workflow](#189-per-app-dns-cert-workflow)
- [§18.10 Lessons from greenbook deployment ch14](#1810-lessons-from-greenbook-deployment-ch14)
- [§18.11 Verification ladder](#1811-verification-ladder)
- [§18.12 Phase 4 path (DR site DNS failover)](#1812-phase-4-path-dr-site-dns-failover)
- [§18.13 Phase 3 close-out](#1813-phase-3-close-out)

## 18. Public DNS + Cloudflare

### 18.1 Role + threat model

The public edge has different threat exposure from anything we've built so far. Up to now, every chapter has been about **internal** services on `*.au-internal` reachable only from AU VLANs. Chapter 18 puts platform apps on **`*.africanunion.org`** — the public internet, with the entire planet as the threat surface.

Cloudflare is the perimeter:

- **DDoS absorption** — Cloudflare's anycast network absorbs L3/4 floods before they reach AU's perimeter
- **WAF** — bot scoring, OWASP rule set, custom rules per app
- **TLS termination at the edge** — clients see Cloudflare's cert; origin TLS is a separate hop
- **DNS authority** — `africanunion.org` zone hosted at Cloudflare
- **Cache** — static asset caching (favicons, CSS, JS) at edge POPs

What Cloudflare **does not** do:

- Replace authentication (apps still authenticate via Keycloak)
- Replace input validation (apps still validate; Cloudflare's WAF is a complement, not a substitute)
- Hide the existence of the platform (the public DNS records are visible; Cloudflare protects, not conceals)

Three consequences:

1. **Compromise = whole-platform exposure to the internet.** A misconfigured Cloudflare rule can expose internal endpoints, leak tokens via cache, or accept traffic that should be blocked. Defence: every config change in GitLab via Cloudflare's API + Terraform (Phase 5 ch23 automation); change-review on every WAF rule; quarterly audit of exposed routes vs. intended routes.
2. **Outage of Cloudflare = platform unreachable from the public internet.** Cloudflare itself has had global outages (rare, ~once every 12-18 months). Mitigation: AU's published DNS TTL on the zone is short (300 sec) so emergency repointing to a backup CDN is possible; Phase 4 DR plan documents the procedure.
3. **The most likely failure is "it works in dev, not in prod."** AU's corporate WAF (Symantec WSS / Bluecoat-class) intercepts every internal user's traffic to `*.africanunion.org`. The greenbook deployment's chapter 14 §14.10 documented this: legitimate POST traffic to URLs ending in `.data` was being treated as a "file upload" and quarantined. Defence: bypass-list `*.africanunion.org` at AU's corporate filter; document the diagnostic ladder so the next encounter is recognised in minutes, not days.

**Threat model — what we defend against:**

| Threat                                        | Mitigation                                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| L3/4 DDoS (volumetric)                        | Cloudflare's anycast absorbs at the edge; AU's perimeter never sees the flood                              |
| L7 DDoS (HTTP flood)                          | Cloudflare rate limiting + bot fight mode; per-IP per-route caps                                           |
| Bot enumeration / scraping                    | Cloudflare bot scoring; challenge for low-score traffic; block for known-bad ASNs                          |
| OWASP Top-10 (SQLi, XSS, etc.)                | Cloudflare Managed Rules (OWASP ruleset); apps still validate (defence in depth)                           |
| Origin IP exposed → bypass Cloudflare         | Origin firewall accepts only Cloudflare IPs (auto-updated allowlist); Authenticated Origin Pulls (Phase 5) |
| Hijack of the AU DNS zone                     | Cloudflare DNSSEC enabled; registry lock at the registrar; 2FA on Cloudflare admin accounts                |
| Stolen API token → unauthorised config change | Tokens scoped to single zone; short rotation; audit trail in Cloudflare logs                               |
| Corporate WAF false positives breaking apps   | Bypass-list `*.africanunion.org` at AU's filter; verification step in chapter 14 of greenbook deployment   |
| Cache poisoning (sensitive data cached)       | Explicit `Cache-Control: private` on auth-bearing responses; cache-rule allowlist by path, not deny-list   |

**Phase 3 deliberate non-goals:**

- **Cloudflare Tunnel (cloudflared)** — an alternative to perimeter NAT + DMZ allowlist. Phase 3 keeps the existing greenbook DMZ nginx topology; Cloudflare Tunnel is a Phase 5 option if AU IT is willing to remove the DMZ tier entirely.
- **Cloudflare Access (zero-trust)** — replaces the platform's Keycloak SSO at the edge. Out of scope; Keycloak (chapter 07) is the locked identity provider.
- **Cloudflare Workers** — edge code execution. Useful for niche cases (header rewriting, A/B test routing) but not needed for the platform-tier features in Phase 3.
- **Argo Smart Routing** — paid feature for latency optimisation. Out of scope for Phase 3; revisit after measuring real-world client latencies.

### 18.2 Topology recap (Cloudflare → AU NAT → DMZ → App)

The end-to-end traffic path, from client browser to platform app:

```
   ┌────────────┐
   │  Client    │  (anywhere on the internet)
   └─────┬──────┘
         │ HTTPS to greenbook.africanunion.org
         ▼
   ┌────────────────────────────────────────────────────────────┐
   │  Cloudflare edge (anycast POP, e.g., NRT/JNB/AMS/etc.)    │
   │  - DNS resolves greenbook.africanunion.org → CF anycast IP │
   │  - TLS terminates here with the AU wildcard               │
   │  - WAF + rate limit + bot scoring                         │
   └──────────────────────────┬─────────────────────────────────┘
                              │ HTTPS to origin
                              │ (single Cloudflare IP, Cloudflare-only egress)
                              ▼
   ┌────────────────────────────────────────────────────────────┐
   │  AU perimeter — public IP 196.188.248.25                  │
   │  - NAT translates port 443 → DMZ internal IP              │
   │  - Edge firewall: allowlist Cloudflare IP ranges only     │
   └──────────────────────────┬─────────────────────────────────┘
                              │ HTTPS, plain HTTP after auth tier
                              ▼
   ┌────────────────────────────────────────────────────────────┐
   │  DMZ nginx pair (greenbook deployment ch12)               │
   │  - TLS terminates again (origin cert)                     │
   │  - Per-host SNI routing to app VMs                        │
   │  - Per-host rate limit + IP allowlist                     │
   └──────────────────────────┬─────────────────────────────────┘
                              │ HTTP over App VLAN
                              ▼
   ┌────────────────────────────────────────────────────────────┐
   │  App VM nginx (greenbook deployment ch06)                 │
   │  - per-app upstream pool                                  │
   │  - forwards to app process listening on loopback          │
   └────────────────────────────────────────────────────────────┘
                              │
                              ▼
                          App + DB + everything else
```

Two TLS hops by design — Cloudflare to client, Cloudflare to origin. **Full Strict** mode (§18.5) means Cloudflare verifies the origin cert is valid and signed by a trusted CA; this prevents a MITM between Cloudflare and the AU perimeter.

The DMZ nginx pair from greenbook's deployment is **already deployed in Phase 1** — chapter 18 doesn't re-deploy it. This chapter wires Cloudflare in front of the existing DMZ.

### 18.3 Pre-flight (Cloudflare + AU IT prerequisites)

**Cloudflare side:**

- Cloudflare account with the `africanunion.org` zone in **Pro** plan minimum (Free lacks WAF Custom Rules, page rules at scale, and image-resizing). Business or Enterprise gives more rate-limit headroom + Argo if budget allows.
- Account-level 2FA enforced for every admin user.
- API tokens scoped to single zone with **edit DNS / edit firewall / edit cache** permissions only (no global account access).
- Tokens stored in Vault under `kv/platform/cloudflare/api_token` with 90-day rotation.

**AU IT prerequisites (engagement required):**

| Need                                               | Owner          | Notes                                                                                                              |
| -------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Public IP allocation for the platform              | AU IT network  | Currently `196.188.248.25` per DMZ topology memory; confirm dedicated to platform                                  |
| Perimeter NAT rule (CF → DMZ)                      | AU IT network  | TCP 443 from Cloudflare ranges → DMZ nginx primary IP                                                              |
| Edge firewall: Cloudflare IP allowlist             | AU IT security | Cloudflare publishes ranges at `https://www.cloudflare.com/ips-v4/`, `ips-v6`; auto-update via cron                |
| **Corporate WAF bypass-list `*.africanunion.org`** | AU IT security | **CRITICAL** — without this, internal users hitting platform apps trigger Symantec WSS / Bluecoat-class quarantine |
| DNS registrar registry lock                        | AU procurement | Prevents zone hijack at the registrar level — even with stolen Cloudflare creds                                    |

The **corporate WAF bypass** is the single most important AU IT step. Greenbook's deployment chapter 14 §14.10 spent two diagnostic days tracking this down: legitimate POST `/login.data` requests from internal AU users to `greenbook.africanunion.org` were being intercepted by the corporate filter, which scanned the URL ending in `.data` and treated the response as a "quarantined file upload." The fix is a single line in AU IT's filter config; documenting it here so the next platform team doesn't repeat the diagnosis.

```bash
# Cloudflare IP ranges — fetch + verify before AU IT firewall changes
$ curl -fsS https://www.cloudflare.com/ips-v4/ -o /tmp/cf-ips-v4.txt
$ curl -fsS https://www.cloudflare.com/ips-v6/ -o /tmp/cf-ips-v6.txt
$ wc -l /tmp/cf-ips-v4.txt /tmp/cf-ips-v6.txt
# Expected: ~15 IPv4 ranges, ~7 IPv6 ranges (changes occasionally)

# Hand these files to AU IT for the perimeter firewall allowlist.
# Set up a weekly cron on the bastion to re-fetch + diff + alert on changes.
```

### 18.4 Cloudflare zone configuration

Most of this is dashboard-driven; for repeatability, the same configuration is achievable via Terraform's `cloudflare_*` resources (Phase 5 ch23 automates this).

**Zone settings to set once per zone:**

| Setting                   | Value                                             | Why                                                         |
| ------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| SSL / TLS                 | **Full (strict)**                                 | Cloudflare verifies origin cert (§18.5)                     |
| Always Use HTTPS          | On                                                | Auto-redirect HTTP→HTTPS at the edge                        |
| Min TLS Version           | 1.2                                               | Drop 1.0/1.1 for clients                                    |
| Opportunistic Encryption  | On                                                | Free upgrade for cleartext-capable clients                  |
| TLS 1.3                   | On                                                | Modern handshakes                                           |
| Automatic HTTPS Rewrites  | On                                                | Rewrites `http://` → `https://` in HTML responses           |
| HSTS                      | On (max-age 6 months, includeSubDomains, preload) | Browser caches the HTTPS-only policy                        |
| DNSSEC                    | On                                                | Signs zone responses; protects against DNS tampering        |
| Browser Integrity Check   | On                                                | Cloudflare's basic abusive-header check                     |
| Challenge Passage         | 30 minutes                                        | How long an IP that solved a challenge is trusted           |
| Privacy Pass              | On                                                | Reduces challenge friction for repeat visitors              |
| Bot Fight Mode            | On (Pro plan)                                     | Free-tier abusive bot mitigation                            |
| Email Address Obfuscation | Off                                               | Off — let apps handle this; don't rewrite their HTML        |
| Rocket Loader             | Off                                               | Don't reorder JS — apps' bundlers do this correctly already |

**Network → IP Geolocation header:** add `CF-IPCountry` (free tier) so apps can geo-route or audit.

**Network → True-Client-IP header:** Pro+ plan; sends the original client IP at L7 instead of just `X-Forwarded-For`. The DMZ nginx config already trusts `CF-Connecting-IP` per greenbook deployment ch12.

### 18.5 Origin TLS — full strict mode + origin certificates

Cloudflare's three TLS modes from least to most secure:

| Mode              | Browser → CF | CF → Origin | Origin verifies?    |
| ----------------- | ------------ | ----------- | ------------------- |
| Off               | HTTP         | HTTP        | n/a                 |
| Flexible          | HTTPS        | HTTP        | No                  |
| Full              | HTTPS        | HTTPS       | No (any cert)       |
| **Full (strict)** | HTTPS        | HTTPS       | **Yes (CA-signed)** |

**Full (strict) is the only acceptable mode.** Anything else allows a MITM between Cloudflare and the AU perimeter — someone inside AU's ISP could swap in their own cert and Cloudflare would forward traffic to them.

Two ways to get a strict-verifiable cert at the origin:

**Option A — Cloudflare Origin CA (recommended)**

Cloudflare issues you a 15-year cert signed by a Cloudflare-internal CA that only Cloudflare trusts. Cloudflare → origin verifies; clients never see this cert (they see Cloudflare's edge cert).

```bash
# Dashboard: SSL/TLS → Origin Server → Create Certificate
# - Hostnames: *.africanunion.org, africanunion.org
# - Validity: 15 years
# - Type: ECC P-256

# Save the cert + private key to Vault for distribution
$ vault kv put kv/platform/cloudflare/origin_cert \
    cert_pem='<CERT_BLOCK>' \
    key_pem='<KEY_BLOCK>' \
    issued_at="$(date -Iseconds)" \
    expires_at='2041-05-02'

# Distribute to DMZ nginx pair
$ vault kv get -field=cert_pem kv/platform/cloudflare/origin_cert | \
    ssh dmz-nginx-01 'sudo tee /etc/nginx/ssl/cloudflare-origin.crt'
$ vault kv get -field=key_pem  kv/platform/cloudflare/origin_cert | \
    ssh dmz-nginx-01 'sudo tee /etc/nginx/ssl/cloudflare-origin.key'
$ ssh dmz-nginx-01 'sudo chmod 600 /etc/nginx/ssl/cloudflare-origin.key'
```

DMZ nginx then uses `cloudflare-origin.crt` for the public-facing 443 listener instead of (or alongside) the AU wildcard. The AU wildcard cert is still useful for internal-only paths (greenbook ch14 documented an internal `*.au-internal` use case).

**Option B — Public CA cert (Let's Encrypt or AU wildcard)**

Use the same AU wildcard `*.africanunion.org` cert that DMZ nginx already has. Cloudflare's strict verification trusts public CAs by default. No extra cert needed; minor downside is the wildcard rotates every 90 days (LE) or annually (paid wildcard) and rotation must propagate to DMZ nginx.

Phase 3 ships **Option A** — 15-year origin cert is operationally simpler for the platform tier. Apps that already have AU wildcard rotation tooling (greenbook does) keep using that on internal paths.

**Authenticated Origin Pulls** (Phase 5): Cloudflare presents a client cert to the origin; DMZ nginx verifies it. Means even if Cloudflare's IP ranges leak, only Cloudflare can connect. Adds a second factor to the IP allowlist.

### 18.6 Origin IP allowlist (Cloudflare → DMZ only)

The greenbook deployment chapter 12 already has the DMZ nginx pair allowlisting Cloudflare ranges in its `01-au-rate-limit.conf`. This chapter formalises the **maintenance pattern**:

```bash
# [bastion]
$ sudo tee /usr/local/bin/refresh-cf-ips.sh > /dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
TMPV4=$(mktemp); TMPV6=$(mktemp)
trap "rm -f $TMPV4 $TMPV6" EXIT
curl -fsS https://www.cloudflare.com/ips-v4/ -o "$TMPV4"
curl -fsS https://www.cloudflare.com/ips-v6/ -o "$TMPV6"

# Compare with last-known-good
if ! diff -q "$TMPV4" /var/lib/cf-ips-v4.txt 2>/dev/null; then
  logger -t cf-ips "Cloudflare IPv4 ranges changed — review + update DMZ + perimeter allowlists"
  cp "$TMPV4" /var/lib/cf-ips-v4.txt
  # Send the diff to platform-team-email (chapter 12)
fi
if ! diff -q "$TMPV6" /var/lib/cf-ips-v6.txt 2>/dev/null; then
  logger -t cf-ips "Cloudflare IPv6 ranges changed"
  cp "$TMPV6" /var/lib/cf-ips-v6.txt
fi
EOF
$ sudo chmod 755 /usr/local/bin/refresh-cf-ips.sh

# Weekly systemd timer
$ sudo tee /etc/systemd/system/refresh-cf-ips.timer > /dev/null <<'EOF'
[Unit]
Description=Weekly Cloudflare IP range refresh

[Timer]
OnCalendar=Mon 03:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

$ sudo tee /etc/systemd/system/refresh-cf-ips.service > /dev/null <<'EOF'
[Unit]
Description=Refresh Cloudflare IP ranges

[Service]
Type=oneshot
ExecStart=/usr/local/bin/refresh-cf-ips.sh
EOF

$ sudo systemctl daemon-reload
$ sudo systemctl enable --now refresh-cf-ips.timer
```

The script logs to journald → Loki; the alert-manager rule below catches changes:

```yaml
# Add to chapter 12's Loki rules
- alert: CloudflareIPRangesChanged
  expr: |
    sum(rate({unit="refresh-cf-ips.service"} |= "ranges changed" [1h])) > 0
  for: 1m
  labels:
    severity: warning
    service: cloudflare
  annotations:
    summary: "Cloudflare IP ranges changed — update DMZ + AU perimeter allowlists"
```

Cloudflare announces range changes ahead of time; alerts give the platform team a window to coordinate the AU IT firewall update.

### 18.7 WAF rules + rate limiting

Cloudflare's WAF has three tiers of rules:

1. **Managed Rules** — Cloudflare's curated rulesets (OWASP, Cloudflare Managed, exposed credentials check). Enable + leave on.
2. **Custom Rules** — per-platform business logic. Reviewed each addition.
3. **Rate Limiting Rules** — request-per-second caps per route + IP.

**Managed Rules — enable these:**

| Ruleset                         | Sensitivity | Action    | Why                                                 |
| ------------------------------- | ----------- | --------- | --------------------------------------------------- |
| Cloudflare Managed Ruleset      | High        | Block     | Generic OWASP + bot patterns                        |
| Cloudflare OWASP Core Ruleset   | High        | Block     | OWASP CRS — known signatures of common attacks      |
| Cloudflare Exposed Credentials  | Default     | Challenge | Detects login attempts using known-leaked passwords |
| Cloudflare Free Managed Ruleset | Default     | Block     | Free-tier abusive patterns                          |

**Custom Rules — initial set for the platform:**

```
1. Block: cf.client.bot AND not cf.bot_management.verified_bot
   Action: Block
   (Blocks unverified bot traffic — keeps Google + Bing through the verified-bot allow)

2. JS Challenge: ip.geoip.country in {country list with no AU stakeholders}
   Action: JS Challenge
   (Lower friction; legitimate users pass; scrapers fail)

3. Block: http.request.uri.path matches "^/.git" OR matches "^/.env"
   Action: Block
   (Common bot reconnaissance — reject without sending to origin)

4. Allow + cache: cf.zone.plan eq "PRO" AND http.request.uri.path eq "/healthz"
   Action: Cache for 30 sec
   (Internal health-check probes don't need to traverse the origin every time)
```

**Rate Limiting Rules — per platform:**

```
1. Login endpoints (matches ".+/login" or ".+/auth.+")
   Limit: 10 req/min per IP
   Action: Block for 15 min after threshold
   (Brute force mitigation; complements Keycloak's per-user lockout)

2. API write endpoints (matches "POST .+/api/.+")
   Limit: 100 req/min per IP
   Action: Block for 5 min
   (Abuse mitigation; per-app may need tuning)

3. Public read endpoints (greenbook public directory)
   Limit: 600 req/min per IP
   Action: Challenge
   (Generous — scraping concerns; allows normal browsing)
```

These are starting numbers. Tune per app's actual traffic pattern; document each rule's rationale in GitLab so reviewers know what was intentional.

### 18.8 Cache rules

The platform's apps are mostly authenticated — the default rule is **don't cache anything Cloudflare hasn't been told to cache**. Add explicit cache rules per static asset type.

| Path pattern                         | Cache TTL | Edge behaviour                           | Why                                           |
| ------------------------------------ | --------- | ---------------------------------------- | --------------------------------------------- |
| `*.css`, `*.js`, `*.svg`             | 1 month   | Cache by full URL; respect query strings | Bundlers hash filenames; cache-bust automatic |
| `*.woff2`, `*.woff`                  | 1 year    | Same                                     | Fonts are deeply immutable                    |
| `*.png`, `*.jpg`, `*.webp`, `*.avif` | 7 days    | Same                                     | Logos + UI imagery; cache headroom            |
| `/_assets/*`, `/static/*`            | 1 month   | Same                                     | Build-output paths from React Router 7        |
| Everything else (default)            | Bypass    | Pass through to origin                   | Authenticated content; never edge-cached      |

**Critical**: never cache responses that include `Set-Cookie`, `Authorization`, or `Cache-Control: private`. Cloudflare honours these headers by default; verify per app via the cache-rules-debugging steps in §18.11.

The ban-list (§18.10's lesson learned): never cache POST responses, never cache 4xx/5xx, never cache routes with `*` query strings unless the app explicitly opts in.

### 18.9 Per-app DNS + cert workflow

The contract for chapter 30 (App onboarding) — this is what's needed to publish a new app:

1. **Choose subdomain** — `<app>.africanunion.org` per platform convention.
2. **Submit DNS request** — DNS A record at Cloudflare pointing to AU's perimeter IP (`196.188.248.25` today).
3. **Add to DMZ nginx** — new `server { server_name <app>.africanunion.org; ... }` block per the greenbook deployment chapter 12 pattern.
4. **Add to App VM nginx** (or Nomad app via Consul SD per chapter 17).
5. **Add Cloudflare WAF Custom Rules** if app has special needs (e.g. webhook endpoints that need IP allowlists not rate limits).
6. **Verify with the chapter 14 (greenbook deployment) ladder** — section by section; the chapter is now the platform's authoritative test sheet.
7. **Open Linear / GitLab tracking issue** for AU IT corporate-WAF bypass-list verification (§18.10 lesson).

**DNS record definition (via Cloudflare API):**

```bash
$ CF_TOKEN=$(vault kv get -field=api_token kv/platform/cloudflare/api_token)
$ CF_ZONE_ID=$(curl -sf -H "Authorization: Bearer $CF_TOKEN" \
    "https://api.cloudflare.com/client/v4/zones?name=africanunion.org" | jq -r '.result[0].id')

$ curl -X POST \
    -H "Authorization: Bearer $CF_TOKEN" \
    -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
    -d '{
      "type": "A",
      "name": "<app>",
      "content": "196.188.248.25",
      "ttl": 1,
      "proxied": true
    }'
# proxied: true — traffic goes through Cloudflare (orange cloud)
# proxied: false — DNS-only (grey cloud) — exposes origin IP, never use for app traffic
```

Bulk DNS changes via Terraform (`cloudflare_record` resource) once Phase 5 ch23's automation is in place.

### 18.10 Lessons from greenbook deployment ch14

Greenbook deployment chapter 14 was written **after** the platform team spent significant time debugging real production failures. Surface them here so the next chapter author doesn't repeat them:

#### Lesson 1 — "Cloudflare 521 Web server is down"

**Cause**: AU perimeter NAT misconfigured — port 443 isn't forwarded, OR DMZ nginx isn't actually running, OR the firewall's allowlist doesn't include the Cloudflare range hitting the request.

**Diagnostic ladder** (15 min):

1. From outside AU, `curl -I https://<app>.africanunion.org/` — get the 521.
2. From AU IT laptop (bypassing corporate WAF), repeat — same 521 = Cloudflare → AU NAT broken.
3. From the bastion, `curl -kI https://196.188.248.25/` — if this fails, AU NAT broken.
4. From the bastion, `curl -kI https://<dmz-nginx-internal-ip>/` — if this works, only the NAT/firewall is broken.

**Fix**: AU IT verifies port-forward + Cloudflare allowlist on perimeter firewall. Common slip: a recent Cloudflare range expansion that AU IT's allowlist hasn't picked up.

#### Lesson 2 — "TLS handshake failure" between Cloudflare and origin

**Cause**: Origin presenting wrong cert (e.g., a self-signed cert when Full Strict is set), or hostname doesn't match SNI.

**Fix**: Use Cloudflare Origin CA cert (§18.5) per the workflow above. Verify with `openssl s_client -connect 196.188.248.25:443 -servername <app>.africanunion.org`.

#### Lesson 3 — Corporate WAF blocking `*.data` POSTs

**Cause**: AU IT's corporate filter (Symantec WSS / Bluecoat-class) intercepts every internal user's traffic. URLs ending in `.data` are pattern-matched as "file uploads" and the response is rewritten to a quarantine page (~20 KB HTML, looks like a 403).

**Fix**: AU IT bypass-list `*.africanunion.org` at the corporate filter. Two-day diagnostic the first time greenbook hit this.

**Detection signal**: external clients can POST to `<app>/login.data` and succeed (response is 200 + JSON token); internal clients get a 403 + 20+ KB HTML body. The size mismatch is the clearest signal.

#### Lesson 4 — Internal "spec.data" routes blocked by the same filter

Same root cause as Lesson 3. Documented separately because the route name is different and the symptom is "AJAX call returns HTML instead of JSON."

#### Lesson 5 — Cloudflare Always Use HTTPS 301 → infinite loop

If origin is set to TLS Mode "Flexible" instead of "Full (strict)", and the origin then redirects HTTP → HTTPS, traffic loops. **Fix**: always Full (strict). Phase 3 enforces this; the issue surfaced once during greenbook deployment.

### 18.11 Verification ladder

Greenbook deployment chapter 14 already has the canonical seven-layer verification ladder. **This chapter doesn't replicate it** — the existing ladder is the authoritative test sheet for any platform app:

| Layer | Test                                                                  | Greenbook ch14 reference |
| ----- | --------------------------------------------------------------------- | ------------------------ |
| 1     | DNS resolves to Cloudflare anycast IPs (not directly to AU perimeter) | §14.3                    |
| 2     | TLS to Cloudflare succeeds with valid cert                            | §14.4                    |
| 3     | Cloudflare → origin TLS handshake succeeds (Full Strict)              | §14.5                    |
| 4     | DMZ nginx → App VM HTTP forwarding works                              | §14.6                    |
| 5     | App responds with expected content                                    | §14.7                    |
| 6     | Cookie + session flow works end-to-end                                | §14.8                    |
| 7     | POST + write paths (the corporate-WAF check from §14.10)              | §14.9 + §14.10           |

Each new platform app re-runs this ladder before the chapter 30 onboarding workflow marks the app "publicly live."

### 18.12 Phase 4 path (DR site DNS failover)

Cloudflare Load Balancing (paid feature, Pro+ plan with Load Balancing add-on) does origin health checks and steers traffic away from a failed origin. Phase 4 [chapter 20 — DR site] introduces:

- A second AU perimeter IP at the DR location
- Cloudflare Load Balancer with both origins as pool members
- Health-check at the application layer (`GET /healthz`) — failing over within ~30 sec
- Geo-steering: AU users prefer primary DC; international users get whichever is healthier

What carries over unchanged: zone settings, WAF rules, cache rules, origin certs (the DR site uses the same cert because it's the same wildcard), the corporate-WAF bypass-list. Only the `proxied: true` A record changes — instead of a single origin IP, it points at a load-balanced pool name.

### 18.13 Phase 3 close-out

With chapter 18, **Phase 3 (app scaling + edge HA) is complete**. The platform now eliminates every "single VM" entry from the Phase 1+2 close-out tables and adds a public edge:

| Capability                | Phase 1+2 status            | After Phase 3                                        | Chapter |
| ------------------------- | --------------------------- | ---------------------------------------------------- | ------- |
| Application database      | Single VM (Keycloak DB)     | Primary + replica streaming repl; pgBackRest PITR    | 13      |
| Sessions / cache / queues | (none — apps used Postgres) | 3-VM Redis Sentinel cluster                          | 14      |
| Object storage            | (none — local FS chunks)    | 4-VM MinIO with EC; Loki/Mimir/Tempo migrated        | 15      |
| Connection pooling        | Direct app→Postgres         | PgBouncer pool with auth_query                       | 16      |
| Internal load balancing   | DNS round-robin             | HAProxy + VRRP + Consul SD                           | 17      |
| Public edge               | Greenbook DMZ nginx alone   | Cloudflare in front; corporate-WAF bypass documented | 18      |

**Phase 3 close-out summary** — same shape as the Phase 1 (ch06) and Phase 2 (ch12) tables:

| Component       | Phase 3 location                             | Phase 5 upgrade chapter                           |
| --------------- | -------------------------------------------- | ------------------------------------------------- |
| Postgres        | 2-VM streaming replication; manual failover  | 24 — Patroni for automated failover (RTO <30 sec) |
| Redis           | 3-VM Sentinel; one shared cluster            | 26 — Redis Cluster for sharding                   |
| MinIO           | 4-VM EC; Object Lock GOVERNANCE              | 25 — Cluster expansion + COMPLIANCE retention     |
| PgBouncer       | 2-VM active-active; userlist auth_user       | 22 — Vault dynamic credentials                    |
| HAProxy         | 2-VM VRRP + xinetd pg-isprimary              | 24 — Patroni REST API replaces xinetd             |
| Cloudflare edge | Origin CA + IP allowlist + WAF managed rules | (Phase 5) — Authenticated Origin Pulls            |

**Phase 4 starts with chapter 19** — Backup strategy. Phase 3 introduced backup _targets_ (MinIO buckets with Object Lock); Phase 4 introduces the unified _backup orchestration_ (RPO ≤ 1h target, all platform components covered, restore drills).

**Phase 3 closes on 2026-05-02.** App teams now have HA databases, fast caches, durable object storage, connection pooling, internal load balancing, and a public edge with WAF + DDoS protection. Per-app onboarding workflow lands in chapter 30; the chapter 14 (greenbook deployment) verification ladder is the authoritative go-live test sheet.

---
