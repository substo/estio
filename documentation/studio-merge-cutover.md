# Studio merge: local readiness and next-round cutover

Production cutover completed on 2026-10-28 at approximately 17:31 UTC. The first attempt failed closed; the explicitly authorized retry below is now live.
The original Studio project remains the fallback; both projects stay on Free. No R2
objects move: the 471 old keys keep their legacy prefix.

## Runtime inventory

- Middleware checks CRM database configuration; its route permissions are unchanged.
- Web library/content/knowledge/AI/profile access, job/upload reads, YouTube and
  schedule history/executions use StudioDb (CRM Prisma pool, `studio` schema).
- Hosted worker queue, transcription, text workflows and YouTube handlers use
  StudioDb. Atomic SQL functions, lease tokens and paid-attempt fences remain.
- Mac pairing, device management and authenticated companion operations use the
  same adapter. Companion HTTP is the app API, not a database REST transport.
- `/api/cron/studio-schedules` dispatches using StudioDb; `install-cron.sh` remains
  the scheduler owner. No new scheduler or infrastructure is introduced.
- Readiness snapshots use StudioDb. All database failures block readiness; there
  is no provider-restriction deployment bypass. Deploy requires the copy receipt
  before candidate web startup, worker replacement or traffic switch.
- No runtime `studioRest`, `requestStudioRest`, `queryPath`, `studio_workspaces`,
  `studio_workspace_memberships` or `STUDIO_SUPABASE_*` dependency remains.
- `rest-client.ts`, `import/apply-target.ts`, `recovery/config.ts`, recovery
  preflight and the five old operator import/apply/upload CLIs remain old-source
  recovery tooling only. They are not reachable from web, worker or cron. Do not
  use them to import into the merged target. The old workspace service was deleted.
- `rest.ts` only retains compatibility error exports for older UI handlers. It
  contains no transport/configuration. Provider backoff helpers remain for the
  retained recovery client; runtime database errors do not enter that mode.
- Test fixtures may translate SQL requests into old fixture labels; this is test
  code only. SQL boundary tests assert canonical Location values and UUID casts.

## Cutover commands (requires parent authorization in the deployment round)

Keep credentials in a private pg_service.conf and environment files, never shell
history or this repository. Define services `studio_merge_source` (old Studio)
and `studio_merge_target` (CRM), both direct PostgreSQL operator connections.
`PGSERVICEFILE` must point to that owner-only file. `DATABASE_URL` is the exact
CRM runtime URL from the target `.env`; the receipt binds to its hash.

1. Stop `estio-studio-worker` on Hetzner and drain any in-flight paid requests.
   Old web/cron/Mac endpoints will subsequently fail safely at the source freeze.
   Record uncertain paid attempts; do not automatically resend them.

   ```bash
   pm2 stop estio-studio-worker
   psql -X -v ON_ERROR_STOP=1 'service=studio_merge_source' -f scripts/studio-merge/freeze-source.sql
   ```

   The transaction acquires exclusive locks on all Studio/platform source tables,
   waits for earlier writers, then fences INSERT/UPDATE/DELETE/TRUNCATE. Reads
   remain available. It also fences stale tabs, cron calls, Macs and old CLIs.
   Freeze the target by moving any old receipt outside its configured path;
   retain it privately for diagnosis, never reuse it after a new copy.

2. Take fresh dumps of **both** projects outside Git after the freeze. Retain the
   already verified premerge dumps at `/Users/martingreen/Backups/estio-2026-10-28/`.
   Use unique timestamped names; do not overwrite the earlier evidence. Set `umask 077` and create the private `$backup_dir` before dumping.

   ```bash
   pg_dump --format=custom 'service=studio_merge_source' --file="$backup_dir/studio-frozen.dump"
   pg_dump --format=custom 'service=studio_merge_target' --file="$backup_dir/crm-frozen.dump"
   ```

