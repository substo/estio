# Unified database recovery

After the October 28 merge, a database recovery point must contain both `public`
(CRM, Location/team authority and Prisma migration ledger) and `studio` (content,
knowledge, media references, jobs, credentials, devices and platform connections).

`location:backup` is a selected CRM business-data transfer, not a Studio backup.
`scripts/backup.sh` commits code only. Neither is a disaster-recovery snapshot.
The old Studio REST recovery tools target the frozen source, not the unified database.

Use a private PostgreSQL service configuration for the **CRM target**, with a
read-capable operator connection and matching PostgreSQL client tools. Keep output
outside Git on encrypted private storage. Example (new directory required):

```bash
bash scripts/backup-unified-database.sh studio_merge_target /absolute/private/new-recovery-point
```

This reads the database, dumps every schema in one snapshot, checks both schema
entries, decodes the entire archive and writes SHA256SUMS. Failed directories stay
for diagnosis and must not be treated as verified. No restore, freeze or data
mutation occurs. A successful decode is not proof of restoration: before relying
on a new recovery point, restore into an isolated disposable database, check
migration history, both schemas, counts/FKs, Location/realm authority and readiness.
Never run a restore against production as a verification step.

The database archive does not include R2 bytes, Clerk configuration, server env
secrets (especially STUDIO_SECRETS_KEY and rotation keys), or application artifacts.
Preserve these separately; preserve legacy media prefixes. Keep the October 28
frozen dumps, checksums, copy receipt and mapping evidence. After live writes,
rollback requires preserving/reconciling those writes as described in
`studio-merge-cutover.md`; the old frozen source is not a current backup.

No recurring database backup scheduler is installed by this command. Agree retention
and cadence before adding one to the existing operations workflow; avoid repeated
large dumps against the free-plan egress budget.

## Disposable application restore drill

Use PostgreSQL 17 binaries and a fresh private unified archive directory:

```bash
PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH bash scripts/drill-unified-restore.sh /absolute/private/recovery-point
```

The command verifies checksums, initializes a new Unix-socket-only local cluster,
restores `public` and `studio` with local ownership, checks application constraints,
the merge migration, same-realm authority and schema readiness, and writes table
counts/digests plus key-ID/media metadata. It always stops the cluster on exit.
It accepts no database target URL and runs no application, cron or worker.
The retained local cluster and logs contain sensitive data; keep them private.
Worker heartbeats returned by readiness are archived rows, not live clone workers.
Supabase infrastructure schemas and global role ownership are outside this local
application drill; full provider disaster recovery also requires provider setup.

October 28 evidence: fresh postmerge unified archive under
`/Users/martingreen/Backups/estio-2026-10-28/unified-restore-drill-direct2-20261028/`.
Two successful restores produced identical inventories for **184 tables**. Restored
**83** completed migrations, readiness schema **29**, **0** unvalidated application
FKs, **5** canonical authority rows, **471** media objects with legacy prefixes and
**471** knowledge media links. Key IDs were empty in this snapshot. Private
`restore-evidence/` retains inventory/digests and invariant output. The initial
schema-filtered restore exposed that `studio` must be explicitly created locally;
the script now does so. This is application-schema recovery evidence, not an R2
byte restore or a production restore. Frozen premerge recovery points are retained.
