# Realm-scoped identity and Substo brands: rollout runbook

Slices 0–5 of "CRM on Substo" ([design](substo-crm-design.md)). `User` gains an `authRealm` (`estio` | `substo`), so equal email addresses in the Estio and Substo Clerk applications never resolve to, link to or merge with the same Business user. Substo then gets brands (Prisma `Location`) with their own team and invitations, and Substo Studio sits on top of the brand. Nothing in this runbook has been run against production. Each release below needs its own authorization.

There are **two releases, in this order, never combined**:

| Release | Commit | Migrations | Code |
| --- | --- | --- | --- |
| A | `9e2d34ad` | `20261024160000_user_auth_realm_expand` | realm-aware user resolution, linking and webhooks (slice 0) |
| B | branch head | `20261024170000_substo_brands`, `20261024180000_user_auth_realm_contract`, `20261025010000_substo_public_sites_expand` | brands, brand team and invitations on Substo, Studio on top of the brand, shared sidebar layout, CRM/Studio switch on Estio and generic CRM opening, Substo product switch and vocabulary and opt-in public brand websites (slices 1–5) |

The contract migration refuses to run unless the expand migration finished at least 10 minutes earlier. A deploy of B straight from a pre-A release therefore aborts before the traffic switch, rather than leaving a rollback target that links users by email alone.

## What changes

| Area | Behaviour |
| --- | --- |
| Schema | `enum AuthRealm`, `User.authRealm NOT NULL DEFAULT 'estio'`, unique `(authRealm, email)` and `(authRealm, clerkId)`. `User.clerkId` stays globally unique on purpose: one Clerk user ID can only ever map to one row. |
| Realm source | `lib/auth/request-realm.ts`: the exact host allowlist (`resolveHostBrand`) that also selects the Clerk keys. estio.co, local hosts and tenant satellites → `estio`; Substo hosts → `substo`. Never derived from an email or payload. |
| Resolution | Release A resolves Business users only on Estio. Release B resolves active tenants by (request realm, clerkId), filters connected brands by that realm and rechecks the selected brand. Platform admin and impersonation remain Estio-only. Header-free helpers (`permissions.ts`, `current-user.ts`) use `businessClerkIdWhere`. The Studio schedule worker uses (`estio`, clerkId). |
| Linking | `ensureUserExists` → `ensureRealmUser`: (realm, clerkId), then a same-realm email claim (invited/placeholder users), as before. No fallback across realms. A conflicting row in the other realm makes the write fail closed. |
| Webhooks | `/api/webhooks/clerk` verifies the raw body with the host realm's secret (`CLERK_WEBHOOK_SECRET` for Estio, `SUBSTO_CLERK_WEBHOOK_SECRET` for Substo). It rejects identical secrets, and checks `instance_id` when `ESTIO_CLERK_INSTANCE_ID` / `SUBSTO_CLERK_INSTANCE_ID` is set (the Substo ID is required). Substo events cannot create team members (no Business access) or tenant contacts. `/api/webhooks/clerk-mail` is Estio-only (404 elsewhere). `/api/webhooks/clerk-profile` was already per realm and touches only Studio. The profile webhook is the sole admitted webhook on Substo; the Business and mail webhook paths stay blocked by `classifySubstoRoute`. Substo brand invitations and memberships are managed by its brand service. |
| Estio-only links by email | GHL OAuth callback, GHL SSO, property-creator placeholders, team invite and offboarding preview, platform-admin scripts and repair scripts: scoped to (`estio` or request realm, email). |

### Lookups deliberately left unchanged

About 50 Business call sites still use `findUnique({ where: { clerkId } })` after authorization (contacts, conversations, settings, Microsoft/Bazaraki APIs, analytics, Codex device auth, team actor lookups). They are realm-safe because:

1. `clerkId` is globally unique, so the lookup returns only the row created for that exact Clerk user.
2. Every write path that sets `clerkId` now sets it within the Clerk user's own realm.
3. They sit behind the realm-gated chokepoints above.
4. Release A keeps all Business routes off Substo. Release B opens only the reviewed CRM pages/APIs behind same-realm tenant authority; Server Actions have a separate default-deny app guard.

`realm-identity-contract.test.ts` pins the global `clerkId` uniqueness this relies on, and fails if any `db.user.findUnique/upsert/update/delete({ where: { email ... } })` without a realm reappears in `app/`, `lib/` or `scripts/`. Location-scoped user lists need no realm, because the database rejects cross-app memberships (release B). `platform-location-options` (Estio platform-admin login) is filtered to Estio brands and users.

