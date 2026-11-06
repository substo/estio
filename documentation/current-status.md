# Current release and work

Updated 2026-11-06. This is the task/status source of truth; [architecture and decisions](how-the-app-works.md) owns product rules. Historical checkpoints do not override this page.

## Release

Library source/channel slice and public-origin import fix deployed 2026-11-06 from source `b7f5b6ccbc1c18ede5bd61580648da5a92c96ea7`, canonical `release/studio-go-live`, checkout `/tmp/estio-combined-release-20261105`. Live build `JdPUNcImpHWUj3bSyrix0`, blue/3001. Server manifest records fingerprint `a4826b32ec55bb650ca7c54987a905004b4cd043278dadb6922c9661dd636197` and previous serving revision `e317d7ce6fdf3a3c6bc94874d661337c1f3461d0`. The canonical merge retains the newer credentials, business-onboarding, Mac research and Build-story work; it adds task `e3563b75` and scoped origin fix `b80fe410`. No schema changes. Owned migrate-only workflow exited 0 with no pending migrations, Caddy validation/20-second soak passed, health/version match, required PM2 services online with zero restarts, no rollback. Green retained for normal drain.

Source details separate original description, saved transcript, AI summary/basis and human notes; editing is disclosed. Validated creator URLs/channel IDs survive import; watching uses existing channel records and transaction-owned links, with reverse source reads. This does not subscribe on YouTube or start monitoring. Automatic captions are not implemented; latest videos remain on existing Discovery. See [Library](studio-library.md) and [reuse audit](studio-library-reuse.md).

The user-reported import error was reproduced on both public hosts before release. The route now reuses the shared proxy-aware origin policy, requires a serialized HTTP(S) Origin, rejects cross-site requests and retains tenant/account checks. Live non-mutating POSTs on both domains now pass valid public Origins to the missing-tenant guard (409), while missing/cross-site/unrelated Origins receive the verification error (403). Exact reported long/short video URLs normalize to `KD71g4TK6Sg` in regression tests. These are not authenticated successful-import claims.

Verification: 54 focused tests, strict changed-module TypeScript, diff validation and owned production build passed. Real disposable PostgreSQL acceptance executes the actual import transaction/link SQL with only auth/network/summary execution stubbed: atomic channel/link save, reverse relation reads, channel-ID alias dedupe/retry, preserved human evidence, stale-version rollback, cross-tenant and revoked-membership rejection. Global build type validation remains skipped; no whole-project type-clean claim. Existing build/dependency warnings remain.

Signed-in acceptance: Substo existing source detail renders evidence/missing-evidence states, original-source destination, refresh action and keyboard Edit disclosure. Desktop 1440×844 and mobile 390×844 have document width equal to viewport. Existing channel detail renders its original channel link and explicit no-subscription/no-monitoring wording. Estio's signed-in empty Library renders. Viewport reset. Inspected legacy sources lack creator metadata, so production Watch action/link creation and populated reverse lists were not fabricated; those pass fixtures/disposable SQL and await a real user import/refresh. No production test import/save/summary action, paid test generation, pairing change or schedule activation was submitted. Companion/OAuth end-to-end acceptance remains unverified.

The first immutable build completed locally but its deployment shell was held before staging when the origin regression was reported, then ended with 143 without upload/schema/cutover. Its output is preserved. The corrected candidate received a fresh guarded build/deployment; no stale artifact, lock bypass or manual switch was used. Private evidence: `/tmp/library-source-channels-release-evidence`; successful log `/tmp/library-source-channels-origin-fixed-deploy.log`. The existing Library Build record/story is updated in place with release evidence; immutable spec and prior external history are preserved.

### Integration and preserved work

Canonical release remains the only deployment entrypoint. The shared working branch may fast-forward only when clean apart from its original SIMRelay change; preserve any concurrent edits. The task branch remains committed evidence, not a deployment source. Final integration proof accompanies this release. [Enforced workflow](release-workflow.md) and project AGENTS/skill remain authoritative. Existing deployment-key lease, identity, source and manifest guards remain enabled.

## Done

