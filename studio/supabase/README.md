# Studio Supabase migrations

These migrations target the separate Substo Supabase project that will hold Studio data for both Estio and Substo. Never apply them to Estio's Prisma database or to a personal/local Substo database.

The workspace-core migration is additive and does not copy, transform, or delete existing Substo `owner_id` data. Existing content tables remain unchanged until the importer and cutover plan are reviewed. It creates workspace/membership/invitation tables, a workspace-scoped media metadata table, and a private `studio-media` Storage bucket with client-deny policies. That Supabase bucket is unused: Studio media bytes live in a private Cloudflare R2 bucket, and `20261023030000_studio_legacy_media_reconciliation.sql` records `storage_provider = 'cloudflare_r2'` plus the R2 bucket on each media object. Its rows have RLS enabled with no client data policies; the hosted server must authorize every request before using the service role.

The migration is not yet part of `deploy-local-build.sh`. Apply it only after setting a dedicated `STUDIO_DATABASE_URL` for the Substo Supabase project, for example:

```sh
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261022000000_studio_workspace_core.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261022010000_studio_library.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261022020000_studio_library_import.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261022030000_studio_knowledge.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261022040000_studio_knowledge_import.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261022050000_studio_knowledge_review.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261023000000_studio_schedules.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261023010000_studio_schedule_import.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261023020000_studio_record_link_editing.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261023030000_studio_legacy_media_reconciliation.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261023040000_studio_knowledge_media.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261024000000_studio_ai_credentials.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261024010000_studio_jobs.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261024020000_studio_uploads.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261024030000_platform_youtube_discovery.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261024040000_studio_paid_attempt_reliability.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261024050000_studio_transcription_reconciliation.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261024060000_studio_idea_review.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261024070000_studio_script_briefs.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261024080000_studio_knowledge_extraction.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261024090000_studio_schedule_run_now.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261024100000_studio_recurring_schedules.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261024110000_studio_youtube_schedules.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261024120000_studio_knowledge_edit_topics.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261024130000_platform_profile_deletion.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261024140000_studio_upload_recovery.sql
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261024150000_studio_readiness.sql
```

Keep the database URL and Supabase service-role key in the production secret store. Do not commit either value. The schema intentionally stores Estio location IDs as external keys because Estio Business and Studio use separate databases.

The library migration adds shared records, same-workspace relationships, pending legacy attachment metadata, and a version-checked record mutation. Browser roles have no direct table or RPC access. The import migration adds an atomic import ledger/RPC; see [import preparation](../import/README.md) and [reviewed apply procedure](../import/APPLY.md). These migrations create new `studio_*` tables alongside any existing personal `owner_id` schema.

The knowledge migration adds workspace-scoped topics, sources, insights, evidence, reviews, source-unit sidecars, and units. Knowledge sources must reference a library record in the same workspace; evidence is constrained to its insight's source. Each source-unit sidecar envelope is stored once, with unit rows linked to the same source and transcription. The import migration adds a service-role-only owner-checked atomic RPC and replay ledger; it requires a matching successful library import and verifies the canonical knowledge/library snapshots and normalized row/unit fidelity. All knowledge tables have RLS enabled and no browser grants or client policies. See the [knowledge export contract](../import/KNOWLEDGE.md) and [reviewed apply procedure](../import/APPLY-KNOWLEDGE.md). The normalizer, read-only preview CLI, metadata-only apply path, and workspace-authorized knowledge UI are implemented. Apply does not move media.

The review migration adds a positive optimistic version to each insight and a service-role-only RPC for pending → approved/rejected and approved/rejected → pending. It leaves the imported insight payload and imported review events unchanged; current status lives in the insight's separate `status` column. Direct service-role mutation grants on insight and review tables are removed; service-role reads remain available, while security-definer import/review RPCs perform writes. A successful decision appends a hosted event with the actor's Clerk user ID and brand, the previous/new status, an optional note, version, and server-generated UTC timestamp. Stale versions, missing workspace insights, invalid transitions, and nonmember Substo actors are rejected; a Substo membership row is locked through the decision so concurrent revocation waits. The Estio server must separately verify Business location authority and reject impersonated writes before calling the RPC; the Studio database cannot verify that separate Business authority. This slice changes review status only: statement edits and local Substo's automatic topic creation/assignment on approval remain separate work.

