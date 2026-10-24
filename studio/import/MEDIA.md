# Legacy library media checksum preview

The read-only media preview establishes the original attachment byte hashes
that a later reviewed upload/reconciliation operation must pin. It is not an
upload command and never marks a hosted attachment ready.

```sh
npx tsx scripts/studio-media-preview.ts --data-dir /absolute/path/to/quiescent-data --output /absolute/private/media-manifest.json
```

Use a quiescent source directory or a prepared consistent copy. Both paths
must be absolute, the output parent must already exist, and output must resolve
outside the source directory. The CLI creates the artifact exclusively with
mode `0600`; it refuses overwrites, output aliases into the source, and extra
flags such as `--apply`. It loads no credentials and performs no network,
storage, database, local application startup, or AI operations.

## Scope and fidelity

The source is local `store.json` v1 and the `files/<original file UUID>` bytes
referenced by its attachment rows. The library normalizer validates every
record/file relationship. The complete canonical library snapshot, including
unknown metadata, original array order, exact transcripts/scripts, and original
attachment fields, is retained under `librarySource`. Paths are not rewritten
or turned into hosted URLs. Unreferenced files, knowledge frame/audio/OCR
assets, transcription sidecars, and editor projects are outside this adapter.

Every attachment receives a manifest row with canonical file/record IDs, the
original relative path/name/type, expected size, observed size when safe, and
either a streamed SHA-256 or an explicit diagnostic status. Missing, unsafe,
size-mismatched, or oversized attachments remain visible and make `valid`
false. No rows are silently dropped. A dangling library link also blocks
validity even when all attachment bytes were successfully hashed.

The manifest `studio.legacy-media.v1` includes:

- `librarySource.sourceDigest`: the canonical library metadata snapshot ID,
  required later to match a successful import in the target workspace.
- `sourceFiles`: original `store.json` byte count and SHA-256, separate from its
  canonical metadata digest.
- `files`: exact file-to-record projections, diagnostic state, and hashes of
  actual attachment bytes, without copying media into the manifest.
- `sourceDigest`: SHA-256 of canonical JSON containing `librarySourceDigest`
  and the complete `files` array. A same-size byte change therefore changes
  this digest even when library metadata stays identical.
- Counts, sorted issues, `snapshotCheckedUnchanged: true`, and
  `sourceBytesVerified` indicating whether every referenced attachment hashed.
  `hostedReconciled: false` and `uploadSupported: false` remain false even for
  a valid local preview. These are not hosted media-readiness assertions.

The output contains private source text and filenames. Stdout reports only
counts, issue count, readiness flags, and output path; failures use safe codes.
Exit code `0` means a valid preview was saved, `2` means an invalid diagnostic
manifest was saved, and `1` means arguments, structural validation, source
consistency, resource limits, or output creation failed.

## Read safety and bounds

Media is hashed in 1 MiB chunks with no-follow file access. Reads are bounded
by captured file size plus one byte to detect growth. File descriptor/path
identities are checked around each read; all source identities and the store
snapshot are checked again at batch completion. Symlinked files or `files`
folders are rejected without reading their targets. Shared metadata snapshot
reads now also enforce their captured length rather than allowing concurrent
growth to expand a read indefinitely.

Limits are 100 MiB for store JSON, 10,000 attachments, 64 GiB per attachment,
512 GiB total declared attachment bytes, and 250 MiB serialized manifest. The
per-file limit creates a diagnostic row without reading oversized bytes; the
batch/count bounds fail before hashing. The preview does not buffer an entire
video. Hashing a large batch can take time and requires the source to remain
quiescent. Identity/hash checks detect observed changes, but do not provide an
exclusive filesystem snapshot while another process is writing.

## Private upload to Cloudflare R2 and reconciliation

Studio media bytes are stored in a dedicated **private Cloudflare R2 bucket**
(S3 API). The Studio Supabase database holds metadata only. Supabase Storage is
not used for Studio media. Cloudflare Images is not used for private Studio
media either, because its delivery URLs are not authorized per workspace. It
may later serve derived public assets such as published covers.

```sh
STUDIO_SUPABASE_URL=... STUDIO_SUPABASE_SERVICE_ROLE_KEY=... \
STUDIO_R2_ACCOUNT_ID=... STUDIO_R2_ACCESS_KEY_ID=... STUDIO_R2_SECRET_ACCESS_KEY=... STUDIO_R2_BUCKET_NAME=... \
  npx tsx scripts/studio-media-upload.ts --manifest /absolute/private/media-manifest.json \
  --expected-sha256 SHA256_OF_REVIEWED_MANIFEST --data-dir /absolute/path/to/quiescent-data \
  --workspace UUID --owner-user-id CLERK_ID --apply
```

`STUDIO_R2_ENDPOINT` (https) may replace the account-derived endpoint. The
`R2_*` / `CLOUDFLARE_R2_*` variables used by WhatsApp media are deliberately
not read. Use a separate bucket and an R2 API token scoped to that bucket only.
The CLI reads credentials only from the explicit environment, never dotenv
files. Before any network request it checks the pinned manifest bytes, requires
`valid` and `sourceBytesVerified`, and rebuilds the preview from source. The
rebuild must equal the reviewed manifest in canonical form, including every
attachment hash.

