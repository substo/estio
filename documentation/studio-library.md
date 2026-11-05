# Studio Library

Deployed 2026-11-05, isolated from unfinished phase 6. Shared by Estio and Substo under the canonical active Location and account authority. The owner explicitly authorized the isolated release and migrate-only production deployment on 2026-11-05.

## Behavior

- Cards use original-platform thumbnails and links, with platform-appropriate formats consistent with the app. Videos/posts and watched channels have separate views, with platform filters and format-aware sections.
- Compact URL/@handle import obtains metadata automatically. Existing sources also enrich automatically: at most five per view, sequentially, using stable source UUIDs and a tenant fence. Persisted `complete` / `missing_description` results prevent repeated enrichment loops.
- Connected OAuth is preferred for metadata. Quota and version checks protect processing and result application.
- Generated `aiSummary` stays separate from research notes. Evidence fingerprints make summary generation idempotent. Summaries use account-scoped subscriptions through the scoped account companion, respect capacity and never fall back to a paid API or another account.

Preserve saved content, original media, immutable provenance and recovery safeguards. Autonomous research and channel suggestions remain planned, not implemented launch capabilities.

## Subscription prerequisites

Apply the subscription SQL migration through the normal release workflow. The requesting account needs its own paired, running **Node companion**, text-processing opt-in, actual subscription sign-in and the QuotaCell helper for capacity readings. A native Swift app extension is not implemented; that connector is not yet in source. Pairing or local mock tests alone do not establish a working live subscription session.

## Verification and remaining acceptance

- Parent's combined suite rerun on final source: **134/134 tests passed**, zero failures (`/tmp/studio-library-final-tests.log`). Final SQL verification rerun exited 0 (`/tmp/studio-library-final-sql.log`).
- Production build passed before the final small fixes (`/tmp/studio-library-build.log`). The final production build **passed**, exiting 0 after generating 133 pages (`/tmp/studio-library-final-build.log`).
- Strict focused TypeScript checking of the new core presentation, import metadata, summary routing, Build tracking and usage modules exited 0 (`/tmp/studio-library-focused-types.log`). The whole-project compiler was manually stopped after more than ten minutes without a result (`/tmp/studio-library-types.log`); there is no whole-project type-clean claim.
- A live **local subscription smoke passed** (`/tmp/studio-library-live-subscription.log`): real `readUsage` selected Codex, the adapter authenticated through ChatGPT, and the real native default returned a valid summary of a public synthetic description. No API fallback was used.
- Full production paired-device end-to-end execution remains **unverified** because the migration and deployment have not been performed. Live connected YouTube OAuth and responsive signed-in acceptance also remain unverified. A desktop fixture rendered; T3 preview snapshots failed and Chrome debugging was unavailable while the user was driving. Fixture rendering does not replace those checks.

These are local implementation checks, not deployment evidence. Historical signed-in acceptance in current status predates this redesign.

## Build tracking

Implementation belongs to T3 thread `73b15758-ef2d-45c2-9055-69d72ce849f6`. The existing Build ledger ID is `external-t3:73b15758-ef2d-45c2-9055-69d72ce849f6`; no duplicate queued implementation or Atlas intake is needed. The parent updates the tracking revision and review evidence after final verification. External reports do not grant merge or deployment authority.

## Isolated release input

Base `84765413` (phase 5), verified against live build `787P0nnbWuoEsS5ab74wp` and `/tmp/deploy-phase5.log`. Release checkout `/tmp/estio-library-release-20261105`, branch `release/studio-library-20261105`. Only the 40 Library-owned files were transferred. Prisma schema is unchanged; only migration `20261105140000_studio_library_summary` is added. Root index and tracked/untracked file hashes captured privately in `/tmp/studio-library-release-evidence`. No phase-6 fields or retirement migration are included.

Isolated verification: 113 focused tests passed; disposable SQL assertions passed. Existing companion pairing exists but no running Node companion or LaunchAgent was found; no queue loop, pairing, login or opt-in was started. Preview opens to sign-in; signed-in mobile and connected OAuth acceptance remain open.

## Production release evidence

Source `ae4204c12434fb5028cd02064cc06e0d0052c78f`, build `5GYm7caXnqjTVofK9kTx7`, green/3002. Owned migrate-only workflow exited 0; additive Library migration applied, Caddy validation/20-second soak passed, no rollback. Health/version and required PM2 services passed. Signed-in desktop Library rendered on Estio and Substo with original-platform thumbnails loaded and research notes preserved; subscription waiting status is visible. Build renders the external-review card in Now with exact anchor; ledger revision 4 records deployment. Earlier pending-approval statements above describe historical local checks, not current release authority.

No whole-project type-clean, signed-in mobile, connected OAuth or production paired-device generation claim. Existing Node companion pairing remains preserved but no running process/LaunchAgent was found; safe activation requires controlled queue/login-command review and existing text opt-in/subscription readiness. Source is available in the isolated release checkout; no new pairing or opt-in was enabled. Root integration instructions and private manifest/log paths are in current status.