- One database: CRM public schema and Studio schema, canonical Location foreign keys, shared roles and realm authority. Runtime has no workspace/membership mirror dependency.
- Shared usage totals and fixed-script onboarding live. Totals are recorded application usage, not provider invoice reconciliation; missing historical usage is not guessed.
- Unified restore drill: 184 table inventories/digests, 83 migrations at snapshot time, zero invalid FKs, 471 media references. This predates the later tested profile migration; it is not a fresh restore of today's production.
- Removed workspace URL redirect/path helper and retired tenant-selection handler. Clean paths use active Location; old paths have no compatibility promise. Existing tenant-switch authorization and stale-command fences remain.

## Preserved recovery and data

`Location.studioWorkspaceId` is recovery metadata only (source-copy rehearsal still reads it), not runtime identity. Keep it until a separate backed-up, disposable-rehearsed migration preserves its map. Old source names/IDs in frozen SQL, import/recovery tools, receipt/checksums and immutable R2 media prefixes are intentional historical evidence. No content, records, media, backups, migration ledger or source project is deleted. All 471 old R2 keys remain unchanged. See [cutover](studio-merge-cutover.md) and [backup/restore](unified-database-recovery.md).

## Next three tasks / acceptance

1. **Done: final-build signed acceptance.** Actual CRM ↔ Studio clicks passed both directions on Estio and Substo. Library, Content, Knowledge, Discovery, Schedules and Onboarding rendered signed in on both domains; all twelve measured 390px document width at 390px viewport. Both retired workspace URLs showed 404; retired preference POST returned 404. Next: preserve this no-provider acceptance matrix for the next runtime release.
2. **Open, requires device:** sustained existing Mac companion diagnostics/local processing. A prior no-provider once-mode job succeeded and exited cleanly; that does not prove sustained processing. Use existing pairing only.
3. **Blocked on bounded spend authorization:** real onboarding draft/review/save using a specified model and concrete cost ceiling. Mock/disposable access, persistence and ledger checks passed; no real provider run is authorized. Ask the parent for that decision before paid acceptance.

Website editing/publishing and Clerk email delivery have no new live acceptance in this cleanup. Do not publish, invite or send messages merely to test. Substo CRM setup-pending is intentionally deferred. Free-form onboarding/search, more social integrations, billing, custom domains and proxy work are deferred.

## Verify and release

- Focused routes/auth: `npx tsx --test lib/studio/route-context.test.ts lib/auth/tenant-context.test.ts lib/auth/host-routing-policy.test.ts`
- No-provider onboarding/usage/fetch checks: use existing suites in `lib/studio`, `lib/ai` and `lib/web`; never infer a real paid pass from mocks.
- Compiler: `npx tsc --noEmit` (known whole-project baseline failures; report affected-file diagnostics separately). Next build skips type validation.
- Production build/deploy: `PRISMA_SCHEMA_SYNC_MODE=migrate-only ./deploy-local-build.sh` with actual `.env.prod` and Caddyfile. The owned workflow builds, backs up, verifies dependencies/schema/readiness, switches Caddy, soaks and checks services. No Vercel; do not bypass gates or edit checksums.
- Public release checks: `curl -fsS https://estio.co/api/health` and `/api/version`; Substo health is host-policy 404, not a failed database check.

[Deployment skill](../.agents/skills/deploy-estio/SKILL.md), [cutover evidence](studio-merge-cutover.md), [recovery runbook](unified-database-recovery.md), [onboarding design (historical v1 plan)](onboarding-chat-plan.md), [archived checkpoints](studio-implementation-history-2026-10-29.md).

## Cleanup release verification (2026-10-29 evidence)

- Owned migrate-only workflow exited 0; no pending migrations. Dependency and worker readiness passed, due/expired/uncertain queue counts zero. Caddy switch and 20-second soak passed; no rollback. Web, Studio worker, scrape worker and viewing relay online with zero restarts; green retained for normal drain.
- Production health is OK; version matches `5ycy5vOy9gkNegk5mnZ2z`. Full production build passed with existing webpack/Browserslist/dependency warnings. No readiness bypass, checksum alteration or data purge.
- 23 focused routing/auth tests and 22 no-provider profile/usage-scope/workflow/fetch tests passed. Whole-project compiler completed with existing failures (620 output lines); no diagnostics name the changed route-context source/tests or tenant-context test. Initial default-heap attempt exhausted memory; enlarged retry during build was stopped, then final 8GB run completed. Build skips type validation, so no whole-project type-clean claim.
- Preview snapshots repeatedly timed out. A fresh Chrome fallback tab recovered and provided the final signed switching/404/mobile evidence above. Mobile viewport was reset afterward.
- Sustained Mac remains open: normal start may execute queued provider diagnostics and login commands. It was not started unattended under no-spend authorization. Real paid onboarding still requires the parent to obtain a concrete cost ceiling/model decision. No provider call, publish, email, invite or message was sent.
- Private local logs (not durable repository artifacts): `/tmp/studio-no-legacy-deploy.log`, `/tmp/studio-cleanup-tests.log`, `/tmp/studio-cleanup-no-provider.log`, `/tmp/studio-cleanup-final-types.log`. Historical restore evidence and R2 preservation were not re-run or re-inventoried in this cleanup.

