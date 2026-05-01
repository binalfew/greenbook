# 01 — Capacity & sizing

> **Phase**: foundation · **Status**: 📋 planned (stub) · **Audience**: platform engineers, infrastructure provisioning team
>
> Sizing the platform's VMs against expected workload. Covers per-tier VM specs, growth projections, and the procurement requisition AU IT will need.
>
> **Prev**: [00 — Architecture](00-architecture.md) · **Next**: [02 — Bastion](02-bastion.md) · **Index**: [README](README.md)

---

## Stub — content pending

This chapter will cover:

- Per-tier VM sizing with rationale (CPU / RAM / disk for each component)
- Growth projection over 3 years — apps, users, log volume, storage
- Hypervisor capacity requirements (cores, RAM, datastore)
- Network bandwidth requirements between VLANs
- Procurement-ready VM specification table for AU IT
- Sizing review triggers (when to scale up: traffic doubles, storage > 70%, etc.)

Draft sizing for Phase 1 (developer foothold):

| Role              | Count       | vCPU   | RAM       | Disk                     | Notes                            |
| ----------------- | ----------- | ------ | --------- | ------------------------ | -------------------------------- |
| Bastion           | 2           | 2      | 4 GB      | 40 GB SSD                | active/passive                   |
| Vault server      | 3           | 2      | 8 GB      | 80 GB SSD                | integrated storage (Raft)        |
| GitLab CE         | 1           | 4      | 16 GB     | 200 GB SSD + 500 GB data | runner workloads on Nomad        |
| Nomad server      | 3           | 2      | 4 GB      | 40 GB SSD                | with Consul colocated            |
| Consul server     | (colocated) | —      | —         | —                        | runs alongside Nomad servers     |
| Nomad client      | 3+          | 4      | 16 GB     | 100 GB SSD               | scales horizontally per app load |
| Nexus             | 1           | 2      | 4 GB      | 200 GB SSD + 1 TB data   | artifact storage growth-driven   |
| **Phase 1 total** | **13**      | **30** | **88 GB** | **~3 TB**                | initial footprint                |

Phase 2-5 sizing and the full table will be drafted alongside their respective bring-up chapters.
