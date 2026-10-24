# Apply a reviewed knowledge manifest

This applies one pinned knowledge export to an existing standalone Substo
workspace whose matching library snapshot has already been imported. It stores
topics, sources, insights, evidence, reviews, and source-unit metadata. It does
not upload or move frame/audio/OCR media.

Apply `20261022040000_studio_knowledge_import.sql` after the workspace,
library, library-import, and knowledge migrations. The migration adds a
service-role-only transaction RPC and a workspace/source-digest ledger. Browser
roles have no direct table or function access.

Create a read-only preview using [KNOWLEDGE.md](KNOWLEDGE.md), then review the
private manifest and pin its exact bytes:

```sh
shasum -a 256 /absolute/private/knowledge-manifest.json
```

Set `STUDIO_SUPABASE_URL` and `STUDIO_SUPABASE_SERVICE_ROLE_KEY` in the
execution environment. The CLI does not load dotenv files.

```sh
npx tsx scripts/studio-knowledge-apply.ts \
  --manifest /absolute/private/knowledge-manifest.json \
  --workspace 00000000-0000-0000-0000-000000000001 \
  --owner-user-id user_REPLACE_WITH_SUBSTO_CLERK_ID \
  --expected-sha256 REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS \
  --apply
```

Before making a request, the CLI verifies the exact manifest hash, canonical
knowledge source snapshot/digest, library source snapshot/digest, normalized
row projections, sidecar coverage/count/transcription readiness, and source
file evidence. It confirms that the target is a standalone Substo workspace,
the explicit Clerk user is an owner, and the matching library source digest
already has a successful import ledger entry. The RPC repeats owner/dependency
checks in the transaction and independently hashes the source snapshots and
checks row and unit fidelity before insertion.

Apply accepts a manifest up to 400 MiB and canonical source snapshots up to
100 MiB each, matching the preview limits. Larger inputs fail explicitly; no
source fields or rows are truncated. The limits bound local parsing and SQL
work; they do not prove the configured Supabase/PostgREST/proxy request-size
limit. Before applying a large real snapshot, verify that its complete request
body fits the target service's configured transport limit.

The import is all-or-nothing. A retry of the same exact manifest returns the
ledger result without overwriting hosted edits. Reusing the same source digest
with a changed manifest is rejected. The source digest covers canonical source
JSON; `--expected-sha256` covers the exact reviewed manifest bytes, including
inspection evidence. Both are required.

`bash scripts/test-studio-schema.sh` applies the migrations to disposable local
PostgreSQL and checks authorization, library dependency, fidelity, rollback,
and replay behavior. It does not connect to Supabase or read source data.
