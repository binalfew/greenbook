# 02 — Database VM setup

> **Phase**: bring-up · **Run on**: DB VM (`auishqosrgbdbs01`, 10.111.11.50) · **Time**: ~45 min
>
> PostgreSQL 16 from the PGDG repository, SCRAM-SHA-256 auth, the `greenbook` database + `appuser` role, network exposure on the internal interface only, pg_hba pinned to the app VM's IP, and Postgres tuning. Backups are in [03 — Database VM backups](03-db-vm-backups.md).
>
> **Prev**: [01 — Pre-flight](01-pre-flight.md) · **Next**: [03 — Database VM backups](03-db-vm-backups.md) · **Index**: [README](README.md)

---

## 4. Database VM setup

This section sets up PostgreSQL 16 on the DB VM. We use the PostgreSQL Global Development Group (PGDG) apt repository rather than Ubuntu’s packages, because PGDG tracks upstream patch releases and publishes security fixes immediately. PostgreSQL 16 is supported by the community until November 2028.

### 4.1 Add the PGDG apt repository and install PostgreSQL 16

We add the PGDG signing key to a dedicated file under /usr/share/postgresql-common/pgdg/, then create an apt source list that references it. This is the modern apt signing pattern — the older "apt-key add" is deprecated because it merged all keys into a single global trust store, defeating scoped trust.

```bash
# [auishqosrgbdbs01]
$ sudo apt install -y curl ca-certificates
#   We need curl (to download the key) and ca-certificates (so curl's HTTPS
#   to postgresql.org verifies). Already installed in pre-flight; repeating
#   is harmless — apt will say "already the newest version".

$ sudo install -d /usr/share/postgresql-common/pgdg
#   install -d DIR    create DIR. Unlike mkdir, install can set mode/owner
#                      in one command. Here we just need the directory.

$ sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
#   curl                  fetch a URL.
#   -o PATH               write the response body to PATH (not stdout).
#   --fail                exit non-zero on HTTP errors. Without this, curl
#                          happily saves an error page as if it were the key.
#   The URL serves the long-term PGDG signing key. Its fingerprint is
#   B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8. Verify with:
#       gpg --show-keys /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc

$ sudo sh -c 'echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
  https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list'
#   sh -c 'CMD'              run CMD in a fresh shell. Required because the
#                            redirect (>) needs root privileges for the
#                            TARGET file, not just the command.
#   echo "..." > /etc/...    write the line to the source list file.
#   signed-by=PATH           apt only accepts packages signed by keys in PATH.
#   $(lsb_release -cs)       captures "noble" on Ubuntu 24.04. -c = codename,
#                            -s = short form. Evaluated before the command runs.
#   -pgdg main               PGDG's repository suite (codename + "-pgdg").

$ sudo apt update
#   Refresh package lists so apt learns about everything in the new PGDG repo.
```

```bash
apt-cache policy postgresql-16 | head -20
#   apt-cache policy PKG    show installed and candidate versions for PKG and
#                           which repository each comes from.
#   | head -20              pipe through head, keeping only first 20 lines.
# Expected: "Candidate: 16.x-1.pgdg24.04+1" and a 500-priority entry pointing
# at apt.postgresql.org. If Candidate points at archive.ubuntu.com, the PGDG
# repo was not added correctly — re-run the curl and echo steps above.

$ sudo apt install -y postgresql-16 postgresql-client-16 postgresql-contrib-16
#   postgresql-16           the server (postmaster, psql, data-dir setup).
#   postgresql-client-16    psql and related CLI tools. Technically already
#                            a dependency of the server package, listed
#                            explicitly for clarity.
#   postgresql-contrib-16   optional modules: pg_trgm, pgcrypto, etc. Cheap
#                            to include, often wanted later.

$ sudo systemctl status postgresql --no-pager
# Expected: "active (exited)" for the postgresql wrapper service. On Debian/
# Ubuntu, Postgres runs the actual database as a separate unit,
# postgresql@16-main.service. Check it too:
#   sudo systemctl status postgresql@16-main.service --no-pager

$ sudo -u postgres psql -c "SELECT version();"
#   sudo -u USER CMD    run CMD as the specified user.
#   postgres            the OS user created by the PostgreSQL package; it owns
#                        the data directory and is also the database superuser.
#   psql                PostgreSQL's interactive client.
#   -c "SQL"            execute SQL and exit (non-interactive).
# Expected: "PostgreSQL 16.x on x86_64-pc-linux-gnu ..."
```