Validate all migrations and security assertions on disposable local PostgreSQL with `bash scripts/test-studio-schema.sh`. Its Storage tables and roles are a minimal local test surface; a successful local run still requires verification against the dedicated Supabase project before activation.

The schedule migration adds service-only, workspace-scoped draft definitions for YouTube discovery, idea review, and script brief. Saves check optimistic versions, actor brand, and active Substo membership under a row lock; Estio authority and impersonation are checked by the server. Direct service-role table writes are disabled. Daily cadence uses a saved Asia/Nicosia wall time; seven-day cadence describes elapsed time after a future run. The original migration adds no enabled state or dispatch timestamp. Migration 21 below adds explicit manual execution; saving still cannot enqueue work or incur API usage. Legacy `schedules.json` definitions and run history now have a [private preview and pinned inactive apply adapter](../import/SCHEDULES.md). Hosted imported-history browsing is implemented; migration 21 adds hosted manual run history.

The schedule-import migration adds immutable service-read-only legacy definitions/history and an import ledger retaining full canonical source and preview evidence. Its owner-checked service-only RPC imports drafts/history atomically, enforces workspace/import foreign keys, reconciles projections/counts, and preserves later draft edits on identical replay. It does not add an enabled flag, jobs, or dispatch path. Validate with the disposable PostgreSQL harness before any separately reviewed live application.

The record-link migration adds one-way add/remove RPCs with Substo membership
locking, actor-brand checks, same-workspace targets, shared record-version
conflicts, and atomic attributed audit events. Actual changes rebuild active
`payload.linkedIds` in canonical UUID order from the edge table; other payload
fields and `legacy_payload` remain unchanged. No-op changes at the current
version do not append an event or increment the version. New additions are
capped at 100 outgoing edges, matching local Substo; existing larger imports
are not truncated and can still be unlinked one edge at a time.

Direct service-role writes to records/edges/events are revoked. The public
`studio_save_record` RPC remains the field-write entry point and rejects
`linkedIds` patches; its former implementation is a private helper with no
service/browser EXECUTE grant. Existing security-definer import RPCs still own
initial snapshot writes and replay semantics. Link edits and ordinary field
edits serialize on the same record version. Estio authority and impersonation
are checked by the server; the SQL RPC additionally rechecks Substo membership.
The shared link picker is read-paginated and accessible from library/content
detail pages. Browser roles have no table or RPC grants. Apply only to the
dedicated Studio project after review; no live application has occurred.

The profile/discovery migration deliberately separates app-user Google consent (`platform_google_youtube_*`, keyed by realm and Clerk user ID with no workspace FK) from workspace discovery configuration and bookmarks. Refresh tokens are encrypted and remain server-side; profiles do not inherit Google grants through membership. Service RPCs serialize one-use profile OAuth state and separately check workspace membership/manager rights for discovery. See [the profile Google/discovery contract](../../documentation/profile-google-youtube-discovery.md). No live application was performed.

The paid-attempt reliability migration (16) rotates a claim token on each job
claim and requires that token plus an unexpired lease for worker mutations.
Stop/drain old workers before an authorized rollout: the old job RPC signatures
are removed and unfenced transcript/spend helpers become internal-only. No live
application is authorized by this README or the local reliability task.

Upload transcription reserves budget per durable chunk attempt; chunk persistence,
usage settlement and attempt success commit atomically. Expired/replaced job
attempts are recovered as `uncertain` during claim sweeps, including exhausted
jobs. Unknown provider outcomes retain their linked holds and block automatic
resend, including after a member retries the job. Explicit auth/input/rate-limit
rejections release their own holds. A lost committed result response is reusable
without a second provider call. The original whisper-1 estimate remains 100
micro-USD per second, now owned by these SQL RPCs; review pricing before release.

Unknown holds count in their original reservation month; they are not actual
invoice charges. Migration 17 adds the reviewed manager reconciliation path to release or
settle holds with evidence and separately authorize replacement work. Never infer
that a timeout/crash means no provider processing. Legacy unassociated holds, if
present on a future target, require separate review. The disposable harness runs
historical assertions before this migration and final-schema reliability/security
assertions after it. Local checks do not establish production readiness.

