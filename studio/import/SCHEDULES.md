# Legacy schedule preview

This read-only adapter inspects local Substo `schedules.json` version 1. It
preserves definitions and run history for review; it cannot apply a manifest,
activate schedules, resume jobs, or invoke local Codex/browser runners.

```sh
npx tsx scripts/studio-schedule-preview.ts --data-dir /absolute/path/to/quiescent-data --output /absolute/private/schedule-manifest.json
```

The input directory and output path must be absolute. The output parent must
already exist and resolve outside the source directory. Output is created
exclusively with mode `0600`; existing files and symlinks are never overwritten.
Only `schedules.json` is opened. Missing source files are errors, rather than
an inferred empty export. No credentials, local application startup, network,
SQLite, library records, or media are required.

The `studio.legacy-schedules.v1` manifest contains:

- A canonical full source snapshot and SHA-256 digest, including unknown
  top-level fields and original array order. Each schedule/run also retains
  its complete untouched JSON payload and source array index. Exact focus,
  output/error text, timestamps, workflow data, channel configuration, job
  references, legacy enabled/next-run state, and unknown row fields survive.
- Canonical ID projections and run-to-schedule references, plus hosted draft
  projections for the three supported editorial workflows: YouTube discovery,
  idea review, and script brief. Invalid rows remain in the diagnostic artifact;
  they are never silently omitted. Missing daily time/time zone is reported,
  rather than filled with a guessed legacy default.
- Counts, sorted issues, and original file byte/hash evidence. The reader uses
  no-follow file access and checks file identity/hash before returning. Read
  against a quiescent source or prepared consistent copy; these checks detect
  observed changes and cannot lock another local process out of the JSON file.
- `executionEnabled: false` and `applySupported: false`, even when `valid` is
  true. `valid` covers the supported metadata checks, not production readiness
  or permission to execute historical workflows.

The supported source has daily (`24`) or seven-day (`168`) cadence and
`Asia/Nicosia` time zone. Daily cadence retains a wall time; weekly cadence
retains the local scheduler's elapsed interval after a run. Original
`nextRunAt`, `lastRunAt`, and legacy enabled state remain payload metadata;
this preview never recalculates them. Run workflow may differ from the current
definition because a schedule may have been edited after that run.

IDs, duplicate IDs, dangling run links, known field types, time ordering,
unsupported workflows/cadence/statuses, malformed channel targets, and missing
terminal completion timestamps produce errors. Unknown JSON is retained; unsafe
integer values and nesting beyond 100 levels are rejected rather than claiming
lossless normalization. Limits are 20 MiB source bytes, 10,000 definitions,
50,000 historical runs, and 100 MiB serialized manifest.

Legacy enabled schedules, automatic knowledge scans, browser-based discovery,
and queued/running history emit review warnings without changing the source.
Historical running/queued rows remain historical evidence; they do not become
hosted jobs. Channel configuration is retained, without treating it as OAuth
consent or rewriting personalized browser recommendations as public discovery.
Hosted discovery requires the separately approved OAuth/public-source design.

Exit code `0` means a valid metadata preview was saved (review warnings may
remain), `2` means an invalid diagnostic manifest was saved, and `1` means
arguments, reading, source structure, or writing failed. Stdout reports only
counts, readiness flags, issue count, and output path; private content is in
the artifact. CLI failures use safe error codes.

## Reviewed inactive apply

`scripts/studio-schedule-apply.ts` applies a reviewed preview to an existing
standalone Substo workspace. This is an operator command, separate from the
read-only preview. The v1 preview keeps `applySupported: false` to describe its
own no-apply mode; the dedicated apply command accepts that unchanged contract
only with an explicit `--apply` and a pinned file hash.

Apply `20261023010000_studio_schedule_import.sql` after all earlier Studio
migrations in the dedicated Supabase project. Provide `STUDIO_SUPABASE_URL` and
`STUDIO_SUPABASE_SERVICE_ROLE_KEY` through the execution environment. The command
does not load dotenv files.

```sh
shasum -a 256 /absolute/private/schedule-manifest.json
npx tsx scripts/studio-schedule-apply.ts \
  --manifest /absolute/private/schedule-manifest.json \
  --workspace 00000000-0000-0000-0000-000000000001 \
  --owner-user-id user_REPLACE_WITH_SUBSTO_CLERK_ID \
  --expected-sha256 REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS \
  --apply
```

Review the private manifest, its counts/issues, and exact target first. The
SHA-256 argument pins the exact reviewed artifact bytes, including inspection
evidence. It differs from `sourceDigest`, which identifies canonical source
JSON. Apply requires a regular symlink-free manifest path, at most 100 MiB;
canonical source JSON is bounded to 20 MiB. It rechecks the hash, canonical source
and digest, normalizes every projection/count/issue again, and validates file
inspection evidence before network access. NUL characters or unpaired Unicode
surrogates cannot be represented in PostgreSQL JSONB and cause explicit
rejection; source text is never cleaned to make an import succeed.

The command verifies the explicit workspace and Clerk owner ID; email is not
used. The service-only RPC repeats the standalone-brand/owner check, holds the
workspace and membership locks through the transaction, hashes the source,
verifies source-row/draft/history projection equality and core semantic fields,
and reconciles counts. CLI validation additionally covers the complete preview
contract, including discovery configuration and warning projections. No library
import dependency is needed: this adapter imports only schedule definitions and
history, retaining external job/workflow IDs as provenance rather than resolving
them to hosted jobs.

The transaction inserts editable inactive drafts plus immutable legacy
definition and run payloads with workspace-composite foreign keys and original
array indexes. Original timestamps survive both in the payloads and the initial
draft rows. The ledger retains the complete canonical source (including unknown
top-level metadata), source-file hash/byte evidence, warning list, import actor,
counts, and a SHA-256 logical-manifest signature. Tables have RLS, no browser
access, and service-role SELECT only; import RPCs own the writes. Normal draft
edits cannot change legacy provenance or history.

Conflicting IDs, invalid projections, or any later failure roll back drafts,
history, and ledger together. The same reviewed manifest can be retried after an
uncertain network response: the ledger returns its original import result
without overwriting later hosted edits. Changed manifest values with the same
source digest are rejected; a new snapshot overlapping existing IDs is also a
conflict requiring review. Neither path deletes or remaps existing records.

Successful stdout is restricted to import/workspace/source IDs, reconciled
counts, replay state, and `executionEnabled: false`; it contains no private
source text or arbitrary server fields. A transport or reconciliation error exits
1 and must not be treated as success. Before a large real snapshot, verify the
complete request fits the target PostgREST/proxy transport limit; local bounds
are not proof of the production transport configuration.

Hosted history browsing now links each draft to its immutable imported definition,
paginated run summaries in original source order, exact run output/error text,
and import provenance. A separately authorized JSON download includes the full
canonical source and all preview flags for the selected workspace import. List
pages do not fetch full output or snapshots; those load on explicit detail or
download requests. Downloads use attachment headers and private/no-store caching.

Discovery authorization, customer credentials, worker execution, and real-data
cutover remain separate milestones. Even legacy
`enabled: true` or `running` history does not activate anything after apply.
