# Estio–Substo Studio: audit and continuation handoff

This document captures the latest conversation's read-only audit and the next implementation plan. It supplements the original approved brief in `studio-agent-handoff.md`. **`studio-implementation-progress.md` remains the status source**; update it after each completed implementation milestone. Verify observations against the current tree/environment rather than treating this document as proof of completion.

## Start here

- Work in `/Users/martingreen/Projects/Estio`.
- Read current repository instructions, this document, `studio-agent-handoff.md`, `studio-implementation-progress.md`, `substo-hosted-studio-host-setup.md`, `profile-google-youtube-discovery.md`, and the relevant implementation files.
- Use `/Users/martingreen/Projects/Substo` as a read-only reference for existing features, especially `app/agent-workflows.js`, `app/local-scheduler.js`, `app/transcription.js`, and `docs/foundation.md`. Its `video-editor/` is another repository. Do not merge repositories or inspect/modify ignored private data as routine implementation work.
- Start with `git status --short` and inspect untracked source too. Much of Studio is untracked, alongside unrelated SIMRelay/SMS/Business/documentation changes. Preserve all unrelated work. Do not reset, clean, broadly stage, commit, or deploy the whole dirty tree implicitly.
- Earlier numbered slices describe milestones, not proof that the first hosted release is complete. Some old “next” paragraphs are stale: media and interactive Google discovery code now exist, but scheduled execution and hosted text AI do not.

## Approved product and boundaries

One Next.js deployment serves two exact host-based experiences:

- **Estio:** existing location selector and Business features plus a Studio switch. Existing public tenant websites must keep working.
- **Substo:** canonical hostname `substo.com`, its own sign-in and workspace selector, Studio only. The user wants `www.substo.com` redirected to the apex.
- Separate Clerk applications/production realms. Equal email addresses never merge accounts, grants, memberships, or content. Preserve Estio's Clerk configuration and existing Business Google integrations.
- Estio Business stays in its existing Prisma database. Both brands' Studio data goes into the dedicated Substo Supabase Postgres project. Do not apply Studio migrations to Business or retrofit the personal `owner_id` schema.
- Map each Estio location idempotently to a Studio workspace and inherit audited location/team roles. Standalone Substo uses explicit workspace memberships/invitations. Authorize each server operation; never trust a submitted workspace ID or infer access from email.
- Private media bytes live in a dedicated Cloudflare R2 bucket, not Supabase Storage or Cloudflare Images. Supabase holds Studio metadata.
- First release includes library, knowledge, ideas/scripts/content, media, schedules, authorized discovery, customer-funded hosted text AI and upload transcription, repeatable migration, and dependable jobs while the owner's Mac is off.
- **User clarification:** Google scopes and refresh tokens belong to each app user profile, keyed by app realm plus Clerk user ID, never a Studio workspace. Studio independently checks workspace access. Personal subscriptions remain private until the user explicitly saves a public research link to a workspace. OpenAI keys and budgets remain workspace-owned under the approved plan.
- Use official YouTube APIs with honest source labels. Do not claim a personalized home feed, run hosted signed-in scraping, or download/transcribe third-party media without authorization. Hosted processing must not depend on the operator's Codex/Claude subscription.
- Intentionally later: recording, Swift `.substo` editor/companion sync, local models, cover generation, publishing, and generalized Business expansion. Keep the existing native editor.
- Hosting is Hetzner with Caddy TLS/reverse proxy and Cloudflare DNS/edge, not Vercel. Deploy through `deploy-local-build.sh`; production schedules belong to `scripts/install-cron.sh` and installed scripts.

## Audit conclusion and verified code

**The shared first release is incomplete. Neither hosted Studio experience is ready for real use. Existing Estio Business remains online.** The audit made no implementation or production changes. Preparing this handoff only changes documentation.

Code inspection and focused checks support these implemented capabilities:

- Exact branding, separate request-time Clerk keys, fail-closed Substo configuration, Studio-only route firewall, and retained Estio tenant routing: `lib/auth/{host-brand,host-routing-policy,clerk-runtime}.ts`, `middleware.ts`.
- Workspace/location access, membership/invitations, role checks, scoped impersonation restrictions: `lib/studio/access.ts` and associated policies.
- Shared library/content editing, optimistic versions, stages, exact notes/scripts, record links and audit events; knowledge browsing, citations/history, and status-only review: `lib/studio/{library,content,record-relations,knowledge}.ts`, `app/(main)/studio/`.
- Library/SQLite knowledge/sidecar/schedule import previews and pinned atomic apply, provenance/replay preservation, media checksum/upload/read-back/binding and private display: `lib/studio/import/`, `scripts/studio-*`, `studio/import/`.
- Encrypted workspace OpenAI keys/caps, reservation ledger, queue/worker, browser uploads and chunked transcription: `lib/studio/{ai-settings,uploads,media-r2}.ts`, `lib/studio/worker/`, `scripts/studio-worker.ts`.
- Profile-owned Google grants and interactive YouTube subscriptions/public search/approved channels/saved URLs, with explicit sharing: `lib/google/profile-youtube*.ts`, `lib/google/youtube*.ts`, `lib/platform/profile.ts`, `app/(main)/account/connections/`, Studio YouTube UI.

These are local/code claims, not a completed cross-brand production acceptance test. Earlier notes record throwaway live R2 checks; the audit did not repeat object writes or treat those historical checks as production upload verification.

## Concrete defects and unfinished first-release work

### Fix paid-job reliability first

1. `lib/studio/worker/runner.ts:23` swallows lease-renewal errors. Repeated failures can leave a handler running past lease expiry while another worker reclaims its job. Completion is lease-checked, but transcript side-effect RPCs are not fenced by a current job lease. See `studio/supabase/migrations/20261024020000_studio_uploads.sql:132`.
2. `lib/studio/worker/transcribe-upload.ts:68–94` increments billed seconds only after a successful provider response. A lost response leaves provider processing/spend uncertain, yet the reservation can be released. A successful provider response followed by failed chunk persistence leads to resending/rebilling on retry. Process crashes can strand reservations; the usage ledger lacks a complete job/attempt recovery association.
3. Design explicit uncertain-outcome handling, durable per-attempt accounting and reservation recovery, plus current-lease fencing for writes. Do not promise exactly-once provider execution where the provider cannot support it. Existing happy-path/resume tests do not establish these guarantees.

### Remaining feature and operational gaps

- **Schedules:** only drafts, inactive imported definitions, and historical browsing exist. No enabled state, due-run dispatcher, run-now path, or scheduled discovery execution. See `lib/studio/schedules.ts`, `studio/supabase/README.md:37`, schedule migrations, and `scripts/install-cron.sh`.
- **Text AI:** registered handlers are diagnostic and upload transcription only. Port idea review, script brief, and knowledge extraction to hosted customer-funded processing rather than shelling out to local Codex. Compare `scripts/studio-worker.ts`, `lib/studio/worker/handlers.ts`, and local Substo `app/agent-workflows.js`.
- **Profile lifecycle:** Google credential cleanup on Clerk account deletion is not integrated/verified. See `documentation/profile-google-youtube-discovery.md:35`.
- **Parity:** knowledge statement editing and approval-time topic assignment/creation are absent; content stage filtering is absent. Complete these or obtain an explicit scope decision before claiming full parity; they are not automatically covered by the intentionally deferred native/publishing work.
- **Browser upload recovery:** `app/(main)/studio/_components/studio-upload-form.tsx` sends a single PUT and retains no durable resume/finalization state. A lost finish response/reload can leave an orphan or require a new upload. Distinguish this path from the operator legacy-media importer.
- **Readiness:** `deploy-local-build.sh:688` warns rather than fails when the Studio worker is not online. `app/api/health/route.ts` only returns a basic OK. Studio dependency/queue/worker readiness, database/media/encryption-key backup and tested restore/rollback remain outstanding. `scripts/backup.sh` is a Git code-backup helper, not a Studio data backup.
- No reviewed real-data cutover, end-to-end brand/team acceptance, live Google consent, or Mac-off hosted processing has been demonstrated.

## Live environment observations — recheck before acting

These are observations from the preceding audit, not permanent facts or permission to modify production. No secrets are included here.

### DNS, TLS, and Clerk

