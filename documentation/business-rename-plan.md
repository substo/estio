# Location naming and Studio re-key plan

Status: revised 2026-10-27 for the user's decision. Source of truth: [How the app works → Names](how-the-app-works.md#names-one-backend-name-per-thing).

The tenant keeps the backend name **Location**. Prisma `Location` / `locationId` stay as they are, so the old Prisma rename stages (S3 and S4, "Business") are **cancelled**. Screens keep their words through the vocabulary layer (Estio "Location", Substo "Brand"), and URL paths may stay.

What changes:
- names that use "brand" to mean a Location become location names;
- Studio has no workspace: its rows are keyed by the CRM `location_id`;
- Studio's `brand` column (meaning the app) becomes `app`.

## Stage A: CRM backend brand → location names (no behaviour change)

| Old | New |
| --- | --- |
| Prisma `BrandInvitation`, enum `BrandInvitationStatus`, relations `BrandInvitation*` | `LocationInvitation`, `LocationInvitationStatus`, `LocationInvitation*` (one migration: `ALTER TABLE/TYPE … RENAME`, index and constraint renames) |
| `lib/brands/*` (`brand-service`, `brand-policy`, `substo-brands`) | `lib/locations/*` (`location-service`, `location-policy`, `substo-locations`, next to the existing `market-context`) |
| `BrandRole`, `BrandActor`, `BrandDeps`, `BrandMembership`, `inviteToBrand`, `renameBrand`, `listUserBrands`, `getBrandRole`, `createAutoBrandIfNeeded`, `getSubstoBrandActor`, … | `LocationRole`, `LocationActor`, `LocationDeps`, `LocationMembership`, `inviteToLocation`, `renameLocation`, `listUserLocations`, `getLocationRole`, `createAutoLocationIfNeeded`, `getSubstoLocationActor`, … |
| Clerk invitation `publicMetadata` `{ source: "brand_invite", brandInvitationId }` | `{ source: "location_invite", locationInvitationId }` (write-only; nothing reads it) |

Accept: `prisma migrate diff` from migrations to the schema is empty; the typecheck, focused tests, `scripts/test-user-auth-realm-db.sh` and the build pass; Team and invite pages work on both hosts.

## Stage B: Studio keyed by `location_id`

### Studio database

| Old | New |
| --- | --- |
| `studio_workspaces (id uuid, brand, workspace_type, estio_location_id, …)` | `studio_locations (location_id text pk, app, name, …)`: the minimal per-Location row for FKs and the app check, not a separate concept |
| `workspace_id uuid` (52 columns), `p_workspace_id uuid`, `p_workspace` | `location_id text`, `p_location_id text`, `p_location` |
| `studio_workspace_memberships`, `studio_workspace_ai_settings`, `studio_workspace_ai_credentials` | `studio_location_memberships`, `studio_location_ai_settings`, `studio_location_ai_credentials` |
| `brand`, `actor_brand`, `workspace_brand`, `p_actor_brand` | `app`, `actor_app`, `location_app`, `p_actor_app` |
| `studio_workspace_invitations` and its RPCs (unused, 0 rows) | dropped |
| functions named `*workspace*` | `*location*` |

**R2:** existing object keys keep their workspace-UUID prefix. Key-checked tables (`studio_media_objects`, `studio_uploads`, `studio_legacy_media_transfers`, `studio_knowledge_media_links`) get a nullable `legacy_key_prefix uuid`. A check accepts `coalesce(legacy_key_prefix::text, location_id)` as the prefix. New objects use the location ID.

**How it is built:**
1. The Studio migration history and its test suites are rewritten mechanically to the new names. Fresh databases and `scripts/test-studio-schema.sh` then exercise exactly the new schema and functions.
2. One more history migration adds the legacy R2 prefix.
3. Production gets a one-off conversion, `studio/supabase/conversions/20261027000000_studio_location_key.sql`, run in one transaction:
   1. it maps every workspace to its Location (Estio from `estio_location_id`, Substo from Prisma `Location.studioWorkspaceId`, passed in) and aborts if any is unmapped;
   2. it drops views, triggers, functions, constraints and indexes;
   3. it converts the columns in place (`uuid` → mapped `text`), renames them and fills `legacy_key_prefix`;
   4. it recreates every constraint, index, function, view, trigger and grant from the new history.
4. A rehearsal script proves that "old history + conversion" has the same catalog as "new history" (columns, constraints, indexes, function bodies, ACLs, RLS). It also proves identical per-table row counts on fixture data and on a read-only copy of production.

### Code

- Every TypeScript `workspaceId` / `workspace_id` / `studio_workspaces` use becomes `locationId` / `location_id` / `studio_locations`. The Studio access path then uses the active Location ID directly, with no mapping lookup.
- Substo and Estio both create the `studio_locations` row on first Studio use (the same idempotent paths as today).
- Mac companion and device pairing: the job schema takes `location_id` as any non-empty string, not a UUID.
- Old `/studio/workspace/<uuid>/…` links redirect after an access check, or return 404.

### Rollout (short maintenance window)

1. Rebase on `origin/release/studio-go-live`, then run tests, the build and the rehearsal.
2. Stop `estio-studio-worker`, then take a `pg_dump` of the Studio database (kept outside the repo).
3. Apply the conversion with the mapping read from Prisma, then reload the PostgREST schema.
4. Deploy with `PRISMA_SCHEMA_SYNC_MODE=migrate-only ./deploy-local-build.sh`. Its readiness check restarts the worker on the new code.
5. Verify:
   - the legacy Substo Location still shows 10 records, 4 sources, 200 insights and 1,738 units;
   - old frames load from their old keys;
   - Estio Studio opens;
   - the paired Mac reconnects after the companion restarts.