> **ℹ About the repository key**
>
> The URL https://www.postgresql.org/media/keys/ACCC4CF8.asc serves the long-term PGDG signing key. Its fingerprint is B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8. You can verify with: gpg --show-keys /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc

### 4.2 Set the password encryption to SCRAM-SHA-256

PostgreSQL 16 ships with password_encryption = scram-sha-256 as the default, but it is worth asserting this explicitly before creating any users — because roles keep whatever hash format was in effect when their password was set. If a legacy tool ever flips it to md5 and you create a user, that user’s password will be md5-hashed until you reset it.

```bash
# [auishqosrgbdbs01]
$ sudo -u postgres psql <<'SQL'
ALTER SYSTEM SET password_encryption = 'scram-sha-256';
--   ALTER SYSTEM modifies a server-wide parameter. Changes are written to
--   postgresql.auto.conf, which is read AFTER postgresql.conf so it overrides.
SELECT pg_reload_conf();
--   pg_reload_conf() tells the postmaster to re-read config files WITHOUT
--   restarting. Most parameters support reload; a few (shared_buffers,
--   listen_addresses) require full restart. password_encryption is reload-only.
SHOW password_encryption;
--   SHOW PARAM displays the current effective value. Confirms our change took.
SQL
# Expected final output: scram-sha-256
```

### 4.3 Create the application database and user

The production database is named **`greenbook`** throughout this guide. Local development uses `app` as the DB name (per `.env.example`) because that was the template default — but in production we rename to `greenbook` so every piece of metadata (psql prompts, `pg_dump` filenames, pgBackRest stanzas, log lines, cloud-console listings) identifies this database unambiguously. If your AU naming standard prefers `greenbook_prod` or similar, substitute everywhere you see `greenbook` below.

Generate a strong password first. Anything less than 24 random characters is not appropriate for a production database account.

```bash
# [auishqosrgbdbs01]
$ openssl rand -base64 32
#   openssl rand         generate cryptographically random bytes.
#   -base64              encode output as base64 (safe in env vars,
#                         connection strings, most config files).
#   32                   number of RAW bytes. Base64 expansion yields ~44 chars.
# Copy the output somewhere safe. Call it APP_DB_PASSWORD for the rest of this
# document. You will need it in two places:
#   (a) now, in the CREATE USER below;
#   (b) later, in /etc/greenbook.env on the app VM.
```

```bash
# [auishqosrgbdbs01]
$ sudo -u postgres psql <<'SQL'
-- Replace STRONG_PASSWORD_HERE with the openssl output above BEFORE pasting.
CREATE USER appuser WITH LOGIN PASSWORD 'STRONG_PASSWORD_HERE';
--   CREATE USER is shorthand for CREATE ROLE ... LOGIN.
--   PASSWORD 'X' — Postgres hashes X according to the current value of
--                   password_encryption (which we just set to scram-sha-256).
--                   Plaintext X exists in the network protocol for this one
--                   command only; the server stores only the hash.

CREATE DATABASE greenbook
  OWNER appuser
  ENCODING 'UTF8'
  LC_COLLATE 'en_US.UTF-8'
  LC_CTYPE   'en_US.UTF-8'
  TEMPLATE template0;
--   OWNER appuser             grants full privileges on the new DB to appuser.
--                              CRITICAL for greenbook: `prisma db push` (which
--                              greenbook uses for schema changes) needs CREATE
--                              on the database AND on the public schema.
--   ENCODING 'UTF8'           store strings as UTF-8 (universally safe).
--   LC_COLLATE / LC_CTYPE     locale for sorting and character classification.
--                              en_US.UTF-8 is the safest default; it is
--                              installed by default on Ubuntu.
--   TEMPLATE template0        copy from the unmodified template. template1
--                              (the default) may have local modifications and
--                              is tied to the cluster's default locale.

\c greenbook
--   \c DBNAME                 connect to DBNAME. Subsequent commands run there.

GRANT ALL ON SCHEMA public TO appuser;
--   PostgreSQL 15+ changed default privileges on the public schema: non-owners
--   no longer have CREATE on public. This line restores CREATE rights for
--   appuser on its own database. Without it `prisma db push` (and any later
--   `prisma migrate deploy`) fails with "permission denied for schema public".

\q
SQL
```

