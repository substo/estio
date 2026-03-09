# Site Settings Platform (Supabase Postgres + Encrypted Secrets)

**Last Updated:** 2026-03-08  
**Status:** Implemented and deployed

> [!IMPORTANT]
> This document is the source of truth for settings architecture, encryption, migration, rollout, and operational procedures.

## 1. Scope and Intent

The settings platform centralizes site and integration settings in the same Supabase-managed PostgreSQL database (no external secret manager). It replaces direct scattered writes to `SiteConfig`, `Location`, and `User` with a typed settings layer and encrypted secret storage.

Core goals:

- Keep settings evolution safe and maintainable as fields change.
- Enforce scoped access and consistent write semantics.
- Encrypt sensitive values at rest with key rotation.
- Migrate without data loss (backfill + dual-write + parity validation).

## 2. Data Model

The platform introduces three core tables and two enums in Prisma.

### Enums

- `SettingsScopeType`: `LOCATION` | `USER`
- `SettingsAuditOperation`: `UPSERT` | `DELETE` | `ROTATE` | `PARITY_MISMATCH` | `BACKFILL`

### `settings_documents` (non-secret settings)

- Key: (`scope_type`, `scope_id`, `domain`) unique
- Value: `payload jsonb`, `version`, `schema_version`, timestamps
- Prisma model: `SettingsDocument`

### `settings_secrets` (encrypted secret values)

- Key: (`scope_type`, `scope_id`, `domain`, `secret_key`) unique
- Value: `ciphertext`, `iv`, `auth_tag`, `alg`, `key_id`, `encrypted_at`, `rotated_at`, timestamps
- Prisma model: `SettingsSecret`

### `settings_audit_log` (change/audit stream)

- Captures actor, scope, domain, operation, before/after JSON, request id, timestamp
- Prisma model: `SettingsAuditLog`

## 3. Domain and Secret Registry

### Settings domains

- `location.public_site`
- `location.ai`
- `location.navigation`
- `location.content`
- `location.integrations`
- `location.crm`
- `user.crm`
- `user.integrations.google`
- `user.integrations.microsoft`

### Secret keys

- `google_ai_api_key`
- `whatsapp_access_token`
- `twilio_auth_token`
- `crm_password`
- `google_access_token`
- `google_refresh_token`
- `google_sync_token`
- `outlook_access_token`
- `outlook_refresh_token`
- `outlook_password`
- `outlook_session_cookies`

## 4. Service Layer Contract

`lib/settings/service.ts` is the centralized API used by server actions and integration services.

Main capabilities:

- Documents: `getDocument`, `upsertDocument`, `deleteDocument`
- Secrets: `setSecret`, `getSecret`, `hasSecret`, `clearSecret`
- Rotation: `rotateSecrets` (batch re-encryption to primary key)
- Migration safety: `checkDocumentParity` (legacy projection vs new projection)
- Concurrency: `expectedVersion` with `SettingsVersionConflictError`
- Auditing: write operations produce `settings_audit_log` events

## 5. Encryption Design

Secrets use application-level envelope-style encryption primitives:

- Algorithm: AES-256-GCM
- IV: random 12-byte IV per secret write
- AAD binding: `${scope_type}:${scope_id}:${domain}:${secret_key}`
- Stored metadata: `key_id`, `alg`, `encrypted_at`, optional `rotated_at`

AAD prevents ciphertext swapping across tenants/domains/keys.

### Keyring env vars

- `SETTINGS_ENCRYPTION_KEYS`: JSON map of `key_id -> base64(32-byte key)`
- `SETTINGS_ENCRYPTION_PRIMARY_KEY_ID`: active key for new writes

Validation is strict:

- keyring JSON must parse
- each key must decode to exactly 32 bytes
- primary key id must exist in keyring

## 6. Rollout Flags

Feature flags in `lib/settings/constants.ts`:

