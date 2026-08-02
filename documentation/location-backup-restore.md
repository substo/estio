# Backend Location Backup and Restore

This tool copies durable business data from one Estio `Location` to another. It is separate from a full Supabase disaster-recovery backup and has no frontend.

## Where the backup downloads

By default, the archive is written on the backend machine under:

```text
backups/locations/<source-id>-<timestamp>.location-backup.json.gz
```

Use `--output /absolute/path/file.location-backup.json.gz` to download it elsewhere. If the command runs on a remote server, retrieve that file with your normal SSH/SFTP/SCP tooling.

The command prefers `DIRECT_URL` and falls back to `DATABASE_URL`. An explicit `--db-url` overrides both. Do not put database URLs in shell history when avoidable.

## Export

```bash
npm run location:backup -- export --location SOURCE_LOCATION_ID
```

Choose an output path:

```bash
npm run location:backup -- export \
  --location SOURCE_LOCATION_ID \
  --output /var/backups/estio/source-location.location-backup.json.gz
```

Inspect the manifest and counts without connecting to the database:

```bash
npm run location:backup -- inspect \
  --input /var/backups/estio/source-location.location-backup.json.gz
```

## Restore to a different Location

Always run the dry-run first:

```bash
npm run location:backup -- import \
  --location TARGET_LOCATION_ID \
  --input /var/backups/estio/source-location.location-backup.json.gz \
  --dry-run
```

The real restore requires the target ID twice to prevent accidental replacement:

```bash
npm run location:backup -- import \
  --location TARGET_LOCATION_ID \
  --input /var/backups/estio/source-location.location-backup.json.gz \
  --confirm-target TARGET_LOCATION_ID
```

The included target business rows are deleted and recreated in one database transaction. A failure rolls back the entire restore.

## Data policy

Included data covers properties, contacts, companies, projects, content, conversations/messages, deals, viewings, property matching records and their durable children.

The destination keeps its own Location row, users, roles, site configuration, domains, credentials and provider connections. Queues, scheduled work, sync state, analytics, audit records, AI runtime data and external integration identifiers are not restored. URLs stored on business records are preserved, but this database archive does not download the referenced Supabase Storage, Cloudflare Images, R2 or other binary objects.

The importer generates new record IDs, remaps foreign keys and strips nullable globally unique external IDs. It currently targets another Location in the same database, which allows shared User references to remain valid.