> **ℹ Why TEMPLATE template0**
>
> The default template1 may carry local modifications. template0 is a clean, unmodified template — using it guarantees reproducible databases across environments.

### 4.4 Configure listen_addresses

By default PostgreSQL only listens on localhost, which is correct for a single-VM setup but wrong for ours. We expose it on the internal interface only — never on 0.0.0.0, which would expose it on every interface including any future public one.

```bash
# [auishqosrgbdbs01]
$ sudo -u postgres psql -c "SHOW config_file;"
#   SHOW config_file     report the exact path of the active postgresql.conf.
# Expected on Ubuntu: /etc/postgresql/16/main/postgresql.conf

$ sudo nano /etc/postgresql/16/main/postgresql.conf
#   nano FILE    simple visual text editor. Use vim or any other if you prefer.
#   sudo         required because the file is owned by postgres:postgres.
```

Find and edit these lines:

```
# BEFORE (commented out or set to localhost):
#listen_addresses = 'localhost'

# AFTER:
listen_addresses = 'localhost,10.111.11.50'
#   'localhost,10.111.11.50'  — two interfaces, comma-separated:
#     localhost   keeps the lo interface working (needed by pgBackRest and
#                 any local tool like pg_dump that uses /tmp/.s.PGSQL.5432).
#     10.111.11.50   the DB VM's internal IP. Only this interface accepts
#                 remote connections. DO NOT use '*' or '0.0.0.0' — that
#                 would expose Postgres on every network interface.

# Leave the rest as-is for now. We will tune memory settings below.
```

A listen_addresses change requires a full restart, not just a reload. We’ll do both the restart and the pg_hba edit below and restart once.

### 4.5 Configure pg_hba.conf (who can connect from where)

pg_hba.conf ("host-based authentication") controls which clients can connect, to which databases, and what authentication method is required. It is evaluated top-down, first-match-wins. This ordering is critical: a permissive rule at the top can shadow a stricter rule below it; a stray "reject" line above our allow rule will block our app.

```bash
# [auishqosrgbdbs01]
$ sudo nano /etc/postgresql/16/main/pg_hba.conf
```

Scroll down until you find the "# IPv4 local connections:" section. Add our rule IMMEDIATELY ABOVE the first default IPv4 entry (the one starting with "host all all 127.0.0.1/32"):

```
# TYPE  DATABASE  USER     ADDRESS         METHOD
host    greenbook appuser  10.111.11.51/32    scram-sha-256
#   TYPE      host            TCP/IP connection. Use 'hostssl' to REQUIRE TLS
#                              on top of the TCP connection, if you want that.
#   DATABASE  greenbook       this rule applies ONLY to connections to the
#                              "greenbook" database. 'all' would match any
#                              database — too broad.
#   USER      appuser         ONLY appuser-role connections match. 'all' would
#                              include the postgres superuser — never do that.
#   ADDRESS   10.111.11.51/32    CIDR. /32 is a single IP (exactly 10.111.11.51).
#                              If you add a second app VM at 10.111.11.52, add
#                              a SECOND line; do not widen /32 to a subnet.
#   METHOD    scram-sha-256   challenge/response auth using a salted SHA-256
#                              hash of the password. Modern standard; replaces
#                              md5 which is being deprecated.
```

> **⚠ Ordering matters in pg_hba.conf**
>
> pg_hba.conf is read top-down, first-match-wins. If there is any "reject" rule or a broader "all"-covering rule above the line you just added, requests from 10.111.11.51 may match THAT first and your scram-sha-256 rule will never be evaluated. Scan the file before saving: no earlier line should match type=host, database=greenbook OR all, user=appuser OR all, with an address range including 10.111.11.51. Fresh Ubuntu installs are clean; the warning is for edits layered on previous edits.

