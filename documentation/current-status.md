# Current release and work

Updated 2026-11-03. This is the task/status source of truth; [architecture and decisions](how-the-app-works.md) owns product rules. Historical checkpoints do not override this page.

## Release

Build `zSXjwCjdSkQWjl0bMBVP0`, blue/3001, deployed 2026-11-03 around 15:10 UTC through the owned migrate-only workflow. Source is base `6be4c78af9f08c1bd7d3a86dce7d35215d000623` plus the uncommitted Build changes; no commit or push was made. Build-input fingerprint: `a1fbf89d4d27717722440e6a4d8e80351abe7f16085c8b84944f5dbf910acc4c`. The isolated release checkout `/tmp/estio-build-release-20261103` excluded unrelated SIMRelay edits. The main release branch still points to the base; preserve its deployed working changes until committed/reconciled. October acceptance below is historical and does not prove current signed-in acceptance.

## Local pending release: Studio Library (2026-11-05)

Library cards/import enrichment and account-scoped, capacity-aware subscription summaries are implemented locally; see [behavior, prerequisites and acceptance limits](studio-library.md). Parent combined suite rerun on final source: 134/134 tests passed (`/tmp/studio-library-final-tests.log`); Final SQL rerun exited 0 (`/tmp/studio-library-final-sql.log`). Production build passed before final small fixes. The final production build rerun passed with exit 0 after generating 133 pages (`/tmp/studio-library-final-build.log`). Strict focused TypeScript checking of new core presentation, import metadata, summary routing, Build tracking and usage modules exited 0 (`/tmp/studio-library-focused-types.log`). The whole-project compiler was manually stopped after more than ten minutes without a result (`/tmp/studio-library-types.log`); no whole-project type-clean or deployed claim.

Live local subscription smoke passed (`/tmp/studio-library-live-subscription.log`): real capacity reading selected Codex, ChatGPT subscription authentication succeeded, and the native default returned a valid summary of a public synthetic description without API fallback. Full production paired-device end-to-end remains unverified because migration/deployment have not occurred; live connected YouTube OAuth and responsive signed-in checks also remain unverified. A desktop fixture rendered. Subscription use requires the normal-release SQL migration, the account's paired running Node companion with text-processing opt-in, subscription sign-in and QuotaCell helper. No native Swift connector is implemented. Build tracks the existing T3 thread as `external-t3:73b15758-ef2d-45c2-9055-69d72ce849f6`; parent supplies final review evidence. Owner explicitly authorized isolated Library release and migrate-only deployment on 2026-11-05. This local scope does not supersede ongoing business/settings cleanup or its release status.

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
