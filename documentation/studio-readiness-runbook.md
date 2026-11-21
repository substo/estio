# Studio runtime readiness (local implementation)

This is a private operator/worker/deployment check. `/api/health` remains the
existing Business/web liveness endpoint; it is not a Studio readiness claim.
There is no new public operational endpoint or browser-accessible RPC grant.
No production configuration, migration, process, cron, bucket or deployment was
changed while implementing this workflow.

## Read-only doctor

From the intended release directory, with its environment already exported:

```sh
./node_modules/.bin/tsx scripts/studio-readiness.ts --mode=dependencies
./node_modules/.bin/tsx scripts/studio-readiness.ts --mode=worker
```

For manual use, `tsx --env-file=.env scripts/studio-readiness.ts ...` can load the
intended release's environment explicitly. The CLI does not load `.env.local`
or `.env.prod` implicitly. Do not use a different release's environment or print
its secret values. JSON output contains check names/booleans and aggregate queue
counts, without endpoints, credentials, ciphertexts, profile/workspace IDs, worker
IDs or signed media URLs. Exit 0 means the requested check passed; 1 means
unconfirmed/unready. The internal `--mode=required` returns 2 for dormant Studio.

Studio is required when either dedicated Supabase variable, `SUBSTO_APP_HOSTS`,
or `STUDIO_READINESS_REQUIRED` is nonblank. Set the last value to `1` for an
explicit requirement; a nonblank `0` does not disable other requirements. R2/key
provisioning alone remains dormant so existing Business-only releases do not
start Studio merely because media credentials were prepared. Partial database or
hostname activation fails closed. Removing activation configuration is not a
workspace shutdown, worker drain or approved decommissioning workflow.

The doctor checks:

- Dedicated database/R2/current encryption-key configuration and a local AES-GCM
  roundtrip. The private `studio_readiness_snapshot()` contract must be schema
  27/protocol 1. It reports distinct encryption key IDs used by workspace OpenAI
  credentials and realm-owned Google grants. All must exist in the local keyring.
  This detects missing old key IDs; it does not prove every stored ciphertext can
  decrypt, detect wrong material under an unchanged ID, or replace a restore test.
