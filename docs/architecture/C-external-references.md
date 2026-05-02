# Appendix C — External references

> **Phase**: post-phase reference · **Update**: rolling — when upstream URLs change or new versions ship, update here
>
> Upstream documentation, vendor links, RFC pointers, and technical-spec references for every product the platform uses. Organised by chapter. The chapter itself contains the operationally-relevant subset; this appendix is the "where do I read more?" gateway.

---

## Contents

- [§C.1 HashiCorp products](#c1-hashicorp-products)
- [§C.2 GitLab](#c2-gitlab)
- [§C.3 Keycloak](#c3-keycloak)
- [§C.4 LGTM stack (Grafana Labs)](#c4-lgtm-stack-grafana-labs)
- [§C.5 Prometheus](#c5-prometheus)
- [§C.6 Postgres + pgBackRest](#c6-postgres-pgbackrest)
- [§C.7 Redis](#c7-redis)
- [§C.8 MinIO](#c8-minio)
- [§C.9 PgBouncer](#c9-pgbouncer)
- [§C.10 HAProxy + Keepalived](#c10-haproxy-keepalived)
- [§C.11 Cloudflare](#c11-cloudflare)
- [§C.12 Teleport](#c12-teleport)
- [§C.13 Ansible](#c13-ansible)
- [§C.14 Standards + RFCs](#c14-standards-rfcs)
- [§C.15 OS + base](#c15-os-base)

## C. External references

### C.1 HashiCorp products

**Vault** (chapters 03 + 22)

- Docs: https://developer.hashicorp.com/vault/docs
- Raft + HA: https://developer.hashicorp.com/vault/docs/concepts/integrated-storage
- Database secrets engine: https://developer.hashicorp.com/vault/docs/secrets/databases
- PKI engine: https://developer.hashicorp.com/vault/docs/secrets/pki
- Transit engine: https://developer.hashicorp.com/vault/docs/secrets/transit
- SSH CA: https://developer.hashicorp.com/vault/docs/secrets/ssh
- Vault Agent: https://developer.hashicorp.com/vault/docs/agent-and-proxy/agent
- JWT/OIDC auth: https://developer.hashicorp.com/vault/docs/auth/jwt

**Nomad** (chapter 05)

- Docs: https://developer.hashicorp.com/nomad/docs
- ACLs: https://developer.hashicorp.com/nomad/tutorials/access-control
- Workload identity: https://developer.hashicorp.com/nomad/docs/concepts/workload-identity
- Vault integration: https://developer.hashicorp.com/nomad/docs/integrations/vault-integration
- Service block: https://developer.hashicorp.com/nomad/docs/job-specification/service

**Consul** (chapter 05)

- Docs: https://developer.hashicorp.com/consul/docs
- ACLs: https://developer.hashicorp.com/consul/tutorials/security/access-control-setup-production
- DNS: https://developer.hashicorp.com/consul/docs/discovery/dns
- Service mesh: https://developer.hashicorp.com/consul/docs/connect (out of scope for Phase 5; reserved for future)

### C.2 GitLab

(chapter 04)

- Self-managed install: https://docs.gitlab.com/ee/install/
- Omnibus configuration: https://docs.gitlab.com/omnibus/settings/
- Backup + restore: https://docs.gitlab.com/ee/raketasks/backup_restore.html
- Container registry: https://docs.gitlab.com/ee/administration/packages/container_registry.html
- OmniAuth + OIDC: https://docs.gitlab.com/ee/administration/auth/oidc.html
- GitLab Runner: https://docs.gitlab.com/runner/

### C.3 Keycloak

(chapters 07 + 08)

- Server admin guide: https://www.keycloak.org/docs/latest/server_admin/
- Server installation: https://www.keycloak.org/docs/latest/server_installation/
- LDAP user federation: https://www.keycloak.org/docs/latest/server_admin/#_ldap
- OIDC client setup: https://www.keycloak.org/docs/latest/server_admin/#_oidc_clients
- High availability: https://www.keycloak.org/server/configuration-production
- Quarkus + Infinispan: https://www.keycloak.org/server/caching

### C.4 LGTM stack (Grafana Labs)

**Loki** (chapter 09)

- Docs: https://grafana.com/docs/loki/latest/
- Architecture: https://grafana.com/docs/loki/latest/get-started/architecture/
- LogQL: https://grafana.com/docs/loki/latest/query/
- Promtail: https://grafana.com/docs/loki/latest/send-data/promtail/

**Mimir** (chapter 10)

- Docs: https://grafana.com/docs/mimir/latest/
- Architecture: https://grafana.com/docs/mimir/latest/references/architecture/
- HA tracker (dedup): https://grafana.com/docs/mimir/latest/references/architecture/components/distributor/#ha-tracker

**Tempo** (chapter 11)

- Docs: https://grafana.com/docs/tempo/latest/
- TraceQL: https://grafana.com/docs/tempo/latest/traceql/
- OTLP receivers: https://grafana.com/docs/tempo/latest/configuration/#otlp

**Grafana** (chapter 09)

- Docs: https://grafana.com/docs/grafana/latest/
- OAuth + OIDC: https://grafana.com/docs/grafana/latest/setup-grafana/configure-security/configure-authentication/generic-oauth/
- Provisioning: https://grafana.com/docs/grafana/latest/administration/provisioning/

**OpenTelemetry** (chapter 11)

- Docs: https://opentelemetry.io/docs/
- Semantic conventions: https://opentelemetry.io/docs/specs/semconv/
- OTLP protocol: https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/protocol/otlp.md

### C.5 Prometheus

(chapter 10 + 12)

- Docs: https://prometheus.io/docs/
- Configuration: https://prometheus.io/docs/prometheus/latest/configuration/configuration/
- PromQL: https://prometheus.io/docs/prometheus/latest/querying/basics/
- Alertmanager: https://prometheus.io/docs/alerting/latest/alertmanager/
- node_exporter: https://github.com/prometheus/node_exporter
- postgres_exporter: https://github.com/prometheus-community/postgres_exporter
- redis_exporter: https://github.com/oliver006/redis_exporter
- pgbouncer_exporter: https://github.com/prometheus-community/pgbouncer_exporter

### C.6 Postgres + pgBackRest

**PostgreSQL** (chapter 13)

- Docs: https://www.postgresql.org/docs/16/
- Streaming replication: https://www.postgresql.org/docs/16/warm-standby.html#STREAMING-REPLICATION
- pg_basebackup: https://www.postgresql.org/docs/16/app-pgbasebackup.html
- pg_rewind: https://www.postgresql.org/docs/16/app-pgrewind.html
- pgaudit: https://github.com/pgaudit/pgaudit

**pgBackRest** (chapters 13 + 19)

- Docs: https://pgbackrest.org/user-guide.html
- Configuration: https://pgbackrest.org/configuration.html

**Patroni** (Phase 5 ch24 reserved slot)

- Docs: https://patroni.readthedocs.io/

### C.7 Redis

(chapter 14)

- Docs: https://redis.io/docs/
- Sentinel: https://redis.io/docs/management/sentinel/
- Persistence: https://redis.io/docs/management/persistence/
- Cluster (Phase 5 ch26 reserved): https://redis.io/docs/management/scaling/

### C.8 MinIO

(chapter 15 + 20)

- Docs: https://min.io/docs/minio/linux/
- Distributed setup: https://min.io/docs/minio/linux/operations/install-deploy-manage/deploy-minio-multi-node-multi-drive.html
- Erasure coding: https://min.io/docs/minio/linux/operations/concepts/erasure-coding.html
- Bucket replication: https://min.io/docs/minio/linux/administration/bucket-replication.html
- IAM: https://min.io/docs/minio/linux/administration/identity-access-management.html
- Object Lock: https://min.io/docs/minio/linux/administration/object-management/object-locking.html

### C.9 PgBouncer

(chapter 16)

- Docs: https://www.pgbouncer.org/usage.html
- Config: https://www.pgbouncer.org/config.html
- auth_query: https://www.pgbouncer.org/config.html#auth_query

### C.10 HAProxy + Keepalived

**HAProxy** (chapter 17)

- Docs: https://docs.haproxy.org/3.0/
- Configuration manual: https://docs.haproxy.org/3.0/configuration.html
- Runtime API: https://docs.haproxy.org/3.0/management.html#9.3
- Consul SD with server-template: https://www.haproxy.com/blog/dynamic-configuration-haproxy-runtime-api

**Keepalived** (chapter 17)

- Docs: https://keepalived.readthedocs.io/
- VRRP RFC 5798: https://datatracker.ietf.org/doc/html/rfc5798

### C.11 Cloudflare

(chapter 18)

- Docs: https://developers.cloudflare.com/
- DNS: https://developers.cloudflare.com/dns/
- TLS / SSL: https://developers.cloudflare.com/ssl/
- Origin CA: https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/
- WAF: https://developers.cloudflare.com/waf/
- Rate Limiting: https://developers.cloudflare.com/waf/rate-limiting-rules/
- Load Balancing: https://developers.cloudflare.com/load-balancing/
- IP ranges: https://www.cloudflare.com/ips/

### C.12 Teleport

(chapter 21)

- Docs: https://goteleport.com/docs/
- Architecture: https://goteleport.com/docs/architecture/
- OIDC integration: https://goteleport.com/docs/access-controls/sso/oidc/
- Application access: https://goteleport.com/docs/application-access/
- Database access: https://goteleport.com/docs/database-access/
- Audit log: https://goteleport.com/docs/management/security/

### C.13 Ansible

(chapter 23)

- Docs: https://docs.ansible.com/ansible/latest/
- ansible-lint: https://ansible.readthedocs.io/projects/lint/
- community.hashi_vault: https://docs.ansible.com/ansible/latest/collections/community/hashi_vault/
- community.postgresql: https://docs.ansible.com/ansible/latest/collections/community/postgresql/

### C.14 Standards + RFCs

- **TLS 1.3** — RFC 8446: https://datatracker.ietf.org/doc/html/rfc8446
- **OIDC Core** — https://openid.net/specs/openid-connect-core-1_0.html
- **OAuth 2.0** — RFC 6749: https://datatracker.ietf.org/doc/html/rfc6749
- **SAML 2.0** — https://docs.oasis-open.org/security/saml/v2.0/saml-2.0-os.zip
- **JWT** — RFC 7519: https://datatracker.ietf.org/doc/html/rfc7519
- **VRRP** — RFC 5798: https://datatracker.ietf.org/doc/html/rfc5798
- **HSTS** — RFC 6797: https://datatracker.ietf.org/doc/html/rfc6797
- **DNSSEC** — RFC 4033-4035: https://datatracker.ietf.org/doc/html/rfc4033
- **OpenTelemetry semantic conventions** — https://opentelemetry.io/docs/specs/semconv/
- **OWASP Top 10** — https://owasp.org/www-project-top-ten/
- **CIS Benchmarks** (OS hardening) — https://www.cisecurity.org/cis-benchmarks/

### C.15 OS + base

**Ubuntu 24.04 LTS**

- Release notes: https://discourse.ubuntu.com/t/noble-numbat-release-notes/39890
- Server guide: https://ubuntu.com/server/docs

**OpenSSH**

- sshd_config manpage: https://man.openbsd.org/sshd_config

**systemd**

- Manpages: https://www.freedesktop.org/software/systemd/man/

**fail2ban**

- Wiki: https://www.fail2ban.org/wiki/index.php/Main_Page

**auditd**

- Manpage: https://man7.org/linux/man-pages/man8/auditd.8.html

---