3. From the reviewed checkout, deploy with the explicit staging wait. This uses
   the existing deploy workflow and Prisma `migrate deploy`; never db-push.

   ```bash
   DEPLOY_PREBUILT_BUILD_ID= STUDIO_MERGE_COPY_WAIT_SECONDS=1800 PRISMA_SCHEMA_SYNC_MODE=migrate-only bash deploy-local-build.sh
   ```

   Wait for `Studio copy gate waiting in ...`. No candidate web/worker starts at
   this point. In the second operator shell, use the printed target directory on
   Hetzner (blue or green), export its `.env`, and use a unique private evidence
   directory that does not exist yet. Its configured/default receipt path must
   be absent. The gate default is `/home/martin/.deploy-state/studio-merge-ready.json`.

   ```bash
   cd "$target_dir"
   set -a; . ./.env; set +a
   export STUDIO_MERGE_STATE_FILE=/home/martin/.deploy-state/studio-merge-ready.json
   export STUDIO_COPY_SOURCE_SERVICE=studio_merge_source STUDIO_COPY_TARGET_SERVICE=studio_merge_target
   python3 scripts/studio-merge/rehearse-copy.py "$evidence_dir" --operator-apply
   node_modules/.bin/tsx scripts/studio-merge/record-verification.ts "$evidence_dir/copy-verification.json"
   ```

   Operator mode requires distinct named services, explicit private service file,
   absent target receipt and enabled source freeze triggers. Copy refuses a
   nonempty target or unmapped source rows. One target transaction inserts all
   projections and validates 89 FKs; verification covers 53 table counts/digests
   and two Location mappings. Sequence advancement is retained. The recorder
   independently rechecks every target count/digest before atomically installing
   the receipt, bound to the exact DATABASE_URL and migration hash.

4. The waiting deploy now continues: candidate web health, dependency readiness,
   fresh matching worker report, then traffic switch. Verify both app Locations,
   Substo counts (10 records, 4 sources, 200 insights, 1,738 units), old media keys,
   and Mac reconnect. The old source remains frozen as fallback. Never unfreeze
   both databases for application writes simultaneously.

## Failure and rollback

Missing/invalid receipt, copy error, count/digest mismatch, dependency failure or
wait timeout leaves activation blocked. Keep both datasets, logs, dumps and the
Prisma migration ledger. No helper drops a schema or deletes migration history.
A committed copy without a receipt stays frozen; investigate and reverify it,
never empty the target to make a retry pass.

Before **any target writes**, restore old traffic/build, keep the target frozen,
then unfreeze the old source and restart its matching worker:

```bash
psql -X -v ON_ERROR_STOP=1 'service=studio_merge_source' -f scripts/studio-merge/unfreeze-source.sql
```

After target writes, first remove the receipt and stop/drain the candidate worker,
back up the CRM, and reconcile/export every post-cutover write. Do not switch
writes to the stale source until reconciliation is reviewed. Keep the Studio
schema and `_prisma_migrations` intact; validate the selected build against the
retained schema before reopening writes. There is deliberately no automatic
post-write rollback command that could silently abandon new data.

## Local evidence

The r4 real-data restore/copy is unchanged: `/tmp/studio-r4-complete-rehearsal.log`
and `/tmp/studio-merge-restore.R0wu5C/copy-verification.json` prove 53 tables,
89 FKs and two Location mappings. Migration/projection logic was not changed in
r5; the copy CLI only gained an explicitly gated operator connection mode.

The local freeze harness (`scripts/studio-merge/test-freeze.sh`) uses a disposable
Unix-socket-only database. It tests all four producers and DML/TRUNCATE, confirms
reads/data preservation and reversible unfreeze. Gate tests cover absent, invalid,
wrong-target and wrong-schema receipts, immediate re-freeze, and placement before
web/worker startup. Read-only verification tests reject partial inventories and
mismatched copied data. The 32 worker tests retain no-resend billing/lease checks.
Final compiler/build results are recorded in the progress log.

The final local build uses synthetic build-only configuration. The deployment command
explicitly clears `DEPLOY_PREBUILT_BUILD_ID` and rebuilds with actual `.env.prod`.
Legacy filenames/local variable labels such as `paid-workspace.ts` do not create a
workspace identity or authority; immutable imported legacy payloads retain original
keys for lossless provenance. Historical SQL and old-source recovery necessarily
retain their original workspace schema names.

## Authorized production attempt (2026-10-28; blocked before traffic switch)