6. Afterwards: drop `Location.studioWorkspaceId` in its own Prisma migration.

**Rollback:** restore the dump and redeploy the previous build.

## Stage C: docs

Update the "To fix" column in `how-the-app-works.md`, and add one line to `studio-implementation-progress.md`.

## Resume here (parked 2026-10-27)

Stage B is **parked** because the Studio Supabase project is restricted (`402 exceed_egress_quota`). The work is on branch **`wip/studio-location-rekey`** (commit `a8eaeb36`, based on `d8b88ca3`). It is not in `release/studio-go-live`; do not merge it until the steps below are done.

**Done (SQL only):**
- the Studio migration history and every SQL test suite were rewritten by `scripts/codemods/studio-location-key.py`: workspace becomes location, brand becomes app, and `uuid` location keys become `text`;
- the new history migration `20261027000000_studio_location_key.sql` drops the unused invitations, adds `legacy_key_prefix` for R2 and sets schema 28;
- `studio/tests/location-key-assertions.sql` checks that no workspace or brand names remain, and the R2 prefix rule;
- `scripts/test-studio-schema.sh` runs all of these. Every SQL and concurrency suite passes.

**Known failing:** `scripts/test-studio-schema.sh` exits 1 at the end with "Synthetic recovery fixture failed". The TypeScript recovery tools (`lib/studio/recovery`, `studio/tests/recovery-fixture.ts`) still use workspace names. Expect every TypeScript Studio path to fail against the new schema until the code re-key is done. Log: `/tmp/studio-rekey-wip-schema.log`.

**Remaining:**
1. The production conversion `studio/supabase/conversions/20261027000000_studio_location_key.sql` (not started), per "How it is built" step 3.
2. Its rehearsal script (not started). It must prove that "old history + conversion" equals "new history", and give equal row counts on fixtures and on a read-only production copy.
3. The TypeScript re-key: about 770 uses of `workspaceId`/`workspace_id`/`studio_workspace*` in about 150 files. `STUDIO_SCHEMA_VERSION` in `lib/studio/readiness.ts` becomes 28.
4. The Mac companion: the `location_id` job schema in `lib/studio/companion/http-queue.ts` and `scripts/studio-companion.ts`. The paired Mac needs the rebuilt companion.
5. R2 key checks in code: new objects use the location ID; old rows keep `legacy_key_prefix`.

**Precondition:** Supabase must be reachable, with the restriction lifted. Check that `scripts/studio-readiness.ts --mode=dependencies` exits 0, not 3 (exit 3 means degraded by the provider).

**Steps to resume:**
1. `git switch wip/studio-location-rekey && git rebase origin/release/studio-go-live`.
2. `bash scripts/test-studio-schema.sh` (only the recovery fixture should fail).
3. Do the remaining items 1–5. Then `scripts/test-studio-schema.sh`, the focused tests, `tsc` and the build must all pass.
4. Follow "Rollout" above: stop the worker, `pg_dump`, convert, deploy, verify.

## Likely Studio egress causes (from code reading only, not measured)

Ranked by likely bytes. Studio media is in R2 (presigned URLs); no code calls Supabase Storage, so media is **not** a Supabase egress cause.

1. **Whole JSON payloads re-read on every view.**
   - The knowledge insight view (`lib/studio/knowledge.ts:88`) loads the source's full `payload`, including its `units` array (1,738 units), for each insight opened. Reviewing 200 insights re-downloads the same source each time.
   - The Library list (`lib/studio/library.ts`) selects `payload` for 51 records per page; imported records carry full transcripts.

   *Cheap fix:* select only the fields shown, for example `payload->title` or the cited unit by index, and fetch the transcript and units only on the detail tab that shows them.
2. **One-off bulk reads.**
   - The 2026-10-26 legacy import verified "exact source payloads and metadata replay" by reading everything back.
   - Recovery verification scripts and any `pg_dump` or `psql` session also count as egress.

   *Cheap fix:* verify with hashes or counts on the server side (an RPC returning a digest), not by downloading rows.
3. **The Connected-computer settings page auto-refresh.** `companion-settings.tsx` calls `router.refresh()` every 15s, or 3s during sign-in, while the tab is visible. Each refresh re-runs about 4–6 Studio queries (access checks plus devices). One open tab is about 5,800 refreshes a day.

   *Cheap fix:* 60s or more when idle, fast only while a command runs, and stop after a few minutes.
4. **Per-request access checks.** Every Studio page and API call makes 3–4 small round trips: the profile-deleted check, the membership sync, the workspace read and the Location lookup.

   *Cheap fix:* cache the result per request with `React.cache`, and skip the membership upsert when nothing changed.
5. **The Mac companion and the hosted worker polling.** These are small rows but constant.
   - Companion: a heartbeat every 15s and a claim every 5s once healthy, each one RPC through `/api/studio/device/*`.
   - Hosted worker: a claim every 5s and a heartbeat every 30s.
   - Cron `studio-schedules`: every minute (prune plus a due-schedules read).

   Together that is about 25k–45k calls a day.

   *Cheap fix:* back off the claim interval when the queue is empty (5s → 60s), use a 60s heartbeat, and run the schedule cron every 5 minutes.
6. **Readiness probes (negligible).** `studio_readiness_snapshot` runs only at deploy and worker start. PM2 and the health endpoints never call it.

Since 2026-10-27, a restricted provider puts the whole process into a 120s backoff (`lib/studio/rest-client.ts`), so a restricted project is not hammered.