## Build workspace release (2026-11-03)

- Private `/admin/platform/build`, linked from Platform, uses existing Estio PLATFORM_ADMIN authority; no Location-admin or impersonation access. Source/product map, curated feature relationships, scoped proposal decisions, profile policy and leased queue state persist in four additive Build tables.
- Mac outbound scanner imports tracked source/static import links, preserves approved intent, reconciles removals and invalidates old/new reverse consumers conservatively. Parent disposable PostgreSQL acceptance: 1,518 nodes, 4,974 edges, unchanged rescan zero changes; persistence/pause/concurrent single-claim/duplicate-completion smoke passed. Initial imports are now batched.
- Nine focused auth/routing/lease/CLI/delivery tests pass; targeted strict Build compilation passes. Whole-project typecheck retains baseline failures; targeted compiler/build results and final acceptance are handed to the parent for integration. Real subscription execution and signed-in mobile acceptance remain unverified; deployment evidence follows.
- Atlas intake did not register this assignment because saved checkout identity is stale. No Atlas queue owner was changed. An opt-in daily read-only review grant uses the same Mac claim loop; default off, one stale page per UTC day, no trigger while asleep. It is not activated. See [setup and manual acceptance](build-workspace.md); approved long design remains rationale.

- Final runtime wiring includes isolated persistent delivery worktrees, confirmed process-stop/fallback gates and bounded mapped dependency context. Real provider execution and signed-in mobile acceptance remain unverified.
- 2026-11-03 later: executor switched to visible T3 Code threads on `build/…` branch worktrees (dispatch via local `t3` CLI, no model turn); independent second review removed by owner decision (low-token mode). Fence adopts the T3 worktree. Deployed to green the same day via the owned migrate-only workflow (no pending migrations, soak passed, no rollback; blue drains after 15 min). Model approval became a T3-catalog picker (Not allowed / Routine / Hard, no typing) with difficulty-based routing restricted to approved models. Local real Haiku smoke passed; see [Build workspace](build-workspace.md#t3-bridge-acceptance-2026-11-03).
- Separate disposable daily/context smoke passed one/day admission, mapped dependency/rule context, grant-disable stop and re-enable deduplication with no provider calls.
- Final frozen-source `npm run build` passed (exit 0), including `/admin/platform/build`, `/api/build` and `/api/build/worker`; server bundle contains final cursor and reviewer-capacity handling. Build retains existing dependency/Browserslist warnings and skips global type validation. Targeted strict Build compiler exited 0; nine focused tests and `git diff --check` pass. Full-project baseline errors remain. Local logs: `/tmp/estio-build-build.log`, `/tmp/estio-build-targeted-types.log`, `/tmp/estio-build-tests.log`.

- Production: owned workflow exited 0; migration `20261103120000_build_workspace` applied, all 85 migrations current. Blue/3001 Caddy switch and 20-second soak passed; no rollback. Public health OK and version matches the build above. Web, Studio, scrape and viewing relay services online with zero restarts; green retained for 900-second drain. Existing dependency/compiler warnings remain.
- Build operator API rejects unsigned requests (403), and worker API rejects missing token (403). Authenticated Mac poll passed while paused. Production registry imported 1,518 source records / 4,974 links without a model call. `co.estio.build-worker` LaunchAgent is running at login on the Mac; queue paused, profiles empty, daily grant off. No real task or model acceptance run was started.
- Private deployment log: `/tmp/estio-build-deploy-20261103-interactive.log`. The first local attempt stopped at an optional Git prompt before server contact; the approved interactive run declined optional commit/push and completed.
