# Where credentials live

Decided 2026-11-06. Every credential the app stores is in the encrypted settings store: `SettingsSecret` (table `settings_secrets`, AES-256-GCM, AAD bound to scope/scopeId/domain/key, optional KMS data keys; `lib/settings/{crypto,service}.ts`). Non-secret settings stay in `SettingsDocument`. Keys were not rotated (pre-launch).

| Credential | Home (scope, domain, key) | Helper |
| --- | --- | --- |
| Old CRM username (Estio only) | USER `user.crm` document, `crmUsername` | `lib/crm/credentials.ts` |
| Old CRM password | USER `user.crm` secret `crm_password` | `getUserCrmCredentials` / `setUserCrmCredentials` / `clearUserCrmCredentials` |
| Google OAuth access / refresh token | USER `user.integrations.google` secrets `google_access_token`, `google_refresh_token` | `lib/google/credentials.ts` |
| Google People sync cursor | USER `user.integrations.google` secret `google_sync_token` | same |
| Outlook OAuth access / refresh token | USER `user.integrations.microsoft` secrets `outlook_access_token`, `outlook_refresh_token` | `lib/microsoft/credentials.ts` |
| Outlook browser sign-in password / session cookies (JSON) | USER `user.integrations.microsoft` secrets `outlook_password`, `outlook_session_cookies` | same |
| WhatsApp Cloud webhook verify token | LOCATION `location.integrations` secret `whatsapp_webhook_secret` | `lib/whatsapp/webhook-secret.ts` |
| WhatsApp Cloud access token, Twilio auth token | LOCATION `location.integrations` secrets `whatsapp_access_token`, `twilio_auth_token` | unchanged (legacy encrypted column copies still written; separate cleanup) |
| Gemini / OpenAI keys, ChatGPT subscription | see [business data, phase 4](business-data.md#phase-4-ai-connections-and-keys-2026-11-05) | unchanged |

- "Is this person connected?" checks read secret presence without decrypting (`lib/settings/user-secrets.ts`).
- Disconnect and team offboarding delete the secrets. Offboarding deletes every USER secret in the Google, Microsoft, Old CRM and ChatGPT domains and the `user.crm` document.
- The webhook handshake (`GET /api/webhooks/whatsapp`) accepts the platform `WHATSAPP_WEBHOOK_VERIFY_TOKEN` or any Location's stored verify token. Every candidate is compared in constant time (both sides SHA-256 hashed, then `timingSafeEqual`). Before this change only the platform token was accepted, although the settings screen told admins to paste the Location's token into Meta.
- The Old CRM integration (Puppeteer pull/push of listings and leads) stays for future Estio customers. Only its credential storage changed. The Location CRM columns and `LegacyCrmLeadEmailProcessing` are unchanged.
- A contract test (`lib/settings/legacy-credential-columns.contract.test.ts`) fails if code names a retired column again.

## Retired columns

| Column | Production 2026-11-06 (read-only) | Dropped by |
| --- | --- | --- |
| `User.crmPassword` (plain text) | 0 rows; 1 encrypted secret | `20261106100000_drop_legacy_user_credentials` |
| `User.crmUsername` | 1 row, the same value in its `user.crm` document | same |
| `User.googleAccessToken`, `googleRefreshToken`, `googleSyncToken`, `outlookAccessToken`, `outlookRefreshToken` (plain text) | 0 rows | same |
| `User.outlookPasswordEncrypted`, `User.outlookSessionCookies` (app-encrypted with `CREDENTIAL_ENCRYPTION_KEY`/`JWT_SECRET`) | 1 user; both decrypt | `20261106110000_drop_moved_credentials`, after the copy |
| `Location.whatsappWebhookSecret` and the `whatsappWebhookSecret` key of the `location.integrations` document (plain text) | 1 Location with a value (the document and the column hold the same value); 2 more documents with an empty key | same |

Each drop migration runs in a transaction and first refuses (`RAISE EXCEPTION`) if any row still holds a value that is not in its new home:
- the first: any non-empty `crmPassword` or token column, or a non-empty `crmUsername` whose user has no `user.crm` document;
- the second: any non-null browser column, or any non-empty column or document verify token.

`crmUsername` moved too because every reader already used the helper and production's one value was already in the document. The helper therefore has no column fallback.

## Deploy order

1. **Code** (commit "Read and write legacy credentials only through the encrypted settings store"). Deploy it. Writers store secrets and clear legacy copies. Readers use secrets. Only the Outlook browser and verify-token readers still fall back to the old copies.
2. **Run the copy on the server.** Storing a secret needs the server's KMS key file, so a Mac run fails before writing anything (seen 2026-11-07).
   - **Where:** the platform admin opens **Platform overview** (`/admin/platform`), finds the **Move remaining legacy credentials** card and clicks **Apply**.
   - **What the card shows:** counts per credential from a dry run (no ids, no values). After Apply it shows the result. Once nothing is left it reads "Nothing left to move", and on the next visit it is gone.
   - **Access:** `POST /api/platform/legacy-credentials` accepts only the platform admin, never while impersonating, and only same-origin requests.
   - **Shared logic:** `moveLegacyCredentials` in `lib/settings/legacy-credentials-move.ts` serves both the card and `npx tsx scripts/settings/move-legacy-credentials.ts [--apply]`, for anywhere the keys exist.
   - **Behaviour:** it stores each Outlook browser value and verify token as a secret (never overwriting one), reads it back, then clears the old copy.
   - **Audit:** every write is in the settings audit log under the admin's user and one request id: secret UPSERTs, column-clear DELETEs and the document UPSERT. The removed verify token is shown as `[redacted]`.
   - **Output:** ids and counts only.

   Production dry run, 2026-11-06 (the same five items on 2026-11-07):
   ```
   DRY RUN
   Outlook browser credentials: 1 user(s) with an in-column copy
     - cmingx6lt0009rdycpxeor80j password: decrypts; would store secret and clear column
     - cmingx6lt0009rdycpxeor80j session cookies: decrypts; would store secret and clear column
   WhatsApp webhook verify token: 3 Location(s) with a plain-text copy
     - cmingx6b10008rdycg7hwesyn verify token: from document
     - cmsbhnn9v0000eetr9vg9u9t9 verify token: legacy copy is empty; would clear it
     - cmshgqe2j0000a4jjw6152pjf verify token: legacy copy is empty; would clear it
   Columns guarded by the immediate drop migration (non-empty rows; must be 0 or 'dropped'):
     - User.crmPassword: 0 (and the five token columns: 0)
     - User.crmUsername without a user.crm document: 0
   ```
3. **Immediate drop** (commit "Drop plain-text CRM password, username and OAuth token columns"). Safe as soon as step 1 is live, because no deployed code reads these columns. It is a separate deploy so that the old slot never queries a dropped column during cutover.
4. **Drop after copy** (commit "Drop Outlook browser and webhook verify-token columns after the copy"). Deploy only after step 2's Apply has run and the card says "Nothing left to move". It removes the fallbacks and the columns; its guard refuses if the copy has not run.

Steps 3 and 4 may go out in one deploy once step 2 is done.

**Known residue:** 38 settings audit rows (`settings_audit_log`, counted 2026-11-06) for earlier `location.integrations` saves contain the verify token in `beforeJson`/`afterJson`. They are audit evidence and are left unchanged. Redact them separately if wanted.