- A read-only R2 `HeadBucket` with a bounded abort signal. It proves bucket/API
  reachability with these credentials; it does not prove object write/read-back,
  browser CORS, public-access settings, lifecycle policy or customer media access.
  Denial is unready, not permission to widen bucket access. [Cloudflare documents
  HeadBucket support](https://developers.cloudflare.com/r2/api/s3/api/).
- `ffmpeg` and `ffprobe` HTTPS protocol support, a tiny local synthetic libopus
  encode/probe and temporary-directory write/removal. Both release and temporary
  filesystems need at least 1 GiB available by default. `STUDIO_MIN_FREE_BYTES`
  permits an explicit integer override of at least 64 MiB (used in disposable
  local tests). This is a point-in-time capacity check, not a reservation or a
  production capacity plan. The check removes only its own new temporary folder.
- In worker mode, a fresh capable report for this directory's `.next/BUILD_ID`.
  `STUDIO_WORKER_INSTANCE` optionally pins a launch, paired with
  `STUDIO_WORKER_STARTED_AFTER` (the current PM2 `pm_uptime` timestamp in
  milliseconds). The deployment gate always supplies both. A report predating
  PM2's current process cannot pass after autorestart reuses launch environment. A report must have protocol 1, all six current
  handlers, a successful claim check, no drain marker and a DB-clock age of at
  most 90 seconds (at most five seconds into the future). A restarted or wrong
  release/process, legacy heartbeat, missing handler or failed claim cannot pass.

Dependency probes run together with a 12-second timeout and shared abort signal;
media subprocesses also have five-second limits. Queue due count/oldest due,
expired leases and attempts with `status='uncertain'` are diagnostic aggregates.
The latter includes historical reviewed attempts still bearing that status. A
busy queue or retained uncertainty is not itself a readiness failure, and the
doctor never claims, completes, retries, reconciles or releases such work. It
never calls Google/OpenAI, refreshes grants or charges a workspace.

## Worker reports and local schema

Apply migration 27, `20261024150000_studio_readiness.sql`, only to the dedicated
Studio database after migrations 1–26, in a separately authorized rollout. It
adds service-read-only report metadata to the heartbeat table and service-only
report/snapshot RPCs. The original heartbeat RPC remains callable but clears
capability metadata, so old liveness cannot qualify as new readiness. No browser
or direct service table-write grant is introduced.

A required Studio worker performs the same dependency doctor before claiming any
job; missing R2, encryption keys or media tools no longer make transcription an
unknown/unsupported handler. It must have a built release ID. Dormant workers may
still idle before configuration. The process reports initial `healthy=false`,
then reports healthy after the first successful queue claim RPC, even if no job
was due. Claim failure withdraws that state; failed heartbeat confirmation stops
new claims until heartbeat recovery. Existing paid jobs keep their independent
lease/attempt fences and uncertainty holds.

Reports run every 30 seconds independently of occupied job slots. After shutdown
is observed, the worker serializes a final unhealthy/draining report behind any
in-flight pulse and drains already-claimed work. SQL makes draining terminal for
that process identity, even if a delayed healthy report arrives afterward.
Transport outages can leave an old report visible until its 90-second freshness
window elapses. PM2's existing 30-second kill timeout can end longer jobs; their
lease expiry and paid uncertainty recovery remain essential. New reports do not
promise uninterrupted processing or exactly-once provider calls.

## Owned deployment integration

`deploy-local-build.sh` calls `scripts/studio-deploy-readiness.sh` after target web
liveness and **before** changing the active symlink or Caddy traffic. The helper
is a deployment mutation helper, not a read-only doctor; do not execute it without
an authorized deployment.

For required Studio, it first runs the dependency doctor, leaving the prior
worker untouched on failure. It then replaces the named worker from the exact
target directory with a unique process instance, checks exactly one online PM2
entry (five-second PM2-list timeout), and requires the matching release/instance
report with a start time at or after that PM2 process start. Up to six bounded readiness probes run with two-second delays. All deploy
runtime scopes use this gate; no old-release worker can satisfy a web-only
release's readiness. PM2 “online” alone and the former warning-only path are gone.

If worker readiness is unconfirmed, the helper stops the candidate, attempts to
restart the prior worker from its release directory and prior `.env` in a clean
environment, then returns failure. Public symlink/traffic have not switched at
that point. A failed prior restart is explicitly reported and needs operator
recovery; a PM2 restart attempt is not proof of restored readiness. Initial
activation has no prior Studio worker to restore. A target web process may remain
running on its inactive port after failure. Failure later in the broader deploy
(e.g. Caddy validation/soak) still follows the existing web traffic rollback; it
does not automatically reverse this already-passed worker replacement. A reviewed
combined schema/media/key/worker rollback remains a release prerequisite.

[PM2's process metadata](https://pm2.io/docs/runtime/reference/pm2-programmatic/)
and [process-start implementation](https://github.com/Unitech/pm2/blob/master/lib/God.js)
provide the current process startup timestamp used to fence autorestarts.

The deploy script still does not apply Studio migrations or install schedules.
Production capacity/configuration, secrets/realm verification, tested backups and
restore, CORS/real media and customer-provider acceptance, cron installation and
Mac-off execution remain separately authorized release work. Readiness does not
activate `SUBSTO_APP_HOSTS`, create a workspace, transfer data or deploy anything
by itself.

## Offline release preflight and recovery-bundle verification

Both tools are read-only and offline. They never connect to a database, R2,
Clerk or a provider, never accept `--apply`/connection flags, and emit only safe
JSON (no secrets, URLs or filesystem paths on failure).

- **Preflight:** `npx tsx scripts/studio-release-preflight.ts --project-ref=<ref>
  --bucket=<bucket> --artifact-bytes=<n> --backup-spool-bytes=<n>
  --media-temp-bytes=<n>`. All inputs are explicit; there are no defaults. It checks
  the current host's environment shape (dedicated Studio project/pooler identity,
  no alias of the Business database host, no credentials in API URLs), the local
  migration inventory hashes and free disk against the stated estimates.
  `configurationReady` can pass; `releaseReady` is always `false` because live
  capacity, secrets and acceptance are not verifiable offline.
- **Bundle verification:** `npx tsx scripts/studio-recovery-verify.ts
  --bundle=<dir> --manifest-sha256=<pinned> --project-ref=<ref> --bucket=<bucket>`.
  The bundle (`database.dump`, `state.json`, `manifest.json`, `media/<sha256>`)
  must be produced by a separately approved export, live outside the application
  tree, and be owner-only (no group/other bits, no symlinks or hard links). The
  manifest hash must be pinned out-of-band. Every file hash/size, referenced media
  object and credential decrypt probe (with the realm context) must match; extra
  or missing files fail. Output reports `restoreExecuted`, `liveCompletenessVerified`
  and `keyEscrowRetrievalVerified` as `false`: verification is not a restore, does
  not prove the export was complete, and does not prove key escrow retrieval.
- **Restore rehearsal:** `bash scripts/test-studio-schema.sh` runs
  `studio/tests/recovery-rehearsal.sh` against disposable PostgreSQL only. It seals
  a synthetic bundle, verifies it, `pg_restore`s into a fresh database, reloads
  the fixture keyring and compares all Studio tables, sequence positions, function
  definitions, effective (`aclexplode`) privileges, media bytes and credential
  probes. A retained paid hold and queued job survive without starting a worker.

Release rollback is web+worker only (`scripts/studio-worker-restore.sh`); see
[the go-live plan](studio-go-live-plan.md). A real export, escrowed-key retrieval, restore into a non-production target and
a production rollback exercise remain separately authorized.

## Paired Mac continuity at release

Use the same signed-in account, Location, Mac and source for pre/post checks on each edition. On **Devices** record the build revision, companion release and start time, last heartbeat, applied Setup version, Processing switch, local gate, free disk in decimal GB, CLI discovery/sign-in, and the relevant operation's handler/version. A recent heartbeat (under 90 seconds) means the companion reached the device service. A green system web health check or an On switch cannot establish task readiness.

In **AI Settings** compare the connection's reason and capacity freshness. Open an existing source and read **Source Assistant** readiness for both the Location order and your paired Mac. This uses the authenticated GET at `/studio/ai-capabilities/api?workflow=source_assist`, scoped by the active tenant and account. Do not submit a prompt, queue a diagnostic, place a paid hold or manually send a device heartbeat. Compare expected eligibility or the same specific blocker before and after the release. Record an edition or operation as unverified if it lacks an eligible authorized test Mac. Location ChatGPT is unsupported for Source Assistant; that result is expected with a healthy hosted subscription.

Interpret the evidence by layer:

- A stale heartbeat is a transport or companion-state symptom. Record the last successful heartbeat and release/slot, then correlate the server's request status with the Mac’s UTC event. The updated companion logs `device_heartbeat_failure` with a timestamp and only a failure class and optional HTTP status. A 401/403 calls for an authority check; a 400/413 or invalid response calls for protocol/envelope checks; 429/5xx and transport/timeout need edge, application and connection evidence. Never copy tokens, URLs with parameters, request bodies, Keychain records or CLI auth output into release notes.
- Online with `low_disk_space` can still report signed-in providers. Free space above the applied floor restores eligibility on subsequent observations. Keep that floor. Free configured disk on the correct volume, or move builds to an authorized build host.
- “Not installed” is a report from the running process. Compare its actual LaunchAgent user, executable, working directory and PATH with local binary discovery. Distinguish installation, authentication method, capacity freshness and capability version. A failed quota read can retain the last independently valid reading only until the freshness fence expires. Only a fresh reading can confirm exhaustion.
- Web-only changes preserve the Mac process and Keychain credentials. A companion bundle/runtime change or newly required capability may need a separate coordinated update and restart. Verify the current job/lease state, allow it to drain before changing the loaded code, preserve its pairing and verify a new heartbeat with the required capability afterward. Never automatically replay uncertain work.

### November 21 incident

For web revision `04dd7ea1` and build `9dTMQd8IaLnPm8sZ52AfK`, the release session recorded 18 GiB at 10:26 UTC before build, 15 GiB at 10:28:41 and 10:30:26, 9.3 GiB at 10:37:22, 15 GiB when the prebuild finished at 10:40:30, and 18 GiB after cutover at 10:45:41. On this Mac the build output and companion home share the APFS data volume. The user’s applied minimum was 20 decimal GB. The shortage predated cutover and the build worsened it. The old local failure lines have no per-event timestamp or HTTP code. Their file was last modified at 10:39:53 UTC, before publication at 10:45:17 UTC. The same LaunchAgent process had started the previous evening. At 10:57 UTC the Devices screenshot showed a recent report with Processing On, Codex signed in, green assistant/transcription rows and research blocked by disk. Source Assistant honored the disk gate. The Devices checklist had omitted it. That screenshot establishes the displayed state. The release reused the fingerprint-verified prebuild, prepared blue on port 3001, applied migrate-only, replaced the hosted Studio worker and waited for readiness, switched Caddy, passed the 20-second soak, and scheduled a 900-second drain for green. The scrape worker and viewing relay were refreshed in the selected runtime scope. The WhatsApp bridge and Android tunnel were disabled for an expired canary scope in this release. The normal continuity path retains a healthy bridge when its ownership, configuration and code fingerprint match. This deployment did not update or restart the companion.

A later read-only discovery under the LaunchAgent PATH found both subscription logins ready (Codex 0.171.0 and Claude Code 2.1.330), Chrome 157.0.8103.80 installed, and 19.2 decimal GB free. This does not establish that the earlier companion probe found or authenticated Claude. Related-video readiness also includes the local processing gate, so “Chrome isn’t ready” alone did not establish installation failure. Both unauthenticated heartbeat routes returned JSON 401; historical authenticated response statuses were unavailable through the deploy log/access. The heartbeat transport cause is unconfirmed.
