# 03 — Database VM backups

> **Phase**: bring-up · **Run on**: DB VM (`auishqosrgbdbs01`) · **Time**: ~30 min
>
> Two backup layers: nightly `pg_dump` for easy per-object restores, and pgBackRest for continuous WAL-archived point-in-time recovery. Plus the offsite-replication strategy (S3 / NFS / rsync) — without which neither layer protects you against losing the VM itself.
>
> **Prev**: [02 — Database VM setup](02-db-vm-setup.md) · **Next**: [04 — App VM Docker setup](04-app-vm-docker.md) · **Index**: [README](README.md)

---

### 4.10 Backup strategy

Two layers: a nightly logical dump (easy to move around, good for per-object restores), and a continuous physical + WAL backup via pgBackRest (allows point-in-time recovery to any moment, which pg_dump alone cannot do).

#### 4.10.1 Nightly pg_dump (logical backup)

```
# [auishqosrgbdbs01]
sudo mkdir -p /var/backups/postgres
#   -p      idempotent — no error if the directory already exists.

sudo chown postgres:postgres /var/backups/postgres
#   Ownership to the postgres user — the cron job runs as postgres and
#   needs to write here.

sudo chmod 700 /var/backups/postgres
#   700     rwx for owner only. Dumps contain every row of your database;
#           they are as sensitive as the live DB.
```

Give the postgres user a crontab entry that runs the dump every night:

```
# [auishqosrgbdbs01]
sudo -u postgres crontab -e
#   sudo -u postgres    run the command as the postgres user.
#   crontab -e          open that user's crontab in $EDITOR (usually nano).
# You'll end up in an editor. Add this line (ONE line, no leading whitespace):
```

```
0 2 * * * pg_dump -Fc -d greenbook -f /var/backups/postgres/greenbook-$(date +\%F).dump && find /var/backups/postgres -name "greenbook-*.dump" -mtime +14 -delete
#   0 2 * * *         cron schedule: minute hour day-of-month month day-of-week.
#                     0 2 * * * = "at 02:00 every day".
#
#   pg_dump -Fc -d greenbook -f FILE
#     pg_dump         PostgreSQL's logical backup tool. Queries the DB and
#                     emits the schema + data as SQL or a compressed archive.
#     -Fc             format: custom. Compressed binary; can be restored
#                     selectively (single table, single schema) by pg_restore.
#                     Much more flexible than plain SQL (-Fp).
#     -d greenbook    source database.
#     -f FILE         write output to FILE.
#
#   $(date +\%F)       expands at cron-run time to today's date in YYYY-MM-DD.
#                     %F is a shortcut for %Y-%m-%d. The backslash is REQUIRED
#                     in crontab — see warning below.
#
#   && find ... -mtime +14 -delete
#     && CMD          run CMD only if the previous command succeeded.
#                     Prevents deletion if the backup failed.
#     find DIR        recurse from DIR.
#     -name PATTERN   match filenames.
#     -mtime +14      modification time more than 14 days ago.
#     -delete         delete matching files. Retains the last 14 dumps.
```

> **⚠ Escape the % in crontab**
>
> In crontab entries, the % character has a special meaning (it is converted to newlines in the command). It MUST be escaped as \% to pass literally through to the date command. Forgetting this is the single most common reason pg_dump cron jobs silently fail with an empty filename. Test the command manually first by running exactly what you pasted (with the escape), then let cron run it.

Test the job immediately instead of waiting until 02:00 tomorrow:

```
# [auishqosrgbdbs01]
sudo -u postgres bash -c 'pg_dump -Fc -d greenbook -f /var/backups/postgres/greenbook-test.dump'
#   bash -c 'CMD'    run CMD in a fresh bash shell — needed because we use
#                     redirection and quoting that the outer sudo doesn't parse.
# Expected: no output. Runtime scales with DB size; empty DB is sub-second.

ls -la /var/backups/postgres/
# Expected: greenbook-test.dump owned by postgres:postgres, non-zero size.

sudo -u postgres rm /var/backups/postgres/greenbook-test.dump
# Clean up the test dump.
```

#### 4.10.2 pgBackRest (physical + WAL, PITR-capable)

pgBackRest is the standard tool for production PostgreSQL backup. It supports full, differential, and incremental backups; compresses and optionally encrypts backups; manages WAL archiving automatically; and handles PITR restore with a single command. Installing and configuring it now — before production data exists — is much easier than retrofitting later.

