# Current release and work

Updated 2026-11-05. This is the task/status source of truth; [architecture and decisions](how-the-app-works.md) owns product rules. Historical checkpoints do not override this page.

## Release

Combined Library + business-data phase 6 deployed 2026-11-05 at 16:37 UTC from source `9fd35f7c606c4e7b08d0ddd8711f0e80f10c4cef` on canonical `release/studio-go-live`, checkout `/tmp/estio-combined-release-20261105`. Live build `-aZklYFFXKdbz9FJou0VU`, blue/3001. The server manifest `/home/martin/.deploy-state/current-release.json` atomically records that revision, build, fingerprint `a66eef93474082eeb45f14992a086df3ec327a243ef9422d38a5f66a2367c62e`, timestamp and previous verified revision `04b24cdf89513359ccee1019faa8292eb99e6423`. Owned migrate-only workflow exited 0; Caddy validation, 20-second soak, public health/version and Cloudflare response passed. Web, Studio worker, scrape worker and viewing relay were online with zero restarts at completion and follow-up. Green retained for normal drain. No rollback.

The release contains latest business commit `4ac778e2` and the entire Library branch through `da138858`, including browse-first source `7593c2e0`. It restores LibraryBrowse/AddDialog while preserving business-profile/location-config readers and all migrations. Phase 6b's retirement migration had failed at a missing SQL alias. The exact known failed UUID/checksum was verified against two fully copied legacy settings rows and zero legacy keys, privately exported with schema/ledger, marked rolled back once under the server lease, then the corrected transactional migration applied normally. Production now has neither `SearchConfig` nor `studio_location_ai_credentials`; unresolved failed migrations count is zero. No other repair, reset, provider spend or account command ran.

Verification: 65 focused feature tests; 14 candidate/fingerprint/source-contract tests; 11 server lease/manifest tests; two Build merge tests; focused strict TypeScript; disposable combined SQL assertions; production build. Tests reject stale/divergent candidates, dirty/untracked inputs, moved canonical/live identities, concurrent holders and lost leases. A real lost-holder rollback test refuses the next holder until operations drain. Real server guarded SSH/rsync dry-run passed; concurrent lease and old raw SSH commands were refused. Old Library and shared-root checkouts were also refused by the canonical check. The runtime-drift hotfix skip is removed; actual slot/build/Caddy must match the manifest. Global build type validation is still skipped; no whole-project type-clean claim. Existing build/dependency warnings remain.

Signed-in live acceptance: Substo populated Library restored with cards at 216px in 1280×639 and 243px in 390×844; no inline form or horizontal overflow. Modal keyboard opening, input focus, Tab/Shift+Tab containment, Escape/focus return and mobile fit passed. Estio mobile empty view stays closed until its action, opens with input focus and has document width 390. Estio website settings and both apps' business profile screens render after retirement. Browser viewport reset. No real import/save/provider/relay call was submitted; relay startup/health is verified, not a real viewing session. Companion execution and connected OAuth remain unverified.

### Canonical checkout and preserved work

Root `/Users/martingreen/Projects/Estio` is now `work/shared-root-20261105`, fast-forwarded to the same integrated history. Its 40 duplicate Library paths were verified against the original hashes, backed up and reconciled; only the original dirty SIMRelay submodule remains. No unexpected original-file changes outside the approved integrated paths were found. The root is not a deploy entrypoint. `release/studio-go-live` is checked out only in the dedicated clean canonical checkout, equal to origin after evidence commits; Build's existing merge target remains that branch. No future root-owner integration remains pending. Historical sibling checkouts are preserved as evidence but cannot deploy through the supported protocol.

[Enforced release workflow](release-workflow.md) and project skill/AGENTS own the lasting rules; the existing Build product memory has a pinned release decision. Private evidence: `/tmp/estio-combined-evidence`; successful log `/tmp/estio-combined-deploy-attempt2.log`. Attempt 1 was deliberately stopped before upload/schema mutation after detecting the production-omitted Prisma binary assumption; the pinned CLI correction was reviewed/tested/committed before attempt 2. Its stopped log is preserved. The deployment key's server forced-command gate rejects older raw scripts; other administrator keys/root authority remain an explicit administrative boundary.

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
