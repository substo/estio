# Studio database merge plan

Status: written 2026-10-28 from the user's decisions. Source of truth: [How the app works](how-the-app-works.md).

Studio's tables move from the separate Studio Supabase project (`rzutavcryuafosyljfel`, eu-west-1, reached over PostgREST) into the **CRM database** (`oxxkmbxfqswtomzernzu`, eu-north-1, Prisma). Studio data is keyed by `location_id` with a foreign key to `Location`; there is no Studio workspace and no membership mirror. Both projects stay on the **free plan**.

## Stage 0 measurements (2026-10-28, live)

**Sizes (read-only):**

| | Size | Notes |
| --- | --- | --- |
| CRM database | 193 MB | largest: `PropertyMatchCandidate` 35 MB, `Message` 25 MB, `AgentExecution` 12 MB |
| Studio database | 17 MB total; **4.9 MB** in Studio tables | 60 tables, 105 functions, 2 views; largest: source units 1 MB |
| Combined after the merge | about **198 MB** | 40% of the 500 MB free limit |

The Studio data is two workspaces, and both map to a Location:
- Substo `7c74d024…` → `cmvntrnxm0001a4die51ayr85`, via `Location.studioWorkspaceId`. It holds 10 records, 4 sources, 1,738 units, 200 insights, 471 media objects and links, 5 jobs and 1 device.
- Estio `7236b20c…` → `cmshgqe2j0000a4jjw6152pjf`, via `estio_location_id`. It is empty.

Payloads are small: the largest record is 30 KB and the largest source payload 353 bytes. The rename plan's suspect #1 (whole payloads re-read) costs less than it guessed.

**Egress and polling:**
- Free-plan egress is **5 GB a month for the whole organization** (CRM and Studio together). After an overage, restrictions "generally apply to all projects in the organization", and once the grace period is used, the next overage restricts with no new grace. The Studio restriction lifted today at 02:35 UTC, when the quota refilled.
- Studio REST requests per day: 8.3k on 24 Oct, then 23.7k, 25.2k, 1.4k (restricted) and 3.9k (today so far).
- Since the 22 Oct statistics reset, there were about 62k PostgREST calls. The worker's claim loop is two thirds of them (43k), and the page access checks most of the rest: profile-deletion 3.2k, workspace 2.2k, memberships 1.4k.
- 211 `pg_dump` sessions hit the Studio database (an earlier Studio-side recovery or rehearsal; no code here calls it). That is a likely one-off egress source.
- **The CRM is probably the larger egress consumer.** The header usage badge reads every `AiUsage` row of the month for each page view (about 650 rows of about 500 B per call; 46M rows returned since November). Every page also repeats its access lookups (see below).
- Per-project egress bytes are only shown in the dashboard: the CLI token gets 401 from the usage API, and the logs API changed. **The user should read "Egress by project" in the Supabase dashboard.**

**Latency.** The server is in Nuremberg; both databases are about 30 ms away (TCP connect). The Studio REST round trip is 27 ms warm and 200 ms with a new TLS connection.

**Page timings.** Signed-in Substo session, median of 5 `fetch`es, time to first byte:

| Page | TTFB | CRM queries per load | Studio REST calls per load |
| --- | --- | --- | --- |
| `/admin` (CRM) | 2,167 ms | 49 (17 of them `DEALLOCATE ALL`) | 3 (Substo workspace adoption on every CRM page) |
| `/studio` | 2,342 ms | n/a | n/a |
| `/studio/library` | 2,463 ms | 58 (20 `DEALLOCATE ALL`) | 7 (the workspace read and the profile-deletion check run twice) |
| `/studio/knowledge` | 2,518 ms | | |
| `/studio/content` | 2,346 ms | | |
| `/studio/schedules` | 2,427 ms | | |
| `/studio/jobs` | 2,292 ms | | |
| `/account/connections` (no app shell) | 280 ms | | |
| **CRM → Studio switch** (POST `/api/studio/product-switch` + `/studio`) | **3,400 ms** (POST 1,000 ms + page 2,400 ms) | | |