```
# [auishqosrgbdbs01]
sudo apt install -y pgbackrest
#   Package from the Ubuntu repo. PGDG also publishes a newer build; the
#   Ubuntu version is sufficient for this deployment.

sudo install -d -m 750 -o postgres -g postgres /var/lib/pgbackrest
sudo install -d -m 750 -o postgres -g postgres /var/log/pgbackrest
sudo install -d -m 770 -o postgres -g postgres /var/spool/pgbackrest
#   install -d DIR     create DIR.
#   -m MODE            set mode bits (750 = rwx for owner, rx for group).
#   -o USER / -g GROUP set owner and group.
#   /var/lib/pgbackrest    where backups and WAL archive live.
#   /var/log/pgbackrest    detailed logs (the global log is also in journald).
#   /var/spool/pgbackrest  used by async archive-push for performance.
```

Create the pgBackRest config at /etc/pgbackrest.conf:

```
# [auishqosrgbdbs01]
sudo tee /etc/pgbackrest.conf <<'EOF'
[global]
repo1-path=/var/lib/pgbackrest
#   repo1-path        where the repository (backups + WAL archive) is stored.

repo1-retention-full=2
#   Keep 2 full backups. Older fulls and the WAL/diffs that depended on them
#   are pruned automatically after the next backup run.

repo1-retention-diff=7
#   Keep 7 differential backups. With full weekly + diff daily, this yields
#   ~2 weeks of PITR range (2 full backups * 1 week each) bounded by the
#   oldest full. See the retention-math note below.

process-max=2
#   Parallelism for backup/restore/compress. 2 is safe on a 2-4 core VM;
#   raise to match cores on larger hosts.

compress-type=zst
compress-level=6
#   Zstandard compression at level 6. Good balance of CPU vs size. zst is
#   much faster than gzip at similar ratios. Range 1-19; higher = more CPU.

log-level-console=info
log-level-file=detail
#   How much to log to stdout/stderr ("console", captured by cron or journald)
#   vs to files in /var/log/pgbackrest (more verbose — useful when debugging).

start-fast=y
#   When taking a backup, ask Postgres to checkpoint immediately rather than
#   waiting for the scheduled checkpoint. Shortens backup window.

archive-async=y
spool-path=/var/spool/pgbackrest
#   Archive the WAL asynchronously via a spool directory. Much faster under
#   high write load — archive_command returns immediately and background
#   workers push to the repo.

[main]
pg1-path=/var/lib/postgresql/16/main
#   pg1-path         filesystem path to the Postgres data directory.
pg1-port=5432
pg1-user=postgres
#   pg1-user         Postgres role pgBackRest connects as. With no pg1-host,
#                     pgBackRest uses the local Unix socket, which maps to
#                     the postgres OS user via the default "local ... peer"
#                     pg_hba.conf rule — no password needed.
EOF

sudo chown postgres:postgres /etc/pgbackrest.conf
sudo chmod 640 /etc/pgbackrest.conf
# 640 = owner read/write, group read. The 'postgres' group can read so
# pgbackrest invocations (run as the postgres user) can read the config.
```

> **ℹ Retention math — what window of PITR does this buy you?**
>
> With full weekly and differential daily, retention-full=2 and retention-diff=7 give you this: the two most recent full backups are kept; after a full is pruned, its dependent diffs and WAL are pruned too. In practice, that is ~14 days of continuous PITR coverage at any given time (from the oldest still-retained full forward through all later WAL). If you need longer (compliance, change-review windows), bump retention-full. For 30 days, use retention-full=4 with a weekly full schedule; for 90 days, use retention-full=12. Disk usage grows roughly linearly with retention-full — plan the DB VM disk accordingly.

Enable WAL archiving in PostgreSQL. Append the following to /etc/postgresql/16/main/postgresql.conf:

```
# WAL archiving for pgBackRest — each line explained below.

wal_level = replica
# Level of detail in the WAL. 'replica' (the default) is sufficient for
# physical backup and standard replication. 'logical' adds info needed for
# logical replication — only set that if you also need logical replication.

archive_mode = on
# Turn on WAL archiving. Each completed WAL segment triggers archive_command.

archive_command = 'pgbackrest --stanza=main archive-push %p'
# External command Postgres calls for each completed WAL segment.
#   %p        expanded by Postgres to the full path of the segment to archive.
#   archive-push   pgBackRest subcommand; copies the segment to the repo.
# pgBackRest must exit 0 on success. Failures cause the segment to pile up in
# pg_wal until resolved — if WAL fills the disk, Postgres stops writing.

archive_timeout = 60
# Force a WAL switch every 60 seconds even if the current segment is not
# full. Bounds maximum data loss in PITR to ~60 seconds on an idle DB.

max_wal_senders = 3
# Maximum number of concurrent replication connections (including
# pgBackRest's when it copies WAL). 3 leaves room for a future replica.
```

Apply with a restart — archive_mode cannot be changed with reload:

```
# [auishqosrgbdbs01]
sudo systemctl restart postgresql
```

