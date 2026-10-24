# Legacy library import preview

This is the first vertical slice of the Substo content importer. It reads the existing local `store.json` version 1 and inspects attachment metadata. It does not read SQLite knowledge, transcription sidecars, schedules, editor projects, or media bytes. Those sources require later adapters and relationship reconciliation before cutover.

The command only produces a dry-run manifest. It has no database credentials, remote calls, uploads, or apply mode:

```sh
npx tsx scripts/studio-import.ts --data-dir /absolute/path/to/Substo/data --output /absolute/private/location/studio-library-manifest.json
```

The output parent directory must already exist and be outside the source data directory. Existing output files are not overwritten. The manifest contains original source content, including transcripts and notes, and is created with file mode `0600`. The CLI prints only counts, issue counts, readiness, and the output path. Exit code `0` means the supported metadata and media inspection passed, `2` means a manifest was produced with unresolved links/media, and `1` means input validation or file access failed.

The `studio.legacy-library.v1` manifest contains:

- `records`: all `reference`, `channel`, and `content` records so links across those kinds remain resolvable. Each includes canonical UUID `id`, `kind`, original `title`, `linkedIds`, attachment IDs, and an untouched JSON `payload`. `sourceUrl` is a separate HTTP(S)-only projection for safe link rendering; original URL values remain in `payload`.
- `files`: canonical UUID `id`, owning `recordId`, source-relative `files/<original UUID>` path, and untouched attachment metadata in `payload`. The path is a source reference, not a hosted URL or storage object.
- `sourceCanonicalJson`: canonical JSON text of the complete source export, including unknown top-level metadata and original record/file order. This preserves the original snapshot without duplicating it as a second parsed object.
- `sourceDigest`: SHA-256 over the UTF-8 bytes of `sourceCanonicalJson`. Apply validation reparses and re-canonicalizes the source, verifies this digest, then compares every normalized record/file projection to the source rows. This is a metadata snapshot digest; media byte hashes are not claimed.
- `counts`, sorted `issues`, and `media`: reconciliation evidence. Missing files and size mismatches are reported; symlinks and unsafe paths are rejected or marked unsafe. `valid` covers supported metadata validation; `mediaReady` additionally requires every source attachment to exist as a regular file at the expected size.

Duplicate or invalid IDs, repeated normalized linked IDs (including case variants), malformed records or known text fields, invalid review flags, and orphan attachments reject the whole batch. Missing linked records block `valid`. Unknown record/file fields and historical discovery labels remain in `payload`; importing a past `recommendation` observation does not create a hosted personalized recommendation source. Unknown top-level store fields remain in `sourceCanonicalJson` and contribute to `sourceDigest`, but are not copied into hosted library records; they require a later adapter before full cutover. No transcript cleaning, review approval, URL rewriting in the source payload, or content deletion occurs.

Future application must choose an already authorized workspace, use `(workspace_id, id)` keys, insert links through same-workspace foreign keys, reconcile database counts and attachment checksums, and report existing-record conflicts before changing hosted content. A successful preview is not a full-data import or cutover approval.

Schedule definitions and run history now have a separate [read-only preview contract](SCHEDULES.md). It does not apply data or enable execution.

Legacy attachment bytes now have a separate [read-only checksum preview](MEDIA.md). It retains file/record mappings and original metadata while keeping hosted media reconciliation pending.
