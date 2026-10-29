# Current release and work

Updated 2026-10-29. This is the task/status source of truth; [architecture and decisions](how-the-app-works.md) owns product rules. Historical checkpoints do not override this page.

## Release

Runtime `b1c8a5f061e77c1257adb1fb3e47f2c9552a6393`, build `5ycy5vOy9gkNegk5mnZ2z`, blue/3001, released 2026-10-29 around 07:02 UTC. Documentation is the following docs-only commit containing this page (use `git log -1 -- documentation/current-status.md` for its exact SHA). Both release branches and `studio-db-merge` are synchronized.

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

## Cleanup release verification

- Owned migrate-only workflow exited 0; no pending migrations. Dependency and worker readiness passed, due/expired/uncertain queue counts zero. Caddy switch and 20-second soak passed; no rollback. Web, Studio worker, scrape worker and viewing relay online with zero restarts; green retained for normal drain.
- Production health is OK; version matches `5ycy5vOy9gkNegk5mnZ2z`. Full production build passed with existing webpack/Browserslist/dependency warnings. No readiness bypass, checksum alteration or data purge.
- 23 focused routing/auth tests and 22 no-provider profile/usage-scope/workflow/fetch tests passed. Whole-project compiler completed with existing failures (620 output lines); no diagnostics name the changed route-context source/tests or tenant-context test. Initial default-heap attempt exhausted memory; enlarged retry during build was stopped, then final 8GB run completed. Build skips type validation, so no whole-project type-clean claim.
- Preview snapshots repeatedly timed out. A fresh Chrome fallback tab recovered and provided the final signed switching/404/mobile evidence above. Mobile viewport was reset afterward.
- Sustained Mac remains open: normal start may execute queued provider diagnostics and login commands. It was not started unattended under no-spend authorization. Real paid onboarding still requires the parent to obtain a concrete cost ceiling/model decision. No provider call, publish, email, invite or message was sent.
- Private local logs (not durable repository artifacts): `/tmp/studio-no-legacy-deploy.log`, `/tmp/studio-cleanup-tests.log`, `/tmp/studio-cleanup-no-provider.log`, `/tmp/studio-cleanup-final-types.log`. Historical restore evidence and R2 preservation were not re-run or re-inventoried in this cleanup.
