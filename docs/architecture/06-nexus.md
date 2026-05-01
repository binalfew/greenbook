# 06 — Nexus

> **Phase**: 1 (developer foothold) · **Run on**: 1× Nexus VM (`auishqosrnex01`) · **Time**: ~75 min
>
> Sonatype Nexus Repository OSS — artifact storage for Maven, npm, NuGet, PyPI, Helm, Docker, and generic binaries. Hosts proxies of public registries (Maven Central, npm public) so app builds work even when the public internet is unreachable; hosts AU's own internal-only repos for proprietary artefacts. Single VM in Phase 1 (OSS edition, no HA without Pro tier).
>
> **Final chapter of Phase 1.** With Nexus, the developer-foothold tier is complete: bastion (operator entry), Vault (secrets), GitLab CE (source + CI + container registry), Nomad cluster (workload runtime), Nexus (artefact registry).
>
> **Prev**: [05 — Nomad cluster](05-nomad-cluster.md) · **Next**: Phase 2 chapters (07 onward) — TBD · **Index**: [README](README.md)

---

## Contents

- [§6.1 Role + threat model](#61-role-threat-model)
- [§6.2 Pre-flight](#62-pre-flight)
- [§6.3 Install Nexus OSS](#63-install-nexus-oss)
- [§6.4 Initial admin password rotation](#64-initial-admin-password-rotation)
- [§6.5 TLS via reverse proxy (nginx local)](#65-tls-via-reverse-proxy-nginx-local)
- [§6.6 Repository setup (Maven, npm, Docker, Generic)](#66-repository-setup-maven-npm-docker-generic)
- [§6.7 LDAP / Keycloak integration (deferred to Phase 2)](#67-ldap-keycloak-integration-deferred-to-phase-2)
- [§6.8 Backup strategy](#68-backup-strategy)
- [§6.9 Audit logging](#69-audit-logging)
- [§6.10 UFW + firewall rules](#610-ufw-firewall-rules)
- [§6.11 Verification](#611-verification)
- [§6.12 Path to Phase 2](#612-path-to-phase-2)

## 6. Nexus

### 6.1 Role + threat model

Nexus is the **artefact registry** for everything that isn't a container image. GitLab Container Registry (chapter 04 §4.7) handles Docker images; Nexus handles:

- **Java / Kotlin / Scala** Maven dependencies + AU-internal libraries
- **Node.js** npm proxies + private packages
- **Python** PyPI mirror + AU-internal wheels
- **Generic binaries** — RPMs, tarballs, executables, anything else CI produces or builds consume

Two consequences:

1. **Compromise = supply-chain compromise of every dependent build.** An attacker with write access to Nexus can replace `commons-logging-1.2.jar` with a backdoored version; every build that pulls it inherits the backdoor. Defence: write access restricted to CI service accounts (later: workload identity); proxies pull from upstream verified sources; checksums logged on push.
2. **Outage = build failures across the platform.** Builds that depend on Nexus (most of them) fail until Nexus is back. Mitigation: backups every 4 hours; documented restore RTO ≤30 minutes from backup. Critical builds use Nexus only for AU-internal artefacts; public dependency proxies cache locally so a Nexus blip during a build often just hits the local cache.

**Threat model — what we defend against:**

| Threat                                           | Mitigation                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Supply chain attack via tampered AU-internal pkg | Write access via service-account tokens only; tokens stored in Vault; audit log on push  |
| Public dependency replaced by malicious version  | Proxies use upstream's checksum verification; proxy entries pinned to specific upstreams |
| Stolen admin password                            | Admin password stored in Vault; Phase 2 LDAP/SSO removes standing local admin            |
| Disk fill from runaway artefact uploads          | Per-repo storage quotas + cleanup policies (Tasks → Cleanup unused snapshots, etc.)      |
| Lost data on the Nexus VM                        | Backups every 4h to local; Phase 3 to MinIO; Phase 4 off-site replication                |

**Phase 1 deliberate non-goals:**

- **Nexus Repository Pro features** — clustering, repository health checks, IQ Server integration. OSS edition is fine for AU's scale; revisit only if we hit limits.
- **Nexus IQ Server** (vulnerability scanning) — separate paid product. GitLab's built-in container scanning + dependency scanning covers most of the same ground for Phase 1.
- **AU-public artefact distribution** — Nexus is internal-only; no external customers consume from it.

### 6.2 Pre-flight

One Ubuntu 24.04 VM hardened to AU base (greenbook chapter 01 §1.1-§1.7). Skip §1.8. Operator account membership per chapter 02 §2.4.

| Resource | Value                           | Why                                                                              |
| -------- | ------------------------------- | -------------------------------------------------------------------------------- |
| vCPU     | 2                               | Nexus is JVM-based; not CPU-bound for typical artefact serving                   |
| RAM      | 4 GB                            | JVM heap default 1.2 GB; OS overhead; comfortable for ~100 concurrent users      |
| Disk     | 200 GB SSD (root) + 1 TB (data) | Artefact storage grows with usage; proxy caches alone can be ~50 GB after 1 year |

Hostname: `auishqosrnex01`. IP: `10.111.30.40`. VLAN 4 (Platform).

```bash
# [auishqosrnex01]
$ lsb_release -d
$ sudo systemctl is-active unattended-upgrades fail2ban
$ groups | grep operators

# Confirm 1 TB data disk mounted at /opt/sonatype/sonatype-work
$ mount | grep sonatype
# If not mounted yet:
$ sudo install -d -m 755 /opt/sonatype/sonatype-work
$ sudo mount -o defaults <DATA_DEVICE> /opt/sonatype/sonatype-work
# Add to /etc/fstab.
```

### 6.3 Install Nexus OSS

Nexus ships as a tarball; no apt repo. Install JDK first, then Nexus.

```bash
# [auishqosrnex01]

# (1) Install OpenJDK 17 (Nexus 3.x requires Java 8+ but recommends 11+)
$ sudo apt install -y openjdk-17-jre-headless
$ java -version
# Expected: openjdk version "17.x.x"

# (2) Create the nexus user
$ sudo useradd --system --create-home --home-dir /opt/sonatype \
    --shell /bin/bash --comment "Sonatype Nexus" nexus

# (3) Download Nexus OSS — pin a known version
$ NEXUS_VERSION=3.65.0-02   # check for latest LTS at https://help.sonatype.com/repomanager3/release-notes
$ cd /tmp
$ wget https://download.sonatype.com/nexus/3/nexus-${NEXUS_VERSION}-unix.tar.gz
$ wget https://download.sonatype.com/nexus/3/nexus-${NEXUS_VERSION}-unix.tar.gz.sha256

# (4) Verify checksum
$ sha256sum -c nexus-${NEXUS_VERSION}-unix.tar.gz.sha256
# Expected: nexus-...-unix.tar.gz: OK

# (5) Extract to /opt/sonatype/nexus
$ sudo tar -xzf nexus-${NEXUS_VERSION}-unix.tar.gz -C /opt/sonatype/
$ sudo ln -sf /opt/sonatype/nexus-${NEXUS_VERSION} /opt/sonatype/nexus
$ sudo chown -R nexus:nexus /opt/sonatype

# (6) Configure Nexus to run as the `nexus` user
$ sudo tee /opt/sonatype/nexus/bin/nexus.rc > /dev/null <<'EOF'
run_as_user="nexus"
EOF

# (7) systemd unit
$ sudo tee /etc/systemd/system/nexus.service > /dev/null <<'EOF'
[Unit]
Description=Sonatype Nexus Repository
After=network-online.target
Wants=network-online.target

[Service]
Type=forking
LimitNOFILE=65536
ExecStart=/opt/sonatype/nexus/bin/nexus start
ExecStop=/opt/sonatype/nexus/bin/nexus stop
User=nexus
Group=nexus
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

$ sudo systemctl daemon-reload
$ sudo systemctl enable --now nexus

# (8) Watch startup — Nexus takes ~60-90 seconds to come up
$ sudo tail -f /opt/sonatype/sonatype-work/nexus3/log/nexus.log
# Wait for: "Started Sonatype Nexus OSS 3.x.x"
# Then Ctrl+C.
```

### 6.4 Initial admin password rotation

Nexus generates a random admin password on first boot and writes it to a file that auto-deletes after first login. Same discipline as GitLab (chapter 04 §4.6).

```bash
# [auishqosrnex01]

# (1) Read the bootstrap password
$ sudo cat /opt/sonatype/sonatype-work/nexus3/admin.password
# Output: a 36-character UUID-like string

# (2) Login at http://auishqosrnex01:8081/ as `admin` with that password.
#     Nexus prompts you to set a new admin password on first login.
#     Choose a strong, unique password.

# (3) Store the new password in Vault
$ vault kv put kv/platform/nexus/admin_password \
    password='<new-strong-password>' \
    rotated_at="$(date -Iseconds)" \
    rotation_period_days=90

# (4) Configure anonymous access (per AU policy):
#     Login → Security → Anonymous Access → enable for read of public-facing
#     repos; disable for AU-internal repos.

# (5) Once first login completes, the bootstrap file auto-deletes.
#     Verify:
$ sudo ls -la /opt/sonatype/sonatype-work/nexus3/admin.password
# Expected: "No such file or directory"
```

### 6.5 TLS via reverse proxy (nginx local)

Nexus' built-in HTTPS support exists but is awkward to operate alongside the JVM. Easier: terminate TLS in a small nginx instance on the same VM, proxying to Nexus on `:8081` over loopback.

```bash
# [auishqosrnex01]

# (1) Install nginx
$ sudo apt install -y nginx

# (2) Drop in the AU wildcard cert
$ sudo install -d -m 755 /etc/nginx/ssl
$ sudo install -m 644 -o root -g root \
    wildcard.africanunion.org.fullchain.pem \
    /etc/nginx/ssl/nexus.africanunion.org.crt
$ sudo install -m 600 -o root -g root \
    wildcard.africanunion.org.key \
    /etc/nginx/ssl/nexus.africanunion.org.key

# (3) Site config
$ sudo tee /etc/nginx/sites-available/nexus > /dev/null <<'EOF'
upstream nexus_app {
    server 127.0.0.1:8081;
    keepalive 16;
}

server {
    listen 80;
    server_name nexus.africanunion.org;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name nexus.africanunion.org;

    ssl_certificate     /etc/nginx/ssl/nexus.africanunion.org.crt;
    ssl_certificate_key /etc/nginx/ssl/nexus.africanunion.org.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;

    # Nexus generates large file uploads (containers, JARs) — bump limits
    client_max_body_size 1024m;
    proxy_request_buffering off;

    # Long timeouts for big artefact uploads / downloads
    proxy_connect_timeout 60s;
    proxy_send_timeout    600s;
    proxy_read_timeout    600s;

    location / {
        proxy_pass http://nexus_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }
}
EOF

$ sudo ln -sf /etc/nginx/sites-available/nexus /etc/nginx/sites-enabled/nexus
$ sudo rm -f /etc/nginx/sites-enabled/default
$ sudo nginx -t && sudo systemctl reload nginx

# (4) Tell Nexus its public-facing base URL
#     Login → Settings → Repository → Base URL → https://nexus.africanunion.org
#     (or via API; UI is simpler for one-time setup)

# (5) Verify
$ curl -kI https://nexus.africanunion.org/
# Expected: HTTP/2 200; cert chain valid
```

### 6.6 Repository setup (Maven, npm, Docker, Generic)

Nexus comes with default repos for `maven-central` (proxy), `maven-public` (group), `maven-releases` (hosted), `maven-snapshots` (hosted), `nuget.org-proxy`, and `nuget-public`. Phase 1 adds:

| Repository         | Type   | Format | Purpose                                                                                                                 |
| ------------------ | ------ | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| `npm-public`       | proxy  | npm    | Caches public npm registry (https://registry.npmjs.org)                                                                 |
| `npm-internal`     | hosted | npm    | AU-internal npm packages                                                                                                |
| `npm-group`        | group  | npm    | Combines proxy + internal — apps point at this URL                                                                      |
| `pypi-public`      | proxy  | pypi   | Caches https://pypi.org/simple                                                                                          |
| `pypi-internal`    | hosted | pypi   | AU-internal Python packages                                                                                             |
| `pypi-group`       | group  | pypi   | Combines proxy + internal                                                                                               |
| `generic-internal` | hosted | raw    | AU-internal binary artefacts (RPMs, tarballs, etc.)                                                                     |
| `docker-internal`  | hosted | docker | Internal-only Docker images (GitLab Container Registry handles primary; this is a fallback for non-GitLab CI consumers) |

Setup via UI: Server administration → Repositories → Create repository. For each new repo, follow the type-specific wizard (proxy URL, storage location, blob store).

Or via API (faster for bulk setup; requires admin token):

```bash
# (Example) Create npm-public proxy via Nexus REST API
$ ADMIN_PW=$(vault kv get -field=password kv/platform/nexus/admin_password)
$ curl -u "admin:${ADMIN_PW}" -X POST \
    -H "Content-Type: application/json" \
    "https://nexus.africanunion.org/service/rest/v1/repositories/npm/proxy" \
    -d '{
      "name": "npm-public",
      "online": true,
      "storage": {
        "blobStoreName": "default",
        "strictContentTypeValidation": true
      },
      "proxy": {
        "remoteUrl": "https://registry.npmjs.org",
        "contentMaxAge": 1440,
        "metadataMaxAge": 1440
      },
      "negativeCache": {
        "enabled": true,
        "timeToLive": 1440
      },
      "httpClient": {
        "blocked": false,
        "autoBlock": true
      }
    }'
```

**Per-app consumption** (covered in detail in chapter 30):

```bash
# npm — point .npmrc at the group endpoint
registry=https://nexus.africanunion.org/repository/npm-group/

# Maven — settings.xml mirror
<mirror>
  <id>nexus</id>
  <mirrorOf>*</mirrorOf>
  <url>https://nexus.africanunion.org/repository/maven-public/</url>
</mirror>

# Pip — pip.conf
[global]
index-url = https://nexus.africanunion.org/repository/pypi-group/simple
```

### 6.7 LDAP / Keycloak integration (deferred to Phase 2)

Phase 1 uses Nexus' local user database. Each operator gets a local Nexus account. Phase 2 [chapter 07 — Keycloak](07-keycloak.md) introduces SSO; chapter 08 federates to AU AD; Nexus picks up SSO via its built-in SAML/LDAP integration.

Until then, manage users via UI: Security → Users → Create user. Use AU-style usernames; require strong passwords; enforce role assignments.

### 6.8 Backup strategy

Nexus' data is split between the database (H2 by default; Postgres optional) and the blob store (filesystem under `/opt/sonatype/sonatype-work/nexus3/blobs/`). Both must be backed up.

```bash
# [auishqosrnex01]

# (1) Schedule a Nexus-internal task: Server administration → System →
#     Tasks → Create task → "Admin - Export databases for backup"
#     Configure: cron schedule "0 */4 * * *" (every 4 hours);
#     destination /opt/sonatype/sonatype-work/nexus3/backup

# (2) Filesystem snapshot of the entire sonatype-work dir (DB + blobs)
$ sudo tee /etc/cron.d/nexus-backup > /dev/null <<'EOF'
# Nexus filesystem backup — runs after the database export task
30 */4 * * * root tar -czf /var/backups/nexus/nexus-$(date +\%Y\%m\%d-\%H\%M).tar.gz -C /opt/sonatype/sonatype-work nexus3 2>&1 | logger -t nexus-backup
EOF

$ sudo install -d -m 750 -o root -g root /var/backups/nexus

# (3) Retain last 7 days locally; older off-site (Phase 4)
$ sudo tee -a /etc/cron.d/nexus-backup > /dev/null <<'EOF'
0 5 * * * root find /var/backups/nexus -name 'nexus-*.tar.gz' -mtime +7 -delete
EOF

# (4) Verify after the first scheduled run
$ ls -lh /var/backups/nexus/
```

**Restore** (documented in chapter 41 — incident response):

1. Stop Nexus: `sudo systemctl stop nexus`
2. Replace `/opt/sonatype/sonatype-work/nexus3` with the backup tarball contents
3. Start Nexus: `sudo systemctl start nexus`
4. Wait for "Started Sonatype Nexus OSS" in logs
5. Verify a known artefact is retrievable

### 6.9 Audit logging

Nexus logs to `/opt/sonatype/sonatype-work/nexus3/log/`. Three files:

- `nexus.log` — main application log
- `request.log` — HTTP access log
- `audit.log` — security events (logins, permission changes, etc.) — **enable in admin UI**: Server administration → System → Audit → enable

```bash
# [auishqosrnex01]

# Watch live audit during a login attempt
$ sudo tail -f /opt/sonatype/sonatype-work/nexus3/log/audit.log

# Search for failed logins
$ sudo grep -i 'failed\|denied' /opt/sonatype/sonatype-work/nexus3/log/audit.log
```

logrotate is included in the apt-installable Nexus package; verify it's catching `audit.log` (not just `nexus.log`).

### 6.10 UFW + firewall rules

```bash
# [auishqosrnex01]

# Allow HTTPS (443) from operator + App + Platform VLANs
$ sudo ufw allow from 10.111.10.0/24 to any port 443 proto tcp \
    comment 'App VLAN → Nexus (CI fetches dependencies)'
$ sudo ufw allow from 10.111.30.0/24 to any port 443 proto tcp \
    comment 'Platform VLAN → Nexus'
$ sudo ufw allow from 10.111.40.0/24 to any port 443 proto tcp \
    comment 'Operations VLAN → Nexus (operator admin)'

# Redirect 80 → 443 — open 80 for the redirect to work
$ sudo ufw allow from 10.111.10.0/24 to any port 80 proto tcp comment 'Nexus 80→443 redirect'
$ sudo ufw allow from 10.111.30.0/24 to any port 80 proto tcp comment 'Nexus 80→443 redirect'

$ sudo ufw status verbose | grep -E '443|80'
```

Internal-only by design. The DMZ tier doesn't proxy to Nexus — there's no public consumer.

### 6.11 Verification

```bash
# (1) Service running
$ sudo systemctl status nexus --no-pager | head -10
# Expected: active (running)

# (2) UI reachable + cert valid
$ curl -kI https://nexus.africanunion.org/
# Expected: HTTP/2 200

# (3) Login as admin (via UI; check audit.log captured)
$ sudo grep '"Login"' /opt/sonatype/sonatype-work/nexus3/log/audit.log | tail -1

# (4) Default repos exist
$ curl -k -u "admin:${ADMIN_PW}" \
    "https://nexus.africanunion.org/service/rest/v1/repositories" \
  | jq '.[].name'
# Expected: at minimum maven-central, maven-public, maven-releases,
#           nuget.org-proxy

# (5) npm proxy works (pulls a small package through Nexus)
$ curl -k -u "admin:${ADMIN_PW}" \
    "https://nexus.africanunion.org/repository/npm-public/lodash"
# Expected: a JSON document with package metadata. Nexus fetched it
# from registry.npmjs.org on first request and cached it.

# (6) Backup ran
$ ls -lh /var/backups/nexus/

# (7) Audit logging on
$ sudo grep -c '' /opt/sonatype/sonatype-work/nexus3/log/audit.log
# Expected: > 0

# (8) Vault has admin password
$ vault kv get kv/platform/nexus/admin_password
# Expected: rotation_period_days, password fields present
```

**Common failures and remedies:**

| Symptom                                                       | Cause                                                                                                             | Fix                                                                                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Nexus won't start; `nexus.log` shows JVM heap allocation fail | Default 1.2 GB heap > available RAM                                                                               | Edit `/opt/sonatype/nexus/bin/nexus.vmoptions`: lower `-Xms` / `-Xmx`; default for 4 GB VM should be -Xms1024m -Xmx1024m |
| 502 Bad Gateway from nginx → Nexus                            | Nexus not yet listening on :8081 (still starting)                                                                 | Wait 60-90s for Nexus startup; tail `nexus.log` for "Started Sonatype Nexus OSS"                                         |
| `npm install` from a workstation hangs                        | Nexus' upstream proxy can't reach registry.npmjs.org                                                              | Confirm Nexus' outbound HTTPS is allowed; check Nexus' system → Outreach for connectivity errors                         |
| Can't push to `maven-releases` — "Repository is not writable" | Default `maven-releases` is configured for unique releases (no overwrites). Trying to publish same version twice. | Use a new version number; or change repo policy to allow redeploys (production: leave as-is, requires version bumps)     |
| Disk fills with proxy cache                                   | Cleanup tasks not configured                                                                                      | Server administration → Tasks → "Cleanup unused snapshot artifacts" or "Cleanup based on age" — schedule weekly          |
| Backup tarball is huge (>50 GB)                               | Default blob store at `/opt/sonatype/sonatype-work/nexus3/blobs/` includes proxied artefacts                      | Acceptable for Phase 1. Phase 3 moves blob store to MinIO (chapter 15); only DB needs backing up after that              |

### 6.12 Path to Phase 2

Phase 2 [chapter 07 — Keycloak](07-keycloak.md) brings SSO. Nexus integrates via SAML 2.0 (built-in) or LDAP (built-in). Configuration:

- Nexus → Security → SAML → configure Keycloak realm metadata
- Keycloak realm: create a SAML client for Nexus
- Disable local-account login for everyone except `admin` (break-glass)
- Per-AD-group → Nexus role mappings (e.g., `au-platform-engineers` → `nx-admin` role)

Phase 1 patterns survive: the repos, backup pipeline, audit log, UFW rules all stay. Only the auth source changes.

### Phase 1 complete

With chapter 06 drafted, **Phase 1 (developer foothold) is documented end-to-end**:

| #   | Component     | Phase 1 deliverable                              | Phase 5 upgrade                                 |
| --- | ------------- | ------------------------------------------------ | ----------------------------------------------- |
| 02  | Bastion       | OpenSSH + key auth, ProxyJump, auditd            | Teleport (session recording, RBAC) — chapter 21 |
| 03  | Vault         | 3-node HA Raft, KV v2, Shamir unseal             | Dynamic secrets, PKI engine — chapter 22        |
| 04  | GitLab CE     | Single VM, container + package registry, runners | Keycloak SSO — chapter 07                       |
| 05  | Nomad cluster | 3+3, Consul colocated, ACLs + mTLS + Vault JWT   | Consul Connect mesh — chapter 21                |
| 06  | Nexus         | OSS single VM, proxies + hosted repos            | Keycloak SSO — chapter 07                       |

App teams now have everything they need to deploy a workload onto the platform: a place for source (GitLab), a place for secrets (Vault), a place to schedule (Nomad), a place for dependencies (Nexus), and a way for operators to support it (Bastion). The platform consumer-facing chapter (chapter 30 — App onboarding) ties these together into a per-app workflow.

**Next: Phase 2 — identity + observability.** Chapter 07 (Keycloak) introduces SSO across all platform services; chapters 09-12 add the LGTM observability stack.

---