The floor of about 2 s comes from **sequential round trips, not distance**. `User`, `Location` and `UserLocationRole` are each read 3 to 6 times per page, and Prisma sends `DEALLOCATE ALL` after statements on the transaction pooler (`pgbouncer=true`). About 50 to 60 round trips of 30 ms each is about 1.5 to 1.8 s. So merging the databases removes Studio's HTTPS hop, but **per-request caching is what makes pages fast**.

## Free-plan budget (design limits)

| Limit (free, Nano) | Budget we design for | Alert |
| --- | --- | --- |
| Database size: 500 MB per project | ≤ 300 MB | 400 MB |
| Egress: 5 GB a month per org | ≤ 2.5 GB a month (about 80 MB a day) | forecast > 4 GB |
| Direct connections: 60 | app ≤ 10 per process; worker 3 | > 40 in `pg_stat_activity` |
| Pooler (Supavisor) clients: 200 | all runtime traffic through `:6543` | > 150 |
| RAM 0.5 GB, shared CPU | no long scans on page paths; indexes on `location_id` | slow queries > 500 ms |

Rules that keep us inside the budget:
- **Rate limiting and backoff.** The worker and the Mac companion poll quickly only while they find work, then back off exponentially to 60 s, with jitter. Heartbeats run every 60 s. On database errors they use full-jitter exponential backoff, capped at 5 minutes.
- **Caching.**
  - Access checks are cached per request with `React.cache`.
  - Pages select only the columns they show; transcripts and units load only on the tab that shows them.
  - The usage badge aggregates in SQL, not in JavaScript.
  - The Connected-computer page refreshes every 60 s when idle, quickly only while a command runs, and stops after 10 minutes.
- **Crons.** `studio-schedules` runs every 5 minutes.
- **Verification is done in the database.** Copy checks compare per-table counts and digests computed in SQL; rows are never downloaded to compare them.

## Stages

Each stage is deployed with `PRISMA_SCHEMA_SYNC_MODE=migrate-only ./deploy-local-build.sh` from a tree equal to `release/studio-go-live`, and verified before the next one starts.

**Stage 1: reduce egress and polling** (still two databases):
- per-request caching of the CRM and Studio access checks;
- the Substo workspace adoption read skipped once the Location is linked;
- column-trimmed Studio reads;
- SQL aggregation for the usage badge;
- the companion page refresh policy;
- idle backoff for the worker and the companion;
- the `studio-schedules` cron every 5 minutes.

Rollback: redeploy the previous build.

**Stage 2: the move.**
1. **Schema.** One Prisma migration, `prisma/migrations/<ts>_studio_schema/migration.sql`, creates a Postgres schema **`studio`** in the CRM database holding the final Studio schema. It is generated from the re-keyed history on `wip/studio-location-rekey`.

   **Why this way:**
   - It gives one migration system: `prisma migrate deploy` applies it in the existing deploy flow, and later Studio changes are ordinary Prisma migrations.
   - Prisma's datasource only manages `public`, so `prisma migrate diff` and drift checks ignore the `studio` schema. `schema.prisma` stays free of 60 hand-mapped models.
   - The CRM project's PostgREST exposes only `public`, so Studio tables are not reachable over the CRM's REST API.
   - The SQL functions keep the atomic, locking and invariant logic that is tested today. Porting it to Prisma models would rewrite tested invariants for no gain.
2. **Keys.**
   - `location_id text not null references public."Location"(id) on delete cascade`. The app comes from `Location."authRealm"`; there is no `studio_locations` or `studio_workspaces` table. Studio's `brand` column becomes `app`.
   - Key-checked R2 tables (media objects, uploads, legacy transfers, knowledge media links) get `legacy_key_prefix uuid`. Their check accepts `coalesce(legacy_key_prefix::text, location_id)`. The 471 existing objects keep their old keys; new objects use the Location ID.
3. **Access.**
   - The membership mirror and its sync are removed. The Studio functions that checked `studio_workspace_memberships` call one helper, `studio.is_location_member(location_id, clerk_user_id, roles)`, which reads `public."UserLocationRole"` joined to `public."User"` for the Location's realm.
   - TypeScript keeps authorizing first, through the same cached tenant context.
