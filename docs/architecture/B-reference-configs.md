# Appendix B — Reference configs

> **Phase**: post-phase reference · **Update**: rolling — when a chapter's canonical config evolves, update both the chapter and the pointer here
>
> Pointers to the canonical config files referenced throughout chapters 02-23. Each row points at the chapter section that contains the actual block; this appendix is a navigation aid, not a duplicate. Open the chapter for the current authoritative content.

---

## Contents

- [§B.1 How to use this appendix](#b1-how-to-use-this-appendix)
- [§B.2 OS + base hardening](#b2-os-base-hardening)
- [§B.3 Vault](#b3-vault)
- [§B.4 GitLab](#b4-gitlab)
- [§B.5 Nomad + Consul](#b5-nomad-consul)
- [§B.6 Nexus](#b6-nexus)
- [§B.7 Keycloak](#b7-keycloak)
- [§B.8 LGTM stack](#b8-lgtm-stack)
- [§B.9 Postgres](#b9-postgres)
- [§B.10 Redis](#b10-redis)
- [§B.11 MinIO](#b11-minio)
- [§B.12 PgBouncer](#b12-pgbouncer)
- [§B.13 HAProxy + Keepalived](#b13-haproxy-keepalived)
- [§B.14 Cloudflare](#b14-cloudflare)
- [§B.15 Teleport](#b15-teleport)
- [§B.16 Ansible playbooks (skeleton)](#b16-ansible-playbooks-skeleton)

## B. Reference configs

### B.1 How to use this appendix

Each row in the tables below has three columns:

- **Config artifact** — the file or block (e.g., `loki.yaml`, `pgbouncer.ini`, the `[databases]` block)
- **Authoritative location** — the chapter + section where the canonical version lives
- **Notes** — gotchas, replacement values, things to substitute per environment

When applying a config to a new VM:

1. Open the chapter section
2. Copy the block as-is
3. Substitute the `REPLACE` markers
4. Apply

When the config evolves (e.g., a tuning change after operational learning), update the chapter section first, then this appendix's notes if any clarification is needed.

### B.2 OS + base hardening

| Config artifact           | Authoritative location                       | Notes                                                                               |
| ------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| OS hardening pre-flight   | ch01 §1.8 (greenbook deployment ch01 reused) | Skip-check macro reused per chapter; same for every host                            |
| `sshd_config`             | ch02 §2.3                                    | Phase 1 simple bastion; Phase 5 ch21 supplants for everything except break-glass    |
| `auditd` rules            | ch02 §2.7                                    | auth.log retention; same on every Linux host                                        |
| `ufw` per-component rules | each chapter §X.N                            | Per-VLAN per-port; see chapter's "UFW + firewall rules" section                     |
| sysctl tuning             | per-component chapters                       | Service-specific (Redis THP/overcommit_memory, Loadbalancer ip_nonlocal_bind, etc.) |
| `unattended-upgrades`     | ch01 §1.6                                    | Same on every Linux host                                                            |

### B.3 Vault

| Config artifact            | Authoritative location | Notes                                        |
| -------------------------- | ---------------------- | -------------------------------------------- |
| `vault.hcl` cluster config | ch03 §3.4              | Raft + TLS + cluster_addr; replace per node  |
| Audit device               | ch03 §3.10             | File device; Promtail picks up via journald  |
| Snapshot timer             | ch03 §3.10             | Hourly systemd timer; ships to MinIO         |
| Database engine            | ch22 §22.4             | Per-app role + creation_statements           |
| PKI engine                 | ch22 §22.5             | Root + intermediate CAs + per-use-case roles |
| Transit engine             | ch22 §22.6             | Per-app keys; deletion_allowed=false         |
| SSH CA                     | ch22 §22.7             | Break-glass role; 1h TTL                     |

### B.4 GitLab

| Config artifact         | Authoritative location | Notes                                                    |
| ----------------------- | ---------------------- | -------------------------------------------------------- |
| `gitlab.rb`             | ch04                   | Single VM Omnibus; replace external_url + secrets paths  |
| Backup timer            | ch04                   | 4-hour gitlab-rake; secrets bundle separately            |
| OmniAuth (post-Phase 2) | ch08 §8.7              | OIDC integration with Keycloak                           |
| Runner registration     | ch04 §4.9              | Token in Vault; runners colocate on Nomad clients (ch05) |

### B.5 Nomad + Consul

| Config artifact        | Authoritative location | Notes                                       |
| ---------------------- | ---------------------- | ------------------------------------------- |
| `nomad.hcl` (server)   | ch05 §5.5              | mTLS + ACLs + JWT workload identity         |
| `nomad.hcl` (client)   | ch05 §5.7              | Driver config; Vault integration            |
| `consul.hcl` (server)  | ch05 §5.4              | Colocated with Nomad servers; gossip + ACLs |
| Vault JWT auth backend | ch05 §5.9              | Workload identity for jobs                  |
| Snapshot timer         | ch05 §5.13             | Daily; ships to MinIO `platform-misc`       |

### B.6 Nexus

| Config artifact     | Authoritative location | Notes                                               |
| ------------------- | ---------------------- | --------------------------------------------------- |
| nginx reverse-proxy | ch06 §6.5              | TLS via AU wildcard; same shape as Keycloak/Grafana |
| Repository setup    | ch06 §6.7              | Maven, npm, PyPI, Generic, Docker                   |
| Backup task         | ch06 §6.9              | DB export + filesystem snapshot                     |

### B.7 Keycloak

| Config artifact            | Authoritative location | Notes                                          |
| -------------------------- | ---------------------- | ---------------------------------------------- |
| Keycloak HA cluster        | ch07 §7.5              | Quarkus + Infinispan + JGroups TCP             |
| nginx reverse-proxy        | ch07 §7.6              | Same pattern as Nexus/Grafana                  |
| AU realm setup             | ch07 §7.8              | Security defaults; password policy             |
| OIDC client templates      | ch07 §7.9              | One per consuming service; secrets in Vault    |
| LDAP user-storage provider | ch08 §8.3              | LDAPS:636 read-only; bind credentials in Vault |
| AD groups → roles mapping  | ch08 §8.4              | Group-mapper config                            |

### B.8 LGTM stack

| Config artifact                | Authoritative location                           | Notes                                                     |
| ------------------------------ | ------------------------------------------------ | --------------------------------------------------------- |
| `loki.yaml` (microservices)    | ch09 §9.4                                        | 3-node memberlist on port 7946; 30d retention             |
| `mimir.yaml` (monolithic)      | ch10 §10.5                                       | 3-node memberlist on port 7947; 90d retention             |
| `tempo.yaml` (scalable)        | ch11 §11.4                                       | 3-node memberlist on port 7948; 14d retention             |
| `prometheus.yml`               | ch10 §10.6                                       | Scrape configs in conf.d; remote_write to local Mimir     |
| Per-service scrape configs     | ch10 §10.7                                       | One file per service in `/etc/prometheus/scrapes.d/`      |
| Promtail `config.yml`          | ch09 §9.8                                        | journald + nginx log scraping; per-host labels            |
| `grafana.ini`                  | ch09 §9.5                                        | Server bind 127.0.0.1; SSO config in 10-oauth.ini         |
| Grafana data sources           | ch09 §9.7 + ch10 §10.9 + ch11 §11.6              | Loki + Mimir + Tempo provisioning files                   |
| Grafana dashboard provisioning | ch09 §9.10 + ch10 §10.11                         | YAML provider + JSON dashboard files                      |
| `alertmanager.yml`             | ch12 §12.4                                       | 3-node cluster; routing tree; SMTP relay                  |
| Mimir ruler rules              | ch12 §12.6 + ch13/14/15/17/18/19/22/23 additions | Master ruleset evolves chapter-by-chapter                 |
| Loki ruler rules               | ch12 §12.7                                       | Log-based alerts (SSH brute-force, audit anomalies, etc.) |

### B.9 Postgres

| Config artifact              | Authoritative location  | Notes                                       |
| ---------------------------- | ----------------------- | ------------------------------------------- |
| `00-platform.conf` (primary) | ch13 §13.4              | Memory tuning, WAL, logging, pgaudit        |
| `pg_hba.conf`                | ch13 §13.4              | App VLAN only + replication slot            |
| `10-replica.conf`            | ch13 §13.5              | primary_conninfo + standby.signal           |
| `pgbackrest.conf`            | ch13 §13.7 + ch20 §20.5 | Local repo + Phase 4 MinIO repo             |
| pg-isprimary script          | ch17 §17.5.2            | xinetd-served HTTP for HAProxy health check |
| Vault DB engine roles        | ch22 §22.4              | Dynamic per-app credentials                 |

### B.10 Redis

| Config artifact       | Authoritative location | Notes                                              |
| --------------------- | ---------------------- | -------------------------------------------------- |
| `redis.conf`          | ch14 §14.4             | requirepass + min-replicas-to-write 1              |
| `sentinel.conf`       | ch14 §14.5             | quorum=2; 3 sentinels                              |
| Backup script + timer | ch14 §14.8             | Hourly RDB ship to MinIO; ExecCondition for master |

### B.11 MinIO

| Config artifact        | Authoritative location | Notes                                          |
| ---------------------- | ---------------------- | ---------------------------------------------- |
| `/etc/default/minio`   | ch15 §15.3             | MINIO_VOLUMES distributed-mode spec            |
| systemd unit           | ch15 §15.3             | Upstream-supplied                              |
| nginx reverse-proxy    | ch15 §15.5             | S3 API + console upstreams                     |
| Bucket layout          | ch15 §15.7             | Per-consumer buckets + lifecycle + Object Lock |
| Per-consumer policies  | ch15 §15.8             | One service account per consumer               |
| Site replication setup | ch20 §20.6             | `mc admin replicate add` for DR                |

### B.12 PgBouncer

| Config artifact           | Authoritative location | Notes                                         |
| ------------------------- | ---------------------- | --------------------------------------------- |
| `pgbouncer.ini`           | ch16 §16.4             | Transaction-mode default; per-app session DBs |
| `userlist.txt`            | ch16 §16.5             | Single auth_user; auth_query for the rest     |
| auth_query Postgres setup | ch16 §16.5             | Wrapper function with SECURITY DEFINER        |

### B.13 HAProxy + Keepalived

| Config artifact           | Authoritative location | Notes                                         |
| ------------------------- | ---------------------- | --------------------------------------------- |
| `haproxy.cfg`             | ch17 §17.5             | Globals + defaults; conf.d-style per-frontend |
| `conf.d/10-pgbouncer.cfg` | ch17 §17.5.1           | TCP leastconn pool                            |
| `conf.d/20-postgres.cfg`  | ch17 §17.5.2           | rw/ro split via httpchk                       |
| `conf.d/30-minio.cfg`     | ch17 §17.5.3           | TCP + SSL passthrough                         |
| `conf.d/40-apps.cfg`      | ch17 §17.5.4           | Consul SD via server-template                 |
| `keepalived.conf`         | ch17 §17.4             | VRRP active-passive; chk_haproxy script       |

### B.14 Cloudflare

| Config artifact             | Authoritative location | Notes                                        |
| --------------------------- | ---------------------- | -------------------------------------------- |
| Zone settings               | ch18 §18.4             | Full Strict TLS, DNSSEC, HSTS                |
| Origin CA cert              | ch18 §18.5             | 15-year ECC P-256; distributed via Vault     |
| Origin IP allowlist refresh | ch18 §18.6             | Weekly systemd timer on bastion              |
| WAF managed + custom rules  | ch18 §18.7             | Cloudflare Managed + 4 Custom + 3 Rate Limit |
| Cache rules                 | ch18 §18.8             | Default deny + per-extension allowlist       |
| Cloudflare LB pools         | ch20 §20.9             | Phase 4 DR-site failover                     |

### B.15 Teleport

| Config artifact               | Authoritative location | Notes                                                    |
| ----------------------------- | ---------------------- | -------------------------------------------------------- |
| Auth Service `teleport.yaml`  | ch21 §21.4             | Postgres backend + MinIO recordings                      |
| Proxy Service `teleport.yaml` | ch21 §21.5             | Cloudflare Origin CA cert                                |
| Node agent `teleport.yaml`    | ch21 §21.6             | Reverse-tunnel; role/vlan labels                         |
| OIDC connector                | ch21 §21.7             | Keycloak claims_to_roles                                 |
| Roles + JIT                   | ch21 §21.8             | platform-admin / platform-operator / dba / app-developer |
| Application + DB resources    | ch21 §21.9             | Per-resource via tctl create                             |

### B.16 Ansible playbooks (skeleton)

| Config artifact        | Authoritative location | Notes                                           |
| ---------------------- | ---------------------- | ----------------------------------------------- |
| Inventory              | ch23 §23.4             | Single source of truth for every platform VM    |
| Per-component role     | ch23 §23.6             | Mirror of the chapter; tags=['config','verify'] |
| GitLab CI              | ch23 §23.7             | Lint + dry-run + manual-approval apply          |
| Drift-check playbook   | ch23 §23.8             | Nightly; --check --diff                         |
| Patch-rolling playbook | ch23 §23.9             | serial=1 + per-group health checks              |
| DR drill playbook      | ch23 §23.10            | Semi-automated ch20 §20.10                      |

---
