# Realm-scoped Business identity: rollout runbook

Slice 1 of "CRM on Substo". `User` gains an `authRealm` (`estio` | `substo`), so equal email addresses in the Estio and Substo Clerk applications never resolve to, link to or merge with the same Business user. Nothing in this runbook has been run against production. Each release below needs its own authorization.

## What changes

| Area | Behaviour |
| --- | --- |
| Schema | `enum AuthRealm`, `User.authRealm NOT NULL DEFAULT 'estio'`, unique `(authRealm, email)` and `(authRealm, clerkId)`. `User.clerkId` stays globally unique on purpose: one Clerk user ID can only ever map to one row. |
| Realm source | `lib/auth/request-realm.ts`: the exact host allowlist (`resolveHostBrand`) that also selects the Clerk keys. estio.co, local hosts and tenant satellites → `estio`; Substo hosts → `substo`. Never derived from an email or payload. |
| Resolution | `resolveActiveLocation`, `getPlatformAdminContext` and impersonation resolve by (request realm, clerkId) and refuse realms without Business access (`isBusinessRealm`: `estio` only until slice 3). Header-free helpers (`permissions.ts`, `current-user.ts`) use `businessClerkIdWhere`. The Studio schedule worker uses (`estio`, clerkId). |
| Linking | `ensureUserExists` → `ensureRealmUser`: (realm, clerkId), then a same-realm email claim (invited/placeholder users), as before. No fallback across realms. A conflicting row in the other realm makes the write fail closed. |
| Webhooks | `/api/webhooks/clerk` verifies the raw body with the host realm's secret (`CLERK_WEBHOOK_SECRET` for Estio, `SUBSTO_CLERK_WEBHOOK_SECRET` for Substo). It rejects identical secrets, and checks `instance_id` when `ESTIO_CLERK_INSTANCE_ID` / `SUBSTO_CLERK_INSTANCE_ID` is set (the Substo ID is required). Substo events cannot create team members (no Business access) or tenant contacts. `/api/webhooks/clerk-mail` is Estio-only (404 elsewhere). `/api/webhooks/clerk-profile` was already per realm and touches only Studio. All three stay blocked on the Substo host by `classifySubstoRoute`. |
| Estio-only links by email | GHL OAuth callback, GHL SSO, property-creator placeholders, team invite and offboarding preview, platform-admin scripts and repair scripts: scoped to (`estio` or request realm, email). |

### Lookups deliberately left unchanged

About 50 Business call sites still use `findUnique({ where: { clerkId } })` after authorization (contacts, conversations, settings, Microsoft/Bazaraki APIs, analytics, Codex device auth, team actor lookups). They are realm-safe because:

1. `clerkId` is globally unique, so the lookup returns only the row created for that exact Clerk user.
2. Every write path that sets `clerkId` now sets it within the Clerk user's own realm.
3. They sit behind the realm-gated chokepoints above.
4. Middleware keeps `/admin` and the Business APIs off the Substo host.

`realm-identity-contract.test.ts` pins the global `clerkId` uniqueness this relies on, and fails if any `db.user.findUnique/upsert/update/delete({ where: { email ... } })` without a realm reappears in `app/`, `lib/` or `scripts/`. Location-scoped user lists (`platform-location-options`, `inbound-whatsapp`) need no realm: Locations are Estio-only until slice 2.

Production state today: the Substo host never reaches Prisma `User`. The Studio page branches before `resolveActiveLocation`, and middleware blocks `/admin` and the Business webhooks. So no Substo identity can have been linked to an Estio user yet. Query 5 below confirms this.

## Release A: expand (this branch)

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

## Release B: contract (later, separately authorized)

`prisma/contract-migrations/user_auth_realm_contract.sql` drops `User_email_key`. That is what lets a Substo user have the same email as an Estio user. Until then, such a Substo sign-in fails closed and never links. `prisma migrate deploy` does not read that directory.

Preconditions:

- Release A is live and verified.
- No release older than A remains a rollback target (check the deploy state's previous slot).
- Slice 2 has not started creating Substo-realm users yet.

Steps:

1. Copy the file to `prisma/migrations/<timestamp>_user_auth_realm_contract/migration.sql`.
2. Change `email String @unique` to `email String` on `User` in `prisma/schema.prisma`. No application code changes are needed, because all email lookups already use `authRealm_email`.
3. Run `bash scripts/test-user-auth-realm-db.sh`, then deploy.

Pre-check: `SELECT "authRealm", email, count(*) FROM "User" GROUP BY 1, 2 HAVING count(*) > 1;` returns 0 rows.

Post-check: `User_email_key` is absent, and `User_clerkId_key`, `User_authRealm_email_key` and `User_authRealm_clerkId_key` are present.

Roll back release B:

- Rolling back the web/worker to release A is always safe.
- Restoring the global index is only possible while no email exists in both realms: `SELECT email FROM "User" GROUP BY email HAVING count(*) > 1;` must return 0 rows, then run `CREATE UNIQUE INDEX "User_email_key" ON "User"("email");`. Release A does not need this index; only pre-realm releases do.

## Local validation

- `bash scripts/test-user-auth-realm-db.sh` runs 15 checks on a disposable PostgreSQL cluster:
  - It loads the previous release's schema (`release/studio-go-live`) with legacy users, applies the expand migration, and confirms there is no drift against `prisma/schema.prisma`.
  - It checks previous-release inserts and lookups, the fail-closed same-email Substo insert, and global `clerkId` uniqueness.
  - It then applies the contract step and checks drift against the contracted schema, one row per realm for the same email, and same-realm duplicate rejection.
- Unit tests: `npx tsx --test lib/auth/realm-user-link.test.ts lib/auth/clerk-business-webhook.test.ts lib/auth/realm-identity-contract.test.ts`.
