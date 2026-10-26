# Business rename plan

Status: plan only (2026-10-26). Nothing here has been run. Decision source: [How the app works → Names](how-the-app-works.md#names-one-word-per-thing-everywhere).

Goal: the customer is called **Business** in the database, the code, the docs and the screens of both apps. The Studio workspace disappears: Studio rows belong to the Business by the Business ID. Studio's `brand` column (meaning the app) becomes `app`. The CRM **Companies** module is not touched.

## 1. Size (measured on `7573d5df`)

Counts exclude `node_modules` and `*.md` unless noted. "occ" is the number of matches.

| Layer | What | Size |
| --- | --- | --- |
| Prisma models | `Location`, `UserLocationRole`, `BrandInvitation`, `LocationSessionActivity`, `LocationAiPromptVersion`, `LocationKnowledgeEntry`, plus the implicit `_LocationToUser` table | 6 models + 1 join table |
| Prisma fields | `locationId` columns | 80 models |
| | `location Location` relation fields, plus `location*` back-relations on `Location` and `User` | 76 + 6 |
| | enum values `SettingsScopeType.LOCATION`, `ContactAccessScope.LOCATION_WIDE` | 2 |
| | persisted settings domains `location.public_site/ai/navigation/content/integrations/crm` | 6 keys in `settings_documents` |
| | Postgres trigger functions from `20261024170000_substo_brands` that name `"locationId"` in their bodies | 5 triggers |
| Leave alone | geographic fields: `Property.propertyLocation`, `Project.projectLocation`, `Viewing.location` (string), `Contact.requirementPropertyLocations`, `ScrapedListing.locationText`; GoHighLevel's own `ghlLocationId` (273 occ) | — |
| TypeScript | `locationId` | 8,188 occ / 765 files |
| | `Location` type, `db.location.*` | 432 / 168 files; 171 / 95 files |
| | `activeLocation*` / `resolveActiveLocation` | 335 / 79 files |
| | `lib/brands/*` importers, `BrandInvitation` | 16 files; 46 / 9 files |
| | Studio `workspaceId` / `workspace_id` | 2,538 / 219 files |
| | `HostBrand` / `authRealm` (the App, optional, see D5) | 132 / 29; 345 / 76 files |
| Routes | `/select-location`, `/api/active-location`, `/brand/{team,settings}`, `/studio/workspace/[workspaceId]/…` (upload API), `/admin/settings/location-data`, `/api/platform/locations/[locationId]` | 6 route trees |
| Studio DB (Supabase) | tables; tables with `workspace_id uuid` | 56; 50 |
| | FKs to `studio_workspaces`, composite FKs `(workspace_id, …)`, index/unique definitions using `workspace_id` | 38; 21; ~180 |
| | SQL functions (most take `p_workspace_id uuid`) | 134 functions, 521 `p_workspace_id` refs |
| | `brand` / `actor_brand` columns meaning app | ~15 tables, plus `'brand'` keys in the JSONB request fingerprints of 4 command tables |
| UI | hard-coded "location(s)" / "brand(s)" / "workspace" strings in `.tsx` | ~181 / ~70 / ~22 |
| | vocabulary layer `lib/branding/crm-vocabulary.ts` (`tenant*` keys) | 1 file, 251 uses |
| Docs | files mentioning Location / brand / workspace | 67 / 28 / 25 (of 131) |

External touchpoints:

| Touchpoint | Today | Handling |
| --- | --- | --- |
| Active tenant cookie | `active_location_id` (`lib/auth/active-location.ts`) | Write `active_business_id`; read the old one as a fallback for one release. |
| Clerk metadata | Estio team invitations: `publicMetadata.locationId` (`app/(main)/admin/team/actions.ts`); Substo: `publicMetadata.brandInvitationId` | Write the new key; read both while old invitations are pending (Clerk invitations expire after 30 days). |
| Android SMS relay | Device JWT claim `locationId`, valid 365 days (`lib/sms-relay/auth.ts`); pairing response `location_id` | Accept both claims and issue `businessId`. The Android app does not read `location_id`, so add `business_id` and keep `location_id` until re-pairing. |
| Mac companion | Job schema `workspace_id: z.string().uuid()` (`lib/studio/companion/http-queue.ts`) | Will reject CUIDs. Ship a companion that accepts `business_id` (any string) before the Studio re-key (S2). |
| R2 objects | Keys start with the workspace UUID, enforced by checks on `studio_media_objects` and legacy transfers | See D2: keep the old keys and stop enforcing the prefix. |
| Cron | Installed crontab passes no tenant IDs. 6+ cron routes accept an optional `?locationId=` for manual runs. | Accept `businessId`, keep `locationId` as an alias for one release. |
| Env vars | `CONVERSATIONS_CANARY_LOCATIONS`, `VIEWING_SESSION_CANARY_LOCATIONS` | Rename in `.env.prod`, reading both names for one release. |
| Public sites | `/sites/[siteSlug]` uses the site slug | Unaffected. |
| Webhooks | No tenant ID in webhook URLs. GHL/SSO `?locationId=` is GoHighLevel's term. | Unaffected (GHL is being removed). |

**Verdict:** UI wording is small and high value. The code rename is huge but mechanical. Renaming the Prisma DB objects is cheap: Postgres renames are metadata-only with no data movement. The Studio re-key is the costly part: 50 tables, 134 functions, live imported data and R2 key checks. Moving R2 objects is not worth doing now.

## 2. Name map

| Layer | Old | New |
| --- | --- | --- |
| Screens (both apps) | Location / Brand / Workspace | Business / Businesses, "Choose a business", "Switch business" |
| Vocabulary | `tenant`, `tenants`, `tenantTitle`, … | `business`, `businesses`, `businessTitle`, … (same words in both apps) |
| Prisma model / table | `Location` / `"Location"` | `Business` / `"Business"` |
| | `UserLocationRole` | `TeamMember` |
| | `BrandInvitation` (+ enum `BrandInvitationStatus`) | `BusinessInvitation` (+ `BusinessInvitationStatus`) |
| | `LocationSessionActivity` | `BusinessSessionActivity` |
| | `LocationAiPromptVersion` / `location_ai_prompt_versions` | `BusinessAiPromptVersion` / `business_ai_prompt_versions` |
| | `LocationKnowledgeEntry` / `location_knowledge_entries` | `BusinessKnowledgeEntry` / `business_knowledge_entries` |
| | `_LocationToUser` (relation `"LocationToUser"`) | `_BusinessToUser` (D6) |
| Prisma field | `locationId`, `location`, `locations`, `locationRoles`, `location*` lists | `businessId`, `business`, `businesses`, `teamMemberships`, `business*` |
| | `Location.studioWorkspaceId` | dropped (S6) |
| Enum value | `SettingsScopeType.LOCATION`, `ContactAccessScope.LOCATION_WIDE` | `BUSINESS`, `BUSINESS_WIDE` |
| Settings domain | `location.ai`, `location.crm`, … (`SETTINGS_DOMAINS.LOCATION_*`) | `business.ai`, `business.crm`, … |
| Code | `resolveActiveLocation`, `ACTIVE_LOCATION_COOKIE`, `lib/auth/active-location.ts` | `resolveActiveBusiness`, `ACTIVE_BUSINESS_COOKIE`, `lib/auth/active-business.ts` |
| | `lib/brands/*` (`brand-service`, `substo-brands`, `brand-policy`) | `lib/business/*` |
| | Studio `getStudioWorkspaceAccess`, `workspaceId` | `getStudioBusinessAccess`, `businessId` |
| Routes | `/select-location`, `/api/active-location` | `/select-business`, `/api/active-business` (old paths redirect) |
| | `/brand/team`, `/brand/settings` | `/settings/team`, `/settings/general` (old paths redirect) |
| | `/studio/workspace/[workspaceId]/uploads/api` | `/studio/uploads/api` (Business from the cookie) |
| | `/admin/settings/location-data`, `/api/platform/locations` | `/admin/settings/business-data`, `/api/platform/businesses` |
| Studio DB | `studio_workspaces` | `studio_businesses`: mirror row, `id text` = Business ID, plus `app`, `name` (D3) |
| | `workspace_id uuid` (50 tables), `p_workspace_id uuid` | `business_id text`, `p_business_id text` |
| | `studio_workspace_memberships` | `studio_team_members` |
| | `studio_workspace_ai_settings` / `_ai_credentials` | `studio_ai_settings` / `studio_ai_credentials` |
| | `studio_workspace_invitations`, `workspace_type`, `estio_location_id` | dropped |
| | `brand`, `actor_brand`, `p_actor_brand` | `app`, `actor_app`, `p_actor_app` |
| R2 | `<workspace-uuid>/…` | new keys `<business-id>/…`; old keys stay as stored (D2) |
| App (optional, D5) | `HostBrand`, `AuthRealm`, `authRealm` | `App`, `app` |

## 3. Stages

Each stage is one sub-agent's work. Each ships alone with `deploy-local-build.sh` and updates the docs it touches. Studio SQL is applied with `psql` as in `studio/supabase/README.md`; the deploy script does not apply it.

### S1: Screens and vocabulary (no schema, no routes)

- `crm-vocabulary.ts`: rename the `tenant*` keys to `business*`, with the same words in both apps. Replace the hard-coded Location/Brand/workspace strings in `.tsx` (~270), the Clerk invitation email copy and the page titles.
- Do not change "Location / Area" or any other geographic label. Settle D7 (Estio's existing "Business" contact category) first.
- **Accept:** a grep for `\b(Location|Brand|Workspace)s?\b` in user-visible strings finds only geographic or allowlisted hits. Screenshots of the header, selector, Settings → Team, the Studio header and the CRM contacts on both hosts. Vocabulary and edition tests pass.
- **Rollback:** redeploy the previous release.

### S2: External compatibility (code only, no migration)

New names on the wire, with old names still read:

- the cookie;
- Clerk invitation metadata;
- the SMS relay JWT claim and pairing response;
- cron `?businessId=` and canary env vars;
- settings domains: read `business.*` first, then fall back to `location.*`;
- the companion job schema, which takes `business_id` or `workspace_id` as any string;
- new routes, with redirects from `/select-location`, `/brand/*` and `/studio/workspace/*` after the access check.

**Accept:** contract tests cover each old-name fallback. A browser keeping the old cookie stays in its Business. An existing paired Android device keeps polling. `/brand/team` redirects.

**Rollback:** the previous release still writes and reads the old names, and S2 keeps reading them, so roll back in either direction freely.

### S3: Code identifiers, one mechanical commit, Prisma bridged

- Rename models, fields and enum values in `schema.prisma`, with `@@map("Location")`, `@map("locationId")`, `@map("LOCATION")`, `@relation("LocationToUser")` and similar keeping every DB name.
- Rename TypeScript identifiers, files (`lib/brands` → `lib/business`, `active-location.ts` → `active-business.ts`) and Studio `workspaceId` → `businessId` in TypeScript only. Studio SQL is still called with `p_workspace_id`.
- Do it with a committed codemod `scripts/codemods/business-rename.ts` (ts-morph symbol renames plus an explicit identifier list). Geographic fields and `ghl*` are excluded, and there is no blind `sed location`.
- **Accept:**
  - `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma` is empty, which proves zero DB change;
  - `tsc --noEmit` is clean;
  - unit, contract and `scripts/test-user-auth-realm-db.sh` tests pass;
  - `next build` passes;
  - a smoke run on both hosts passes.
- **Rollback:** redeploy S2. There is no DB change.

### S4: Prisma DB rename (one hand-written migration, short downtime)

- Prisma would generate DROP/CREATE for a rename, so write the SQL by hand. All of it is metadata-only:
  - `ALTER TABLE … RENAME` (7 tables) and `RENAME COLUMN` (80 × `locationId`);
  - a `DO` block that renames constraints and indexes whose names contain `Location` or `locationId`, because Prisma compares those names;
  - `ALTER TYPE … RENAME VALUE` (2);
  - recreating the 5 realm trigger functions with the new column names;
  - `UPDATE settings_documents SET domain = replace(domain, 'location.', 'business.')`.
- Remove all S3 bridges in the same commit.
- Commit a reverse script, `prisma/sql/business-rename-down.sql`, next to it.
- **Why not expand/contract:** Postgres cannot alias a renamed column. True expand/contract for 80 columns would need a shadow column, a sync trigger and a backfill per table, which is a lot of work for no real users. The deploy applies migrations before the switch, so the old slot fails for the ~1–2 minutes between migrate and switch. Deploy with `DRAIN_SECONDS=0` (D1).
- **Accept:**
  - the migrate diff is empty;
  - the realm-isolation queries from `crm-realm-identity-rollout.md` return 0 (with the new names);
  - row counts are unchanged per table;
  - `settings_documents` has 0 `location.*` rows;
  - a smoke run on both hosts and the cron log pass.
- **Rollback:** run the down script and then redeploy S3; both are instant.

### S5a: Studio re-key migration, written and tested (no production apply)

- One new Studio migration, `studio_business_key.sql`. It runs in a single transaction:
  1. Create `studio_businesses(id text pk, app text check in ('estio','substo'), name text)`.
  2. Load a mapping `workspace_id → business_id`. The SQL takes it as a parameterised `VALUES` list produced by `scripts/studio-business-map.ts` from Prisma: Substo uses `studioWorkspaceId`, and Estio uses `estio_location_id`.
  3. Abort if any workspace has rows but no Business.
  4. For each of the 50 tables: add `business_id text`, backfill, set NOT NULL, rebuild the PK, unique keys, indexes and composite FKs on `business_id`, then drop `workspace_id`.
  5. Rename the `brand` and `actor_brand` columns to `app` and `actor_app`.
  6. Rename the membership and AI tables.
  7. Drop and recreate the 134 functions with `p_business_id text` and `p_actor_app`.
  8. Replace the R2 prefix checks with `split_part(object_key,'/',1) IN (business_id, legacy_prefix)`, keeping `legacy_prefix` as a stored column (D2).
  9. Drop `studio_workspaces`.
- Update all 26 SQL suites and 9 concurrency checks in `studio/tests/`.
- **Accept:** `bash scripts/test-studio-schema.sh` is green. A fixture copy of production (legacy Substo import + Estio workspaces + devices) migrates with identical per-table row counts. The schema-diff review shows no `workspace`.
- **Rollback:** nothing ships to production.

### S5b: Studio code switch and production apply (maintenance window)

- The code calls `p_business_id` everywhere and `studio_businesses` is kept in step with the Business (create and rename). The membership mirror stays as today.
- **Order:**
  1. Stop `estio-studio-worker` and pause the Studio cron.
  2. Take a Studio DB dump.
  3. Generate the map and apply S5a.
  4. Deploy.
  5. Restart the worker.
- **Accept:**
  - the legacy Substo Business shows the same 10 records, 4 sources, 200 insights and 1,738 units;
  - a pre-existing frame loads from its old R2 key and a new upload lands under `<business-id>/`;
  - a paired Mac receives a diagnostic job;
  - Estio Studio opens for its locations;
  - the schedule dispatcher runs clean.
- **Rollback:** restore the dump and redeploy S4. A reverse SQL script is not worth writing for this.

### S6: Contract

- Drop `Business.studioWorkspaceId`. `autoCreatedForUserId` stays.
- Remove the S2 fallbacks after their windows:
  - cookie and canary env: after 1 release;
  - Clerk invitation keys: after 30 days;
  - SMS relay `locationId` claim: at forced re-pair, or keep until expiry;
  - the old companion field.
- Remove the redirects later or keep them, as you prefer.
- Final docs sweep (D8).
- **Accept:** a grep for `location_id|locationId|workspace_id|active_location` hits only `ghl*`, geographic fields and migration history.
- **Rollback:** redeploy S5b. Re-adding the dropped nullable column is a one-line down script.

## 4. Concurrent work

- **S1 and S2** touch a few dozen files and are fine to run alongside other sessions.
- **S3 touches ~800 files.** Announce a short freeze and wait until in-flight branches are merged. Land it as one commit and deploy it straight away.
  - Other sessions rebase like this: on conflict, take their own version of the file, rerun `scripts/codemods/business-rename.ts`, and continue. Committing the codemod is what makes this cheap.
  - Run S4 immediately after S3, so no new code is written against bridged names.
- **S5a/S5b:** freeze new Studio SQL migrations from the moment S5a starts. Today's device and companion work (`20261026010000`, `20261026020000`) must be merged first. Any later Studio migration is written against `business_id`.
- Rollout docs that describe past releases (for example `crm-realm-identity-rollout.md`) stay as historical records with a one-line note at the top (D8).

## 5. Decisions for the user

| # | Question | Recommendation |
| --- | --- | --- |
| D1 | Accept ~1–2 minutes of downtime for S4 and a few minutes of Studio downtime for S5b, instead of multi-release expand/contract? | **Yes.** There are no real users yet, and expand/contract for 80 renamed columns plus a key-type change would triple the work. |
| D2 | R2: move existing objects to `<business-id>/…` keys, or keep the old keys? | **Keep the old keys.** Keys are opaque stored values, and moving 471+ legacy frames plus uploads adds a copy/verify/delete job for no user-visible gain. Can be done later in a one-off script. |
| D3 | Keep a Studio `studio_businesses` mirror row (same ID as the Business) for FKs and the app check, or have no table at all? | **Mirror row.** It is the Business, not a second concept, just like the membership mirror. Without it, 50 tables lose referential integrity and the app check. |
| D4 | `UserLocationRole` → `TeamMember`, `BrandInvitation` → `BusinessInvitation`? | **Yes.** These match "Team member" and "Business" in the names table. |
| D5 | Rename the App too (`HostBrand`/`AuthRealm`/`authRealm` → `App`/`app`) in S3/S4? The names table says to rename it, but the Account row says `authRealm` is fine. | **Yes, in the same S3/S4 passes.** It is 477 occurrences, so it costs little extra, and it avoids a second freeze. Please confirm, given the contradiction. |
| D6 | `_LocationToUser` is a legacy second membership list beside `UserLocationRole`. Rename it or fold it into `TeamMember`? | **Rename only now.** Folding it in is a behaviour change and needs its own task. |
| D7 | Estio's vocabulary already uses "Business" as a contact category label (`businessCategory`). What should it become? | **"Partners & companies"**, as on Substo, so that "Business" means only the customer. |
| D8 | Docs: rewrite all 67+ files, or update living docs and leave dated runbooks as history? | **Update living docs; keep runbooks as history**, with a note pointing to this plan. |
| D9 | Studio: migrate in place, or rebuild a fresh Studio DB with squashed migrations and re-run the importers? | **In place.** It keeps job history and Estio Studio content, and it avoids redoing the legacy import verification. |

## Recommended first stage

**S1 (screens and vocabulary).** It delivers the user-visible half of the decision in one small release, has no data risk, and does not block other sessions. S2 follows it, then S3 and S4 back to back under a short freeze.
