# One canonical release

## Local worktree closeout

Register task worktrees at creation or at the first implementation handoff. Supply the exact path listed by Git. T3 workers can use the current thread binding to identify the path and branch, then register with the real thread ID. Use Python 3.11 or newer for closeout.

```bash
python3 scripts/worktree_closeout.py register "$WORKTREE" --session "$T3_THREAD_ID" --t3
```

For a non-T3 checkout, pass the documented owning session or operator in `--session` and omit `--t3`. The record lives in the common Git directory under `estio-worktree-closeout/` and stores the session, branch and checkout identity across handoffs. Registration grants no cleanup permission.

### Routine compiler-cache cleanup

The agent infers whether a registered task is finished from Git, the recorded T3 thread and current process use. A completed T3 thread that still points to its checkout can qualify. An active, queued, waiting, missing or mismatched thread defers. Automatic cleanup requires a positively verified T3 registration because the installed CLI cannot provide a complete checkout ownership index. Register historical candidates only when their actual thread confirms the exact branch and path.

```bash
python3 scripts/worktree_closeout.py cache
python3 scripts/worktree_closeout.py cache --apply --target-free-bytes 37580963840
```

Run from another checkout of this repository. The first command is a read-only plan. Both commands accept a single exact task worktree path for a targeted check. Apply sorts verified caches by allocated size and stops at the free-space target when selecting multiple worktrees. Each removal freshly rechecks the pushed canonical tip, worktree identity, Git status, T3 thread, process use and cache layout. It clears only the recognized ignored production compiler cache at `.next/cache`, which is excluded from the release upload. Build output, the build ID, provenance, dependencies, and checkout survive. Unrecognized layouts, symlinks, mounts, active builds or servers, open files and protected checkouts defer. The configured companion checkout is protected even when idle. The Git registry's `cache-audit/` contains durable records of applied attempts with exact paths, revisions and before/after free bytes. Routine cache cleanup has standing approval.

Run `python3 scripts/deploy-local-space.py` from the build checkout for a read-only inventory. Use `--reclaim-cache` to apply verified cache cleanup before a standalone prebuild. The owned deploy does the same before acquiring the production lease. The default threshold is 32,884,901,888 bytes (20 decimal GB plus 12 GiB). Set `--min-free-bytes` on a standalone preflight if the applied companion floor or measured headroom calls for a higher target. Verify remaining space under the companion continuity checks below.

### Checkout retirement and full build artifacts

After pushing verified integration, record **retire** for a completed task or **keep** when the checkout will continue. Review the whole checkout for credentials, local files, build artifacts and release evidence. Keep any ambiguous preserved work pending a human decision. Keep the checkout if it holds local files or shared dependency links that should survive. Preview and apply from another checkout.

```bash
python3 scripts/worktree_closeout.py decide "$WORKTREE" --evidence "$REVIEW"
python3 scripts/worktree_closeout.py closeout "$WORKTREE"
python3 scripts/worktree_closeout.py closeout "$WORKTREE" --apply --owner-verified
```

For this separate operation, use `--clear-next` only after confirming the entire `.next` is regenerable and preserving required evidence and any needed prebuilt artifact elsewhere. Record the evidence location. Add `--keep` to retain the checkout while clearing a reviewed full build. `--owner-verified` records that the operator has checked current use and preserved work. It is required for this operation, including for manual checkouts. A retained T3 binding blocks checkout retirement. An active, waiting or unverifiable T3 state blocks full build clearance as well. Retirement also defers if other ignored files remain. The script uses `git worktree remove` without force, leaves the branch intact, and reports measured free bytes. Use `git worktree prune --dry-run --verbose` to inspect metadata for missing directories as a separate task. Keep the canonical prebuilt artifact available for exact reuse.

## Page consolidation

For route or menu consolidation, inventory affected pages and controls from both parents before merging. Record old and new routes, entry points, realm and role access, and action or callback dependencies. Verify intended moves, replacements and retirements against the final candidate in the relevant access states. Use the [settings consolidation audit](settings-consolidation-audit.md) as an example.

## Release procedure

Tasks run in their own worktrees. Merge reviewed work into `release/studio-go-live` using Build's existing merge flow or a reviewed Git merge; preserve both parents' behavior and migrations. This is the only deployable branch, and its candidate must equal the freshly fetched remote tip. The canonical clean checkout is `/tmp/estio-combined-release-20261105`; the shared root is a working checkout on `work/shared-root-20261105`, retaining SIMRelay. Never deploy a task branch or copy a sibling tree over production.

Run focused checks and commit/push all release inputs, then run `PRISMA_SCHEMA_SYNC_MODE=migrate-only ./deploy-local-build.sh` from the canonical checkout. The owned script builds once. No detached/background deploy or manual Caddy/PM2 cutover. Production authorization must cover the concrete release; existing explicit authorization persists. Do not interpret a test/build request as deployment approval.

The script rejects tracked modifications (except explicitly excluded SIMRelay), untracked/ignored uploaded inputs, missing identity, a candidate behind/divergent from canonical or production, and any changed source/environment fingerprint. Fetch/ancestry checks repeat before slot deletion, schema mutation and cutover; a live observer aborts if canonical HEAD moves. Existing prebuilt reuse requires exact build ID and input fingerprint.

For a server disk-space failure, follow [server disk maintenance](server_maintenance.md) before retrying. The deploy checks available space again before replacing the inactive slot.

