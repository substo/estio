# One canonical release

## Local worktree closeout

Register task worktrees at creation or at the first implementation handoff. Supply the exact path listed by Git. T3 workers can use the current thread binding to identify the path and branch, then register with the real thread ID. Use Python 3.11 or newer for closeout.

```bash
python3 scripts/worktree_closeout.py register "$WORKTREE" --session "$T3_THREAD_ID" --t3
```

For a non-T3 checkout, pass the documented owning session or operator in `--session` and omit `--t3`. The record lives in the common Git directory under `estio-worktree-closeout/` and stores the session, branch and checkout identity across handoffs. Registration grants no cleanup permission.

After pushing verified integration, record **retire** for a completed task. Add `--keep` if the task will continue or the checkout must stay available. Review the entire checkout for release evidence and local files. Preserve any needed evidence or prebuilt artifact elsewhere before recording a decision and identify its location in `--evidence`. Add `--clear-next` only after checking that the exact `.next` is an ordinary, regenerable production build with no independently needed contents. Retirement defers while any other ignored files remain. Keep the checkout if it holds local credentials, shared dependency links, dependencies or other files that should survive. Preview and apply from another checkout of this repository using the reviewed script.

```bash
python3 scripts/worktree_closeout.py decide "$WORKTREE" --evidence "$OWNER_REVIEW"
python3 scripts/worktree_closeout.py closeout "$WORKTREE"
python3 scripts/worktree_closeout.py closeout "$WORKTREE" --apply --owner-verified
```

A keep decision can use `decide "$WORKTREE" --keep --clear-next --evidence "$OWNER_REVIEW"` to review only `.next`. With no reviewed output, keep leaves the checkout intact. A rebuilt or changed directory needs a fresh decision. Preview leaves the checkout untouched. Apply queries the pushed canonical ref again, checks exact commit ancestry, tracked and untracked state, Git locks, the recorded checkout identity, the configured companion checkout and open files. It removes only the pinned `.next` when recorded, and uses `git worktree remove` without force for retirement. It keeps the branch and reports measured free bytes before and after. A retired checkout can be reported again safely. Use `git worktree prune --dry-run --verbose` to inspect metadata for missing directories separately.

Use `--owner-verified` only when the operator has freshly verified that no other session, editor, build, dev server, deploy or companion is using or about to reopen the checkout, and that no retained artifact depends on it. Coordinate with the owner so it stays idle during removal. The installed T3 CLI verifies the recorded thread's binding and run state. An active or waiting thread blocks cleanup. A T3 binding blocks retirement, even when the thread is settled. A settled, bound thread can permit a reviewed cache cleanup under a keep decision when the owner confirms it will remain idle for the operation. An unavailable T3 lookup defers. For external or manual checkouts, use explicit operator evidence of ownership and release. Open-file checks cannot identify all editor windows, detached sessions or future use. The supported T3 CLI does not expose a checkout-release hook or complete workspace ownership index, so perform apply explicitly from outside the task checkout. Record the deferral if a binding or any other use cannot be cleared.

Run `python3 scripts/deploy-local-space.py` from the build checkout before a separate prebuild. The deploy entry point runs the same read-only inventory before the production lease. It shows the largest local outputs and, below the advisory threshold, surfaces recorded closeout decisions for review. The default threshold is 32,884,901,888 bytes (20 decimal GB plus 12 GiB); use `--min-free-bytes` for a different measured requirement. Resolve shortfalls before proceeding under the companion continuity checks below. At release handoff or after deployment verification and lease release, hand completed tasks to their owner for the explicit closeout above. The server slot cleanup and canonical build both have their own lifecycle. Keep canonical artifacts needed for exact prebuilt reuse.

## Page consolidation

For route or menu consolidation, inventory affected pages and controls from both parents before merging. Record old and new routes, entry points, realm and role access, and action or callback dependencies. Verify intended moves, replacements and retirements against the final candidate in the relevant access states. Use the [settings consolidation audit](settings-consolidation-audit.md) as an example.

## Release procedure

Tasks run in their own worktrees. Merge reviewed work into `release/studio-go-live` using Build's existing merge flow or a reviewed Git merge; preserve both parents' behavior and migrations. This is the only deployable branch, and its candidate must equal the freshly fetched remote tip. The canonical clean checkout is `/tmp/estio-combined-release-20261105`; the shared root is a working checkout on `work/shared-root-20261105`, retaining SIMRelay. Never deploy a task branch or copy a sibling tree over production.

Run focused checks and commit/push all release inputs, then run `PRISMA_SCHEMA_SYNC_MODE=migrate-only ./deploy-local-build.sh` from the canonical checkout. The owned script builds once. No detached/background deploy or manual Caddy/PM2 cutover. Production authorization must cover the concrete release; existing explicit authorization persists. Do not interpret a test/build request as deployment approval.

The script rejects tracked modifications (except explicitly excluded SIMRelay), untracked/ignored uploaded inputs, missing identity, a candidate behind/divergent from canonical or production, and any changed source/environment fingerprint. Fetch/ancestry checks repeat before slot deletion, schema mutation and cutover; a live observer aborts if canonical HEAD moves. Existing prebuilt reuse requires exact build ID and input fingerprint.

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
