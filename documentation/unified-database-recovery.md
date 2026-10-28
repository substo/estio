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
