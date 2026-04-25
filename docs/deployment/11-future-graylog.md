# 11 — Future Graylog deployment (planning)

> **Phase**: post-launch enhancement · **Status**: PLANNING ONLY — no commands to run yet
>
> Once greenbook is stable in production, add a third VM running Graylog (MongoDB + OpenSearch + Graylog Server) for centralised log search and alerting. This file covers the architecture, sizing, install outline, and the choice between Docker's `gelf` log driver vs running a log shipper alongside `json-file` (recommended).
>
> **Prev**: [10 — Troubleshooting](10-troubleshooting.md) · **Index**: [README](README.md)

---

## 10. Planning a future Graylog deployment

Graylog is a log-aggregation platform: it ingests structured and unstructured log events from many sources, indexes them into OpenSearch, and gives you a web UI to search, filter, alert on, and dashboard them. It is the SIEM-adjacent open-source choice when you need something more than "tail the journal on each VM" but less than a commercial platform like Splunk or Datadog.

This section is PLANNING only — no commands are run yet. The intent is that once your app is stable in production, you add a third VM for Graylog and wire the app VM to ship logs to it.

### 10.1 Graylog architecture

```
                 ┌────────────────────────────────┐
                 │           GRAYLOG VM           │
                 │                                │
                 │   ┌──────────────────────┐     │
                 │   │  Graylog Server      │ ←── Web UI: 9000/tcp
                 │   │   (Java, OpenJDK)    │     │
                 │   └──────────┬───────────┘     │
                 │              │                 │
                 │   ┌──────────┴───────────┐     │
                 │   │  OpenSearch 2.x      │     │  log storage & search
                 │   │  (indices, search)   │     │
                 │   └──────────────────────┘     │
                 │                                │
                 │   ┌──────────────────────┐     │
                 │   │  MongoDB 6+          │     │  Graylog config/metadata
                 │   │  (Graylog config)    │     │  (NOT the log data)
                 │   └──────────────────────┘     │
                 └─────────────▲──────────────────┘
                               │
               GELF over UDP/TCP, Syslog, HTTP, Beats
                               │
    ┌──────────────────────────┴─────────────────────────┐
    │     APP VM                DB VM           (future) │
    │   Docker logs           Postgres logs              │
    │   Nginx logs            Auth logs                  │
    └────────────────────────────────────────────────────┘
```

### 10.2 Why a separate VM

- Log ingestion spikes (e.g. during an incident) should not consume CPU or memory from the app.
- OpenSearch is JVM-based and memory-hungry; giving it its own host lets you size it independently.
- Log data is sensitive — it often contains user identifiers, request headers, and error context. Isolating it behind its own firewall boundary is cleaner than sharing with the app.
- You can restart or upgrade Graylog without touching the app.

### 10.3 Sizing guidance

| Volume        | CPU     | RAM   | Disk       | Notes                                               |
| ------------- | ------- | ----- | ---------- | --------------------------------------------------- |
| < 1 GB/day    | 2 cores | 4 GB  | 50 GB SSD  | Small team / dev/QA use.                            |
| 1–10 GB/day   | 4 cores | 8 GB  | 200 GB SSD | Typical for a production app with moderate traffic. |
| 10–100 GB/day | 8 cores | 16 GB | 1 TB SSD   | Consider separating OpenSearch onto its own VM.     |

Rule of thumb for OpenSearch heap: half of system RAM, capped at 31 GB. Retention drives disk: with zstd compression (default) expect ~0.3–0.5x the raw log volume on disk, per day, per replica.

### 10.4 Installation outline

Outline only — each step should be expanded and tested when you actually build this VM.

- Provision Ubuntu 24.04 VM. Run the pre-flight steps in §3 to establish a hardened baseline.
- Install OpenSearch 2.x following the Graylog-recommended steps (disable swap, set vm.max_map_count, install via the OpenSearch apt repo, enable single-node discovery).
- Install MongoDB 6+ or compatible (replica set of one for a single-host Graylog; sharded only at much larger scale).
- Install Graylog Server via the graylog-6.x apt repo. Configure /etc/graylog/server/server.conf with a generated password_secret (pwgen -N 1 -s 96) and a sha2 hash of the admin password.
- Install Nginx in front of Graylog Server for TLS termination — same pattern as the app VM.
- Open UFW: 443/tcp for the UI, 12201/udp for GELF ingestion (or a different port if you choose).

### 10.5 Wiring Docker logs to Graylog

Two options for getting Docker container logs into Graylog. Picking between them is the main architectural decision and has meaningful operational consequences.

#### Option A: Docker’s gelf log driver (direct)

```
# In /opt/greenbook/docker-compose.yml, replace the logging block:
logging:
  driver: gelf
  options:
    gelf-address: "udp://10.111.11.52:12201"
    tag: "greenbook"
    # gelf-compression-type: "gzip"
    # gelf-compression-level: "1"
```

> **⚠ The major tradeoff: you lose "docker logs"**
>
> The Docker gelf log driver REPLACES the default json-file driver. Once this is in place, the following STOP WORKING for this container:
>
> · docker logs greenbook returns nothing
>
> · docker compose logs app returns nothing
>
> · docker compose logs --tail returns nothing
>
> All of the above are the primary tools you reach for when something breaks. If Graylog is down (or not yet built), or if the network path to it is broken, you will have NO access to the app’s recent logs on the host. Before switching any production container to the gelf driver, make sure:
>
> (1) Graylog is stable and has redundancy appropriate to your criticality.
>
> (2) Your runbook for "app is broken" no longer assumes docker logs is available.
>
> (3) You have accepted that UDP GELF is lossy under load — some log lines WILL be dropped silently in a burst. TCP GELF (gelf-address: tcp://...) avoids drops but blocks the container if Graylog is slow.

#### Option B: Keep json-file, run a log shipper (recommended)

Leave the container on the default json-file driver. Deploy a separate shipper (Filebeat, Vector, or Fluent Bit) on the app VM that tails /var/lib/docker/containers/_/_.log and forwards to Graylog. Benefits:

- "docker logs" still works — this is a big deal during incidents.
- The shipper buffers to disk when Graylog is unreachable; no log loss on transient failures.
- You get Graylog’s structured search on normal days, and docker-native tools on bad days.

The extra moving part (a shipper service) is worth the operational insurance. Vector and Fluent Bit are both lightweight and have good Docker inputs out of the box.

### 10.6 Shipping Node application logs directly

For structured events from the Node app (business events, audit records), consider emitting GELF directly from application code using a library like `graygelf` or `winston-gelf-tcp`. This bypasses container logs entirely and lets you send richer structured fields. Keep one rule: never send secrets or full request bodies — redact before shipping.

---