Production state today: the Substo host never reaches Prisma `User`. The Studio page branches before `resolveActiveLocation`, and middleware blocks `/admin` and the Business webhooks. So no Substo identity can have been linked to an Estio user yet. Query 5 below confirms this.

## Release A: expand (commit `9e2d34ad`)

Migration `20261024160000_user_auth_realm_expand` is additive. `deploy-local-build.sh` applies it with `prisma migrate deploy` (`PRISMA_SCHEMA_SYNC_MODE=migrate-only`) **before** the traffic switch, so the previous release runs against it during build, soak and the 900-second drain. That is safe: the previous release never reads `authRealm`, and its inserts default to `estio`. Both global unique indexes remain, so its email lookups behave exactly as before. The two `CREATE UNIQUE INDEX` statements briefly block writes to `User` (a small table). They cannot fail, because `email` and `clerkId` are already globally unique.

### Before deploying (read-only)

Run these against production with a read-only role:

```sql
-- 1. Migration history is clean and the expand migration is not yet applied.
SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5;
SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;  -- expect 0

-- 2. Expected unique indexes exist as indexes (not constraints), and the type does not exist yet.
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'User' ORDER BY 1;
  -- expect User_pkey, User_email_key, User_clerkId_key
SELECT conname, contype FROM pg_constraint WHERE conrelid = '"User"'::regclass;  -- expect only User_pkey (p)
SELECT count(*) FROM pg_type WHERE typname = 'AuthRealm';  -- expect 0

-- 3. Baseline.
SELECT count(*) AS users, count("clerkId") AS linked FROM "User";

-- 4. Case-variant duplicates are tolerated (uniqueness stays case-sensitive, as today); record them.
SELECT lower(email), count(*) FROM "User" GROUP BY 1 HAVING count(*) > 1;

-- 5. Rows linked or created since Substo sign-in went live, for manual review.
SELECT id, email, "clerkId", "createdAt", "updatedAt" FROM "User" WHERE "updatedAt" >= '2026-10-23' ORDER BY "updatedAt";
```

