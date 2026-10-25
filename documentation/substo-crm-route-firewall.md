# Substo CRM route firewall (slice 3)

Local implementation only. No production migration, data mutation or deployment is authorized by this slice.

The route list is `lib/auth/substo-crm-policy.ts`; the Server Action list is `lib/auth/substo-crm-actions.ts`. Both deny unknown entries. The Clerk realm still comes from the verified request host. Middleware protects CRM pages and blocks hidden routes before Clerk initialization and the Estio rewrite bypass. API handlers retain their own authentication and tenant checks. Authentication redirects may now return to an allowed CRM page.

## Opened surface and isolation authority

| Surface | Data boundary |
| --- | --- |
| Dashboard, projects, profile | `resolveActiveLocation` / `getLocationContext`; project writes check active location and target project ownership; personal profile uses the immutable globally unique Clerk mapping |
| Contacts list, pipeline, view/edit and intercepted modals | `getActiveContactsAccess`, active location plus assignment scope; relationship IDs validated in that location |
| Companies list/detail | Active contacts access; `Company` queries include the active location; CRUD uses the company access policy |
| Conversations, deals and tasks | Active contacts access and conversation/deal assignment filters; deals/tasks live inside conversations rather than separate standalone pages |
| Homepage/page/post editors, website theme and navigation | Shared Estio components/actions; active location and role checks; public addressing/realm filters from [slice 5](substo-public-websites.md). [The corrective parity audit](shared-website-parity.md) documents the shared homepage/theme/menu flow. Property section writes/listing toggles, domain operations and provider configuration remain closed. |
| Settings and notification preferences | Active contacts access and current user; team entry redirects to `/brand/team`; provider/prospecting/destructive settings are closed |
| Team | Existing Substo brand team service, verified actor and same-realm membership/invitation checks |
| Location selection and switch API | Authorized connection/role intersection within the host realm; posted IDs and cookies are selectors only |
| Presence API | Active location and current authenticated user |
| Message-window API and conversation SSE | Active contacts access plus authorized conversation reference/visibility filters; authorization precedes cache or message loading |
| AI draft/summary streams and translation endpoints | Active location and scoped conversation/message/contact lookup before provider work |
| Notification SSE and push subscriptions | User/location scope; push endpoint writes also require the current owner in the unique filter |
| Attachment reads | Attachment's conversation location must match the active location before redirect or signing |
| Direct image uploads for content | Authenticated active-location policy; asserted location is verified and upload metadata ownership is overwritten server-side |

Every allowed CRM Server Action additionally resolves an authorized Substo tenant before executing its existing resource-specific checks. Every other exported non-Studio/brand action rejects Substo, including public-tenant actions. Studio and brand actions keep their own realm/workspace/team authorization. The two inline delete-page/post actions delegate to guarded actions. The inventory test checks every non-Studio/brand action export, so future exports must acquire a guard.

Read-only shared UI adapters return empty property options and disconnected provider status on Substo. Property payloads embedded in contact CRUD are rejected. Provider sends, WhatsApp imports, automated agents, property matching, viewings and the unscoped trace-tree reader stay closed. Substo generic conversation helpers use local data without requiring or refreshing GHL tokens. Navigation filtering applies to desktop and mobile; shared contact and inbox controls suppress hidden modules. Estio retains its existing routing and features.

## Verification

Results: 135/135 auth/brand/contact-access tests (including 38 new isolation/guard tests), all disposable migration checks and 10/10 brand/push integration tests, 19/19 realtime tests and 2/2 header tests pass. Studio/switcher/team checks pass 106/107, with the already documented `assignment-recovery-contract` failure. The changed-file compiler comparison finds the same 47 diagnostics as `cad79180`, with zero new diagnostics across 79 files. `npm run build` passes (129/129 static pages); the final build after all UI guards also exits 0.

Logs: `/tmp/crm-slice3-auth-final.log`, `/tmp/crm-slice3-isolation.log`, `/tmp/crm-slice3-db.log`, `/tmp/crm-slice3-realtime.log`, `/tmp/crm-slice3-ui-tests.log`, `/tmp/crm-slice3-studio-tests.log`, `/tmp/crm-slice3-types-final.log`, `/tmp/crm-slice3-build-final.log`. These are server-boundary tests with explicit Clerk/request/storage ports plus disposable PostgreSQL; they do not replace signed-in browser acceptance or prove provider delivery.

- `DATABASE_URL=postgresql://nobody:invalid@127.0.0.1:1/none npx tsx --test lib/auth/*.test.ts lib/brands/brand-policy.test.ts lib/contacts/active-location-access.test.ts`
- `bash scripts/test-user-auth-realm-db.sh`
- `npm run test:conversations:realtime`
- `npx tsx --test 'app/(main)/admin/conversations/_components/conversation-list-header.test.ts'`
- Focused Studio, product-switcher and team contract tests; the previously documented assignment-recovery contract failure remains.
- Compiler comparison against `cad79180` for changed files, ignoring line movement; build in a clean environment with an unreachable dummy Business database and no provider credentials.

## Production rollout, only under separate deployment authorization

1. Complete the release A expand deployment and verification in [the realm rollout runbook](crm-realm-identity-rollout.md). Do not combine its expand and contract in one deploy.
2. Deploy release B (brand migration, guarded email-index contract and this code) through `deploy-local-build.sh` with `PRISMA_SCHEMA_SYNC_MODE=migrate-only`, following that runbook. Slice 3 adds no migration and no Studio SQL change.
3. Verify the runbook's cross-realm membership/role/invitation queries return zero, and that sample same-email users resolve to different user IDs and same-realm brands.
4. With two real signed-in sessions, test every opened surface in the table: ordinary Substo access works, and Estio location cookies, location IDs, contact/company/project/page/post/conversation/task/deal/message/attachment IDs cannot disclose or mutate Estio data. Check direct paths, intercepted contact views, query strings and Server Action submissions. Repeat representative Estio workflows.
5. Confirm hidden pages/APIs return 404, forbidden actions reject when posted to `/admin/contacts`, team invitations use Substo Clerk, and no GHL/provider setup/send is exposed. Confirm Studio team access still follows the brand.
6. Slice 4 enables the product switch in both directions. Verify that it preserves the selected brand as described in [the edition runbook](substo-edition-branding.md). First-party public website routing is added in [slice 5](substo-public-websites.md); integrations remain separately scoped.

Rollback this code to `cad79180` to close Substo `/admin` again while preserving brand/Studio access. Keep all database records; no reverse migration or deletion is needed. CRM records created on Substo remain for a subsequent release. Rolling back before release B has the contract restrictions documented in the realm rollout runbook.

## Remaining work

- Signed-in two-app acceptance and real Clerk invitation delivery; separately authorized release A/release B rollout, backup and operational verification.
- Slice 4 is implemented locally; Substo Clerk email branding preview/delivery remains an external acceptance step.
- Slice 5 is implemented locally; signed-in CMS acceptance and authorized rollout remain.
- Slice 6+: review and enable messaging, WhatsApp/SIM relay, Google/Microsoft and other integrations individually; adapt automated AI/property-specific tools before opening them.
- Custom domains and their Clerk login, custom fields/objects per niche, and billing.