- User reported apex A `substo.com → 138.199.214.117`, proxied/Auto TTL, Full (strict), and a separate Substo Clerk production application. Dashboard intent is not equivalent to independently verified live configuration.
- Public resolvers (including 1.1.1.1 and 8.8.8.8) returned the origin IP directly for the apex, suggesting DNS-only rather than the reported ordinary proxy behavior. Nameservers were `emma.ns.cloudflare.com` and `lee.ns.cloudflare.com`.
- Apex HTTPS failed with a TLS internal-error alert. Caddy had no explicit apex Substo block and no stored apex Substo certificate found. A stored `downtowncyprus.substo.com` certificate does not cover the apex.
- `www.substo.com` pointed to `flash.funnels.msgsndr.com`, not an apex redirect. Do not overwrite that record during local work.
- Public Clerk CNAMEs existed: `clerk → frontend-api.clerk.services`, `accounts → accounts.clerk.services`, `clkmail → mail.1g63ekv8yw25.clerk.services`, `clk._domainkey → dkim1.1g63ekv8yw25.clerk.services`, `clk2._domainkey → dkim2.1g63ekv8yw25.clerk.services` (all under `substo.com`). Clerk frontend/account HTTPS certificates validated. Do not replace these with guessed values; compare to the actual production Clerk Domains page.
- Realm keys, instance match, production sign-in/callbacks, dashboard certificate status and complete auth isolation are still unverified. Public DNS/certificates alone cannot establish them.
- The available Cloudflare API token could read the active zone but returned 403 for DNS records and SSL mode. Therefore proxy status and Full (strict) could not be confirmed through the dashboard API. Browser inspection also failed twice with `Preview automation snapshot timed out after 15000ms.` No authenticated dashboard conclusion was reached.

### Server and production environment

- Read-only SSH worked to `root@138.199.214.117` using existing credentials and known host keys. Do not print secrets, weaken host-key checks, or mutate production merely to repeat verification.
- PM2 `estio-app-blue` was online at `/home/martin/estio-app-blue`; Caddy routed web traffic to localhost:3001. No `estio-studio-worker` existed. ffmpeg/ffprobe were installed; server Node was v20.19.6.
- `/api/health` returned 200, `/studio` returned 404. Inspected Studio source/worker paths were absent from the active release.
- Root disk: 38 GB total, 35 GB used, approximately 752 MB free, 98% utilization. Investigate capacity read-only first; do not delete logs/releases/data without a reviewed, authorized plan.
- Active application file/process configuration lacked `SUBSTO_APP_HOSTS`, both `SUBSTO_CLERK_*` keys, `CLERK_ENCRYPTION_KEY`, Studio Supabase URL/service credentials/database URL, Studio R2 access credentials, and Studio secret encryption key.
- Existing Estio keys remained configured. Production also set `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` and `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL`, which `lib/auth/clerk-runtime.ts` explicitly rejects for Substo activation. Resolve redirects per realm while preserving Estio behavior; do not blindly remove existing settings.
- Caddy's on-demand ask URL was `http://localhost:3001/api/verify-domain`. Existing domain-validation behavior and certificate bootstrap need review before activation. Avoid probes that deliberately trigger certificate issuance during a read-only audit.

### Supabase, R2, and Google

- No configured dedicated Studio Supabase target was available for live schema verification. **Live migrations are unverified, not proven absent.** Deployment does not apply them. `studio/supabase/README.md` lists 15 migration files; use the current list/order and verify target identity, grants, RPCs, and backup before any authorized application.
- Local `.env.prod` had dedicated R2 credentials and Studio secret-key configuration, but lacked Substo Clerk and Studio Supabase configuration. Local `.env.prod` is not proof of the server environment.
- R2 bucket is `studio-media`, with runtime name `STUDIO_R2_BUCKET_NAME`. A read-only `GetBucketCors` request returned AccessDenied/403. Browser CORS for both app origins remains unverified. Previous progress notes record a private bucket and incomplete-multipart lifecycle; verify current configuration with adequate read access.
- Existing Google client credentials were present. A complete optional `PLATFORM_GOOGLE_CLIENT_ID/SECRET` pair takes precedence; otherwise the complete existing `GOOGLE_CLIENT_ID/SECRET` pair is used. Never mix pairs or break Estio Business Google setup.
- Verify YouTube Data API enablement, consent configuration, required production status, and exact callbacks on the selected client: `https://estio.co/account/connections/google-youtube/callback` and `https://substo.com/account/connections/google-youtube/callback`. Optional `YOUTUBE_DATA_API_KEY` serves public data only; it cannot replace personal subscriptions consent.

## Recommended continuation sequence