For query 5, every listed `clerkId` should exist in the **Estio** Clerk application (Clerk Dashboard → Users, or Backend API `GET /v1/users/{id}` with Estio's secret key). A row whose `clerkId` exists only in the Substo application would be a pre-existing cross-realm link. Stop and repair it before continuing; do not let it backfill as `estio`.

Environment checks:

- `ESTIO_CLERK_INSTANCE_ID` (already used by the profile webhook) must equal the `instance_id` of Estio's Business webhook deliveries (Clerk Dashboard → Webhooks → a recent `user.created` attempt). If it is set but wrong, Business webhooks return 400 and Clerk retries them.
- `SUBSTO_CLERK_WEBHOOK_SECRET` is not needed for slice 1. If it is set, it must differ from `CLERK_WEBHOOK_SECRET`; otherwise both realms fail closed with 503.
- Take the usual database backup immediately before the deploy.

### Deploy

Use `deploy-local-build.sh` as usual. Do not use `db-push` mode.

### Verify after deploying

```sql
SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = '20261024160000_user_auth_realm_expand';  -- finished, not rolled back
SELECT "authRealm", count(*) FROM "User" GROUP BY 1;  -- only estio, equal to baseline users (plus new sign-ups)
SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'authRealm';  -- 'estio'::"AuthRealm", NO
SELECT indexname FROM pg_indexes WHERE tablename = 'User' AND indexname IN ('User_email_key', 'User_clerkId_key', 'User_authRealm_email_key', 'User_authRealm_clerkId_key');  -- 4 rows
```

Smoke tests:

- On estio.co, sign in → `/admin` opens the same location → platform admin page loads (for a platform admin) → Estio Studio opens a location workspace.
- On substo.com, `/studio` still works and `/admin` is still blocked.
- If a team invite is pending, accept it and confirm the member appears.
- Logs show no `Clerk webhook is not configured`, `Rejected Clerk event from another instance` or `[Auth Sync] Error`.

### Roll back release A

- **Web/worker rollback** (the normal path): roll back to the previous release with the deploy script's existing rollback. No database change is needed. The previous release works with the expanded schema, as above.
- **Failed migration**: `migrate deploy` runs before the switch, so the deploy aborts and the old release keeps serving. Inspect `_prisma_migrations`, then run `npx prisma@6.19.0 migrate resolve --rolled-back 20261024160000_user_auth_realm_expand` and fix the problem before retrying.
- **Schema reversal** (only if the schema itself must go, and only while the previous release is serving): first confirm `SELECT count(*) FROM "User" WHERE "authRealm" <> 'estio'` returns 0. Then:

  ```sql
  BEGIN;
  DROP INDEX IF EXISTS "User_authRealm_clerkId_key";
  DROP INDEX IF EXISTS "User_authRealm_email_key";
  ALTER TABLE "User" DROP COLUMN IF EXISTS "authRealm";
  DROP TYPE IF EXISTS "AuthRealm";
  DELETE FROM _prisma_migrations WHERE migration_name = '20261024160000_user_auth_realm_expand';
  COMMIT;
  ```

## Release B: brands and contract (branch head)

Deploy only after release A is live and verified, and once no release older than A remains a rollback target (check the deploy state's previous slot).

What it adds:

- **`20261024170000_substo_brands`** (additive): `Location.authRealm` (default `estio`), `Location.studioWorkspaceId` (unique; links a Substo brand to its Studio workspace), `Location.autoCreatedForUserId` (unique; at most one automatic brand per user) and the `BrandInvitation` table. Triggers reject any membership, role or invitation whose user and brand belong to different apps, and any change to a user's or brand's app. Every existing and newly inserted row from earlier releases is Estio, so A keeps working.
- **`20261024180000_user_auth_realm_contract`**: drops `User_email_key`, so the same email can exist once per app. Without it, a Substo sign-in whose email also exists in Estio cannot create its Substo user, and Substo Studio would show a setup error for that person.
- No Studio (Supabase) migration. Substo Studio membership rows stay, as a mirror of the brand team that the app keeps in step, so Studio's SQL checks keep working.

Behaviour on Substo after release B:

- At each `/studio` entry, the app links the Substo Business user and claims pending brand invitations addressed to the user's verified emails. It then adopts pre-brand Studio workspaces: the first member to sign in turns each one into a brand, and all of its current Studio members are imported once. If the user is still in no brand and has no invitation, the app creates their brand ("<first name>'s brand"), at most once per user.
- Team management lives at `/brand/team` (invite by email, change role, remove, leave), and the name at `/brand/settings`. Invitations are sent by Substo's own Clerk application. Old `/studio/invite/<token>` links only explain that invitations now come by email.
- Studio and brand pages use the CRM's sidebar shell in both apps. On Estio, the CRM/Studio switch sits under the logo. Slice 3 now opens only the reviewed generic CRM pages/APIs on Substo, with a separate Server Action firewall. Slice 4 enables both directions of the Substo product switch with membership revalidation.

### Before deploying B (read-only)

```sql
-- A is live, verified, and older than 10 minutes.
SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = '20261024160000_user_auth_realm_expand';
-- No duplicates the contract step would expose within one app.
SELECT "authRealm", email, count(*) FROM "User" GROUP BY 1, 2 HAVING count(*) > 1;  -- expect 0 rows
-- Pre-brand Substo Studio workspaces that will be adopted at first sign-in (run against the Studio database).
SELECT w.id, w.name, count(m.id) AS members FROM studio_workspaces w LEFT JOIN studio_workspace_memberships m ON m.workspace_id = w.id WHERE w.brand = 'substo' GROUP BY 1, 2;
```

Substo Clerk application (dashboard):

- Sign-ups are allowed, at least by invitation.
- `https://substo.com/sign-up` is a permitted redirect.
- The invitation email template is enabled.

Take the usual database backup immediately before the deploy.

### Verify after deploying B

```sql
SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name IN ('20261024170000_substo_brands', '20261024180000_user_auth_realm_contract');  -- both finished
SELECT count(*) FROM pg_indexes WHERE tablename = 'User' AND indexname = 'User_email_key';  -- 0
SELECT tgname FROM pg_trigger WHERE tgname IN ('UserLocationRole_same_auth_realm', '_LocationToUser_same_auth_realm', 'BrandInvitation_same_auth_realm', 'User_auth_realm_immutable', 'Location_auth_realm_immutable');  -- 5 rows
SELECT "authRealm", count(*) FROM "Location" GROUP BY 1;  -- estio unchanged; substo only after Substo sign-ins
-- Isolation invariants: both must be 0, now and at any later time.
SELECT count(*) FROM "UserLocationRole" r JOIN "User" u ON u.id = r."userId" JOIN "Location" l ON l.id = r."locationId" WHERE u."authRealm" <> l."authRealm";
SELECT count(*) FROM "_LocationToUser" m JOIN "User" u ON u.id = m."B" JOIN "Location" l ON l.id = m."A" WHERE u."authRealm" <> l."authRealm";
```

Smoke tests:

- On estio.co: `/admin` is unchanged, and the CRM/Studio switch under the logo opens the location's Studio with the sidebar.
- On substo.com:
  - Sign in. You land in your brand's Studio with the same sidebar; a pre-brand workspace appears as a brand with its name.
  - `/brand/team` invites a second test address. That person signs up from the email and lands in the same brand as a member, without getting a brand of their own.
  - Removing them takes their Studio access away.
  - `/admin` opens the generic CRM in the same Substo brand. Follow every opened route and foreign-ID check in [the slice 3 audit](substo-crm-route-firewall.md). `/admin/properties`, `/admin/prospecting`, `/admin/viewings`, platform/provider routes and forbidden Server Actions remain closed.

### Roll back release B

- **Web/worker rollback to A** is safe. A ignores brands and resolves Substo Studio access from Studio membership rows, which B keeps in step. Note: someone removed from a brand under B has no Studio row, so A also denies them. A never uses email uniqueness.
- **Never roll back to a release older than A** once the contract step has run.
- **Failed migration**: the deploy aborts before the switch. Inspect `_prisma_migrations`, run `npx prisma@6.19.0 migrate resolve --rolled-back <name>` for the failed one, and fix the problem before retrying. If the contract guard fired, deploy and verify A first.
- **Schema reversal of brands** (only while A is serving, and only if `SELECT count(*) FROM "Location" WHERE "authRealm" <> 'estio'` returns 0): drop the five triggers and their `estio_*` functions, the `BrandInvitation` table and `BrandInvitationStatus` type, and the three new `Location` columns, then delete the migration's `_prisma_migrations` row.
- **Restoring the global email index** is only possible while no email exists in both apps: `SELECT email FROM "User" GROUP BY email HAVING count(*) > 1;` must return 0 rows, then run `CREATE UNIQUE INDEX "User_email_key" ON "User"("email");`. Releases A and B do not need it.

## Local validation

- `bash scripts/test-user-auth-realm-db.sh` builds a disposable PostgreSQL cluster from the previous release's schema (`release/studio-go-live`) with legacy users, an Estio brand and a membership, then applies the three migrations in order. It checks:
  - No drift before and after the contract step.
  - Writes in the previous release's style still work.
  - The same-email Substo insert fails closed before the contract step and succeeds after it, once per app.
  - `clerkId` stays globally unique.
  - All realm triggers fire.
  - The contract guard rejects a same-deploy run.
  - The brand service integration tests (`lib/brands/brand-service.db.test.ts`) pass against the migrated database.
- Unit and contract tests: `npx tsx --test lib/auth/realm-user-link.test.ts lib/auth/clerk-business-webhook.test.ts lib/auth/realm-identity-contract.test.ts lib/brands/brand-policy.test.ts`.


## Slice 3: CRM host and action firewall

This adds no migration. Release B now includes the generic CRM opening described in [the route audit](substo-crm-route-firewall.md). Keep the release A → release B order above. Rollback from slice 3 to `cad79180` closes Substo CRM access again, keeps brands and Studio, and retains CRM records; it needs no database reversal. A rollback across release B's contract step must follow the older limits above.


## Slice 4: Substo edition branding and navigation

[The edition runbook](substo-edition-branding.md) records the shared identity/vocabulary, switch authority, exact local checks, Clerk email-branding copy and acceptance steps. It adds no migration. The release A → B order is unchanged; a later code-only slice 4 release can follow deployed slice 3. Code rollback to `4408b7b7` preserves CRM access/isolation and data while hiding the Substo product-switch option. Do not change the Estio Clerk application when reviewing Substo email branding.


## Slice 5: opt-in public websites

[The website runbook](substo-public-websites.md) records the additive `SearchConfig` fields, explicit publication, public data/host boundaries, migration verification queries and browser/HTTP checks. Release B now includes the website expand migration after the guarded contract migration. The release A → B order remains mandatory. If slices 0–4 have already deployed, apply the website expand with this code as the next release. Code rollback to `481b10cc` closes the public namespace; retain the additive columns and records. No DNS, Studio SQL or cron change is required.