The transcription-reconciliation migration (17) adds immutable service-read-only
manager review events. The Jobs reconciliation page/API requires a same-realm
AI manager signed in as themselves. SQL locks Substo membership and role; Estio
location ADMIN authority stays in the app. Billing decisions require a specific
provider evidence reference and exact confirmed amount; they do not grant a new
paid call. A separate explicit authorization permits one replacement attempt for
that missing chunk and requeues the job. Current budgets/keys still apply, saved
chunks are skipped, and other uncertain chunks remain blocked.

The old attempt, original usage month and any confirmed charge stay in history.
Unknown outcomes remain reserved; provider evidence is manager-attested, not
fetched/verified by this workflow. Version and request-ID checks make reviews
safe to replay after a lost response and reject conflicting decisions. Live
workers block review; expired workers are fenced before reconciliation. The
local harness now needs `rg` and runs final reconciliation assertions plus a
three-session race test against its private disposable Unix-socket database.
This migration and UI have not been activated against production.

Migration 18 adds hosted bounded idea reviews. Member-authorized enqueue pins
one to five current idea versions plus up to three linked records per idea in
an immutable 24 KiB maximum snapshot. Exact source URLs are bounded; long notes
and source text are explicitly excerpted. Advisory results never mutate content;
changed/deleted inputs make a result historical. The worker uses the workspace
OpenAI key, a $0.01 reservation, bounded structured output and token settlement
atomically committed with the result. See the progress record for model/rate
version and official API references. Customer model access and real paid calls
have not been verified locally.

Physical paid attempt/review tables are now `studio_ai_attempts` and
`studio_ai_attempt_reviews`, with service-only compatibility views retaining the
legacy transcription names. Existing upload RPCs keep working; new text jobs
share the same lease fencing, crash recovery, evidence review and separate
replacement authorization. The Jobs reconciliation page reads shared attempts.
Do not drop compatibility views or rewrite old migrations. Drain workers before
a separately authorized schema/code rollout. The disposable harness verifies
both text processing and successful transcription after this upgrade; a local
pass does not establish live Supabase or release readiness.

Migration 19 adds `script_brief` to the shared text workflow/paid-attempt path.
`studio_idea_reviews` keeps its legacy name but now has an explicit workflow
column; application reads filter it. New shared enqueue/begin/finish helpers
keep workspace checks, immutable snapshots, budgets, current-lease fencing,
workflow validation and atomic result/usage commits together. Old idea RPCs
remain constrained compatibility wrappers. Script briefs require one current
idea and saved supporting research text, retain all source/version provenance,
and never mutate content during generation.

`studio_apply_script_brief` is a separate authorized, explicitly confirmed,
version-checked transaction. It refuses any changed/deleted input and applies
a run at most once, replacing only the script, setting script stage and clearing
approval. An immutable `studio_script_brief_applications` row retains actor,
versions and exact previous values. Replay returns its saved result without
changing later human edits. Both SQL suites and an independent human-edit race
exercise this behavior. Drain workers before any separately authorized schema/
code rollout; no live application or deployment occurred.

Migration 20 adds bounded `knowledge_extract` text runs. Explicit saved text,
imported speech units or an upload transcript bound to the same source record
are snapshotted with source versions, range metadata and SHA-256 fingerprints.
The shared paid path validates exact selected-unit quotes before atomically
saving proposals and usage. Media/frame/OCR interpretation and automatic
whole-source processing are outside this slice.

A separate confirmed RPC applies selected proposals as pending findings, with
exact evidence and attributed events. Current source text/unit fingerprints are
rechecked; existing topics, statements, statuses, history and coverage counters
are preserved. Exact source/statement/kind matches are reused. Immutable request
and per-finding ledgers make retries and overlapping selections safe; source
serialization prevents duplicate insights from concurrent runs. Existing review
RPCs still own approve/reject/reopen. Direct service writes to sources, evidence,
source units and sidecars are revoked; the existing security-definer importer/
media RPCs retain their write authority. New sources label coverage as extraction
ranges rather than advertising corpus completion.

The disposable harness adds extraction assertions and a concurrent exact-match
race to its earlier suites/races. Only local synthetic data was used. Migration
20 and matching worker code require a reviewed, separately authorized dedicated
Studio rollout after backup/target verification and worker drain.