1. **Local reliability slice:** reproduce lease-loss and paid-call/persist/crash uncertainty with synthetic injected dependencies. Implement lease fencing and durable usage/attempt recovery. Run focused tests and the PostgreSQL harness if SQL/RPCs change. Update the progress record with exact behavior, limitations, and checks.
2. **Independent production preflight:** inspect disk consumers and prerequisite configuration read-only; prepare a concrete capacity, secrets, certificate, migration, backup, and rollback plan. Do not make production mutations under a local reliability task.
3. **Hosted text AI:** implement customer-key provider adapters/jobs for idea review, script brief, and knowledge extraction, with access checks, bounded inputs/outputs, version-safe writes, provenance, metering, retries, and user-visible outcomes.
4. **Schedule execution:** add activation/due-run dispatch, concurrency/deduplication and execution history. Integrate the production schedule owner. Design personal-grant selection/revocation explicitly for unattended discovery; do not quietly move Google credentials into workspaces.
5. **Parity and lifecycle:** finish review statement/topic operations, content filters, upload recovery, and realm-specific account deletion cleanup, or document explicit approved deferments.
6. **Provisioning and import:** after separately authorized external changes, verify realms/hosts/TLS, configure secrets/CORS, apply dedicated migrations, perform pinned real metadata/media imports and reconcile counts, links, exact text, citations, history, and bytes. Use applicable deployment/data-repair skills and reviewed manifests.
7. **Release acceptance:** test both identities, same-email isolation, Estio location switching/team access, Substo invites/revocation, tenant websites, media isolation, OAuth removal/revocation, quotas/budgets/retries, restarts, and Mac-off processing. Establish worker readiness and real backup/restore/rollback. Run a milestone build, then a controlled authorized deployment.

Keep `SUBSTO_APP_HOSTS=substo.com` disabled until the relevant production gates pass. Do not treat a frontend build or local PostgreSQL pass as activation approval. Record each unresolved prerequisite precisely; request secrets through the available private secret-entry mechanism, never in chat or documentation.

## Verification already performed and efficient future checks

The audit reran this command with **77 passing tests, zero failures**:

```sh
npx tsx --test lib/auth/host-brand.test.ts lib/auth/clerk-runtime.test.ts lib/auth/host-routing-policy.test.ts lib/studio/access-policy.test.ts lib/studio/library-policy.test.ts lib/studio/content-policy.test.ts lib/studio/knowledge-policy.test.ts lib/studio/record-link.test.ts lib/studio/schedule-history.test.ts lib/studio/worker/runner.test.ts lib/studio/worker/transcribe-upload.test.ts lib/studio/media-r2.test.ts lib/studio/ai-settings.test.ts lib/google/youtube.test.ts
```

`bash scripts/test-studio-schema.sh` also passed all 14 disposable PostgreSQL assertion suites. Audit logs were in `/tmp/estio-studio-audit-tests.log` and `/tmp/estio-studio-audit-pg.log`; temporary files may disappear.

The audit did not repeat a full build or full-project TypeScript check. The preceding implementation milestone recorded a passing production Next build and zero diagnostics in 24 changed files. A previous full TypeScript run had 344 diagnostics outside changed Studio paths; this is not a clean whole-project typecheck.

Run nearest focused checks while building; run PostgreSQL after coherent SQL/RPC/security changes; run one full build at a meaningful implementation/release milestone. Serialize expensive checks. Do not rerun the entire historical matrix after every edit or run a build solely because this documentation handoff was created.

## Copy/paste prompt for the next task chat

```text
Continue the approved shared Estio–Substo Studio implementation in /Users/martingreen/Projects/Estio. First read current repository instructions and documentation/studio-audit-continuation-handoff.md, documentation/studio-agent-handoff.md, and documentation/studio-implementation-progress.md, then inspect the relevant actual code and untracked files. The progress record remains the status source. Use /Users/martingreen/Projects/Substo only as a read-only behavioral reference; preserve all unrelated dirty work.

The audit found that the first hosted release is incomplete and Studio is not deployed. Google OAuth belongs to each app user profile (realm + Clerk ID), whereas OpenAI keys/budgets belong to workspaces. Preserve Estio Business, its Clerk realm, existing Google integrations, tenant sites, and the separate Studio Supabase/private R2 boundary.

Plan the remaining work using the handoff, then implement the first cohesive local reliability slice: worker lease-loss fencing, transcription uncertain paid-call outcomes, and durable usage-reservation/attempt recovery. Reproduce the failure cases with focused tests before fixing them; do not claim exactly-once provider calls without provider support. Run the PostgreSQL harness when SQL/RPCs change, focused checks while building, and a full build at a meaningful milestone. Update the progress record and report completed behavior, validation, and next blockers.

This task authorizes local implementation and disposable local tests. Production disk cleanup, DNS/Clerk/Caddy changes, secret configuration, live database migrations/imports, hostname activation, and deployment require a separately authorized concrete plan. Do not enable SUBSTO_APP_HOSTS=substo.com or deploy during this slice. Continue useful local work without stopping for routine implementation choices.
```
