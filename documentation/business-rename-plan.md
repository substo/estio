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