Migration 21 adds explicit Run now for saved idea-review/script-brief schedules.
The service-only command checks current member/realm, saved schedule version,
explicit paid consent and current selected idea versions, then calls the shared
text enqueue and appends an immutable execution/definition ledger in one
transaction. Estio Business access and impersonation are checked by the server.
Identical replay retains child identities after later edits. Schedule/request
locks prevent concurrent duplicates; queued/running jobs and unresolved paid
attempts block new commands on that schedule. Existing job recovery remains the
only path to reconcile/authorize a replacement for uncertain work. History
links to the durable input/results, current job status and charge-review path.

Draft saves and imports remain inactive. Recurring activation/due dispatch,
unattended authority/input selection, cron installation and profile-owned
Google grant selection/revocation remain separate follow-up work. YouTube
schedule execution is rejected. The disposable harness includes grants,
authority, rollback/replay, stale input, uncertainty fencing and a three-session
schedule race. No production schema, scheduler or provider was changed locally.

Migration 22 adds explicit enable/pause and atomic due dispatch for recurring
idea-review/script-brief schedules. It pins the bounded shared text snapshot,
selected record versions, definition version and author/realm with separate
recurring paid consent. Definition/input changes require reauthorization;
enable replay cannot undo a later pause. Each generation has a fresh activation
token. Queued old-generation work cannot inherit new consent.

Daily Asia/Nicosia wall time rolls a spring gap forward and selects the later
fall occurrence. Weekly means 168 elapsed hours. Missed times dispatch once;
active work skips a tick. SQL binds due timestamp/token, serializes concurrent
dispatch/pause, retains due outcomes and execution links, and pauses terminal
paid uncertainty without releasing holds or authorizing replacement work.
Substo membership and current consent are checked before reserving spend.
Production dispatcher and text worker separately check Estio Business authority
at dispatch and before a paid attempt; revocation is not atomic across the two
databases and cannot cancel an already authorized in-flight provider request.

The authenticated cron route is `/api/cron/studio-schedules`; the existing
`scripts/install-cron.sh` owner prepares its minute-by-minute
`run-cron-endpoint.sh studio-schedules 110` entry. No installer, migration or live
provider was run. Verify dedicated target/backups and drain old workers before
a separately authorized schema/code rollout and cron installation. Signed-in,
Business/Studio integration and real Mac-off acceptance remain release gates.
YouTube recurrence still requires a profile-owned grant/source/revocation
workflow; no workspace Google credentials are introduced.

