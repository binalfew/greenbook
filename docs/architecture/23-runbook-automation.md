# 23 — Runbook automation

> **Phase**: 5 (operational maturity) · **Run on**: 1× Ansible control node (`auishqosrans01`) on Operations VLAN; targets every existing platform VM via Teleport-issued SSH certs · **Time**: ~6 hours initial setup; ongoing playbook authoring per task
>
> Wraps the manual procedures from earlier chapters into Ansible playbooks. Provisioning, configuration drift detection, patch management, DR drills, backup verification, incident-response automation. Reduces "how do we do X again?" from a documentation-search task to `ansible-playbook X.yml`. **Closes Phase 5.**
>
> Phase 5 chapter 3 of 3.
>
> **Prev**: [22 — Dynamic Vault secrets](22-dynamic-secrets.md) · **Next**: [30 — App onboarding](30-app-onboarding.md) — _post-phase reference_ · **Index**: [README](README.md)

---

## Contents

- [§23.1 Role + threat model](#231-role-threat-model)
- [§23.2 Pre-flight (1 dedicated control node)](#232-pre-flight-1-dedicated-control-node)
- [§23.3 Install Ansible + ecosystem](#233-install-ansible-ecosystem)
- [§23.4 Inventory + groups (one source of truth)](#234-inventory-groups-one-source-of-truth)
- [§23.5 Authentication via Teleport-issued SSH certs](#235-authentication-via-teleport-issued-ssh-certs)
- [§23.6 Playbook layout (per-component + per-action)](#236-playbook-layout-per-component-per-action)
- [§23.7 GitLab CI for lint + dry-run on every PR](#237-gitlab-ci-for-lint-dry-run-on-every-pr)
- [§23.8 Drift detection + nightly remediation](#238-drift-detection-nightly-remediation)
- [§23.9 Patch management (rolling, health-checked)](#239-patch-management-rolling-health-checked)
- [§23.10 DR drill automation (semi-automated ch20 §20.10)](#2310-dr-drill-automation-semi-automated-ch20-2010)
- [§23.11 Vault to Ansible — dynamic secret consumption](#2311-vault-to-ansible-dynamic-secret-consumption)
- [§23.12 Verification](#2312-verification)
- [§23.13 Phase 5 close-out](#2313-phase-5-close-out)

## 23. Runbook automation

### 23.1 Role + threat model

Phases 1-4 produced ~20 chapters of "do these commands in this order on these VMs." That was the right place to start — every step was deliberate, debugged, validated. Phase 5 ch23 takes those validated procedures and codifies them as **idempotent Ansible playbooks**, so the next operator's job is "review the diff, run the playbook" rather than "find and follow chapter X §Y."

What this chapter eliminates:

- Operator-to-operator drift in how a procedure runs (one operator forgets a step; another adds an undocumented one)
- "It worked last time but not this time" mysteries from manual command typing
- The window where chapter docs and reality drift apart

What this chapter does NOT eliminate:

- The chapters themselves — Ansible playbooks are **derived artifacts**; the chapters remain the conceptual source.
- Operator judgement on when to run a playbook — automation doesn't decide WHEN to fail over Postgres; it just executes the steps once decided.
- Playbook code review — every change is a PR with CI lint + dry-run.

Three consequences:

1. **Compromise = ability to push code to every host.** Ansible's reach is total. Defence: Ansible repo is in GitLab with mandatory code review; CI enforces dry-run + lint; the control node has its own role in Vault (chapter 22 §22.4 pattern); Teleport audits every SSH session the control node opens.
2. **Outage = no automated runbook execution.** Manual procedures from earlier chapters always remain available — that's the fallback. Mitigation: control node is single-VM but easily rebuilt; the playbooks themselves live in GitLab (chapter 04), surviving the control node loss.
3. **Stale playbooks are the realistic failure mode.** A playbook that worked 6 months ago but hasn't run since now drifts from the live infrastructure. Defence: drift-detection nightly run (§23.8) catches mismatches; quarterly playbook audit; "playbook last successful run >30 days ago" alert (§23.12).

**Threat model — what we defend against:**

| Threat                                               | Mitigation                                                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Unauthorised playbook push                           | GitLab CODEOWNERS for the Ansible repo; CI requires 2 approvals on production playbooks            |
| Compromised control node                             | Ansible repo in GitLab — all playbooks rebuildable; control-node SSH certs are 1h Vault SSH CA TTL |
| Playbook injects bad config                          | CI runs `ansible-lint`, `yamllint`, dry-run mode against staging-like inventory before merge       |
| Drift between playbook and reality                   | Nightly `--check` mode runs; diff alerted to platform-team email                                   |
| Concurrent playbook executions clobbering each other | Lock file pattern; or use Ansible Tower / AWX (Phase 6+) for serial execution                      |
| Stale credential in playbook                         | Playbooks pull from Vault at runtime via `community.hashi_vault` — no hardcoded values             |
| Operator bypass (running ad-hoc commands)            | Teleport session recording (chapter 21) catches it; alerts on unusual command patterns             |

**Phase 5 deliberate non-goals:**

- **Replacing manual chapters** — chapters remain the conceptual source; playbooks are runnable artifacts of those chapters.
- **AWX / Ansible Tower** — paid feature; out of scope. Bare Ansible + GitLab CI gives the same "audit + queue" experience for our scale.
- **Self-service operator UI** — operators run playbooks from the bastion / control node; no web UI on top.
- **Replacing Terraform** — Ansible handles configuration management on existing VMs; if VM provisioning needs IaC, that's Terraform (Phase 6+).
- **Replacing chapter 30 onboarding** — chapter 30 is the _workflow_ + contract for app teams; chapter 23 provides the _execution_ of platform-side steps.

### 23.2 Pre-flight (1 dedicated control node)

| Role                 | Hostname         | IP           | vCPU | RAM  | Disk  | Notes                         |
| -------------------- | ---------------- | ------------ | ---- | ---- | ----- | ----------------------------- |
| Ansible control node | `auishqosrans01` | 10.111.40.60 | 4    | 8 GB | 80 GB | Operations VLAN (ops tooling) |

Single VM is fine — Ansible is stateless; if the VM is lost, rebuild from playbooks (which live in GitLab). The control node is reproducible from the chapter's own Ansible (the bootstrap problem is solved by a tiny shell script seed).

```bash
# [auishqosrans01]
$ lsb_release -d
$ sudo systemctl is-active unattended-upgrades fail2ban
$ groups | grep operators

# Disk layout: /opt/ansible for playbooks; /var/log/ansible for logs (large)
$ sudo install -d -m 750 -o operators -g operators /opt/ansible /var/log/ansible
```

### 23.3 Install Ansible + ecosystem

```bash
# [auishqosrans01]

# (1) Ansible from the official PPA (gives current LTS — Ansible Core 2.16+)
$ sudo apt install -y software-properties-common
$ sudo apt-add-repository --yes --update ppa:ansible/ansible
$ sudo apt install -y ansible

# (2) Required collections
$ ansible-galaxy collection install \
    community.general \
    community.postgresql \
    community.hashi_vault \
    ansible.posix \
    community.docker

# (3) Useful adjacent tools
$ sudo apt install -y \
    yamllint \
    ansible-lint \
    pipx
$ pipx install ansible-runner

# (4) Verify
$ ansible --version
$ ansible-lint --version
```

### 23.4 Inventory + groups (one source of truth)

The inventory is the master map of "every VM, what role, which group." Lives in GitLab; the control node syncs it on every playbook run.

```bash
# [auishqosrans01]
$ sudo install -d -m 750 -o operators -g operators /opt/ansible/inventory

$ sudo -u operators tee /opt/ansible/inventory/au-platform.yml > /dev/null <<'EOF'
all:
  vars:
    ansible_user: ubuntu
    ansible_python_interpreter: /usr/bin/python3
    ansible_ssh_common_args: '-o ControlMaster=auto -o ControlPersist=60s'

  children:
    bastions:
      hosts:
        auishqosrbas01: { ansible_host: 10.111.40.10 }
        auishqosrbas02: { ansible_host: 10.111.40.11 }

    vault:
      hosts:
        auishqosrvlt01: { ansible_host: 10.111.30.20 }
        auishqosrvlt02: { ansible_host: 10.111.30.21 }
        auishqosrvlt03: { ansible_host: 10.111.30.22 }

    nomad_servers:
      hosts:
        auishqosrnmd01: { ansible_host: 10.111.30.10 }
        auishqosrnmd02: { ansible_host: 10.111.30.11 }
        auishqosrnmd03: { ansible_host: 10.111.30.12 }

    nomad_clients:
      hosts:
        auishqosrnmc01: { ansible_host: 10.111.10.10 }
        auishqosrnmc02: { ansible_host: 10.111.10.11 }
        auishqosrnmc03: { ansible_host: 10.111.10.12 }

    gitlab:
      hosts:
        auishqosrgit01: { ansible_host: 10.111.30.40 }

    nexus:
      hosts:
        auishqosrnex01: { ansible_host: 10.111.30.50 }

    keycloak:
      hosts:
        auishqosrkc01: { ansible_host: 10.111.30.30 }
        auishqosrkc02: { ansible_host: 10.111.30.31 }

    keycloak_db:
      hosts:
        auishqosrkdb01: { ansible_host: 10.111.20.20 }

    observability:
      hosts:
        auishqosrobs01: { ansible_host: 10.111.30.60 }
        auishqosrobs02: { ansible_host: 10.111.30.61 }
        auishqosrobs03: { ansible_host: 10.111.30.62 }
      vars:
        services: [loki, mimir, prometheus, tempo, alertmanager]

    grafana:
      hosts:
        auishqosrgrf01: { ansible_host: 10.111.30.70 }

    postgres_app:
      hosts:
        auishqosrpdb01: { ansible_host: 10.111.20.30 }
        auishqosrpdb02: { ansible_host: 10.111.20.31 }

    redis:
      hosts:
        auishqosrred01: { ansible_host: 10.111.20.40 }
        auishqosrred02: { ansible_host: 10.111.20.41 }
        auishqosrred03: { ansible_host: 10.111.20.42 }

    minio:
      hosts:
        auishqosrobj01: { ansible_host: 10.111.20.50 }
        auishqosrobj02: { ansible_host: 10.111.20.51 }
        auishqosrobj03: { ansible_host: 10.111.20.52 }
        auishqosrobj04: { ansible_host: 10.111.20.53 }

    pgbouncer:
      hosts:
        auishqosrpgb01: { ansible_host: 10.111.20.60 }
        auishqosrpgb02: { ansible_host: 10.111.20.61 }

    haproxy:
      hosts:
        auishqosrlb01: { ansible_host: 10.111.30.90 }
        auishqosrlb02: { ansible_host: 10.111.30.91 }

    teleport:
      hosts:
        auishqostele01:    { ansible_host: 10.111.40.50 }
        auishqostele-px01: { ansible_host: 10.111.30.95 }
        auishqostele-px02: { ansible_host: 10.111.30.96 }

    ansible_control:
      hosts:
        auishqosrans01: { ansible_host: 10.111.40.60 }

    # Composite groups for cross-cutting playbooks
    all_data_tier:
      children:
        postgres_app: {}
        redis: {}
        minio: {}
        keycloak_db: {}

    all_platform_tier:
      children:
        vault: {}
        nomad_servers: {}
        gitlab: {}
        nexus: {}
        keycloak: {}
        observability: {}
        grafana: {}
        haproxy: {}
        teleport: {}

    all_app_tier:
      children:
        nomad_clients: {}
EOF
```

This file becomes the **single source of truth** for inventory across the platform. New VMs added in chapters 30+ (app onboarding) get a row here. Everything downstream (playbooks, drift detection, patch management) reads from this inventory.

### 23.5 Authentication via Teleport-issued SSH certs

Ansible normally uses static SSH keys. Phase 5 + chapter 21 + chapter 22 give us a better option: **Teleport-issued certs** (or Vault SSH CA — same effect, different issuer).

```bash
# [auishqosrans01] — Operators run playbooks via Teleport reverse-tunnel

# Option A: Use Teleport's tsh as a proxy (preferred for Phase 5)
# operator already has a Teleport cert; ssh through tsh
$ cat > ~/.ssh/config <<'EOF'
Host auishqosr*
  ProxyCommand tsh proxy ssh --cluster=au-platform %r@%h
  User ubuntu
  StrictHostKeyChecking yes
EOF

# Now ansible commands work without static keys; every command logged in Teleport
$ ansible -i /opt/ansible/inventory/au-platform.yml all -m ping
# Each connection establishes via Teleport reverse tunnel; recorded automatically.
```

The control-node operator account itself uses Teleport login (chapter 21); when running playbooks, every SSH session goes through Teleport's audit trail. Ansible sees no static keys; nothing on the control node to steal.

For unattended cron-based runs (drift detection, patch nights), the control node uses a **non-renewable Vault SSH CA cert** with 1-hour TTL via Vault Agent (chapter 22 §22.7). The playbook runs, the cert expires, no residual access.

### 23.6 Playbook layout (per-component + per-action)

```
/opt/ansible/
├── inventory/
│   └── au-platform.yml
├── group_vars/
│   ├── all.yml
│   ├── postgres_app.yml
│   └── ...
├── host_vars/
│   └── auishqosrpdb01.yml      # only when host-specific overrides exist
├── roles/
│   ├── base/                   # OS hardening, user setup, journald
│   ├── postgres/               # mirrors chapter 13
│   ├── redis/                  # mirrors chapter 14
│   ├── minio/                  # mirrors chapter 15
│   ├── pgbouncer/              # mirrors chapter 16
│   ├── haproxy/                # mirrors chapter 17
│   ├── teleport/               # mirrors chapter 21
│   └── vault-agent/            # generic — applied to every VM that needs creds
├── playbooks/
│   ├── provision-postgres.yml  # idempotent: brings a fresh VM to chapter 13's state
│   ├── provision-redis.yml
│   ├── ...
│   ├── verify-backups.yml      # codifies chapter 19 §19.6
│   ├── dr-drill.yml            # codifies chapter 20 §20.10
│   ├── patch-rolling.yml       # OS patches; rolling restart per group
│   └── drift-check.yml         # nightly --check mode against everything
└── ci/
    ├── lint.yml                # ansible-lint + yamllint
    └── dry-run.yml             # ansible --check against staging
```

Each role is the Ansible-encoded version of a chapter. Example skeleton for the postgres role:

```yaml
# /opt/ansible/roles/postgres/tasks/main.yml
- name: PG16 apt repo
  ansible.builtin.apt_repository:
    repo: "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
      https://apt.postgresql.org/pub/repos/apt {{ ansible_distribution_release }}-pgdg main"
    state: present

- name: Install PG16 + extensions
  ansible.builtin.apt:
    name: ["postgresql-16", "postgresql-contrib-16", "postgresql-16-pgaudit"]
    state: present

- name: Mount data volume
  ansible.posix.mount:
    src: LABEL=pgdata
    path: /var/lib/postgresql
    fstype: ext4
    opts: defaults,noatime
    state: mounted

- name: Render conf.d/00-platform.conf
  ansible.builtin.template:
    src: 00-platform.conf.j2
    dest: /etc/postgresql/16/main/conf.d/00-platform.conf
    owner: postgres
    group: postgres
    mode: "0644"
  notify: reload postgres
  tags: ["config"]

- name: Render pg_hba.conf
  ansible.builtin.template:
    src: pg_hba.conf.j2
    dest: /etc/postgresql/16/main/pg_hba.conf
    owner: postgres
    group: postgres
    mode: "0640"
  notify: reload postgres
  tags: ["config"]

# ... (all the other steps from chapter 13 §13.4) ...

- name: Verify replication health (if a replica)
  ansible.builtin.command: >
    sudo -u postgres psql -tAc "SELECT pg_is_in_recovery();"
  register: recovery_state
  changed_when: false
  when: inventory_hostname != groups['postgres_app'][0]
  tags: ["verify"]

- name: Replication assertion
  ansible.builtin.fail:
    msg: "Expected replica state but got primary on {{ inventory_hostname }}"
  when:
    - inventory_hostname != groups['postgres_app'][0]
    - recovery_state.stdout != 't'
```

The `tags` system lets operators run subsets:

```bash
# Apply only config changes (no install, no full bootstrap)
$ ansible-playbook -i inventory/au-platform.yml playbooks/provision-postgres.yml --tags=config

# Verify state without changes
$ ansible-playbook -i inventory/au-platform.yml playbooks/provision-postgres.yml --tags=verify --check
```

### 23.7 GitLab CI for lint + dry-run on every PR

```yaml
# /opt/ansible/.gitlab-ci.yml
stages:
  - lint
  - dry-run
  - apply

variables:
  ANSIBLE_FORCE_COLOR: "1"

lint:
  stage: lint
  image: cytopia/ansible:latest
  script:
    - yamllint -c .yamllint.yml .
    - ansible-lint -c .ansible-lint.yml playbooks/

dry-run-staging:
  stage: dry-run
  image: cytopia/ansible:latest
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - ansible-playbook -i inventory/au-platform-staging.yml playbooks/drift-check.yml --check
  artifacts:
    paths: [drift-report.txt]

apply-prod:
  stage: apply
  image: cytopia/ansible:latest
  rules:
    - if: $CI_COMMIT_REF_NAME == "main"
      when: manual
  script:
    - ansible-playbook -i inventory/au-platform.yml playbooks/$PLAYBOOK
  variables:
    PLAYBOOK: ""
  environment:
    name: production
```

Required GitLab settings:

- CODEOWNERS file in the Ansible repo: `/playbooks/dr-drill.yml @platform-team-leads`
- Branch protection on `main`: 2 approvers required
- Apply-prod stage is `when: manual` — humans push the button, not CI

### 23.8 Drift detection + nightly remediation

Every night, the control node runs `--check` mode against everything:

```bash
# /opt/ansible/playbooks/drift-check.yml
---
- name: Drift detection — does live state match what Ansible would set?
  hosts: all
  gather_facts: true
  tasks:
    - name: Apply base role in check mode
      ansible.builtin.include_role:
        name: base
      tags: ['always']

    - name: Apply component role per group
      ansible.builtin.include_role:
        name: "{{ item }}"
      loop: "{{ group_names | intersect(['postgres', 'redis', 'minio', 'haproxy', ...]) }}"
      tags: ['component']
```

Run via systemd timer:

```bash
$ sudo tee /etc/systemd/system/ansible-drift-check.service > /dev/null <<'EOF'
[Unit]
Description=Nightly Ansible drift check

[Service]
Type=oneshot
User=operators
ExecStart=/usr/bin/ansible-playbook -i /opt/ansible/inventory/au-platform.yml \
            /opt/ansible/playbooks/drift-check.yml --check --diff \
            -o /var/log/ansible/drift-check-$(date +%%F).log
EOF

$ sudo tee /etc/systemd/system/ansible-drift-check.timer > /dev/null <<'EOF'
[Unit]
Description=Nightly drift check at 03:00

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

$ sudo systemctl daemon-reload
$ sudo systemctl enable --now ansible-drift-check.timer
```

If drift is detected, the timer logs to journald → Loki picks it up; chapter 12 ruleset gets a new alert:

```yaml
# Add to chapter 12 §12.7 Loki ruleset
- alert: AnsibleDriftDetected
  expr: |
    sum(rate({unit="ansible-drift-check.service"} |~ "changed=" |~ "ok=" [1d])) > 0
    and
    sum(rate({unit="ansible-drift-check.service"} |~ "changed=0" [1d])) == 0
  for: 1m
  labels:
    severity: warning
    service: ansible
  annotations:
    summary: "Ansible drift detected last night — review /var/log/ansible/drift-check-*.log"
```

The decision to actually remediate (not just detect) is **manual** by default — operators review the diff and decide. Auto-remediation can land in a future chapter once the team has confidence in the playbooks.

### 23.9 Patch management (rolling, health-checked)

Replace the manual "ssh to each VM, apt upgrade, reboot if needed" with a playbook that:

1. Runs on one host at a time per group
2. Checks health before/after via the chapter's verification command
3. Halts the entire run if any host fails

```yaml
# /opt/ansible/playbooks/patch-rolling.yml
---
- name: Rolling OS patch with per-host health checks
  hosts: "{{ target_group | default('all') }}"
  serial: 1 # critical — one at a time
  any_errors_fatal: true
  tasks:
    - name: Pre-patch health check
      ansible.builtin.include_tasks: ../tasks/health-check-{{ group_role }}.yml
      tags: ["health"]

    - name: Drain from load balancer (if applicable)
      ansible.builtin.uri:
        url: "http://{{ hostvars['auishqosrlb01']['ansible_host'] }}:8404/"
        method: GET
      when: group_role in ['nomad_clients', 'pgbouncer']

    - name: Apt update
      ansible.builtin.apt: update_cache=true cache_valid_time=0

    - name: Apt upgrade
      ansible.builtin.apt: upgrade=safe

    - name: Check if reboot required
      ansible.builtin.stat:
        path: /var/run/reboot-required
      register: reboot_required

    - name: Reboot if required
      ansible.builtin.reboot:
        msg: "Patch reboot from Ansible"
        connect_timeout: 5
        reboot_timeout: 600
      when: reboot_required.stat.exists

    - name: Post-patch health check
      ansible.builtin.include_tasks: ../tasks/health-check-{{ group_role }}.yml
      tags: ["health"]

    - name: Re-enable in load balancer
      ansible.builtin.command: echo "rebalance"
      when: group_role in ['nomad_clients', 'pgbouncer']
```

Per-group health checks are tiny task files:

```yaml
# /opt/ansible/tasks/health-check-postgres.yml
---
- name: Postgres responding
  ansible.builtin.command: sudo -u postgres pg_isready
  changed_when: false

- name: Replication healthy (if replica)
  ansible.builtin.command: >
    sudo -u postgres psql -tAc "SELECT extract(epoch from now() - pg_last_xact_replay_timestamp())"
  register: lag
  changed_when: false
  when: inventory_hostname != groups['postgres_app'][0]

- name: Replication lag is bounded
  ansible.builtin.fail:
    msg: "Replication lag is {{ lag.stdout }}s, max 60s"
  when:
    - inventory_hostname != groups['postgres_app'][0]
    - lag.stdout | float > 60
```

Operator workflow on patch night:

```bash
# Patch the data tier first (smaller blast radius — replicas absorb)
$ ansible-playbook playbooks/patch-rolling.yml -e target_group=postgres_app -e group_role=postgres

# Then platform tier
$ ansible-playbook playbooks/patch-rolling.yml -e target_group=all_platform_tier
```

If any single host fails, the playbook halts; operator investigates; resumes with `--limit` or `--start-at`.

### 23.10 DR drill automation (semi-automated ch20 §20.10)

Chapter 20 §20.10's DR runbook is a sequence of manual steps. Phase 5 ch23 codifies the **mechanical parts** (provision DR VMs, restore Vault, restart services); the **decisions** (declare DR? fail back?) remain human.

```yaml
# /opt/ansible/playbooks/dr-drill.yml
---
- name: DR drill orchestration
  hosts: localhost
  vars_prompt:
    - name: confirm_drill
      prompt: "Is this a DR DRILL (not real outage)? Type 'drill' to continue"
      private: false
  tasks:
    - name: Halt unless confirmed
      ansible.builtin.fail:
        msg: "Drill not confirmed; aborting"
      when: confirm_drill != "drill"

- name: T+0:10 — Activate DR Vault
  hosts: dr_vault
  tasks:
    - name: Restore Vault from latest snapshot
      ansible.builtin.command: vault operator raft snapshot restore /tmp/latest.snap
    - name: Wait for Vault ready
      ansible.builtin.wait_for: { port: 8200, timeout: 60 }

- name: T+0:30 — Activate DR Nomad
  hosts: dr_nomad_servers
  tasks:
    - name: Restore Nomad snapshot
      ansible.builtin.command: nomad operator snapshot restore /tmp/nomad-latest.snap
    # ... etc

- name: T+1:00 — Promote DR Postgres
  hosts: dr_postgres_replica
  tasks:
    - name: pg_promote
      ansible.builtin.command: sudo -u postgres pg_ctl promote -D /var/lib/postgresql/16/main

- name: ... (every step from ch20 §20.10) ...
```

The control node logs every step's timing → Loki → drill report at `/var/log/ansible/dr-drill-<date>.log`. Compare quarterly to the documented timings; deviations flag procedure drift.

### 23.11 Vault to Ansible — dynamic secret consumption

Playbooks fetch secrets from Vault at runtime, never store them. The `community.hashi_vault` collection does this natively:

```yaml
# Example — playbook that needs the Postgres replication password
- name: Get replication password from Vault
  community.hashi_vault.vault_kv2_get:
    url: https://vault.au-internal:8200
    path: platform/postgres/replication
    auth_method: token
    token: "{{ lookup('env', 'VAULT_TOKEN') }}"
  register: repl_secret

- name: Render replica config with password
  ansible.builtin.template:
    src: 10-replica.conf.j2
    dest: /etc/postgresql/16/main/conf.d/10-replica.conf
  vars:
    repl_password: "{{ repl_secret.data.data.password }}"
  no_log: true # don't print the secret in playbook output
```

The control node authenticates to Vault via Vault Agent (chapter 22 §22.8) — the operator provides their personal Teleport-issued OIDC login at the start of each session; Vault Agent refreshes for the duration.

### 23.12 Verification

```bash
# (1) Inventory is parseable
$ ansible-inventory -i /opt/ansible/inventory/au-platform.yml --list | jq '.all.children | keys'

# (2) Connectivity to every host
$ ansible -i /opt/ansible/inventory/au-platform.yml all -m ping
# Expected: every host green; any red → SSH cert issue or host-down

# (3) Lint
$ ansible-lint /opt/ansible/playbooks/

# (4) Dry-run a small role against one host
$ ansible-playbook -i /opt/ansible/inventory/au-platform.yml \
    playbooks/provision-postgres.yml --check --diff --limit auishqosrpdb02
# Expected: 0 changes if drift-clean; non-zero diff if drift exists

# (5) Drift-check timer is firing
$ sudo systemctl list-timers --no-pager | grep ansible
# Expected: ansible-drift-check.timer with next-run scheduled

$ ls /var/log/ansible/drift-check-*.log | head -3
# Expected: at least one recent log

# (6) DR drill end-to-end (in a staging environment)
$ ansible-playbook -i inventory/staging.yml playbooks/dr-drill.yml
# Expected: every step succeeds; total time < 4h target

# (7) Patch rolling — fake patch (no actual upgrades) verifies the orchestration
$ ansible-playbook playbooks/patch-rolling.yml \
    -e target_group=redis -e group_role=redis -e fake_patch=true
```

**Add to chapter 12 §12.6 ruleset:**

```yaml
- alert: AnsibleDriftCheckMissed
  expr: |
    (time() - node_systemd_unit_state_succeeded_seconds{name="ansible-drift-check.service"}) > 86400 * 2
  for: 1h
  labels:
    severity: warning
    service: ansible
  annotations:
    summary: "Ansible drift check has not succeeded in {{ $value | humanizeDuration }}"

- alert: AnsiblePlaybookFailed
  expr: |
    sum by (playbook) (rate({unit=~"ansible-.*\\.service"} |~ "PLAY RECAP" |~ "failed=[1-9]" [1h])) > 0
  for: 5m
  labels:
    severity: warning
    service: ansible
  annotations:
    summary: "Playbook {{ $labels.playbook }} reported failures"
```

### 23.13 Phase 5 close-out

With chapter 23, **Phase 5 (operational maturity) is complete**. The platform progresses from "documented" to "automated":

| Capability              | Phase 1-4 status                   | After Phase 5                                           |
| ----------------------- | ---------------------------------- | ------------------------------------------------------- |
| Operator access         | Static SSH keys (chapter 02)       | Teleport short-lived certs + RBAC + recording (ch 21)   |
| App credentials         | 90-day rotated static passwords    | 1-hour dynamic leases via Vault DB engine (ch 22)       |
| App-to-backend mTLS     | Deferred from chapters 14/15/16/17 | Vault PKI engine; auto-renewing certs (ch 22)           |
| Encryption-as-a-service | (none)                             | Vault Transit + datakeys (ch 22)                        |
| Routine ops             | Manual chapter-following           | Ansible playbooks; CI-validated; drift-detected (ch 23) |
| DR drill execution      | Fully manual (ch 20)               | Semi-automated (ch 23 §23.10)                           |
| Patch management        | Per-VM SSH session                 | Rolling, health-checked, single command (ch 23 §23.9)   |
| Operator audit          | Per-host journald (ch 02)          | Centralised in Teleport audit (ch 21 §21.10)            |

**Phase 5 close-out summary** — the final close-out:

| Component             | Phase 5 location                               | Beyond Phase 5                                       |
| --------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| Operator access       | Teleport with Keycloak SSO                     | (No further evolution planned; Teleport scales)      |
| Vault dynamic secrets | DB + PKI + Transit + SSH CA engines            | (Phase 6 may add transit-FF for FIPS HSM backing)    |
| Ansible automation    | Bare ansible + GitLab CI                       | AWX / Tower if scale demands (Phase 6+ candidate)    |
| Patroni (Postgres HA) | Slot reserved as ch24 — referenced in 13/16/17 | Future chapter when AU's RTO target tightens to <30s |
| Redis Cluster         | Slot reserved as ch26 — referenced in ch14     | Future chapter when single-node RAM exceeded         |
| MinIO expansion       | Slot reserved as ch25 — referenced in ch15     | Future chapter when usable capacity <50%             |

**Phase 5 closes on 2026-05-02.** All five primary phases drafted. The platform now has:

1. **Phase 1** — developer foothold: bastion, Vault, GitLab, Nomad, Nexus
2. **Phase 2** — identity + observability: Keycloak SSO, full LGTM stack
3. **Phase 3** — app scaling + edge HA: Postgres HA, Redis, MinIO, PgBouncer, HAProxy, Cloudflare
4. **Phase 4** — resilience: backup strategy, DR site
5. **Phase 5** — operational maturity: Teleport, dynamic Vault secrets, Ansible automation

**What remains** (post-phase reference chapters, not part of any phase):

- Chapter 30 — App onboarding workflow (the user-facing surface; consolidates every "chapter 30 contract" reference scattered through Phases 1-5)
- Chapter 40 — Verification ladder (mirrors greenbook ch13 — comprehensive end-to-end test sheet)
- Chapter 41 — Incident response (playbooks per common failure mode)
- Chapter 42 — Hardening checklist (pre-go-live audit)
- Appendix A — Command cheatsheet (rolling)
- Appendix B — Reference configs (canonical files per chapter)
- Appendix C — External references (upstream docs, vendor links)

These can be drafted in any order as operational needs surface. The 5 numbered phases form the complete buildout; the post-phase chapters are continuous improvements.

---
