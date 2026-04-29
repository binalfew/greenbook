# 13 — Verification: testing the full stack layer by layer

> **Phase**: bring-up + day-2 · **Run on**: varies (each layer has its own VM) · **Time**: ~20 min for a clean run
>
> A layered verification runbook. Each layer's commands + expected output + remedy table assume the previous layer is green. Use this top-to-bottom for go-live, or jump straight to the layer that matches your symptom via the [§13.9 symptoms cheatsheet](#139-symptoms-to-layer-cheatsheet).
>
> The architecture this verifies: client → public DNS → DMZ VM (`196.188.248.25` / `172.16.177.50`) → App VM (`10.111.11.51`) → docker container (`127.0.0.1:3000`) → DB VM (`10.111.11.50:5432`).
>
> **Prev**: [12 — DMZ shared reverse proxy](12-dmz-reverse-proxy.md) · **Index**: [README](README.md)

---

## Contents

- [§13.1 The verification ladder](#131-the-verification-ladder)
- [§13.2 Layer 1 — DB VM: PostgreSQL alive](#132-layer-1-db-vm-postgresql-alive)
- [§13.3 Layer 2 — App VM ↔ DB VM connectivity](#133-layer-2-app-vm-db-vm-connectivity)
- [§13.4 Layer 3 — App VM: docker container + nginx](#134-layer-3-app-vm-docker-container-nginx)
- [§13.5 Layer 4 — DMZ VM ↔ App VM connectivity](#135-layer-4-dmz-vm-app-vm-connectivity)
- [§13.6 Layer 5 — DMZ VM: nginx, TLS, certificate](#136-layer-5-dmz-vm-nginx-tls-certificate)
- [§13.7 Layer 6 — Internet ↔ DMZ VM](#137-layer-6-internet-dmz-vm)
- [§13.8 Layer 7 — End-to-end via public DNS](#138-layer-7-end-to-end-via-public-dns)
- [§13.9 Symptoms to layer cheatsheet](#139-symptoms-to-layer-cheatsheet)

## 13. Verification

### 13.1 The verification ladder

Each layer is a prerequisite for the layers above it. If a higher layer fails, drop down to the layer it depends on — the failure is almost always there, not at the top.

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 7 — End-to-end via public DNS                          │  §13.8
│   curl https://greenbook.africanunion.org/healthz            │
├─────────────────────────────────────────────────────────────┤
│ Layer 6 — Internet → DMZ VM                                  │  §13.7
│   public 196.188.248.25:443 reachable from anywhere          │
├─────────────────────────────────────────────────────────────┤
│ Layer 5 — DMZ VM internal: nginx + TLS + cert                │  §13.6
│   loopback 127.0.0.1:443 with valid wildcard cert            │
├─────────────────────────────────────────────────────────────┤
│ Layer 4 — DMZ VM → App VM (LAN)                              │  §13.5
│   172.16.177.50 → 10.111.11.51:80 over private subnet        │
├─────────────────────────────────────────────────────────────┤
│ Layer 3 — App VM internal: docker + nginx                    │  §13.4
│   nginx :80 → docker container 127.0.0.1:3000                │
├─────────────────────────────────────────────────────────────┤
│ Layer 2 — App VM → DB VM (LAN)                               │  §13.3
│   10.111.11.51 → 10.111.11.50:5432 over private subnet       │
├─────────────────────────────────────────────────────────────┤
│ Layer 1 — DB VM internal: PostgreSQL                         │  §13.2
│   postgres serving the greenbook DB locally                  │
└─────────────────────────────────────────────────────────────┘
```

**Bring-up order**: Layer 1 → 7. Each layer's tests pass before moving up.

**Incident order**: Top-down. Run Layer 7; if it fails, run Layer 6; if that fails, Layer 5; and so on. The failing layer is the one to fix.

### 13.2 Layer 1 — DB VM: PostgreSQL alive

PostgreSQL serving the `greenbook` database to local connections. Nothing above this works without it.

```bash
# [auishqosrgbdbs01]

# (1) Postgres service alive?
$ sudo systemctl is-active postgresql
# Expected: active

# (2) Postgres listening on the right interfaces?
$ sudo ss -tlnp | grep ':5432'
# Expected:
#   LISTEN  127.0.0.1:5432  ...   (always — local connections)
#   LISTEN  10.111.11.50:5432 ... (LAN — set by 02 §2.4 listen_addresses)
# If only 127.0.0.1:5432 appears, the LAN listener is missing — Layer 2
# (App VM → DB) cannot work. Fix: edit /etc/postgresql/16/main/postgresql.conf
# and confirm listen_addresses = 'localhost,10.111.11.50'.

# (3) Database + role exist?
$ sudo -u postgres psql -c '\l' | grep greenbook
# Expected: line listing "greenbook" with owner "appuser"

$ sudo -u postgres psql -c '\du' | grep appuser
# Expected: line for "appuser"

# (4) Local app-user auth works?
$ PGPASSWORD='<APP_PASSWORD>' psql -U appuser -h localhost -d greenbook \
    -c "SELECT current_user, current_database(), version();"
# Expected: one row showing (appuser, greenbook, PostgreSQL 16.x ...)
# Substitute <APP_PASSWORD> with the real password from /etc/greenbook.env
# (DATABASE_URL field on the app VM — same password lives in postgres).

# (5) Schema is seeded?
$ sudo -u postgres psql greenbook -c '\dt' | head -10
# Expected: a list of greenbook tables (User, Tenant, Role, Permission, ...).
# Empty output = schema never pushed; run `npm run db:seed` from the app VM
# per 07 §7.5.
```

**Common failures and remedies:**

| Symptom                                                        | Cause                                             | Fix                                                                                                                                            |
| -------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `systemctl is-active postgresql` returns `inactive` / `failed` | Postgres crashed or never started                 | `sudo journalctl -u postgresql --since '1h ago'`; common: corrupt WAL, full disk, bad postgresql.conf edit                                     |
| Only 127.0.0.1:5432 in `ss` output                             | `listen_addresses = 'localhost'`                  | Edit `/etc/postgresql/16/main/postgresql.conf` per [02 §2.4](02-db-vm-setup.md), restart `postgresql`                                          |
| `psql -U appuser` → "password authentication failed"           | DATABASE_URL password doesn't match Postgres role | Reset role password: `sudo -u postgres psql -c "ALTER USER appuser PASSWORD '<new>';"` then update `/etc/greenbook.env` and recreate container |
| `\l` doesn't list greenbook                                    | Database never created                            | Re-run [02 §2.5](02-db-vm-setup.md) — `CREATE DATABASE greenbook OWNER appuser;`                                                               |
| `\dt` empty                                                    | Schema never pushed                               | Run `npm run db:seed` from app VM ([07 §7.5](07-deploy-workflow.md))                                                                           |
| "could not start server: ... read-only file system"            | Disk full                                         | `df -h`; clean up `/var/log/postgresql/`, `/var/lib/pgbackrest/`, journalctl                                                                   |

### 13.3 Layer 2 — App VM ↔ DB VM connectivity

The App VM can open a TCP connection to PostgreSQL on the DB VM, and the configured DATABASE_URL credentials authenticate correctly.

```bash
# [auishqosrgbwbs01]

# (1) Layer 4 — TCP port reachable?
$ nc -zv 10.111.11.50 5432
# Expected: "Connection to 10.111.11.50 5432 port [tcp/postgresql] succeeded!"
# "timed out" = UFW on DB VM blocking, or routing issue
# "refused"   = postgres not listening on 10.111.11.50:5432 (Layer 1 issue)

# (2) Layer 7 — auth + query works?
#     Read DATABASE_URL out of the env file used by the container:
$ sudo grep '^DATABASE_URL=' /etc/greenbook.env
# Format: postgres://appuser:<pwd>@10.111.11.50:5432/greenbook

#     Then test the connection directly:
$ source <(sudo grep '^DATABASE_URL=' /etc/greenbook.env)
$ psql "$DATABASE_URL" -c "SELECT current_user, current_database(), now();"
# Expected:
#   current_user | current_database |              now
#   --------------+------------------+-------------------------------
#   appuser       | greenbook        | 2026-04-29 10:00:00.123+00
# "FATAL: password authentication failed for user 'appuser'"
#   = password mismatch between DATABASE_URL and Postgres role
# "FATAL: no pg_hba.conf entry for host '10.111.11.51'"
#   = pg_hba.conf on DB VM doesn't have an entry for the App VM IP
# "could not connect to server: Connection refused"
#   = port reachable but postgres not accepting (config drift)

# (3) From INSIDE the running container (proves the app's view, not just
#     the host's):
$ sudo -u deployer docker exec greenbook \
    sh -c 'wget -qO- --header="Content-Type: application/json" http://127.0.0.1:3000/healthz'
# Expected: {"status":"ok","checks":{"process":"ok","db":"ok"},...}
# checks.db = "fail" or absence of "db" key = the container can't reach DB
```

**Common failures and remedies:**

| Symptom                              | Cause                                                         | Fix                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nc` times out                       | DB VM UFW blocks 10.111.11.51 → :5432                         | On DB VM: `sudo ufw allow from 10.111.11.51 to any port 5432 proto tcp` per [02 §2.7](02-db-vm-setup.md)                                                                 |
| `nc` "refused"                       | Postgres not listening on 10.111.11.50                        | See Layer 1 step (2); fix `listen_addresses`                                                                                                                             |
| `psql` auth fails                    | password mismatch OR pg_hba entry missing                     | Compare `/etc/greenbook.env` DATABASE_URL password against `\password appuser` on DB VM; verify `pg_hba.conf` has `host greenbook appuser 10.111.11.51/32 scram-sha-256` |
| `pg_hba.conf entry` error            | App VM IP not in pg_hba                                       | Add the entry per [02 §2.6](02-db-vm-setup.md), `sudo systemctl reload postgresql`                                                                                       |
| Container healthz `checks.db = fail` | DATABASE_URL inside container differs from /etc/greenbook.env | docker compose only reads env_file at container start — recreate: `sudo -u deployer docker compose -f /opt/greenbook/docker-compose.yml up -d --force-recreate`          |

### 13.4 Layer 3 — App VM: docker container + nginx

The greenbook docker container is up and healthy, the App VM nginx is serving on `:80`, and a request via loopback reaches the container.

```bash
# [auishqosrgbwbs01]

# (1) Docker daemon up?
$ sudo systemctl is-active docker
# Expected: active

# (2) Container running and healthy?
$ sudo -u deployer docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
# Expected:
#   NAMES       STATUS                    PORTS
#   greenbook   Up 2 hours (healthy)      127.0.0.1:3000->3000/tcp
# "(unhealthy)" = healthcheck is failing — see remedies below
# Container missing entirely = systemd unit didn't start; check `docker compose ps`

# (3) Container's healthcheck endpoint reachable from the host?
$ curl -sI http://127.0.0.1:3000/healthz
# Expected: HTTP/1.1 200 OK
# "Connection refused" = container not listening on 3000 (or container down)

# (4) Container's logs are clean?
$ sudo -u deployer docker logs greenbook --tail 30
# Expected: structured JSON pino logs ending with one or more entries showing
# normal request handling. Repeated stack traces / "ECONNREFUSED" / "P1001"
# (Prisma connection error) = upstream issue (Layer 2: DB connection).

# (5) nginx running and config valid?
$ sudo systemctl is-active nginx
# Expected: active

$ sudo nginx -t
# Expected: "syntax is ok" / "test is successful"

# (6) nginx listening on the right interface + port?
$ sudo ss -tlnp | grep nginx
# Expected: LISTEN ... :80 (and :80 only — no 443 in two-tier inner)

# (7) nginx hands off to docker through the per-app server block?
#     Use --resolve to bypass DNS and hit nginx via loopback with the
#     correct Host: header:
$ curl -sI --resolve greenbook.africanunion.org:80:127.0.0.1 \
    http://greenbook.africanunion.org/
# Expected: HTTP/1.1 200 OK with Express headers (x-correlation-id,
# x-powered-by: Express, ratelimit-*). The canonical greenbook.conf
# allows 127.0.0.1 + ::1 + 172.16.177.50, so loopback is permitted.
# 403 Forbidden = your greenbook.conf predates the loopback carve-out;
#                 add `allow 127.0.0.1; allow ::1;` above
#                 `allow 172.16.177.50;` (or re-fetch the canonical file
#                 from appendix/app-vm/greenbook.conf), then reload nginx
# 502 Bad Gateway = nginx accepted but couldn't reach the container
#                   (port 3000 dead, healthcheck red)
# 200 from /healthz returning HTML/empty = healthz route file missing
#                   (see [05 §5.3](05-app-vm-container.md))
```

**Common failures and remedies:**

| Symptom                                 | Cause                                                                                        | Fix                                                                                                                                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container `(unhealthy)`                 | healthcheck endpoint failing                                                                 | `sudo -u deployer docker logs greenbook --tail 50`; common: DATABASE_URL wrong, Prisma migrations not applied, port not bound                                                                                                             |
| `docker ps` empty                       | Container never started                                                                      | `sudo -u deployer docker compose -f /opt/greenbook/docker-compose.yml up -d`; check journalctl for systemd unit                                                                                                                           |
| `curl 127.0.0.1:3000/healthz` "refused" | Container not bound to 3000 or healthz route missing                                         | Verify `app/routes/healthz.tsx` exists in the deployed image; check container's `ports` mapping                                                                                                                                           |
| `nginx -t` "host not found in upstream" | Upstream block references a name nginx can't resolve                                         | Should be `127.0.0.1:3000` not a hostname; check `/etc/nginx/sites-enabled/greenbook.conf`                                                                                                                                                |
| 502 from nginx                          | Container dead or not bound                                                                  | Layer 3 step (2) + (3); usually a healthcheck issue                                                                                                                                                                                       |
| 403 from nginx on loopback              | `greenbook.conf` predates the loopback carve-out — only `172.16.177.50` is in the allow list | Re-fetch the canonical [`appendix/app-vm/greenbook.conf`](appendix/app-vm/greenbook.conf) (it allows 127.0.0.1 + ::1 + 172.16.177.50) OR add `allow 127.0.0.1; allow ::1;` above `allow 172.16.177.50;` and `sudo systemctl reload nginx` |

### 13.5 Layer 4 — DMZ VM ↔ App VM connectivity

The DMZ VM can reach the App VM at `10.111.11.51:80` over the private LAN. This is the link the DMZ's `proxy_pass http://greenbook_app` actually uses.

```bash
# [auishqosrarp01]

# (1) Layer 3 — IP routable?
$ ping -c 3 10.111.11.51
# Expected: 3 replies, ~1ms RTT on the LAN
# 100% packet loss = no route between DMZ and App VM subnets (network/firewall)
# "Network is unreachable" = DMZ has no route to 10.111.11.0/24

# (2) Layer 4 — TCP port 80 open?
$ nc -zv 10.111.11.51 80
# Expected: "succeeded" / "open"
# "timed out"  = packets reach the network but get dropped before App VM
#                (network firewall between subnets, OR App VM UFW blocking
#                 172.16.177.50)
# "refused"    = packets reach App VM but nothing on :80 (nginx down)

# (3) Layer 7 — HTTP request returns the expected response?
$ curl -sI http://10.111.11.51/
# Expected (App VM in two-tier inner shape, post §6.6):
#   HTTP/1.1 200 OK
#   x-correlation-id: ...
#   x-powered-by: Express
#
# Expected (App VM still in legacy single-tier):
#   HTTP/1.1 301 Moved Permanently
#   Location: https://greenbook.africanunion.org/
#   The App VM is redirecting HTTP→HTTPS; this is correct for single-tier.
#   Either run [06 §6.6](06-app-vm-nginx-tls.md#66-migrating-a-legacy-single-tier-app-vm)
#   to convert, or accept the 301 (the DMZ will pass it through).
#
# 403 / 444 / connection close from App VM:
#   App VM nginx's `allow 172.16.177.50; deny all;` may be filtering
#   incorrectly. Verify on App VM:
#   sudo grep -A1 'allow' /etc/nginx/sites-enabled/greenbook.conf

# (4) Send the actual request the DMZ proxy will send (with Host header):
$ curl -sI -H "Host: greenbook.africanunion.org" http://10.111.11.51/
# Same expected output as (3); proves Host-header routing works.
```

**Common failures and remedies:**

| Symptom               | Cause                                                                  | Fix                                                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ping` 100% loss      | No LAN route between 172.16.177.0/24 and 10.111.11.0/24                | AU IT routing config — talk to network team                                                                                                                                                 |
| `nc` "timed out"      | Network firewall between subnets, OR App VM UFW dropping 172.16.177.50 | On App VM: `sudo ufw status verbose`; verify rule `from 172.16.177.50 to any port 80 proto tcp ALLOW` exists per [06 §6.2](06-app-vm-nginx-tls.md#62-open-port-80-in-ufw-dmz-source-pinned) |
| `nc` "refused"        | App VM nginx not listening on 80                                       | Layer 3 step (5)/(6) on App VM                                                                                                                                                              |
| 403 from App VM nginx | `allow / deny` block rejecting DMZ source IP                           | Verify the `allow 172.16.177.50;` line is present in `greenbook.conf`; reload nginx                                                                                                         |
| 301 redirect to https | App VM still in single-tier (TLS terminator)                           | Run [06 §6.6 migration](06-app-vm-nginx-tls.md#66-migrating-a-legacy-single-tier-app-vm)                                                                                                    |

### 13.6 Layer 5 — DMZ VM: nginx, TLS, certificate

DMZ nginx is serving HTTPS on `:443` with the AU wildcard cert, and the per-app `greenbook.conf` server block routes by Host header.

```bash
# [auishqosrarp01]

# (1) nginx alive + config valid?
$ sudo systemctl is-active nginx
# Expected: active

$ sudo nginx -t
# Expected: "syntax is ok" / "test is successful"
# Common warnings here are benign:
#   "ssl_stapling ignored" (resolver can't reach OCSP) — see [12 §12.10](12-dmz-reverse-proxy.md#1210-renewal)
# Hard errors mean the next test will also fail.

# (2) Listening on 80 + 443?
$ sudo ss -tlnp | grep nginx | head -5
# Expected: both *:80 and *:443 (IPv4 and IPv6)

# (3) Cert files in the right place with correct perms?
$ sudo ls -l /etc/ssl/au/
# Expected:
#   -rw-r----- root www-data  wildcard.africanunion.org.key             (640)
#   -rw-r--r-- root root      wildcard.africanunion.org.fullchain.pem   (644)

# (4) Cert is the wildcard, not expired?
$ sudo openssl x509 -in /etc/ssl/au/wildcard.africanunion.org.fullchain.pem \
    -noout -subject -issuer -dates -ext subjectAltName
# Expected:
#   subject=CN = *.africanunion.org
#   issuer=    your AU CA (DigiCert / Sectigo / etc.)
#   notBefore=...   notAfter=...   (notAfter at least 30 days out)
#   X509v3 Subject Alternative Name: DNS:*.africanunion.org
# notAfter inside 14 days = renewal overdue; see [12 §12.10](12-dmz-reverse-proxy.md#1210-renewal)

# (5) Cert + key actually match (catches install-time mistakes)?
$ sudo bash -c '
    diff <(openssl x509 -in /etc/ssl/au/wildcard.africanunion.org.fullchain.pem -pubkey -noout) \
         <(openssl pkey  -in /etc/ssl/au/wildcard.africanunion.org.key -pubout)
'
# Empty output = match. Any diff = wrong key for this cert; re-extract from PFX.

# (6) Loopback HTTPS handshake — TLS terminates correctly?
$ curl -kI --resolve greenbook.africanunion.org:443:127.0.0.1 \
    https://greenbook.africanunion.org/
# Expected:
#   HTTP/2 <some status>
#   server: nginx/1.24.0
#   strict-transport-security: max-age=31536000; includeSubDomains
#   x-content-type-options: nosniff
#   x-frame-options: DENY
#   referrer-policy: strict-origin-when-cross-origin
# Status code passes through from upstream:
#   200 = Layer 4 → 3 → 2 → 1 all green (whole stack works locally)
#   504 = upstream timeout (Layer 4: DMZ can't reach App VM)
#   502 = upstream connection refused (Layer 4: App VM nginx down)
#   301 = upstream is single-tier App VM redirecting (Layer 4 issue, expected pre-§6.6)

# (7) What cert is actually presented over the wire?
$ echo | openssl s_client -connect 127.0.0.1:443 \
    -servername greenbook.africanunion.org 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
# Expected: same subject/issuer/dates as step (4). If it shows a stale cert,
# nginx didn't reload after the last cert install — `sudo systemctl reload nginx`.
```

**Common failures and remedies:**

| Symptom                                                  | Cause                                                                                         | Fix                                                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `nginx -t` "duplicate directive"                         | Default `nginx.conf` ssl_protocols / ssl_prefer_server_ciphers conflict with `00-au-tls.conf` | Comment out the SSL block in `/etc/nginx/nginx.conf` (Ubuntu defaults)                                                                   |
| Loopback handshake "tlsv1 alert" / "no peer certificate" | Cert files missing or wrong perms (nginx as www-data can't read .key)                         | Layer 5 step (3): re-set perms `chown root:www-data ...key && chmod 640 ...key`                                                          |
| Cert presented is wrong / expired                        | Stale cert; nginx didn't reload                                                               | `sudo systemctl reload nginx`; re-check step (7)                                                                                         |
| `ssl_stapling_responder failed` warnings                 | Outbound HTTPS to OCSP URL blocked                                                            | Either ask AU IT to allow outbound to your CA's OCSP responder (DigiCert: ocsp.digicert.com), or `ssl_stapling off;` in `00-au-tls.conf` |
| 504 from loopback test                                   | Upstream (App VM) timeout                                                                     | Drop to Layer 4                                                                                                                          |
| 301 from loopback test                                   | App VM in single-tier mode                                                                    | Expected pre-§6.6; not a Layer 5 problem                                                                                                 |

### 13.7 Layer 6 — Internet ↔ DMZ VM

The DMZ VM is reachable from the public internet at `196.188.248.25` on ports 80/443. This depends entirely on AU's perimeter NAT and firewall — not on anything inside the VM.

```bash
# From your Mac (off the AU LAN) or any host on the public internet:

# (1) TCP port 443 reachable from outside?
$ nc -zv 196.188.248.25 443
# Expected: "Connection to 196.188.248.25 port 443 [tcp/https] succeeded!"
# "timed out" = NAT/firewall not configured at the AU perimeter
# "refused"   = NAT works but DMZ nginx not listening (Layer 5 issue)

$ nc -zv 196.188.248.25 80
# Expected: same as 443 (DMZ nginx serves both, redirects 80 → 443)

# (2) HTTPS handshake reaches the DMZ?
$ curl -kI --resolve greenbook.africanunion.org:443:196.188.248.25 \
    https://greenbook.africanunion.org/
# Same response as Layer 5 step (6), but now the path is
# Mac → AU perimeter (DNAT) → DMZ VM:443. End-to-end through the public IP.
# If Layer 5 step (6) returned 200 but this returns "timed out", the
# perimeter NAT is the gap — talk to AU IT.

# (3) Inspect TLS chain as the public sees it:
$ openssl s_client -connect 196.188.248.25:443 \
    -servername greenbook.africanunion.org -showcerts </dev/null 2>/dev/null \
  | grep -E '^subject|^issuer'
# Expected: subject=CN=*.africanunion.org → issuer=AU CA intermediate
#           → issuer=root CA (the chain).
# Single subject/issuer line = chain not stapled correctly; step (4)
# of Layer 5 will tell you why.

# (4) Test from a couple of external networks (different ISPs):
$ curl -sI --resolve greenbook.africanunion.org:443:196.188.248.25 \
    https://greenbook.africanunion.org/
# Run from your phone hotspot, your home network, a coworker's laptop.
# All should succeed once NAT + firewall are in place. If only some
# work, the AU edge firewall may have source-IP allowlists.
```

**Common failures and remedies:**

| Symptom                                                                     | Cause                                                                              | Fix                                                                                                                 |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `nc 196.188.248.25 443` "timed out" from outside but Layer 5 loopback works | AU perimeter NAT not configured for `196.188.248.25:443 → 172.16.177.50:443`       | AU IT — confirm DNAT rule + firewall accept on the perimeter                                                        |
| Works from some networks, not others                                        | AU edge firewall has source-IP allowlist                                           | AU IT — relax allowlist or add the source you're testing from                                                       |
| Public connection works on 443 but cert chain shows only the leaf           | Intermediate not concatenated into `fullchain.pem`                                 | Re-run [§12.4](12-dmz-reverse-proxy.md#124-install-the-au-wildcard-certificate) (PFX extraction includes the chain) |
| 504 from public, 200 from Layer 5 loopback                                  | Reverse path broken — packets reach DMZ but DMZ's reply doesn't return through NAT | AU IT — check NAT state table and asymmetric routing                                                                |

### 13.8 Layer 7 — End-to-end via public DNS

The public hostname resolves to the DMZ VM's public IP, and a real client (browser, curl with no `--resolve`) can complete a request through the entire stack.

```bash
# From your Mac or any host on the public internet:

# (1) DNS resolves to the DMZ public IP?
$ dig @1.1.1.1 greenbook.africanunion.org +short
# Expected: 196.188.248.25
# Empty output = AU IT hasn't published the public A record yet
# Different IP = stale DNS pointing at a legacy single-tier App VM, OR
#                the record points at a different host (NAT VIP)

# (2) Real-client request — no --resolve, no -k:
$ curl -sI https://greenbook.africanunion.org/
# Expected: HTTP/2 200 with the same security headers as Layer 5 step (6).
# Cert errors here = TLS chain broken to general internet trust (intermediate
#                    missing); reproduce with Layer 5 step (4)/(7).

# (3) Healthz through the whole chain — confirms DB is reachable:
$ curl -s https://greenbook.africanunion.org/healthz | head -c 400
# Expected:
#   {"status":"ok","version":"<release>","checks":{"process":"ok","db":"ok"}, ...}
# checks.db != "ok" = Layer 2 issue (App VM ↔ DB)
# 502 / 504 here  = upstream broken (Layer 4 or 3)
# 30x redirect    = something in the stack is single-tier; trace it down

# (4) Browser smoke check:
#     Open https://greenbook.africanunion.org/ in a browser. Expected:
#       - Padlock icon (TLS valid)
#       - Login page renders
#       - DevTools Network tab shows HTTP/2 + the security headers
#     If the page loads but assets 404, check /assets/ via curl:
$ curl -sI https://greenbook.africanunion.org/manifest.json
# Expected: HTTP/2 200 + cache-control: public, max-age=3600

# (5) Performance smoke test:
$ curl -w '\nDNS:%{time_namelookup} TLS:%{time_appconnect} TTFB:%{time_starttransfer}\n' \
    -o /dev/null -s https://greenbook.africanunion.org/
# Expected (typical):
#   DNS: ~0.05  TLS: ~0.30  TTFB: ~0.50  (all in seconds)
# TTFB > 2s = upstream slow (App VM, DB, or network); investigate logs
```

**Common failures and remedies:**

| Symptom                                    | Cause                                                                                         | Fix                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `dig +short` empty                         | Public DNS A record not published                                                             | AU IT — add `greenbook.africanunion.org A 196.188.248.25`                                      |
| `dig +short` returns wrong IP              | DNS still points at legacy single-tier App VM                                                 | AU IT — flip the A record                                                                      |
| Browser shows cert warning ("not trusted") | Public connection is reaching wrong server (DNS pointing elsewhere), or cert chain incomplete | Step (1); if DNS correct, Layer 5 step (4)/(7)                                                 |
| 502 / 504 only after a deploy              | Container restart didn't complete                                                             | Layer 3 step (2)/(3) — wait for healthcheck or recreate                                        |
| `checks.db = fail` in healthz              | DB unreachable from container                                                                 | Layer 2                                                                                        |
| Slow TTFB                                  | Upstream slow                                                                                 | Check container logs and DB query times; [08 §8.x](08-day-2-operations.md) covers ongoing perf |

### 13.9 Symptoms to layer cheatsheet

When triaging an incident, start at the symptom row and jump straight to the indicated layer.

| What you observe                     | Most likely layer                           | First command to run                                                               |
| ------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| Public hostname doesn't resolve      | Layer 7                                     | `dig @1.1.1.1 greenbook.africanunion.org +short`                                   |
| Browser cert warning ("not trusted") | Layer 5 (chain) or Layer 7 (DNS)            | Layer 7 step (1), then Layer 5 step (7)                                            |
| `Connection refused` from public     | Layer 6 (NAT) or Layer 5 (nginx)            | `nc -zv 196.188.248.25 443`                                                        |
| `Connection timed out` from public   | Layer 6 (NAT)                               | `nc -zv 196.188.248.25 443`                                                        |
| HTTP 502 Bad Gateway                 | Layer 5 → 4 → 3                             | DMZ error log: `tail -20 /var/log/nginx/greenbook-edge.error.log`                  |
| HTTP 504 Gateway Timeout             | Layer 4 (DMZ → App VM)                      | `nc -zv 10.111.11.51 80` from DMZ                                                  |
| HTTP 503 Service Unavailable         | Layer 3 (container down)                    | `docker ps` on App VM                                                              |
| HTTP 301 redirect to https           | Layer 4 expected (App VM still single-tier) | Run [06 §6.6](06-app-vm-nginx-tls.md#66-migrating-a-legacy-single-tier-app-vm)     |
| HTTP 403 Forbidden                   | Layer 4 (allow/deny) or App-side rate limit | Check App VM nginx access log for the actual deny reason                           |
| HTTP 429 Too Many Requests           | Edge or app rate limit                      | Check `ratelimit-*` headers; tune zone in `01-au-rate-limit.conf`                  |
| `checks.db = fail` in /healthz       | Layer 2                                     | `nc -zv 10.111.11.50 5432` from App VM                                             |
| Login fails with "user not found"    | Layer 1 (DB seed)                           | `psql ... -c '\dt'` on DB VM                                                       |
| Container `(unhealthy)`              | Layer 3 (container internal)                | `docker logs greenbook --tail 50`                                                  |
| TLS cert expired warning             | Layer 5 (renewal)                           | Re-run [12 §12.4](12-dmz-reverse-proxy.md#124-install-the-au-wildcard-certificate) |
| Slow page loads (TTFB > 2s)          | Usually Layer 1/2 (DB)                      | Check DB query log; [02 §2.4](02-db-vm-setup.md) `log_min_duration_statement`      |

> **ℹ Run this top-to-bottom before go-live**
>
> The first time the deployment is brought up, run §13.2 → §13.8 in order. Every layer should pass cleanly. A failure at layer N means everything below N is fine and the issue is at exactly N — that's the whole point of the ladder. Don't try to fix layer N+1 without making layer N green first.

---