Migration 23 adds profile-bound scheduled YouTube discovery to the existing
recurring dispatcher/cron owner. Enable requires the current own profile grant
version, source selection, label and explicit recurring public-link sharing.
Sources are one approved channel, saved public search or one selected subscribed
channel (checked against the same user's token at activation and each run).
Private source selections live only in a service-only profile authorization
row; shared snapshots/audit/results omit subscription choices and credentials.

The worker checks consent, grant generation, current membership and current
lease before reads and final writes; Estio authority is additionally rechecked
in Business before reads/commit. It atomically saves at most ten public links
using the user's label plus ID, reuses existing research without overwriting
human edits and stores no provider snippet/statistics/media/subscription list.
Read retries may use Google quota; saved result replay needs no new Google call.
Workspace AI keys/budgets are not involved. Five active discovery jobs per
workspace and the existing 50 logical discovery operations/day cap bound work.

Connection removal/replacement pauses this realm/user's bound schedules and
deletes private source authorizations. Consent expires after 30 days; the cron
route prunes bounded expired rows before dispatch, while worker checks deny
expired authorization even if cleanup is offline. Reconnect needs fresh
consent; old queued jobs cannot inherit it. Existing shared public research
remains workspace content. The local SQL race verifies profile removal fences
a late result, alongside prior concurrent due/pause and paid-job checks.

No live migration/provider call/cron installation occurred. Verify dedicated
target/backups, drain workers and roll out matching schema/code under separate
authorization. Live consent/privacy, per-realm deletion cleanup, real provider
and cross-brand/Mac-off acceptance remain release gates.

Migration 24 adds version-checked knowledge statement edits and approval-time
topic assignment/creation through a same-origin idempotent command API. Editing
alone returns a finding to pending and retains its topic; a pending edit and
approval/topic can commit together. Topic selection is explicit, names are
bounded, and a workspace-scoped searchable picker returns bounded matches.

A lazy name-claim ledger serializes new topics across independent sources.
Matching ignores ASCII letter case/repeated spaces; it does not merge topics
semantically or normalize other Unicode characters/punctuation. Unambiguous
imported topics can be reused without changing their IDs/payloads. Ambiguous
imported names require selecting an explicit ID. Direct service topic writes
are revoked; existing security-definer import RPCs retain owner authority.

The mutation shares extraction's per-source fence, checks the finding version
before topic creation, and atomically commits statement/status/topic/version,
review history, optional topic/claim and immutable request replay result. The
event retains exact previous/new values, actor/realm and note. Imported payloads,
evidence, source/coverage metadata and historical reviews remain unchanged.
Older status callers approve with the current assigned/suggested topic or must
reload when no valid topic exists; the new UI uses stable request UUID replay.

The disposable suite verifies provenance, authority, replay, rollback and both
concurrent same-topic creation and stale approval versus human editing. No live
migration/data repair/provider request/deployment occurred. Dedicated target,
backups and a separately authorized schema/code rollout remain prerequisites;
signed-in cross-brand/topic acceptance is still pending.

Migration 25 adds realm/user profile-deletion markers and a minimal immutable
verified-event ledger. The dedicated signed `/api/webhooks/clerk-profile`
endpoint uses separate host-bound signing secrets and expected Clerk instance
IDs, independent of the existing Business/mail endpoints. See
[the rollout contract](../../documentation/studio-profile-deletion-webhook.md).

Cleanup atomically records terminal deletion, pauses the exact principal's
recurring work and deletes profile YouTube credentials, pending OAuth and
private schedule sources. Shared profile claims fence concurrent commands;
OAuth/grant writes, Studio access, new workspace/invitation authorization and
scheduled paid attempts cannot resurrect a deleted profile. Duplicate events
replay their saved result, while other realms/profiles stay independent.
Workspace content/evidence/media, roles/ownership/audit, AI keys/budgets and
existing one-off work/paid holds remain intact. Business data and Google-side
revocation are outside this profile-only cleanup.

The disposable suite checks isolation, replay, rollback and concurrent callback/
consent attempts waiting behind deletion. No live migration or webhook/secret
configuration occurred. Verify the dedicated target/backups, drain workers and
roll out matching schema/code before separately registering both production
realm endpoints. Real delivery/stale-session/cross-brand and owner-succession
acceptance remains pending. Deploy does not apply this migration.

## Browser upload recovery

Migration 26, `20261024140000_studio_upload_recovery.sql`, tightens upload-ID
replay to include the exact original filename and R2 bucket, and checks the
original uploader before completed-upload replay. It preserves function OIDs,
service-only grants, the atomic media/job completion transaction, lease fencing
and paid-attempt recovery. Apply after migration 25 on the dedicated Studio
project only, in a separately authorized schema/code rollout.

The record pages list up to 100 current uploader pending uploads, oldest first,
within the existing seven-hour completion window. The same-origin, no-store
`/studio/workspace/[workspaceId]/uploads/api` accepts a stable-ID start command or
an upload/record recovery command. The server checks current own-account realm
and workspace authority, then HEADs the private R2 object. Matching size/type
finalizes its existing upload and single transcription job; an absent object
receives a renewed create-only PUT target for the same key. Replays of a saved
completion need no object HEAD and never enqueue replacement paid work. Metadata
mismatch, storage outages and expiry cannot overwrite bytes or authorize a new
upload automatically. Browser bytes and signed URLs are not persisted in local
storage. A reload rediscovers committed pending registrations from the database;
a registration that never committed needs a new start. Interrupted byte transfers
restart from zero after explicit original-file selection; this is not multipart
or byte-range resume. Name/size/type selection checks are not a content checksum.

Expired registrations/objects are not deleted by this workflow. The existing
expiry is not extended by retries. Cleanup, larger pending-list pagination, live
CORS/signed-in cross-brand/reload acceptance and worker readiness remain separate
work. No production bucket or lifecycle configuration is changed here.


## Runtime readiness

Migration 27, `20261024150000_studio_readiness.sql`, adds service-only operational
reports/snapshots. Old heartbeat liveness cannot satisfy the new release/instance,
capability and successful-claim checks. The schema/code pair is required by the
worker startup doctor and the pre-cutover deployment gate. No live migration is
performed by the deployment script. See [the readiness runbook](../../documentation/studio-readiness-runbook.md)
for private doctor commands, exact limits, failure recovery and rollout gates.
