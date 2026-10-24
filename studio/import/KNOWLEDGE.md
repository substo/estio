# Legacy knowledge export contract

`normalizeLegacyKnowledge` consumes a version 1 JSON export of the authoritative
SQLite tables: `topics`, `sources`, `insights`, `evidence`, and `reviews`. An
optional `recordIds` reconciliation option must list the IDs from the separately
exported Studio library; sources without that context are not apply-ready. An
optional `sourceUnits` array carries sidecar envelopes shaped as
`{ recordId, payload: { transcriptionId, units } }`, matching
`knowledge-source-units/<recordId>.json`. The manifest retains each complete
envelope once in `sourceUnitSidecars`; normalized unit rows have deterministic
derived UUIDs and source-array indexes, reference the sidecar ID, and retain
only the exact raw unit object. Sidecar entries use `source_id` for the matched
library source while retaining the raw envelope's `recordId`. Malformed
envelopes remain once in the diagnostic manifest and make it invalid. Duplicate
record/transcription envelopes are an error. It does not open SQLite or read
local files. `insight_search` is a
derived FTS index and is not part of the export contract.

The normalizer retains every supplied row as JSON and does not trim statement or
citation text, rewrite statuses, generate insight content, inspect media, or
convert local paths into URLs. Source `observed_at`, `transcription_id`, unit
coverage, evidence timestamps/ranges/frame references, review transitions, and
unknown source/unit provenance fields remain in their original payload. Frame,
audio, and OCR references remain pending private media reconciliation.

The result is a deterministic dry-run manifest with counts, a source digest,
and issues for malformed shapes, duplicate IDs, unsupported kinds/statuses,
invalid coverage, and dangling or mismatched references. Invalid manifests
retain malformed input rows for inspection but must not be applied. Older source exports that
lack `total_units` or `covered_units` require an explicit export adapter to
apply a documented schema-era default and emit a warning; the normalizer does
not guess or silently default those values. Units are provided only from the
sidecar export and are never inferred from evidence quotes.

The hosted migration stores each canonical row with its original JSON payload,
adds workspace-composite foreign keys, and enables RLS without browser grants
or client policies. Server-side authorization is authoritative. FTS should be
rebuilt from stored insight/evidence data after import.

## Reviewed metadata apply

Use [APPLY-KNOWLEDGE.md](APPLY-KNOWLEDGE.md) to apply a reviewed manifest to an
existing standalone Substo workspace. The CLI requires a pinned exact manifest
SHA-256, validates the canonical knowledge snapshot and digest, rebuilds all
normalizer projections, rechecks source-unit readiness, and requires a
matching successfully imported library snapshot. The service RPC rechecks the
owner and library dependency inside one transaction, verifies canonical source
hashes and row/sidecar/unit fidelity, and writes an import ledger. Same-snapshot
retries are no-ops and preserve later hosted edits. This operation stores
metadata only; frame/audio/OCR bytes and private Storage reconciliation remain
pending.


## Read-only preview CLI

Use Node 24 or newer with the repository dependencies installed:

```sh
node --import tsx scripts/studio-knowledge-preview.ts --data-dir /absolute/path/to/quiescent-data --output /absolute/private/knowledge-manifest.json
```

Both paths must be absolute; the output parent must exist and resolve outside
of the source directory. Output is created exclusively with mode `0600`; an
existing file is never overwritten. The artifact contains private source text.
The command prints counts and readiness only. Exit codes are 0 for a valid
preview, 2 for a saved diagnostic manifest, and 1 for a read/argument failure.
This command performs no remote operations or database import.

The CLI reads `knowledge.sqlite`, `store.json`, and optional
`knowledge-source-units/<record UUID>.json` files. It opens SQLite using the
Node built-in read-only connection with `query_only`, a read transaction, and
fixed queries. It never loads the local application or its migration module.
The current five-table schema, including `total_units` and `covered_units`, is
required. Unknown tables/views and older coverage schemas are rejected. The
known `insight_search` FTS5 table and its five shadow tables are ignored.
Unknown scalar columns on authoritative tables remain in the exported rows.

Only DELETE journal databases are supported. WAL headers and any existing
`-wal`, `-shm`, or `-journal` companion are rejected before opening SQLite.
Source files and the sidecar directory must be regular, symlink-free paths.
Limits are 256 MiB for SQLite, 100 MiB for store JSON, 20 MiB per sidecar,
100 MiB total sidecars, 10,000 sidecars, 100,000 rows per table, 250,000
rows combined across authoritative tables and sidecar units, and 400 MiB for
the serialized preview manifest. Oversized input is rejected.

Run against quiescent source data or a separately prepared consistent copy.
The transaction provides a SQLite snapshot; pre/post file identities, hashes,
and directory listings detect observed source changes and cause failure.
These checks cannot make SQLite, JSON, and sidecars one atomic filesystem
snapshot while another process is writing. Missing sidecars for sources with
units, mismatched unit counts/transcription IDs, and invalid library
relationships produce an invalid diagnostic manifest.

The manifest includes the exact export as canonical `sourceCanonicalJson`,
whose SHA-256 is `sourceDigest`, plus the separately canonicalized store JSON
under `librarySource`. SQLite row text and complete sidecar envelopes are
preserved. `sourceFiles` records byte counts and hashes;
`snapshotCheckedUnchanged` records the consistency checks performed.
`mediaReconciled` remains false: frame/audio/OCR files are not opened or uploaded.