> **⚠ Use scram-sha-256, never md5 or trust**
>
> md5 password hashing is considered legacy by the PostgreSQL project and is being phased out. scram-sha-256 uses a challenge-response mechanism that never sends the password or its hash across the network, and resists pass-the-hash attacks. trust means no authentication at all — acceptable only for local Unix sockets to the postgres role, never for network connections.

### 4.6 Apply the changes

```bash
# [auishqosrgbdbs01]
$ sudo systemctl restart postgresql
#   restart         stops and starts the service. Required because
#                   listen_addresses cannot be changed without restarting the
#                   postmaster — the listener socket is opened at startup and
#                   the postmaster never re-reads the binding. Other settings
#                   (including pg_hba.conf) accept a cheaper reload.
# The restart takes 1-3 seconds. Open connections get terminated; clients reconnect.

$ sudo systemctl status postgresql --no-pager
# Confirm the service came back up cleanly.

$ sudo ss -tlnp | grep 5432
#   ss           "socket statistics" — modern replacement for netstat.
#   -t           TCP sockets only.
#   -l           listening sockets (servers), not established connections.
#   -n           numeric — don't try to resolve ports to service names.
#   -p           show which process owns each socket (needs root).
#   | grep 5432  filter for port 5432.
# Expected: two lines — 127.0.0.1:5432 AND 10.111.11.50:5432 — both owned by
# postgres. Missing the 10.111.11.50 line means listen_addresses didn't take;
# re-check the postgresql.conf edit.
```

### 4.7 Open the firewall for the app VM only

```bash
# [auishqosrgbdbs01]
$ sudo ufw allow from 10.111.11.51 to any port 5432 proto tcp \
  comment 'Postgres from auishqosrgbwbs01'
#   ufw allow from SRC to DST port PORT proto PROTO [comment 'TEXT']
#     from 10.111.11.51   source IP (or CIDR). Only this address matches.
#     to any            destination — any local IP on this VM. The canonical
#                        form; we only have one inbound IP anyway.
#     port 5432         destination port.
#     proto tcp         TCP only, not UDP.
#     comment '...'     stored with the rule and shown in "ufw status".
#                        Future you will thank present you for commenting.

$ sudo ufw status numbered
#   numbered      list rules with position numbers, so you can delete a
#                 specific rule later with "sudo ufw delete N".
# Expected: "5432/tcp  ALLOW IN  10.111.11.51  # Postgres from auishqosrgbwbs01".
# If any rule allows 5432 from Anywhere or 0.0.0.0/0, delete it immediately —
# it defeats the point of this rule.
```

### 4.8 Verify end-to-end from the app VM

```bash
# [auishqosrgbwbs01]
$ sudo apt install -y postgresql-client-16
#   Installs just the psql client. Not strictly required for the final
#   deployment (the app talks to Postgres itself), but it gives us a cheap
#   way to test the DB path without going through Docker first. Leave it
#   installed — useful for operations.

$ psql -h 10.111.11.50 -U appuser -d greenbook \
  -c "SELECT current_user, current_database(), inet_server_addr();"
#   psql             PostgreSQL's CLI.
#   -h HOST          server hostname or IP. Without -h, psql uses a Unix socket
#                     (which would fail on the app VM — no local Postgres here).
#   -U USER          database role to connect as (not the OS user).
#   -d DB            database to connect to — the production name we created
#                     in §4.3. Local dev uses "app"; production is "greenbook".
#   -c "SQL"         run SQL and exit (non-interactive).
# You will be prompted for APP_DB_PASSWORD. After typing it:
# Expected: one row — appuser | greenbook | 10.111.11.50
#   current_user / current_database() confirm who and where.
#   inet_server_addr() returns the IP the SERVER sees itself as — confirms
#   we hit the internal interface (not the local socket, not a VIP, etc.).
```

If this fails, see the troubleshooting section at the end of this document — specifically "Cannot connect from the app VM to Postgres". Do not proceed until this test passes.

### 4.9 Essential tuning