Create the stanza and take the first backup. A "stanza" is pgBackRest’s name for a configured Postgres cluster.

```
# [auishqosrgbdbs01]
sudo -u postgres pgbackrest --stanza=main stanza-create
#   pgbackrest --stanza=NAME SUBCOMMAND
#     --stanza=main       matches the [main] section in /etc/pgbackrest.conf
#     stanza-create        initialize the repository for this stanza.
# Expected: "completed successfully". Creates directory structure under repo1-path.

sudo -u postgres pgbackrest --stanza=main check
#   check               sanity-check: verify Postgres is reachable, the archive
#                        command works, and the repo is writable.
# Expected: "check command end: completed successfully".

sudo -u postgres pgbackrest --stanza=main --type=full backup
#   backup              take a backup.
#   --type=full         full backup (every block). Can also be --type=diff
#                        (changes since last full) or --type=incr (since last
#                        full OR diff OR incr).
# Runtime scales with DB size; a fresh DB takes seconds.

sudo -u postgres pgbackrest info
# Expected: stanza "main" listed, one full backup, current WAL range shown.
```

Schedule recurring backups. Full weekly, differential daily. WAL streams continuously via archive_command (nothing to schedule).

```
# [auishqosrgbdbs01]
sudo -u postgres crontab -e
# Add these two lines (the pg_dump line from §4.10.1 should already be there):

30 1 * * 0   pgbackrest --stanza=main --type=full backup
#   30 1 * * 0    = 01:30 every Sunday.
#   --type=full   full backup.

30 1 * * 1-6 pgbackrest --stanza=main --type=diff backup
#   30 1 * * 1-6  = 01:30 Monday through Saturday.
#   --type=diff   differential — much faster than full; blocks changed since
#                  the most recent full.
```

> **⚠ Test restore before you need it**
>
> An untested backup is not a backup. Before putting real data into the "greenbook" database, practice restoring:
>
> 1. Spin up a throwaway Postgres instance (a scratch VM or Docker container).
> 2. Copy the pgBackRest repo to it (or point it at the shared repo).
> 3. Run: pgbackrest --stanza=main --delta --type=time --target="2026-04-23 14:30:00" restore
> 4. Start Postgres and verify the data.
>
> Do this at least once per quarter and document the exact timings — those are your RTO.

#### 4.10.3 Offsite backup

The pgBackRest repository on the DB VM protects against PostgreSQL corruption or human error, but not against the VM itself being lost. A second repository on a different host or storage service is essential. pgBackRest supports multi-repository writes natively.

The simplest offsite option for AU infrastructure is an NFS mount from a separate fileserver, or an S3-compatible object store (MinIO, Ceph). Add a [global] block with a second repo:

```
# [auishqosrgbdbs01] — example: NFS-mounted offsite path at /mnt/backup-offsite
# (assumes the NFS mount is already configured in /etc/fstab)

# Edit /etc/pgbackrest.conf and ADD these lines to the [global] section:
repo2-path=/mnt/backup-offsite/pgbackrest
repo2-retention-full=4
#   repo2-*            pgBackRest supports multiple repositories by number.
#                      repo2 is independent of repo1 — own retention, own path.
#                      Keep more fulls offsite (4 here = ~4 weeks) since
#                      offsite storage is typically cheaper per GB.

# After editing, re-run stanza-create to initialise repo2:
sudo -u postgres pgbackrest --stanza=main stanza-create

# All subsequent backups are written to BOTH repositories automatically.
# Restores can be performed from either.
```

For an S3-compatible destination (AWS S3, MinIO, Ceph RGW), replace the repo2-path block with:

```
# Example S3/MinIO configuration
repo2-type=s3
repo2-path=/pgbackrest
repo2-s3-bucket=greenbook-pg-backups
repo2-s3-endpoint=s3.amazonaws.com
repo2-s3-region=us-east-1
repo2-s3-key=AKIA...
repo2-s3-key-secret=...
repo2-retention-full=4
repo2-cipher-type=aes-256-cbc
repo2-cipher-pass=<generated-with-openssl-rand-base64-48>
#   repo2-cipher-*   client-side encryption. Files are encrypted BEFORE
#                     upload; S3 never sees plaintext. Losing the cipher
#                     pass means the backups are unreadable, so back IT up
#                     (ideally to a password manager) separately.
```

> **ℹ Off-site, on-host, and on-VM are three different things**
>
> Backups on the DB VM itself (repo1) do not count as offsite. A second path on the same VM (e.g. a mounted external disk) is better than nothing but does not survive VM loss. The goal is a destination that would not be affected by: (a) a filesystem corruption event on the DB VM, (b) the DB VM being deleted, (c) ransomware on the DB VM. An NFS mount from another host, object storage, or a pull-based rsync from a backup host all qualify.

---