Then, per migration `20261023030000_studio_legacy_media_reconciliation.sql`:

1. Owner preflight, then `studio_reserve_legacy_media` locks the Substo
   standalone workspace and exact owner membership. It requires a successful
   library import with the manifest's `librarySource.sourceDigest`, and checks
   each row against the imported original attachment (record, name, size,
   type). It records a pending reservation for the R2 bucket and key
   `<workspace>/legacy-library/<file id>/<sha256>`. Verified rows are never
   rebound to different bytes or a different bucket.
2. For each pending row, the CLI reads any existing R2 object at that key. If
   none exists, it re-hashes the source file, then uploads create-only
   (`If-None-Match: *`). Files up to 64 MiB use a single PUT. Larger files use
   16 MiB multipart parts with per-part retries. A failed multipart upload is
   aborted; this never deletes a completed object. Existing objects are never
   overwritten.
3. It streams the R2 object back through SHA-256. Only an exact hash and size
   match calls `studio_bind_legacy_media`. The database cannot see R2, so this
   read-back is the byte evidence. The RPC re-locks owner authority, requires
   the reservation's hash and size, and requires the original attachment to be
   still unbound. In one transaction it creates the `studio_media_objects` row
   (`storage_provider = 'cloudflare_r2'`, bucket, key, hash, size), sets
   `studio_legacy_files.media_object_id`, and marks the reservation verified.
   Original attachment payloads are unchanged. A replayed bind is idempotent.

Service-role direct writes to `studio_legacy_files`, `studio_media_objects`,
and the reservation table are revoked. Failures leave the attachment pending.
The run continues and reports `{fileId, code}` per pending file. Exit `2`
means some files remain pending; rerunning is safe. Output contains no
filenames, record text, or credentials.

Known limits: an interrupted multipart upload restarts that file from the
beginning on the next run. Configure an R2 lifecycle rule to abort incomplete
multipart uploads. An object at the key that fails verification stays pending
for operator review and is never deleted automatically. R2 conditional writes
on multipart completion and the account's bucket limits have not been verified
against live R2. Only synthetic fakes have exercised this path.

## Authorized hosted download and display

`/studio/workspace/<workspaceId>/media/<fileId>` resolves Studio workspace
access on the server (Estio location role or Substo membership), loads the
attachment and its verified media object within that workspace, and checks the
provider, key prefix and configured bucket. It then answers with a `302` to a
presigned R2 GET that expires in 5 minutes. Responses are `private, no-store`
and `no-referrer`. Unbound, foreign, or unknown files return `404`. A missing
or mismatched R2 configuration returns `503`. The client never supplies a
bucket or key.

`?inline=1` renders inline only for passive image/video/audio types. SVG, HTML,
PDF and everything else download as `application/octet-stream` attachments
with an RFC 5987 filename. Library and content detail pages show Download plus
an inline video/audio/image player for bound media. Unbound attachments read
"Awaiting media upload and verification".

## Knowledge frame media

Knowledge media means frame images only. Evidence rows name a frame the local
app copied into `knowledge-media/<frame_file>`. Source units name a frame in
`frames/<transcription id>/<frameFile>`. OCR is text already inside the
imported unit and sidecar payloads, and extracted audio is a temporary work
file no imported row references, so neither has bytes to upload.

```sh
npx tsx scripts/studio-knowledge-media-preview.ts --data-dir /absolute/quiescent-data --output /absolute/private/knowledge-media-manifest.json
npx tsx scripts/studio-knowledge-media-upload.ts --manifest /absolute/private/knowledge-media-manifest.json \
  --expected-sha256 SHA256_OF_REVIEWED_MANIFEST --data-dir /absolute/quiescent-data \
  --workspace UUID --owner-user-id CLERK_ID --apply
```

The preview (`studio.legacy-knowledge-media.v1`) runs the existing read-only
knowledge preview, then hashes each referenced frame once. Frame names must be
plain `.jpg/.jpeg/.png/.webp` names, and transcription IDs must be simple path
segments. Anything else, such as a traversal, symlink, unsupported type or file
over 50 MiB, is unsafe and makes `valid` false. A frame already missing locally
is a warning: it stays visible, cannot be recovered, and does not block the rest.

The upload pins the manifest bytes, requires the rebuild to match, and reserves
only hashed frames via `studio_reserve_knowledge_media`. That RPC requires the
matching knowledge import run and the imported evidence/unit row still naming
that frame. It then uses the shared transfer path (`lib/studio/import/media-transfer.ts`):
create-only R2 upload, read-back hash, and `studio_bind_knowledge_media`, which
atomically creates the media object and marks the link verified. Keys are
`<workspace>/legacy-knowledge/<evidence|unit>/<row id>/<sha256>`. Imported
payloads are unchanged.

Hosted display: `/studio/workspace/<id>/knowledge-media/<evidence|unit>/<row id>`
authorizes the workspace and requires a verified link, then redirects to a
5-minute presigned R2 URL. The insight page shows the image for verified frames
and "awaiting media upload and verification" otherwise.

## Still separate

New hosted uploads/transcription intake, real-data import review,
and complete cutover readiness remain separate work.
