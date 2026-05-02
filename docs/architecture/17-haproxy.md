# 17 — HAProxy HA pair

> **Phase**: 3 (app scaling + edge HA) · **Run on**: 2× internal LB VMs (`auishqosrlb01-02`) with a Keepalived-managed VRRP virtual IP · **Time**: ~3 hours
>
> Internal application load balancer. Sits between apps and the backends introduced in chapters 13-16: PgBouncer pool, Postgres rw/ro split, Nomad app workloads (discovered via Consul DNS), MinIO. One Keepalived-managed VIP + active-passive HAProxy failover gives apps a single stable connection target while backends churn underneath. **Not** the public-facing edge — chapter 18 covers Cloudflare → existing DMZ nginx.
>
> Phase 3 chapter 5 of 6.
>
> **Prev**: [16 — PgBouncer](16-pgbouncer.md) · **Next**: [18 — Public DNS + Cloudflare](18-public-dns.md) · **Index**: [README](README.md)

---

## Contents

- [§17.1 Role + threat model](#171-role-threat-model)
- [§17.2 Pre-flight (2 dedicated LB VMs)](#172-pre-flight-2-dedicated-lb-vms)
- [§17.3 Install HAProxy + Keepalived](#173-install-haproxy-keepalived)
- [§17.4 Keepalived VRRP configuration](#174-keepalived-vrrp-configuration)
- [§17.5 HAProxy frontends + backends](#175-haproxy-frontends-backends)
- [§17.6 Consul DNS service discovery for app backends](#176-consul-dns-service-discovery-for-app-backends)
- [§17.7 Apps + components switch to the VIP](#177-apps-components-switch-to-the-vip)
- [§17.8 haproxy_exporter for Prometheus](#178-haproxy_exporter-for-prometheus)
- [§17.9 UFW + firewall rules](#179-ufw-firewall-rules)
- [§17.10 Verification (with VRRP failover drill)](#1710-verification-with-vrrp-failover-drill)
- [§17.11 Phase 5 path (Patroni-aware writer-VIP)](#1711-phase-5-path-patroni-aware-writer-vip)

## 17. HAProxy HA pair

### 17.1 Role + threat model

By the end of chapter 16, three patterns had appeared in the platform that all want a load balancer:

- **PgBouncer** uses DNS round-robin (chapter 16 §16.7) — works, but doesn't health-check; if `auishqosrpgb01` dies, half of all new connections still try it for the DNS TTL.
- **Postgres** has a primary + replica (chapter 13) but no read/write split — chapter 13 §13.1 explicitly deferred this to chapter 17.
- **Nomad app workloads** run on dynamically-allocated ports across Nomad clients — apps need to find each other and apps' callers need a stable address.

One internal load balancer with health-checked backends solves all three. The HA pattern:

```
                       ┌─────────────────────────┐
                       │ Apps + ops connect to:  │
                       │ pg-rw.au-internal       │
                       │ pg-ro.au-internal       │
                       │ pgbouncer.au-internal   │
                       │ minio.au-internal       │
                       │ <app>.platform.local    │
                       └────────────┬────────────┘
                                    │ VRRP VIP (10.111.30.100)
                                    ▼
                  ┌─────────────────────────────────────┐
                  │  HAProxy (active)  │ HAProxy (passive) │
                  │   lb01 holds VIP   │  lb02 ready to take│
                  └────────────────────┴───────────────────┘
                                    │
                  ┌─────────────────┼─────────────────────┐
                  ▼                 ▼                     ▼
          PgBouncer pool    Postgres pri/repl      Nomad apps via Consul DNS
```

Active-passive via Keepalived's VRRP: only one HAProxy holds the VIP at a time; if the active one fails, the standby promotes within ~3 seconds (single-second VRRP advertisement interval + ~2 sec for ARP cache propagation). Apps see a brief connection error, retry, succeed.

Three consequences:

1. **Compromise = traffic redirection at platform scale.** An attacker who controls HAProxy can MITM every app→DB connection, every app→app call. Defence: config in GitLab with code review; HAProxy stats socket only on Ops VLAN; runtime API protected by mTLS in Phase 5.
2. **Outage = nothing routes.** Every app loses connectivity to backends. Mitigation: VRRP failover ~3 sec; both LB VMs in different physical hosts (Phase 1 capacity-sizing constraint).
3. **Stale health-check decisions are the realistic failure mode.** If HAProxy thinks a backend is up when it isn't (slow health check, network partition between HAProxy and backend, backend hung-but-responding-to-TCP), apps see errors that look like backend errors but are routing errors. Defence: layer-appropriate health checks (TCP for PgBouncer, HTTP `/ready` for Mimir, `pg_isready` script for Postgres rw/ro selection); fail fast on consecutive failures.

**Threat model — what we defend against:**

| Threat                                            | Mitigation                                                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Tampered config redirects traffic                 | Source-controlled in GitLab; CI runs `haproxy -c -f config.cfg`; deploy via Ansible (Phase 5 ch23) with diff approval                   |
| MITM the LB itself (rogue VIP holder)             | VRRP authentication password (shared); UFW limits 224.0.0.18 multicast to LB VLAN only                                                  |
| Bypass the LB to hit a backend directly           | Backend UFW rules accept only the LB IPs (not the VIP — the source IP is the LB's primary IP)                                           |
| Stats socket compromise → runtime config edit     | Stats socket bound to 127.0.0.1; HAProxy admin API exposed only on Ops VLAN with mTLS in Phase 5                                        |
| Slow health checks miss a fast failure            | `inter 2s fall 2 rise 3` — fail after 4 sec of no response                                                                              |
| Reverse — flapping backend gets re-added too fast | `rise 3` — backend must pass 3 consecutive checks before re-added (~6s)                                                                 |
| Connection leak (sockets never released)          | `timeout client/server/connect`; explicit `option httpchk` + `option redispatch` for HTTP; metric on `haproxy_backend_current_sessions` |

**Phase 3 deliberate non-goals:**

- **Public-facing edge** — that's the DMZ nginx pair from greenbook deployment chapter 12, plus chapter 18 (Cloudflare) here. **Two separate LB tiers** by design — DMZ has different threat exposure than the internal application LB. Chapter 18 wires Cloudflare to the DMZ nginx; both share the AU wildcard cert, but the DMZ pair has its own configuration and operational lifecycle.
- **Application-layer WAF** — HAProxy can do basic content filtering, but real WAF is Cloudflare's job (chapter 18) at the edge. Internal LB stays simple.
- **mTLS between apps and backends** — backends use scram-sha-256 + PgBouncer's auth_query (chapter 16) and Vault-stored passwords for now. Phase 5 chapter 22 introduces Vault PKI dynamic certs.
- **Active-active LB** — VRRP is active-passive. Active-active needs anycast or DNS round-robin in front of the VIP, which buys nothing at our scale (single LB easily handles the traffic; failover is sub-3-second).

### 17.2 Pre-flight (2 dedicated LB VMs)

Two new Ubuntu 24.04 VMs hardened to AU base. Sized for ~10 Gbps aggregate throughput — HAProxy is CPU-bound on TLS handshakes, almost free for plain TCP forwarding.

| Role         | Hostname        | IP            | vCPU | RAM  | Disk      | Notes                                           |
| ------------ | --------------- | ------------- | ---- | ---- | --------- | ----------------------------------------------- |
| LB primary   | `auishqosrlb01` | 10.111.30.90  | 4    | 8 GB | 40 GB SSD | Holds VIP normally; first to upgrade            |
| LB secondary | `auishqosrlb02` | 10.111.30.91  | 4    | 8 GB | 40 GB SSD | Same shape — mandatory for failover symmetry    |
| **VRRP VIP** | `lb-vip`        | 10.111.30.100 | —    | —    | —         | Floats between the two; never assigned manually |

The VIP is a **third IP** — it isn't tied to any hardware interface. Keepalived attaches it to whichever VM is currently "master" via gratuitous ARP. DNS pointers (`pg-rw.au-internal`, etc.) all resolve to `10.111.30.100`.

```bash
# [each LB VM] — sysctl prep for binding non-local addresses
$ sudo tee /etc/sysctl.d/99-haproxy.conf > /dev/null <<'EOF'
# Allow HAProxy to bind to the VIP even when not currently held
net.ipv4.ip_nonlocal_bind = 1

# Tighter ARP rules for VRRP environments
net.ipv4.conf.all.arp_ignore = 1
net.ipv4.conf.all.arp_announce = 2

# Generous backlog for SYN floods + connection bursts
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.ip_local_port_range = 10000 65000
EOF
$ sudo sysctl --system

# IP_FORWARD off — we're a load balancer, not a router
$ sudo sysctl net.ipv4.ip_forward=0

$ groups | grep operators
```

> **ℹ Why `ip_nonlocal_bind=1`**
>
> HAProxy's `listen` directives reference `10.111.30.100:5432` (the VIP). On the VM that doesn't currently hold the VIP, the address isn't on any interface — without `ip_nonlocal_bind`, HAProxy refuses to start. Setting it lets HAProxy boot on both LBs even when only one holds the VIP. When the VIP fails over, the standby HAProxy is already listening; Keepalived just hands it the IP via gARP and traffic flows.

### 17.3 Install HAProxy + Keepalived

```bash
# [auishqosrlb01-02]

# (1) HAProxy from the haproxy.org PPA — gives current LTS (3.0+ at Phase 3)
$ sudo add-apt-repository -y ppa:vbernat/haproxy-3.0
$ sudo apt update
$ sudo apt install -y haproxy keepalived
$ sudo apt-mark hold haproxy keepalived

# (2) Verify
$ haproxy -v
$ keepalived --version

# (3) Stop both — config goes in next
$ sudo systemctl stop haproxy keepalived
$ sudo systemctl disable haproxy keepalived

# (4) Service users + dirs
$ sudo install -d -m 755 /etc/haproxy/conf.d
$ sudo install -d -m 755 /var/lib/haproxy
$ sudo install -d -m 750 -o root -g root /etc/keepalived
```

### 17.4 Keepalived VRRP configuration

Keepalived owns the VIP — HAProxy doesn't know or care about VRRP. They communicate via a tiny health-check script: Keepalived asks "is HAProxy responsive locally?" and if not, demotes itself so the other LB takes over.

```bash
# [auishqosrlb01] — primary
$ sudo tee /etc/keepalived/keepalived.conf > /dev/null <<'EOF'
global_defs {
    router_id LB01
    vrrp_skip_check_adv_addr
    vrrp_garp_interval 0
    vrrp_gna_interval 0
    enable_script_security
    script_user keepalived_script
}

# HAProxy health probe — if HAProxy stops responding locally, fail over the VIP
vrrp_script chk_haproxy {
    script "/usr/bin/killall -0 haproxy"
    interval 2
    weight -50          ;; reduce priority by 50 if check fails — flips master/backup
    fall 2
    rise 2
}

vrrp_instance VI_PLATFORM {
    state MASTER
    interface eth0                 ;; verify via `ip a`
    virtual_router_id 51           ;; 0-255; must match across both LBs; unique vs other VRRP groups
    priority 110                   ;; higher than lb02; subtract 50 if HAProxy fails → 60 < lb02's 100
    advert_int 1                   ;; 1-second VRRP advertisements
    unicast_src_ip 10.111.30.90
    unicast_peer {
        10.111.30.91
    }
    authentication {
        auth_type PASS
        auth_pass REPLACE_FROM_VAULT      ;; symmetric secret; both LBs identical
    }
    virtual_ipaddress {
        10.111.30.100/24 dev eth0 label eth0:lb-vip
    }
    track_script {
        chk_haproxy
    }
    notify_master "/etc/keepalived/notify.sh master"
    notify_backup "/etc/keepalived/notify.sh backup"
    notify_fault  "/etc/keepalived/notify.sh fault"
}
EOF

# [auishqosrlb02] — secondary (same file but state BACKUP, priority 100, src+peer swapped)
$ sudo tee /etc/keepalived/keepalived.conf > /dev/null <<'EOF'
global_defs {
    router_id LB02
    vrrp_skip_check_adv_addr
    enable_script_security
    script_user keepalived_script
}

vrrp_script chk_haproxy {
    script "/usr/bin/killall -0 haproxy"
    interval 2
    weight -50
    fall 2
    rise 2
}

vrrp_instance VI_PLATFORM {
    state BACKUP
    interface eth0
    virtual_router_id 51
    priority 100
    advert_int 1
    unicast_src_ip 10.111.30.91
    unicast_peer {
        10.111.30.90
    }
    authentication {
        auth_type PASS
        auth_pass REPLACE_FROM_VAULT
    }
    virtual_ipaddress {
        10.111.30.100/24 dev eth0 label eth0:lb-vip
    }
    track_script {
        chk_haproxy
    }
    notify_master "/etc/keepalived/notify.sh master"
    notify_backup "/etc/keepalived/notify.sh backup"
}
EOF

# (1) VRRP password — shared between the two LBs, fetched from Vault
$ VRRP_PASS=$(openssl rand -base64 12 | tr -d '/+=' | head -c 8)   ;; max 8 chars per VRRP spec
$ vault kv put kv/platform/keepalived/vrrp \
    password="$VRRP_PASS" \
    rotated_at="$(date -Iseconds)" \
    rotation_period_days=365

$ for h in 01 02; do
    ssh -J au-bastion auishqosrlb${h}.au-internal \
      "sudo sed -i 's|REPLACE_FROM_VAULT|$VRRP_PASS|' /etc/keepalived/keepalived.conf"
  done

# (2) Notify script — logs state transitions to journald (for Loki to pick up)
$ for h in 01 02; do
    ssh -J au-bastion auishqosrlb${h}.au-internal "
      sudo tee /etc/keepalived/notify.sh > /dev/null <<'EOF'
#!/usr/bin/env bash
STATE=\$1
HOST=\$(hostname -s)
logger -t keepalived \"VRRP \$STATE on \$HOST\"
EOF
      sudo chmod 755 /etc/keepalived/notify.sh
    "
  done

# (3) Service user keepalived runs scripts as
$ for h in 01 02; do
    ssh -J au-bastion auishqosrlb${h}.au-internal \
      "sudo useradd --system --no-create-home --shell /usr/sbin/nologin keepalived_script || true"
  done

# (4) Don't start keepalived yet — HAProxy config goes in next, then both come up together
```

### 17.5 HAProxy frontends + backends

The HAProxy config splits into one main file plus per-frontend snippets in `conf.d/`. Same shape as nginx's sites-enabled — additive, scoped, easy to review.

```bash
# [auishqosrlb01-02 — same config on both]

$ sudo tee /etc/haproxy/haproxy.cfg > /dev/null <<'EOF'
# ─────────────────────────────  Globals  ──────────────────────────────
global
    daemon
    maxconn 50000
    nbthread 4                       # match vCPU count
    log /dev/log local0 info
    log /dev/log local1 notice
    stats socket /run/haproxy/admin.sock mode 600 expose-fd listeners
    stats timeout 30s
    user haproxy
    group haproxy
    # TLS not configured here — internal LB is plain TCP; TLS is end-to-end (PgBouncer cert, etc.)

# ─────────────────────────────  Defaults  ─────────────────────────────
defaults
    mode http
    log global
    option dontlognull
    option log-health-checks
    option redispatch
    retries 3
    timeout connect 5s
    timeout client 60s
    timeout server 60s
    timeout queue 30s

# Pull in per-frontend configs
EOF

# (Per-frontend includes via /etc/haproxy/conf.d/*.cfg loaded by systemd service file
#  override below. HAProxy doesn't natively support conf.d but accepts multiple -f flags.)
$ sudo mkdir -p /etc/systemd/system/haproxy.service.d
$ sudo tee /etc/systemd/system/haproxy.service.d/conf.d.conf > /dev/null <<'EOF'
[Service]
Environment=
Environment="CONFIG=-f /etc/haproxy/haproxy.cfg -f /etc/haproxy/conf.d/"
EOF
$ sudo systemctl daemon-reload
```

#### 17.5.1 PgBouncer pool (TCP 6432)

```bash
$ sudo tee /etc/haproxy/conf.d/10-pgbouncer.cfg > /dev/null <<'EOF'
listen pgbouncer
    bind 10.111.30.100:6432
    mode tcp
    option tcplog
    timeout client 1h
    timeout server 1h
    balance leastconn
    option tcp-check
    tcp-check connect port 6432
    default-server inter 2s fall 2 rise 3 maxconn 5000

    server pgb01 10.111.20.60:6432 check
    server pgb02 10.111.20.61:6432 check
EOF
```

The `leastconn` balance keeps long-lived connections distributed across both PgBouncers; tcp-check probes 6432 every 2 sec; `timeout 1h` matches PgBouncer's `server_lifetime`.

#### 17.5.2 Postgres rw / ro split (TCP 5432)

The hard part: how does HAProxy know which Postgres node is the current primary? It runs a **mini health-check script** that asks each backend "are you in recovery mode?" — Postgres replicas return `t`, primaries return `f`. HAProxy uses the answer to route.

For this we use `xinetd` exposing a tiny per-node script on port 23267 (arbitrary high port). Each Postgres node already has the script available via the `pgbouncer-aware-failover` pattern.

```bash
# [each Postgres node — auishqosrpdb01-02]
$ sudo apt install -y xinetd

$ sudo tee /usr/local/bin/pg-isprimary > /dev/null <<'EOF'
#!/usr/bin/env bash
# Returns HTTP 200 if this node is the primary, 503 if it's a replica or down.
if sudo -u postgres psql -tAc "SELECT pg_is_in_recovery();" 2>/dev/null | grep -q 'f'; then
  printf "HTTP/1.1 200 OK\r\nContent-Length: 7\r\n\r\nPRIMARY"
else
  printf "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 7\r\n\r\nREPLICA"
fi
EOF
$ sudo chmod 755 /usr/local/bin/pg-isprimary

$ sudo tee /etc/xinetd.d/pg-isprimary > /dev/null <<'EOF'
service pg-isprimary
{
    flags           = REUSE
    type            = UNLISTED
    socket_type     = stream
    port            = 23267
    wait            = no
    user            = postgres
    server          = /usr/local/bin/pg-isprimary
    only_from       = 10.111.30.0/24
    per_source      = UNLIMITED
    disable         = no
}
EOF

$ sudo systemctl enable --now xinetd
$ sudo ufw allow from 10.111.30.0/24 to any port 23267 proto tcp comment 'HAProxy → pg-isprimary'

# Verify
$ curl http://auishqosrpdb01:23267
# Expected (when this node is primary): "PRIMARY"
$ curl http://auishqosrpdb02:23267
# Expected: "REPLICA"
```

Now HAProxy's frontend uses `httpchk` against this:

```bash
# [auishqosrlb01-02]
$ sudo tee /etc/haproxy/conf.d/20-postgres.cfg > /dev/null <<'EOF'
# Read-write — accepts only the current primary
listen pg-rw
    bind 10.111.30.100:5433
    mode tcp
    option tcplog
    option httpchk GET /
    http-check expect string PRIMARY
    timeout client 1h
    timeout server 1h
    balance first       # always send to the first backend that's "up" (the current primary)
    default-server inter 2s fall 2 rise 3 port 23267 maxconn 1000

    server pdb01 10.111.20.30:5432 check
    server pdb02 10.111.20.31:5432 check

# Read-only — accepts only nodes that are NOT the current primary
listen pg-ro
    bind 10.111.30.100:5434
    mode tcp
    option tcplog
    option httpchk GET /
    http-check expect string REPLICA
    timeout client 1h
    timeout server 1h
    balance leastconn
    default-server inter 2s fall 2 rise 3 port 23267 maxconn 1000

    server pdb01 10.111.20.30:5432 check
    server pdb02 10.111.20.31:5432 check
EOF
```

Result: `pg-rw.au-internal:5433` always routes to the primary (pdb01 in steady state, pdb02 after failover); `pg-ro.au-internal:5434` always routes to a replica. After Postgres failover (chapter 13 §13.10), HAProxy notices within 4-6 seconds and switches automatically — no operator action on the LB side.

> **ℹ Why ports 5433 + 5434 instead of 5432**
>
> The VIP is a single IP. HAProxy can't bind two listeners to the same `IP:port` for different routing logic. We expose rw on `:5433` and ro on `:5434`. Apps' DSN config picks: `pg-rw.au-internal:5433` for writes, `pg-ro.au-internal:5434` for reads. PgBouncer (chapter 16) similarly uses `pg-primary.au-internal:5432`, which is now best repointed at `:5433` here so it follows the writer automatically.

#### 17.5.3 MinIO (HTTPS 443)

```bash
$ sudo tee /etc/haproxy/conf.d/30-minio.cfg > /dev/null <<'EOF'
listen minio
    bind 10.111.30.100:443
    mode tcp                        # SSL passthrough — let MinIO's nginx terminate TLS
    option tcplog
    timeout client 30s
    timeout server 30s
    balance leastconn
    option tcp-check
    tcp-check connect port 443 ssl
    default-server inter 5s fall 2 rise 3 maxconn 2000

    server obj01 10.111.20.50:443 check
    server obj02 10.111.20.51:443 check
    server obj03 10.111.20.52:443 check
    server obj04 10.111.20.53:443 check
EOF
```

We use `mode tcp` + SSL passthrough — apps see MinIO's existing TLS cert (chapter 15 §15.5), no termination on HAProxy. SNI routing isn't needed at this layer; chapter 18 (Cloudflare) handles host-based routing externally. Internal-only MinIO traffic gets transparent load balancing.

#### 17.5.4 Nomad app HTTP backends — Consul SD

Apps run on Nomad clients with dynamic ports. Hard-coding backend IPs would mean reconfiguring HAProxy on every deploy. Instead, use **Consul DNS service discovery** — Consul knows which IP:port serves each app at any moment.

```bash
$ sudo tee /etc/haproxy/conf.d/40-apps.cfg > /dev/null <<'EOF'
resolvers consul
    nameserver consul1 10.111.30.10:8600
    nameserver consul2 10.111.30.11:8600
    nameserver consul3 10.111.30.12:8600
    accepted_payload_size 8192
    resolve_retries 3
    timeout resolve 1s
    timeout retry   1s
    hold valid 5s
    hold other 5s
    hold refused 5s
    hold nx 5s
    hold timeout 5s
    hold obsolete 5s

frontend app-https
    bind 10.111.30.100:443
    mode http
    option httplog
    option forwardfor
    http-request set-header X-Forwarded-Proto https
    # ⚠ This frontend binds the same VIP:443 as the MinIO listener above.
    # In practice we put MinIO on a separate VIP (or use SNI routing here).
    # See §17.5.5 for the cleaner shape.
    default_backend app-default

# Per-app backend with Consul SD (no hard-coded IPs/ports)
backend app-default
    mode http
    balance leastconn
    option httpchk GET /healthz
    http-check expect status 200
    default-server inter 5s fall 2 rise 3 maxconn 200

    # SRV-record-based discovery: Consul resolves greenbook.service.consul to all healthy instances
    server-template gb 10 _greenbook._tcp.service.consul resolvers consul resolve-prefer ipv4 check
EOF
```

`server-template gb 10 ...` creates 10 placeholder backend slots that Consul fills from the SRV record. As Nomad scales greenbook from 3 to 7 to 10 instances, HAProxy discovers them automatically — no config reload.

#### 17.5.5 Multi-VIP layout (production-correct shape)

The mistake hidden in §17.5.4: two frontends can't both bind `10.111.30.100:443`. The cleanest fix is **separate VIPs per service class**:

| VIP           | Hostname                 | Purpose                                   |
| ------------- | ------------------------ | ----------------------------------------- |
| 10.111.30.100 | `lb-data.au-internal`    | TCP load balancing (Postgres + PgBouncer) |
| 10.111.30.101 | `lb-storage.au-internal` | MinIO (TCP+TLS passthrough)               |
| 10.111.30.102 | `lb-apps.au-internal`    | HTTP load balancing (Nomad apps)          |

Add the extra VIPs to Keepalived's `virtual_ipaddress` block (one VRRP instance per VIP, or a single instance carrying all three — single instance is simpler and there's no failure mode where you want one VIP on lb01 and another on lb02). Update each frontend's `bind` line to the matching VIP. DNS records:

```
lb-data.au-internal     IN A  10.111.30.100
lb-storage.au-internal  IN A  10.111.30.101
lb-apps.au-internal     IN A  10.111.30.102
pg-rw.au-internal       IN A  10.111.30.100   # alias to lb-data:5433
pg-ro.au-internal       IN A  10.111.30.100   # alias to lb-data:5434
pgbouncer.au-internal   IN A  10.111.30.100   # alias to lb-data:6432
minio.au-internal       IN A  10.111.30.101
greenbook.platform      IN A  10.111.30.102
```

### 17.6 Consul DNS service discovery for app backends

For HAProxy's `resolvers consul` block (§17.5.4) to work, Consul must:

1. **Be reachable on its DNS port** (8600/tcp + udp) from the LBs — already true via UFW.
2. **Have services registered** — Nomad job specs declare `service { ... }` blocks; Nomad registers them with Consul automatically. Already true from chapter 05.

Verify:

```bash
# [auishqosrlb01]
$ dig @10.111.30.10 -p 8600 greenbook.service.consul SRV +short
# Expected: SRV records like "0 0 25341 auishqosrnmc01.node.consul." for each running greenbook instance
```

Apps that want to be reachable through HAProxy just need their Nomad job to include:

```hcl
service {
  name = "greenbook"
  port = "http"
  check {
    type     = "http"
    path     = "/healthz"
    interval = "10s"
    timeout  = "2s"
  }
}
```

Chapter 30 (App onboarding) makes this part of the contract — every onboarded app declares its health-check endpoint and Consul service name; HAProxy picks them up automatically.

### 17.7 Apps + components switch to the VIP

Consumers updated:

| Consumer                          | Before                           | After (Phase 3)                          | Why                                                                  |
| --------------------------------- | -------------------------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| Apps connecting to PgBouncer      | `pgbouncer.au-internal` DNS-RR   | `pgbouncer.au-internal` (now VIP-backed) | Health-checked failover                                              |
| PgBouncer's `[databases]` `host=` | `pg-primary.au-internal` (CNAME) | `pg-rw.au-internal:5433`                 | Auto-route to current primary; no operator step on Postgres failover |
| Apps doing read-only queries      | direct to replica IP             | `pg-ro.au-internal:5434`                 | Phase 3 read scaling now exists (chapter 13 §13.1's deferred goal)   |
| App→app calls                     | hardcoded URLs                   | `<service>.platform.local`               | Consul SD via HAProxy app frontend                                   |

PgBouncer's reconfig (apply on both PgBouncer VMs):

```bash
# [auishqosrpgb01-02]
$ sudo sed -i 's|host=pg-primary.au-internal port=5432|host=pg-rw.au-internal port=5433|g' \
    /etc/pgbouncer/pgbouncer.ini
$ sudo systemctl reload pgbouncer
# (RELOAD not enough for backend host change — needs restart, but rolling)
$ sudo systemctl restart pgbouncer
```

After this change, the chapter 13 §13.10 manual-failover procedure no longer requires "step (4): update DNS A record." HAProxy's pg-isprimary check switches the writer endpoint within ~4-6 seconds of the primary going down.

### 17.8 haproxy_exporter for Prometheus

HAProxy 2.0+ exposes Prometheus-format metrics natively at `/metrics`:

```bash
# [auishqosrlb01-02]
$ sudo tee /etc/haproxy/conf.d/00-stats.cfg > /dev/null <<'EOF'
frontend stats
    bind 10.111.30.0:8404 interface eth0   ;; bind to the local IP, not the VIP
    mode http
    option httplog
    no log
    stats enable
    stats uri /
    stats refresh 10s
    http-request use-service prometheus-exporter if { path /metrics }
EOF

$ sudo systemctl reload haproxy
$ curl -s http://127.0.0.1:8404/metrics | head -10
```

(The actual `bind` is each LB's primary IP — 10.111.30.90 / .91 — not the VIP. We want the metrics endpoint on whichever physical LB you're hitting, not bound to the floating VIP.)

Add to chapter 10's scrape config:

```bash
# [each obs VM]
$ sudo tee /etc/prometheus/scrapes.d/haproxy.yml > /dev/null <<'EOF'
scrape_configs:
  - job_name: haproxy
    static_configs:
      - targets:
          - auishqosrlb01:8404
          - auishqosrlb02:8404
        labels:
          role: haproxy
EOF
$ sudo -u prometheus promtool check config /etc/prometheus/prometheus.yml
$ curl -X POST http://127.0.0.1:9090/-/reload
```

HAProxy-specific alert rules added to chapter 12's ruleset:

```bash
# [auishqosrobs01]
$ sudo -u mimir tee -a /var/lib/mimir/rules/anonymous/platform.yaml > /dev/null <<'EOF'

  # ─────────────────────────────  Phase 3: HAProxy  ─────────────────────────────
  - name: haproxy
    interval: 60s
    rules:
      - alert: HAProxyDown
        expr: up{job="haproxy"} == 0
        for: 2m
        labels:
          severity: critical
          service: haproxy
        annotations:
          summary: 'HAProxy on {{ $labels.instance }} is down'

      - alert: HAProxyBackendDown
        expr: haproxy_backend_status{state="UP"} != 1
        for: 5m
        labels:
          severity: warning
          service: haproxy
        annotations:
          summary: 'Backend {{ $labels.proxy }}/{{ $labels.server }} is DOWN'

      - alert: HAProxyAllBackendsDown
        expr: |
          sum by (proxy) (haproxy_backend_active_servers) == 0
        for: 1m
        labels:
          severity: critical
          service: haproxy
        annotations:
          summary: 'HAProxy backend pool {{ $labels.proxy }} has 0 healthy servers'

      - alert: HAProxyHighErrorRate
        expr: |
          rate(haproxy_backend_http_responses_total{code="5xx"}[5m]) /
          rate(haproxy_backend_http_responses_total[5m]) > 0.05
        for: 10m
        labels:
          severity: warning
          service: haproxy
        annotations:
          summary: 'HAProxy backend {{ $labels.proxy }} returning {{ $value | humanizePercentage }} 5xx'

      - alert: VRRPSplitBrain
        expr: |
          count(node_vmstat_pgmajfault{instance=~"auishqosrlb.*"}) == 2
          and
          count(haproxy_process_uptime_seconds{instance=~"auishqosrlb.*"} > 0) == 2
          and
          # both LBs report VIP active in their notify scripts → split brain
          # (real query depends on what the notify script logs to — placeholder)
          0
        for: 1m
        labels:
          severity: critical
          service: haproxy
        annotations:
          summary: 'Both LB nodes claim VRRP MASTER state'
EOF

$ for h in 01 02 03; do
    ssh -J au-bastion auishqosrobs${h}.au-internal \
      'curl -s -X POST http://127.0.0.1:9009/ruler/reload'
  done
```

(The `VRRPSplitBrain` rule's expression is illustrative — the exact PromQL depends on what your VRRP notify script logs through the keepalived_exporter; tune once a working metric source is wired up.)

### 17.9 UFW + firewall rules

```bash
# [auishqosrlb01-02]

# Apps from App VLAN → LB
$ sudo ufw allow from 10.111.10.0/24 to any port 443 proto tcp comment 'LB ← App VLAN HTTPS'
$ sudo ufw allow from 10.111.10.0/24 to any port 6432 proto tcp comment 'LB ← App VLAN PgBouncer'
$ sudo ufw allow from 10.111.10.0/24 to any port 5433 proto tcp comment 'LB ← App VLAN pg-rw'
$ sudo ufw allow from 10.111.10.0/24 to any port 5434 proto tcp comment 'LB ← App VLAN pg-ro'

# Operations VLAN
$ sudo ufw allow from 10.111.40.0/24 to any port 443 proto tcp comment 'LB ← Ops'
$ sudo ufw allow from 10.111.40.0/24 to any port 6432 proto tcp comment 'LB ← Ops PgBouncer'
$ sudo ufw allow from 10.111.40.0/24 to any port 5433 proto tcp comment 'LB ← Ops pg-rw'
$ sudo ufw allow from 10.111.40.0/24 to any port 5434 proto tcp comment 'LB ← Ops pg-ro'

# Stats endpoint from obs VMs
$ sudo ufw allow from 10.111.30.0/24 to any port 8404 proto tcp comment 'Prometheus → HAProxy stats'

# VRRP between the two LB nodes — unicast pair (already configured) on VRRP IP proto 112
$ sudo ufw allow from 10.111.30.91 proto vrrp comment 'VRRP from lb02'
# Run on lb02 with lb01's IP as source
$ sudo ufw allow from 10.111.30.90 proto vrrp comment 'VRRP from lb01'

# Backend VMs need to accept connections from the LB's primary IPs (NOT the VIP — source IP is the physical LB)
# [auishqosrpgb01-02 — re-tighten now that LB fronts them]
$ sudo ufw allow from 10.111.30.90 to any port 6432 proto tcp comment 'PgBouncer ← lb01'
$ sudo ufw allow from 10.111.30.91 to any port 6432 proto tcp comment 'PgBouncer ← lb02'

# [auishqosrpdb01-02]
$ sudo ufw allow from 10.111.30.90 to any port 5432 proto tcp comment 'Postgres ← lb01'
$ sudo ufw allow from 10.111.30.91 to any port 5432 proto tcp comment 'Postgres ← lb02'
$ sudo ufw allow from 10.111.30.90 to any port 23267 proto tcp comment 'pg-isprimary ← lb01'
$ sudo ufw allow from 10.111.30.91 to any port 23267 proto tcp comment 'pg-isprimary ← lb02'
```

Once apps are connecting through the LB consistently, you can tighten Postgres' `pg_hba.conf` to drop the broad `10.111.10.0/24` access — only the LB IPs and PgBouncer IPs need direct DB access.

### 17.10 Verification (with VRRP failover drill)

```bash
# (1) Both LB VMs up; lb01 holds the VIP; HAProxy + Keepalived active
$ for h in 01 02; do
    ssh -J au-bastion auishqosrlb${h}.au-internal \
      'sudo systemctl is-active haproxy keepalived'
  done
# Expected: active active from each

$ ssh -J au-bastion auishqosrlb01.au-internal 'ip a show eth0 | grep inet'
# Expected: includes 10.111.30.100 (the VIP) on lb01

$ ssh -J au-bastion auishqosrlb02.au-internal 'ip a show eth0 | grep inet'
# Expected: does NOT include 10.111.30.100

# (2) HAProxy sees backends as UP
$ ssh -J au-bastion auishqosrlb01.au-internal \
    'curl -s http://127.0.0.1:8404/metrics | grep haproxy_backend_active_servers'
# Expected: each backend has the right number of active servers

# (3) Routing — pg-rw goes to primary, pg-ro to replica
$ PGPASSWORD=$APP_PASS psql "host=pg-rw.au-internal port=5433 \
    dbname=postgres user=app_greenbook sslmode=require" \
    -c "SELECT pg_is_in_recovery(), inet_server_addr();"
# Expected: f, 10.111.20.30 (primary)

$ PGPASSWORD=$APP_PASS psql "host=pg-ro.au-internal port=5434 \
    dbname=postgres user=app_greenbook sslmode=require" \
    -c "SELECT pg_is_in_recovery(), inet_server_addr();"
# Expected: t, 10.111.20.31 (replica)

# (4) Postgres failover routing
$ ssh -J au-bastion auishqosrpdb01.au-internal 'sudo systemctl stop postgresql@16-main'
$ sleep 10
$ PGPASSWORD=$APP_PASS psql "host=pg-rw.au-internal port=5433 \
    dbname=postgres user=app_greenbook sslmode=require" \
    -c "SELECT pg_is_in_recovery(), inet_server_addr();"
# After running ch13 §13.10 promotion: f, 10.111.20.31 (now-primary)
# HAProxy auto-discovered the new primary via pg-isprimary
$ ssh -J au-bastion auishqosrpdb01.au-internal 'sudo systemctl start postgresql@16-main'

# (5) VRRP failover drill
$ ssh -J au-bastion auishqosrlb01.au-internal 'sudo systemctl stop haproxy'
$ sleep 5
$ ssh -J au-bastion auishqosrlb02.au-internal 'ip a show eth0 | grep inet'
# Expected: lb02 now holds 10.111.30.100

$ for i in {1..10}; do
    PGPASSWORD=$APP_PASS psql -h pg-rw.au-internal -p 5433 \
      dbname=postgres user=app_greenbook -tAc "SELECT $i;"
  done
# Expected: 10 outputs; first one or two may retry but all succeed

$ ssh -J au-bastion auishqosrlb01.au-internal 'sudo systemctl start haproxy'
$ sleep 5
$ ssh -J au-bastion auishqosrlb01.au-internal 'ip a show eth0 | grep inet'
# Expected: VIP returns to lb01 (priority 110 reclaims master)

# (6) Consul SD finds Nomad app backends
$ ssh -J au-bastion auishqosrlb01.au-internal \
    'sudo socat /run/haproxy/admin.sock - <<< "show servers state"'
# Expected: rows for each greenbook instance from the server-template, with current IP:port

# (7) Verification ladder — keep the LB VIP up; now stop one HAProxy and verify nothing apps notice
#     this is the active-passive promise; document timing for the chapter 40 verification ladder
```

**Common failures and remedies:**

| Symptom                                               | Cause                                                            | Fix                                                                                                                               |
| ----------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| HAProxy fails to start: "cannot bind socket"          | `ip_nonlocal_bind=0`                                             | `sysctl net.ipv4.ip_nonlocal_bind=1`; verify in /etc/sysctl.d/99-haproxy.conf                                                     |
| Both LBs hold the VIP simultaneously (split brain)    | VRRP unicast peers misconfigured; multicast blocked + no unicast | Verify `unicast_peer` blocks list the OTHER LB's IP; UFW allows VRRP between them                                                 |
| pg-rw routes to a replica                             | pg-isprimary check failing; or both backends rejected by HAProxy | `curl http://pdb01:23267` from LB; verify xinetd is up; check HAProxy stats for backend state                                     |
| Apps see "no server is available" briefly on failover | `inter` × `fall` exceeded the failover window                    | Lower `inter` (1s instead of 2s) for faster detection; or accept the 4-6s outage window                                           |
| Consul SD doesn't find new app instances              | TTL too long; or Consul ACL blocks lookup                        | `dig @10.111.30.10 -p 8600 greenbook.service.consul`; check Consul ACLs (Phase 1 ch05); raise hold values                         |
| HAProxy reload causes brief drop in connections       | Default reload behaviour                                         | Use `systemctl reload haproxy` (sends SIGUSR2 — graceful); avoid `restart`; HAProxy 2.4+ does seamless reloads with sockets       |
| Stats endpoint returns 0 backends                     | `frontend stats` not loaded; conf.d missing                      | `haproxy -c -f /etc/haproxy/haproxy.cfg -f /etc/haproxy/conf.d/`; verify systemd override picks up conf.d                         |
| App→app HTTPS fails with "no peer certificate"        | App VLAN trying to do mTLS through HTTP frontend                 | Apps in App VLAN should connect to HTTP backend (8080) not 443; or terminate TLS at apps and let HAProxy do TCP-mode pass-through |

### 17.11 Phase 5 path (Patroni-aware writer-VIP)

Phase 5 [chapter 24 — Patroni for Postgres] (slot reserved) runs Patroni on each Postgres node. Patroni exposes a REST API (`:8008`) with endpoints `/primary`, `/replica`, `/leader`, `/standby-leader`. HAProxy can replace the xinetd `pg-isprimary` script with native HTTP health-checks against Patroni:

```bash
# Phase 5 chapter 24's HAProxy update (replacing §17.5.2):
$ sudo tee /etc/haproxy/conf.d/20-postgres.cfg > /dev/null <<'EOF'
listen pg-rw
    bind 10.111.30.100:5433
    mode tcp
    option httpchk GET /primary
    http-check expect status 200
    timeout client 1h
    timeout server 1h
    balance first
    default-server inter 2s fall 2 rise 3 port 8008 maxconn 1000
    server pdb01 10.111.20.30:5432 check
    server pdb02 10.111.20.31:5432 check

listen pg-ro
    # /replica returns 200 for healthy replicas only
    bind 10.111.30.100:5434
    mode tcp
    option httpchk GET /replica
    ...
EOF
```

Result: Patroni's automated failover (RTO <30 sec) plus HAProxy's instant routing update gives apps a sub-30-second outage window during a primary loss, with no operator action.

What carries over unchanged: every other frontend in §17.5 (PgBouncer, MinIO, Nomad apps), Keepalived VRRP config, the Prometheus integration, the alert rules. Only the Postgres health-check endpoint changes.

---