- Reviewed/deployed source `222077198a58c8b2b251e30e1e990e13cb6d4f13`; both remote release branches were atomically advanced to it. All 82 existing migration checksums matched. No concurrent deployment was found. The server has no Git metadata, so the old exact source commit could not be independently established.
- Production-configured build **Ps5n63m_D1BbjBKFYejcG** passed. The synthetic readiness artifact was discarded. Exact command: `DEPLOY_PREBUILT_BUILD_ID= STUDIO_MERGE_COPY_WAIT_SECONDS=1800 PRISMA_SCHEMA_SYNC_MODE=migrate-only bash deploy-local-build.sh`.
- Source worker stopped; all **56** Studio/platform tables fenced at 13:30 UTC. Five jobs succeeded; both paid-attempt tables were empty. Fresh source/CRM dumps, full archive decoding and SHA256SUMS: `/Users/martingreen/Backups/estio-2026-10-28/frozen-20261028T1332/`. Earlier premerge backups retained.
- Initial CRM size 202,984,595 bytes; after schema/copy 209,259,667 bytes, below the 500 MB free limit. No subscriptions or paid jobs were started; no R2 keys moved.
- Migration `20261028100000_studio_schema` applied through owned migrate-only deployment. Gate waited before candidate activation. Because Hetzner lacks psql, the identical operator copy script ran locally with private named services, after confirming the actual server receipt was absent.
- Copy evidence: `/Users/martingreen/Backups/estio-2026-10-28/copy-20261028T1344/copy-verification.json`: **53** counts/digests matched, **89** FKs validated, **2** Location mappings. Includes 10 records, 4 sources, 200 insights, 1,738 units, 471 media objects and 471 knowledge media links. Independent server target re-verification passed; receipt installed at `/home/martin/.deploy-state/studio-merge-ready.json`. Server evidence: `/root/studio-merge-evidence-20261028T1347/`.
- Candidate blue health passed, but dependency readiness failed `database_schema`: the migrated snapshot returns **29**, while TypeScript required **27**. All other dependency checks passed. The deployment exited **1** before worker replacement, symlink change or Caddy switch. Fix prepared locally: require version 29, with a regression test reading the real migration function; **9/9** readiness tests pass. Never edit the already-applied migration checksum to fix this.
- Actual retained state: public green build **rZ2ij9xCjCSbQpfgt-yKF** health/version OK; blue candidate is online on 3001; old Studio worker stopped; old source remains frozen; target copy, migration ledger, receipt and backups retained. Target receipt is installed, so target is no longer fenced by that gate. No rollback, receipt removal, worker restart, source unfreeze or deployment retry was attempted after failure. Review target post-copy writes before any rollback; never reopen both sources.
- Logs and preflight manifest (private): `/Users/martingreen/Backups/estio-2026-10-28/cutover-preflight/`. Deploy skill requires separate authorization before retry/recovery following script failure. Next authorized attempt must rebuild the fixed source with production configuration and preserve the committed copy; **do not rerun the copy or empty the target**.
- Browser: Estio redirects to sign-in. Substo signed-in overview verified using T3 evaluation; snapshots timed out twice and computer-use fallback had no browser. Fresh pre-cutover Substo library five-fetch header timings: 2690,1754,1669,1591,1558 ms (median 1669); product-switch POST following redirect: 2547,2426,2633,2328,2236 ms (median 2426). No post-cutover comparison exists. Mac reconnect and live media smoke remain unverified.
- Stage 3 removal of `Location.studioWorkspaceId`, final live UI/worker/Mac verification and post-cutover timing remain pending. Runtime REST/provider-degraded-mode removal was already included. Keep both projects Free; paid contingency thresholds in the merge plan remain informational, not upgrade authorization.

## Completed authorized retry (2026-10-28, 17:31 UTC)

