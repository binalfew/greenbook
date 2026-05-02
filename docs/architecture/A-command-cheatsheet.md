# Appendix A — Command cheatsheet

> **Phase**: post-phase reference · **Update**: rolling — append commands as they prove useful in operations
>
> Operationally-frequent commands extracted from chapters 02-23. Organised per service. Source-of-truth is the chapter; this is the lookup-while-on-call reference.

---

## Contents

- [§A.1 Daily-driver shortcuts](#a1-daily-driver-shortcuts)
- [§A.2 Bastion + Teleport](#a2-bastion-teleport)
- [§A.3 Vault](#a3-vault)
- [§A.4 Nomad + Consul](#a4-nomad-consul)
- [§A.5 GitLab](#a5-gitlab)
- [§A.6 Nexus](#a6-nexus)
- [§A.7 Keycloak](#a7-keycloak)
- [§A.8 Loki + Promtail](#a8-loki-promtail)
- [§A.9 Prometheus + Mimir](#a9-prometheus-mimir)
- [§A.10 Tempo](#a10-tempo)
- [§A.11 Alertmanager](#a11-alertmanager)
- [§A.12 Postgres + pgBackRest](#a12-postgres-pgbackrest)
- [§A.13 Redis](#a13-redis)
- [§A.14 MinIO](#a14-minio)
- [§A.15 PgBouncer](#a15-pgbouncer)
- [§A.16 HAProxy + Keepalived](#a16-haproxy-keepalived)
- [§A.17 Cloudflare](#a17-cloudflare)
- [§A.18 Ansible](#a18-ansible)

## A. Command cheatsheet

### A.1 Daily-driver shortcuts

```bash
# Authenticate to Teleport (operator's first command of the day)
$ tsh login --proxy=teleport.africanunion.org --auth=keycloak

# List all platform nodes the role grants access to
$ tsh ls

# SSH to a node (Teleport-tunneled)
$ tsh ssh root@auishqosrvlt01

# Vault login via Keycloak OIDC (Phase 5 ch22)
$ vault login -method=oidc role=operator

# Quick health snapshot of every component (chapter 40 ladder layer 2)
$ ansible -i /opt/ansible/inventory/au-platform.yml all -m ping
```

### A.2 Bastion + Teleport

```bash
# Phase 1 simple bastion (ch02)
$ ssh -J au-bastion auishqosrXXX.au-internal

# Phase 5 Teleport (ch21)
$ tsh login --proxy=teleport.africanunion.org
$ tsh ssh user@host
$ tsh db ls
$ tsh db login --db-user=postgres postgres-app
$ tsh app ls
$ tsh app login vault

# Just-in-time access request
$ tsh request create --roles=platform-admin --reason="incident #4521"

# Approver
$ tsh request review --approve <id>

# Replay a recorded session
$ tsh play <session-id>

# Audit search
$ tctl audit search --from=2026-05-01 --user=binalfew@africanunion.org

# List active operators
$ tctl users ls
```

### A.3 Vault

```bash
# Status
$ vault status

# Unseal (after restart) — needs 3 of 5 keys
$ vault operator unseal <key>

# KV operations
$ vault kv put kv/platform/example value=foo
$ vault kv get kv/platform/example
$ vault kv list kv/platform/

# Snapshot
$ vault operator raft snapshot save /var/lib/vault/snapshots/$(date +%FT%T).snap
$ vault operator raft snapshot inspect /path/to/snap

# Restore (DR)
$ vault operator raft snapshot restore /path/to/snap

# Token operations
$ vault token create -policy=greenbook-db -ttl=1h
$ vault token lookup
$ vault token revoke <token>

# Dynamic engines (ch22)
$ vault read database/creds/app-role-greenbook
$ vault write -field=signed_key ssh-ca/sign/break-glass-root \
    public_key=@~/.ssh/id_ed25519.pub > /tmp/cert.pub
$ vault write -format=json transit/encrypt/greenbook-pii plaintext=$(echo "secret" | base64)

# Lease management
$ vault list sys/leases/lookup
$ vault lease revoke <lease-id>
$ vault lease renew <lease-id>
```

### A.4 Nomad + Consul

```bash
# Nomad cluster
$ nomad server members
$ nomad node status
$ nomad operator raft list-peers

# Jobs
$ nomad job run <file>.nomad
$ nomad job status <job>
$ nomad job allocs <job>
$ nomad alloc logs <alloc-id>
$ nomad alloc exec <alloc-id> /bin/sh
$ nomad job stop -purge <job>

# Snapshots
$ nomad operator snapshot save /var/lib/nomad/snapshots/$(date +%FT%T).snap

# Consul
$ consul members
$ consul catalog services
$ consul kv get -recurse
$ dig @localhost -p 8600 <service>.service.consul SRV +short

# Snapshots
$ consul snapshot save /var/lib/consul/snapshots/$(date +%FT%T).snap
```

### A.5 GitLab

```bash
# Service control
$ sudo gitlab-ctl status
$ sudo gitlab-ctl restart
$ sudo gitlab-ctl reconfigure

# Backup
$ sudo gitlab-rake gitlab:backup:create
$ sudo gitlab-rake gitlab:backup:check[BACKUP=<filename>]
$ sudo gitlab-rake gitlab:backup:restore BACKUP=<timestamp>

# Health
$ curl -k https://git.africanunion.org/-/health
$ curl -k https://git.africanunion.org/-/readiness
$ curl -k https://git.africanunion.org/-/liveness

# User mgmt (rare)
$ sudo gitlab-rails console
> user = User.find_by(email: '...'); user.admin = true; user.save!
```

### A.6 Nexus

```bash
# Service
$ sudo systemctl status nexus
$ sudo systemctl restart nexus

# Tasks (via REST)
$ curl -u admin:<pass> https://nexus.au-internal/service/rest/v1/tasks

# Backup task trigger
$ curl -u admin:<pass> -X POST \
    https://nexus.au-internal/service/rest/v1/tasks/<task-id>/run

# Health
$ curl -u admin:<pass> https://nexus.au-internal/service/rest/v1/status
```

### A.7 Keycloak

```bash
# Service
$ sudo systemctl status keycloak
$ sudo systemctl restart keycloak

# Admin CLI (kc.sh / kcadm.sh)
$ /opt/keycloak/bin/kcadm.sh config credentials \
    --server https://keycloak.africanunion.org --realm master --user admin --password <pass>
$ /opt/keycloak/bin/kcadm.sh get realms
$ /opt/keycloak/bin/kcadm.sh get clients -r au

# Realm export (backup)
$ /opt/keycloak/bin/kc.sh export --dir /var/keycloak-backup/$(date +%F) --realm au

# Realm import (restore)
$ /opt/keycloak/bin/kc.sh import --dir /var/keycloak-backup/<dir>

# Health
$ curl -k https://keycloak.africanunion.org/health/ready
$ curl -k https://keycloak.africanunion.org/health/live
```

### A.8 Loki + Promtail

```bash
# Loki cluster status
$ curl http://127.0.0.1:3100/ready
$ curl http://127.0.0.1:3100/ring

# Logcli (operator query CLI; install via grafana apt repo)
$ logcli query '{job="systemd-journal"}' --tail --limit 10
$ logcli query '{role="vault"} |= "permission denied"' --since 1h

# Promtail
$ sudo systemctl status promtail
$ sudo journalctl -u promtail -f

# Ruler reload
$ curl -X POST http://127.0.0.1:3100/loki/api/v1/rules
```

### A.9 Prometheus + Mimir

```bash
# Prometheus
$ curl -s http://127.0.0.1:9090/-/ready
$ curl -X POST http://127.0.0.1:9090/-/reload   # config reload
$ curl -sG http://127.0.0.1:9090/api/v1/targets?state=active | jq

# Validate config
$ promtool check config /etc/prometheus/prometheus.yml
$ promtool check rules /etc/prometheus/rules.d/*.yml

# Mimir
$ curl http://127.0.0.1:9009/ready
$ curl http://127.0.0.1:9009/ingester/ring
$ curl http://127.0.0.1:9009/distributor/ring
$ curl -X POST http://127.0.0.1:9009/ruler/reload
$ curl -sG http://127.0.0.1:9009/prometheus/api/v1/query \
    --data-urlencode 'query=up' | jq
```

### A.10 Tempo

```bash
# Health
$ curl http://127.0.0.1:3200/ready
$ curl http://127.0.0.1:3200/distributor/ring
$ curl http://127.0.0.1:3200/status/services

# Synthetic span (otel-cli — install separately)
$ otel-cli span --service "ladder" --name "test" \
    --endpoint tempo.service.consul:4317

# Trace lookup
$ curl http://127.0.0.1:3200/api/traces/<trace-id>
```

### A.11 Alertmanager

```bash
# Cluster
$ curl http://127.0.0.1:9093/-/ready
$ curl http://127.0.0.1:9093/api/v2/status | jq '.cluster'

# Validate config
$ amtool check-config /etc/alertmanager/alertmanager.yml

# Silences
$ amtool --alertmanager.url=http://localhost:9093 silence add \
    alertname=Foo --duration=1h --comment="ops drill"
$ amtool silence query
$ amtool silence expire <silence-id>

# Manual alert (verification)
$ curl -X POST http://localhost:9093/api/v2/alerts -H "Content-Type: application/json" \
    -d '[{"labels":{"alertname":"Test","severity":"warning"}, \
          "annotations":{"summary":"manual test"}, \
          "startsAt":"'$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)'"}]'
```

### A.12 Postgres + pgBackRest

```bash
# Connection
$ sudo -u postgres psql
$ psql -h pg-rw.au-internal -p 5433 -U app_greenbook -d greenbook
$ pg_isready -h pg-rw.au-internal -p 5433

# Replication state
$ sudo -u postgres psql -c "SELECT * FROM pg_stat_replication;"
$ sudo -u postgres psql -c "SELECT pg_is_in_recovery();"
$ sudo -u postgres psql -c "SELECT \
    extract(epoch from now() - pg_last_xact_replay_timestamp()) AS lag_sec;"

# Promote replica (chapter 13 failover)
$ sudo -u postgres pg_ctl promote -D /var/lib/postgresql/16/main
# Or: SELECT pg_promote();

# pgBackRest
$ sudo -u postgres pgbackrest --stanza=app info
$ sudo -u postgres pgbackrest --stanza=app --type=full backup
$ sudo -u postgres pgbackrest --stanza=app verify
$ sudo -u postgres pgbackrest --stanza=app --delta \
    --type=time --target="2026-05-02 14:30:00" --target-action=promote restore
```

### A.13 Redis

```bash
# Connectivity
$ redis-cli -h auishqosrred01 -a <pass> ping
$ redis-cli -p 26379 sentinel master platform
$ redis-cli -p 26379 sentinel replicas platform
$ redis-cli -p 26379 sentinel sentinels platform

# Replication
$ redis-cli -a <pass> info replication

# Failover (controlled)
$ redis-cli -p 26379 sentinel failover platform

# Persistence
$ redis-cli -a <pass> bgsave
$ redis-cli -a <pass> lastsave
$ redis-check-rdb /var/lib/redis/dump.rdb

# Slow log
$ redis-cli -a <pass> slowlog get 10
$ redis-cli -a <pass> slowlog reset

# Memory
$ redis-cli -a <pass> info memory | head -10
$ redis-cli -a <pass> --bigkeys
```

### A.14 MinIO

```bash
# Cluster status
$ mc admin info au-platform
$ curl -sk https://127.0.0.1:9000/minio/health/cluster

# Bucket ops
$ mc ls au-platform
$ mc mb au-platform/<bucket>
$ mc rb --force au-platform/<bucket>

# Policy / IAM
$ mc admin policy create au-platform <name> /tmp/policy.json
$ mc admin user svcacct add au-platform root --name <svc> --policy-file /tmp/policy.json

# Lifecycle / retention / encryption
$ mc ilm rule add au-platform/<bucket> --expire-days 90
$ mc retention set --default GOVERNANCE 30d au-platform/<bucket>
$ mc encrypt set sse-s3 au-platform/<bucket>

# Heal
$ mc admin heal --recursive au-platform/<bucket>

# Site replication
$ mc admin replicate add au-platform au-dr
$ mc admin replicate status au-platform
```

### A.15 PgBouncer

```bash
# Connect to admin DB
$ psql -h auishqosrpgb01 -p 6432 pgbouncer -U pgbouncer_admin

# Inside pgbouncer admin DB
> SHOW VERSION;
> SHOW POOLS;
> SHOW CLIENTS;
> SHOW SERVERS;
> SHOW STATS;
> RELOAD;          # picks up most config changes
> PAUSE;
> RESUME;
> SHUTDOWN;        # only via admin
```

### A.16 HAProxy + Keepalived

```bash
# HAProxy
$ sudo systemctl status haproxy
$ sudo systemctl reload haproxy
$ sudo haproxy -c -f /etc/haproxy/haproxy.cfg -f /etc/haproxy/conf.d/

# Stats + metrics
$ curl http://127.0.0.1:8404/         # web UI
$ curl http://127.0.0.1:8404/metrics  # Prometheus

# Runtime API via socket
$ sudo socat /run/haproxy/admin.sock - <<< "show servers state"
$ sudo socat /run/haproxy/admin.sock - <<< "show pools"
$ sudo socat /run/haproxy/admin.sock - <<< "disable server <pool>/<server>"

# Keepalived
$ sudo systemctl status keepalived
$ ip a show eth0 | grep inet     # who has the VIP
$ sudo journalctl -u keepalived -f
```

### A.17 Cloudflare

```bash
# Set up env
$ CF_TOKEN=$(vault kv get -field=api_token kv/platform/cloudflare/api_token)
$ CF_ZONE_ID=$(curl -sf -H "Authorization: Bearer $CF_TOKEN" \
    "https://api.cloudflare.com/client/v4/zones?name=africanunion.org" | jq -r '.result[0].id')

# DNS
$ curl -H "Authorization: Bearer $CF_TOKEN" \
    "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records?name=greenbook.africanunion.org" | jq

# Add a proxied A record
$ curl -X POST -H "Authorization: Bearer $CF_TOKEN" \
    -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
    -d '{"type":"A","name":"<app>","content":"196.188.248.25","ttl":1,"proxied":true}'

# Refresh CF IP ranges (chapter 18 weekly timer)
$ curl -fsS https://www.cloudflare.com/ips-v4/ -o /tmp/cf-ips-v4.txt
$ curl -fsS https://www.cloudflare.com/ips-v6/ -o /tmp/cf-ips-v6.txt
```

### A.18 Ansible

```bash
# Inventory parse
$ ansible-inventory -i /opt/ansible/inventory/au-platform.yml --list

# Connectivity
$ ansible -i /opt/ansible/inventory/au-platform.yml all -m ping

# Lint
$ ansible-lint /opt/ansible/playbooks/

# Dry-run with diff
$ ansible-playbook -i /opt/ansible/inventory/au-platform.yml \
    /opt/ansible/playbooks/<playbook>.yml --check --diff

# Run with limit + tags
$ ansible-playbook -i /opt/ansible/inventory/au-platform.yml \
    /opt/ansible/playbooks/<playbook>.yml --limit auishqosrpdb02 --tags=config

# Drift check
$ ansible-playbook -i /opt/ansible/inventory/au-platform.yml \
    /opt/ansible/playbooks/drift-check.yml --check --diff

# Patch rolling
$ ansible-playbook -i /opt/ansible/inventory/au-platform.yml \
    /opt/ansible/playbooks/patch-rolling.yml -e target_group=postgres_app

# DR drill
$ ansible-playbook -i /opt/ansible/inventory/au-platform.yml \
    /opt/ansible/playbooks/dr-drill.yml -e confirm_drill=drill
```

---
