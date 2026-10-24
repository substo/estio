# Apply an approved library manifest

This command applies the first library snapshot to an existing standalone Substo workspace. It imports `reference`, `channel`, and `content` records together, their same-workspace links, and attachment metadata. It does not import SQLite knowledge, transcription sidecars, schedules, editor projects, or media bytes. A successful result is metadata import preparation; media reconciliation and the other adapters must finish before cutover.

Apply `20261022020000_studio_library_import.sql` after the workspace and library migrations in the dedicated Studio Supabase project. The migration adds a service-role-only atomic import RPC and an import run ledger with source digest, JSONB consistency signature, record/link/file counts, actor, timestamp, and pending-media count. Clients have no direct access.

Create and review the dry-run manifest using [README.md](README.md). It must report `valid: true` and `mediaReady: true`. Keep this private file outside the source data directory. Review its source and target workspace; obtain its SHA-256 over the exact manifest bytes, for example:

```sh
shasum -a 256 /absolute/private/studio-library-manifest.json
```

The source snapshot digest inside the manifest describes canonical source JSON. The `--expected-sha256` argument pins the exact reviewed manifest file, including its inspection evidence. These are separate values.

Provide `STUDIO_SUPABASE_URL` and `STUDIO_SUPABASE_SERVICE_ROLE_KEY` through the execution environment, then run:

```sh
npx tsx scripts/studio-import-apply.ts \
  --manifest /absolute/private/studio-library-manifest.json \
  --workspace 00000000-0000-0000-0000-000000000001 \
  --owner-user-id user_REPLACE_WITH_SUBSTO_CLERK_ID \
  --expected-sha256 REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS \
  --apply
```

The CLI does not load dotenv files. It validates the pinned file hash, rebuilds normalized records/files/relationships/counts from the preserved payloads, and checks media inspection evidence before network access. It then checks that the target is a standalone Substo workspace and that the exact Clerk user ID is an owner. The RPC rechecks ownership within the import transaction. This first operator import does not accept an Estio target or identify an owner by email.

The database inserts a complete snapshot or rolls back all of it. An existing record or file ID in that workspace is a conflict; no hosted row is overwritten. An identical manifest retry returns the original run and counts without reapplying source values, preserving subsequent hosted edits. Reusing a source digest with different manifest JSON is a conflict. A different source snapshot that overlaps existing IDs is also a conflict requiring review. Do not delete rows or choose new IDs merely to bypass a conflict.

Successful stdout contains only run/workspace/source IDs, reconciled counts, `replayed`, and `mediaPending`. The counts describe this imported snapshot, not the workspace's total content. Failures produce a stable error code and, for database failures, safe HTTP/SQL codes without source payloads or credentials. An uncertain network result can be retried with the same file/hash/target/owner; the ledger makes that retry idempotent.

Each imported record retains both its active `payload` and untouched `legacy_payload`. Attachment rows have `media_object_id = null` and remain pending. Original local paths do not become public links or storage objects. This CLI performs no file copies, uploads, deletes, or automatic production invocation.

`bash scripts/test-studio-schema.sh` exercises the migration against disposable local PostgreSQL, including whole-snapshot rollback, identical replay after hosted edits, wrong-owner/brand rejection, count reconciliation, and workspace isolation. It does not connect to Supabase or read source data.