- `SETTINGS_READ_FROM_NEW` (default `false`)
- `SETTINGS_DUAL_WRITE_LEGACY` (default `true`)
- `SETTINGS_ENABLE_PARITY_CHECKS` (default `true`)

Recommended phases:

1. New writes + legacy writes + parity checks (`read=false`, `dual=true`, `parity=true`)
2. Switch reads to new store (`read=true`, keep `dual=true`, `parity=true`)
3. Disable legacy writes after validation (`dual=false`, then `parity=false`)
4. Remove legacy fallback paths and deprecate old columns

## 7. Authorization and Consistency Rules

- Location settings writes require admin role via `verifyUserIsLocationAdmin` (`UserLocationRole.ADMIN`).
- Settings actions use explicit `locationId`/`scopeId` resolution (no implicit `user.locations[0]` write targeting).
- Optimistic concurrency is enforced on mutable forms using `settingsVersion` -> `expectedVersion`.
- Secret form semantics:
  - Blank input: keep existing secret
  - Explicit `clear*` flag/checkbox: delete secret
  - UI never gets plaintext secrets back; only boolean status (`hasSecret`) + masked display

## 8. Migration and Backfill Runbook

### 8.1 Create schema

Preferred:

```bash
npx prisma migrate dev --name settings_platform
npx prisma migrate deploy
```

Operational fallback (idempotent):

```bash
node scripts/settings/apply-settings-migration.js
```

### 8.2 Backfill legacy data

Dry run:

```bash
npm run settings:backfill -- --dry-run
```

Apply:

```bash
npm run settings:backfill -- --continue-on-error
```

Useful options:

- `--overwrite-secrets`
- `--skip-parity`
- `--location-id=<id>`
- `--user-id=<id>`

### 8.3 Rotate keys

Preview:

```bash
npm run settings:rotate-secrets -- --dry-run
```

Execute:

```bash
npm run settings:rotate-secrets -- --batch-size=200
```

### 8.4 Parity and audit validation

```sql
SELECT operation, COUNT(*) 
FROM settings_audit_log
GROUP BY operation
ORDER BY operation;
```

```sql
SELECT COUNT(*) FROM settings_documents;
SELECT COUNT(*) FROM settings_secrets;
```

Any `PARITY_MISMATCH` rows must be investigated before disabling legacy writes.

## 9. Legacy Compatibility During Migration

While dual-write/fallback remains enabled:

- Legacy columns in `SiteConfig`, `Location`, `User` are still updated for compatibility.
- Read paths in some services can fall back to legacy columns if new settings are absent.
- `ENCRYPTION_KEY` is still needed for legacy `Cryptr` decryption paths.

After full cutover and legacy fallback removal, `ENCRYPTION_KEY` should no longer be required by settings workflows.

## 10. Known Edge Case: Legacy Outlook Secret Decrypt Failures

Some legacy Outlook artifacts (`outlookPasswordEncrypted`, `outlookSessionCookies`) can fail decrypt during backfill if historic cipher inputs are invalid or mismatched.

Operational handling:

- Continue migration with `--continue-on-error`.
- Complete cutover.
- Re-enter Outlook password/session manually from admin UI where needed.

## 11. Files and Surfaces Updated by This Refactor

Core platform:

- `prisma/schema.prisma`
- `prisma/migrations/20260308140000_settings_platform/migration.sql`
- `lib/settings/*`
- `scripts/settings/*`

Admin actions/pages (settings now routed through `SettingsService`):

- `/admin/site-settings`
- `/admin/site-settings/navigation`
- `/admin/content/*` settings writes
- `/admin/settings/ai`
- `/admin/settings/crm`
- `/admin/settings/integrations/google`
- `/admin/settings/integrations/whatsapp`

Integration/auth consumers:

- `lib/google/auth.ts`, `lib/google/people.ts`
- `lib/microsoft/auth.ts`, `lib/microsoft/graph-client.ts`
- `lib/twilio/client.ts`

