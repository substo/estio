# Studio merge: local readiness and next-round cutover

No production commands were executed in the local readiness round. The separately authorized production attempt below staged and copied the merge, but did not switch public traffic.
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