Default PostgreSQL memory settings are conservative. Adjust based on available RAM on the DB VM. The values below are safe starting points for a 4 GB or 8 GB VM; scale up linearly for larger VMs.

| Parameter            | 4 GB VM | 8 GB VM | 16 GB VM | What it controls                                                   |
| -------------------- | ------- | ------- | -------- | ------------------------------------------------------------------ |
| shared_buffers       | 1GB     | 2GB     | 4GB      | Postgres page cache. Rule of thumb: 25% of RAM.                    |
| effective_cache_size | 3GB     | 6GB     | 12GB     | Planner hint about total OS + PG cache. Rule: 50–75% of RAM.       |
| work_mem             | 16MB    | 32MB    | 64MB     | Per-sort / per-hash memory. This is per operation, per connection. |
| maintenance_work_mem | 256MB   | 512MB   | 1GB      | Used by VACUUM, CREATE INDEX, ALTER TABLE.                         |
| max_connections      | 100     | 100     | 200      | Hard cap on concurrent clients. Lower is better — pool at the app. |
| wal_compression      | on      | on      | on       | Compresses WAL pages; cheap win.                                   |
| checkpoint_timeout   | 15min   | 15min   | 30min    | Longer = fewer full-page writes, more WAL between checkpoints.     |
| random_page_cost     | 1.1     | 1.1     | 1.1      | Assumes SSD storage. Leave at 4 for spinning disks.                |

Append these to /etc/postgresql/16/main/postgresql.conf at the bottom, then restart Postgres to apply. Each line is explained below.

```
# Example for an 8 GB auishqosrgbdbs01.

shared_buffers = 2GB
# Memory reserved for Postgres's own page cache. Writes go here first, then
# the OS flushes to disk. Too small = constant disk I/O. Too large = fights
# with the OS page cache. ~25% of total RAM is the conventional sweet spot.

effective_cache_size = 6GB
# NOT an allocation — it's a hint to the query planner about how much memory
# the OS page cache probably holds. Higher value = planner favours index scans
# over sequential scans. Set to 50-75% of RAM.

work_mem = 32MB
# Memory each operation (sort, hash, materialise) can use before spilling to
# disk. A complex query can use several multiples of this — set too high and
# a handful of concurrent queries OOM the server.

maintenance_work_mem = 512MB
# Same idea but for VACUUM, CREATE INDEX, ALTER TABLE. These are rare,
# typically single-threaded, and benefit from more memory; safe to be generous.

max_connections = 100
# Hard upper bound on concurrent backend processes. Each backend uses ~10 MB
# baseline. Prefer application-side connection pooling over raising this.

wal_compression = on
# Compress write-ahead log records. Reduces disk writes and WAL-archive size
# for a small CPU cost. Cheap win.

checkpoint_timeout = 15min
# Maximum interval between checkpoints. Longer intervals reduce write
# amplification (fewer full-page writes) but increase recovery time on crash.

random_page_cost = 1.1
# Planner's estimate of the cost of a random I/O relative to a sequential one.
# 4.0 (the default) assumes spinning rust; 1.1 is right for SSD. Getting this
# wrong biases the planner toward or away from index scans in borderline cases.
```

```bash
# [auishqosrgbdbs01]
$ sudo systemctl restart postgresql
#   shared_buffers and max_connections require restart (not just reload).
#   Do this in a maintenance window once production traffic exists.
```

> **ℹ Connection pooling**
>
> max_connections = 100 is plenty when combined with a connection pool at the application layer. Prisma, pg-pool, and Drizzle all pool by default. If you approach the limit, fix it at the app (lower pool_max) or introduce PgBouncer in front of Postgres — do not crank max_connections, because each Postgres backend consumes memory.

> **ℹ Time-zone handling**
>
> PostgreSQL stores "timestamp with time zone" values as UTC internally regardless of the server’s timezone setting. The session TimeZone affects only how values are displayed and parsed at the connection boundary. Best practice: always declare columns as "timestamptz" (not "timestamp") and store/process as UTC in application code. The DB VM’s system time zone (set in §3.3) affects Postgres logs and pg_dump timestamps but not your application data.