- User explicitly authorized retries until finished within this cutover scope. Source **853d6de0d1079fd53634ca66377d114f602a9b70** on `studio-db-merge`, clean tree, production-configured build **_BvLHCZSx3pI5UYHm5b1o**. Exact command above exited **0**. Test-only fixture correction recognizes the receipt probe and asserts provider restrictions block activation; **15/15** focused readiness/deploy tests passed. Earlier 99-test/identity/compiler/rehearsal evidence remains applicable; no unrelated full typecheck repeated.
- Preflight: both remote release heads were c8da6367; no concurrent deployment; all **83** applied migration checksums matched. Source freeze confirmed **56** enabled triggers before and after retry. Caddy/.env.prod/dependencies present. Build recovered from transient TLS retries without changing checks.
- Owned deployment reused the existing valid receipt, **without recopy, truncation, source unfreeze or migration ledger changes**. Prisma reported no pending migrations. Applied merge migration remains `20261028100000_studio_schema`; readiness schema version **29**. Backup helper found a clean working tree; it is not a new database backup. Fully decoded/checksummed frozen dumps remain in `frozen-20261028T1332/` above, unchanged.
- Public `https://estio.co/api/health` OK; `/api/version` exact build match. Symlink/Caddy now BLUE:3001. Fresh matching Studio worker passed readiness before switch and again afterward; dependency checks all pass; queue due/expired leases/uncertain attempts all **0**. Twenty-second public soak passed, **no rollback**. PM2 web/Studio/scrape/viewing all online, zero restarts. Old green remains for the owned 900-second drain; never manually reopen source writes.
- Post-cutover read-only counts: **10 records, 4 sources, 200 insights, 1,738 units, 471 media and 471 links**; all **471** object keys still start with retained legacy prefixes. CRM size **209,259,667 bytes**. Prior independent **53 count/digest, 89 FK, 2 mapping** verification and receipt retained. Target is live/writable: any rollback now requires preserving/reconciling post-copy writes, including worker heartbeats; do not re-copy or return writes to stale source.
- Signed-in Substo browser reads passed library/content/knowledge/jobs; hosted worker shown Online. CRM POST-follow switch returned `/admin` 200, reverse switch `/studio` 200. Authenticated legacy knowledge evidence image loaded **854×480** through the merged media route. No paid jobs, invites, R2 moves, subscriptions or upgrades initiated. Both projects remain Free.
- Matching five-fetch header timing method (`performance.now()` until fetch resolves, consume body before next request): library **1140,1018,1036,978,997 ms**, median **1018 ms** vs latest pre-cutover **1669 ms** (~39% faster). CRM product-switch POST-follow **1757,1967,1609,1638,1591 ms**, median **1638 ms** vs **2426 ms** (~32% faster). All 200. An earlier combined measurement exceeded the browser's 15-second evaluate limit; these completed independent measurements are the reported evidence.
- Acceptance limitations: Estio redirects to sign-in in the available browser profile. Substo connected-computer page returns 200, retains pairing/setup, but Martin Mac is **Offline**, last seen October 26; no live reconnect/CLI acceptance claimed. No paid check was run.
- **Stage 3 compatibility decision:** retain nullable unique `Location.studioWorkspaceId` during the fallback window. No runtime consumer remains; `scripts/studio-merge/rehearse-copy.py` still reads it for old-source mapping. Verified backups/copy evidence capture that mapping. Dropping it would reduce recovery compatibility without improving live behavior. Removal is deferred to its own migration after the fallback window and recovery-tool adaptation; it is explicitly **not removed** in this cutover. Runtime REST/mirror/provider-degraded mode removal is live.
- Private retry log: `/Users/martingreen/Backups/estio-2026-10-28/cutover-preflight/retry-deploy.log`; focused tests `/tmp/studio-retry-tests.log`. Existing frozen/copy/server evidence paths above remain authoritative.

## Bounded postmerge audit (2026-10-28, 18:01–18:10 UTC)

- Recovery checkout and both remote release heads matched `06c914b8`; clean before
  edits. Public build remains `_BvLHCZSx3pI5UYHm5b1o`, health OK. No active deploy
  found; four required PM2 apps online with zero restarts. Read-only server
  dependency readiness passed every check; due/expired/uncertain jobs all zero.
- Reviewed request access and SQL authority view: active Location + app realm +
  canonical UserLocationRole remain the authority; runtime/worker/cron paths
  inspected have no old REST credential dependency. Disposable PostgreSQL 17
  schema/SQL/concurrency suites and 4 database-adapter tests passed. Initial run
  used default PostgreSQL 14 and rejected PostgreSQL 17's MAINTAIN privilege;
  rerunning with the already installed PG17 tools passed without changing SQL.
- Recovery omission corrected: Location archives now explicitly declare Studio
  excluded. Added read-only full-database backup helper, archive schema/decode/
  checksum checks and operator recovery documentation. No recurring schedule or
  production dump run; no restore drill claimed. Helper failure/overwrite tests
  and 22 focused policy/access/gate/backoff/readiness tests passed. No full app
  build: edits concern operator tooling, archive metadata and docs only. No
  deployment/restart needed for this operator-only correction.
- T3 browser: Estio still redirects to sign-in. Signed Substo connected-computer
  page loaded; Martin Mac remains Offline, last seen Oct 26 21:56. Snapshot timed
  out; read-only page evaluation confirmed status. No pairing reset, CLI/provider
  call, paid check, invite or send performed. User-assisted acceptance: sign in
  to Estio and verify its Studio Location isolation/core pages; start the existing
  paired companion on Martin Mac, then verify reconnect and no-cost diagnostic.
- Existing frozen source, compatibility mapping, dumps and copy evidence unchanged.

Next Studio slices, in order: (1) close those acceptance checks and perform a
private disposable restore drill using the unified recovery procedure; agree backup
cadence/retention, (2) implement onboarding plan's shared hardened public-page fetch
helper before chat/UI work, (3) Location profile schema/service with admin and
cross-realm tests, then the planned guided onboarding, (4) page-by-page parity
check of Library/Content/Knowledge/Discovery/Schedules including empty/error and
member states, (5) shared usage/header accuracy across CRM + Studio, using existing
ledgers and SQL aggregation. These product slices are deferred, not cutover blockers.
