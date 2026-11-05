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

## First-viewport correction (2026-11-05, deployed)

The owner found that the always-visible add form, header spacing and idle “0 updated” message dominated the Library's first viewport. In the isolated release checkout, Library now puts a compact title / Add source row, view tabs and platform filters before the saved cards. The duplicate videos/posts heading, breadcrumb and introductory copy were removed. Creation is disclosed only through the header action or a user-activated empty-state action; the empty view does not auto-open it. Background enrichment behavior remains intact, with only active progress shown near content and no completed/no-op telemetry.

The shared Radix/shadcn Dialog supplies modal semantics, focus containment, Escape and focus return. The dialog has a labelled title/description, initially focuses the URL input, fits phone widths and scrolls within short viewports. Imports retain the tenant fence, pending/error handling and stable UUID retries. The dialog stays open on save so the truthful saved-source result and any server summary enqueue error remain visible.

Durable policy: [UI design principles](ui-design-principles.md), linked from AGENTS.md. The parent owns the existing Build memory write; this implementation does not create another memory record.

Verification for this correction:

- 19 focused component/presentation/enrichment tests pass; focused strict TypeScript for the affected UI components/tests passes (`/tmp/studio-library-correction-qa/types.log`); `git diff --check` passes. No production build, commit or deployment was run by this implementation child.
- T3 preview reached the local harness but two snapshots failed with `Preview automation snapshot timed out after 15000ms.` Its requested resize also reported a different measured viewport. A separate headless Playwright browser was used; no human-owned Chrome tab or saved login was operated.
- The browser harness mounts the actual LibraryBrowse/Dialog/ImportForm/Cards components with existing compiled app styles, fixture records and a placeholder 56px shell header. At measured **1440×900**, first card top was **217px**, document width **1440px**. At **390×844**, first card top was **243px**, document width **390px**. These are viewport-specific observations, not a universal pixel requirement or signed-in production-shell acceptance.
- Populated and empty screens plus dialogs were captured at both sizes. Browser checks passed keyboard open, input initial focus, Tab/Shift+Tab containment, Escape and focus return. Synthetic intercepted imports verified pending disabled controls, error presentation, same-key retry, tenant header and saved-source success with summary error remaining in the open dialog. No real import, provider or subscription request was executed by the harness. There were no browser page errors.
- Private local artifacts: `/tmp/studio-library-correction-qa/` contains the harness, `check.cjs`, `results.json`, `populated-1440.png`, `populated-390.png`, `dialog-1440.png`, `dialog-390.png` and both empty-state screenshots. No public fixture route was added. Final signed-in shell acceptance and deployment belong to the parent/original deployment agent.

### Correction production evidence

Deployed source `7593c2e008ee7d08b630c674b094fb4cf2574707`, build `4qEh7QykvJ0QPnDc9PLIx`, blue/3001. Owned migrate-only workflow completed, no pending migrations, Caddy/soak and health/version passed, required PM2 services online with zero restarts. The quota interruption was reconciled using the original log and live build; no rerun occurred.

Signed-in Substo populated desktop (1280×639) and mobile (390×844) showed first cards at 216px/243px and no horizontal overflow. Live keyboard open, initial input focus, focus containment, Escape and return passed. Mobile dialog fit inside the viewport. Estio's signed-in mobile empty state remained closed until its action was activated, then opened with input focus; no overflow. Browser sizing was reset. Pending/error/retry/saved-result testing remains the implementer's intercepted harness evidence, not a new real production import. Companion execution and connected OAuth remain unverified; no pairing, processing policy or provider login command was changed. Root preservation and integration safeguards are in current status.

## Combined canonical release (2026-11-05 16:37 UTC)

The phase-6-only deployment had overwritten the Library UI. The canonical release now merges both histories: source `9fd35f7c606c4e7b08d0ddd8711f0e80f10c4cef`, build `-aZklYFFXKdbz9FJou0VU`, blue/3001, server manifest published after soak. Browse-first cards/dialog are live again while SiteConfig retirement and canonical business services remain. Signed-in both-app/mobile/modal checks passed; production companion and connected OAuth remain unverified. Earlier standalone branch/integration-pending instructions above are historical. Root duplicate edits are reconciled and its working branch contains the combined code; [release workflow](release-workflow.md) enforces the single clean canonical checkout.