A persistent SSH holder owns the server's `flock` before backup/upload/slot deletion/schema changes. Every remote operation, including rsync, checks that token and is supervised; losing the SSH holder terminates its process group. A drain lock prevents a successor racing rollback. Heartbeats expire; lock files are never deleted to break ownership. A hung holder is diagnosed, not blindly removed. The cutover trap restores previous Caddy/symlink/Studio worker when interrupted before a successful soak/publication.

`/home/martin/.deploy-state/current-release.json` is the authoritative committed revision, build ID, source/environment fingerprint, slot, timestamp and previous identity. Only the exact serving artifact is atomically published after successful soak. Failed pre-cutover attempts and rollbacks leave the prior manifest current. A failure in optional services after successful publication still reports the actual serving release; diagnose it without pretending traffic rolled back.

The existing deployment SSH key is constrained by a server-owned forced-command gate to this lease protocol. Old scripts that send raw shell/rsync commands are rejected before server mutation. Other administrator keys and unrestricted root access remain an emergency administrative boundary; this prevents accidental old-tool deployments, not a malicious root administrator. Guard upgrades need a reviewed server install; a mismatched installed checksum fails closed, with no automatic bootstrap/bypass.

First adoption was explicit: live `6bDK2VVGQKdaTL7pnYc2r`, green, was verified against commit `04b24cdf` (2,262 deployed source files compared with zero mismatches) and its stored fingerprint. The bootstrap command refuses an existing identity and checks observed slot/build/Caddy. No future deployment can silently infer a revision from a branch or adopt an unidentified live tree.

The failed phase-6 migration is a separate one-time recovery: exact failed UUID/checksum, zero applied steps, expected SQL alias error, two fully copied settings rows and zero old keys are required. Private row/schema/ledger recovery exports were captured. The owned, leased workflow may mark only that known failure rolled back, then normal migrate deploy applies the corrected transactional migration. Any different failure requires fresh diagnosis; there is no general resolve/reset fallback.

Build's merge target remains `release/studio-go-live`. Its merger preserves a dirty shared checkout and pushes fast-forwards only. Before deployment, update the dedicated canonical checkout with `git pull --ff-only`, inspect the combined result, test, and commit. The root now contains the integrated code as a working branch; do not resurrect the older copied Library patch. Historical Library-only and phase-6-only checkouts are not release entrypoints and fail both local canonical validation and the server's old-command gate.

The local lease client keeps its heartbeat independent of remote Git checks. Git probes have a 10-second timeout, one retry and a 20-second maximum verification age. It announces readiness only after the canonical tip matches; changed local/remote identity, lost parent/holder or expired verification terminates deployment. Timed-out Git/SSH probe process groups are cleaned up. The server's 15-second lease TTL, synchronous stage-boundary checks, forced-command gate and immutable-input checks are unchanged. Verified with four local lease-client tests and 11 server-guard tests; this fixes the upload interruption caused by a blocking GitHub lookup, without allowing an unverifiable release to continue indefinitely.

## Companion continuity checks

Before prebuild or lease acquisition, take timestamped `df -k` readings on both the build checkout and the companion's home volume. If they share an APFS container, reserve space above the applied companion floor for measured peak build growth, artifact staging and swap. For the November 21 build, sampled growth reached 8.7 GiB. Use at least 12 GiB of headroom above the floor for comparable builds on that Mac until a larger peak is measured. If headroom is insufficient, use a suitable approved build host or review idle regenerable outputs with the worktree closeout procedure. Recheck during and after build, especially before traffic cutover. An existing observation below the floor is a degraded preflight. Record it and resolve the space constraint before a release expected to keep Mac processing available.

Keep web, hosted worker and paired-device readiness separate. Start the candidate web and verify it before Caddy switches traffic. The hosted Studio worker replacement has its own graceful drain, job leases and readiness gate. Preserve the old web drain and the Mac pairings. Follow the existing WhatsApp continuity principle of keeping an unchanged healthy runtime and durable credentials in place. A web deploy does not need a Mac restart. Treat companion updates as a separately planned change with compatible client/server versions, no active work on that Mac and a post-restart heartbeat check.

Capture the pre/post no-spend Devices, AI Settings and Source Assistant check on both editions and record any missing signed-in evidence. [Studio readiness runbook](studio-readiness-runbook.md#paired-mac-continuity-at-release)

## Studio bin purge schedule

The nightly 03:30 `run-cron-endpoint.sh studio-bin-purge 280` entry is installed by the guarded deploy itself, never by plain SSH (the forced-command gate rejects it). After a successful cutover, still inside the lease, `deploy-local-build.sh` runs `scripts/install-cron.sh --studio-bin-purge-only` from the live symlink. That mode replaces only the Studio bin purge line by its script/endpoint name, leaves every other crontab line untouched, and writes the path as `/home/martin/estio-app/scripts/...` so a blue/green switch keeps it valid. A failure is recorded as a post-cutover failure like other optional steps. Running the script again changes nothing (idempotent). The full `scripts/install-cron.sh` remains the complete schedule registry; the deploy deliberately does not rewrite the other jobs. `run-cron-endpoint.sh` reads `CRON_SECRET` from the app's `.env` when the crontab environment does not carry it.

To run the purge once by hand and read its log, set `DEPLOY_CRON_RUN_ONCE=studio-bin-purge` on a normal owned deploy (`studio-schedules` is the only other accepted value). The job runs on the server after cutover and its last log lines are printed; its endpoint response is the log's `SUCCESS: HTTP 200 - {...}` line. Every other server command also has to go through a lease-holding deploy; there is no separate unguarded path.