4. **Code.**
   - `lib/studio/rest*.ts` is replaced by `lib/studio/db.ts`, a few helpers on the existing Prisma client: `studioCall(fn, args)` calls a function as `select studio.fn(...)`, and `studioQuery` runs tagged-template SQL.
   - Table reads become explicit SQL selecting only the columns they need.
   - Every write stays a function call. The app connects as the table owner, so the grant-based "no direct DML" guarantee becomes a code rule: no `insert`, `update` or `delete` on `studio.*` outside functions. A test enforces it.
   - The worker, the companion endpoints and pairing use `location_id` as a non-empty string.
5. **Copy script** (`scripts/studio-merge-copy.sh`): `\copy` per table from the Studio project into `studio.*`.
   - It maps `workspace_id` → `location_id` with the two-row mapping above, and fills `legacy_key_prefix`. It aborts if any workspace is unmapped.
   - It runs in one target transaction with triggers deferred.
   - It then verifies per-table row counts and an md5 digest of each table, computed in SQL on both sides over the same projection, plus FK validity.
6. **Rehearsal** on a disposable local Postgres 17:
   - a CRM schema dump, plus the Studio dump restored as the "source";
   - `prisma migrate deploy`, the copy, the verification;
   - `scripts/test-studio-schema.sh` adapted to the `studio` schema, and the focused tests.
7. **Cutover** (Studio downtime of about 15 minutes):
   1. stop `estio-studio-worker`;
   2. `pg_dump` both projects to `/Users/martingreen/Backups/estio-2026-10-28/`, outside the repo;
   3. deploy (the migration creates `studio.*`);
   4. run the copy and verify;
   5. run the readiness check against the CRM database, then restart the worker.
   6. Verify:
      - the Substo Location shows 10 records, 4 sources, 200 insights and 1,738 units;
      - old frames load from their old R2 keys;
      - Estio Studio opens;
      - the Mac reconnects.
8. The old Studio project stays **untouched, read-only fallback**; do not delete it.

**Rollback (stage 2):** redeploy the stage-1 build, which still reads the Studio project; that project was never written during the move. Then `drop schema studio cascade` and delete the migration's `_prisma_migrations` row. Writes made after the cutover are lost, which is acceptable with no real users. The CRM dump covers anything else.

**Stage 3: clean up and re-measure.**
- Remove `STUDIO_SUPABASE_*` from runtime code, the deploy check and the docs, and remove the provider-specific degraded mode (general database error handling stays).
- Drop `Location.studioWorkspaceId` in its own Prisma migration.
- Re-measure the stage 0 table above.
- Update `how-the-app-works.md` and the progress log.

## Paid-plan contingency (going live)

**When to upgrade the org to Pro** ($25 a month, includes $10 of compute). Upgrade at the first of:
- real users, since paying customers need daily backups (Pro keeps 7 days; free has none);
- an egress forecast above 4 GB a month on two consecutive weeks;
- database size above 400 MB;
- sustained pooler clients above 150, or direct connections above 40;
- any restriction notice after the grace period.

**What changes on Pro:**
- limits: 8 GB of database per project, 250 GB of egress, overage $0.09/GB of egress and $0.125/GB-month of disk;
- no pausing, daily backups, and the option to add PITR;
- keep the **spend cap on** until usage is understood;
- move the CRM project to Micro or Small compute only if CPU or RAM saturate;
- delete the old Studio project once the fallback window has passed, freeing a slot (free allows 2 active projects).

**What to monitor** (weekly while on free, daily after launch), in the dashboard "Usage" page or the Management API:
- egress per project;
- database size;
- `pg_stat_activity` count;
- `pg_stat_statements` top rows and calls;
- the worker's claim rate.

**Thresholds:**
- egress at 50% of quota by mid-cycle means investigate; at 80%, upgrade or cut polling;
- database at 80% of its limit;
- p95 page TTFB above 1 s;
- connection-related errors in the logs above 0.

Code needs no change on upgrade. The backoff and caching rules stay, because they cut cost on Pro too.
