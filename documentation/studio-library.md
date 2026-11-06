# Studio Library

Library is shared by Estio and Substo and scoped to the active Location. The deployed baseline and release evidence live in [current status](current-status.md); source changes below require canonical integration before deployment.

## Current source capabilities

Saved-source browsing puts cards, platform filters and view controls first. Add source uses the existing accessible dialog. Thumbnails open original platform sources; details keep the original-source link visible. Editing is disclosed through a native keyboard-accessible Edit control.

Details separate source description, saved transcript, AI summary with its recorded basis, and human research notes. Description-only summaries explicitly do not claim to have watched video contents. Transcript summaries use at most the first 20,000 saved characters plus available description. Uploaded transcripts retain the existing attachment/transcription UI. Missing text is reported truthfully; users can refresh metadata, edit saved evidence and request analysis using the existing import/summary path. Knowledge extraction retains its existing action.

Imports preserve validated YouTube channel URLs from OAuth snippet IDs or oEmbed author URLs, never inferred creator handles. A saved video's Watch channel action reuses the existing channel record and record-link transaction. Details link creators and show reverse-linked saved videos. Channel-ID dedupe, active Location membership, origin/tenant checks, source version checks and stable request keys protect saves and retries. Unknown payload and provenance fields remain preserved.

Watching is an internal Library relationship. It does not subscribe on YouTube, approve discovery channels, or enable monitoring. `studio_youtube_channels` remains the manager-controlled approval list used by existing Discovery and its schedules; a Library channel is neither an approval nor a schedule. Existing discovery approvals are not changed by this slice.

## Runtime prerequisites and evidence

Summaries reuse the durable SQL request ledger and existing account-scoped subscription companion, readiness and capacity checks. The requesting account needs its own paired running Node companion, text-processing opt-in, subscription sign-in and capacity readings. No paid fallback, caption provider, new table, scheduler or worker is added. Existing payload/upload transcripts are supported; automatic public YouTube captions are not available in this slice.

Reuse decisions: [audit](studio-library-reuse.md). Focused validation artifacts for this slice are `/tmp/library-slice-tests.log`, `/tmp/library-slice-types.log` and `/tmp/library-slice-build.log`. These do not establish production companion/OAuth acceptance. No production records, jobs, pairing or schedules were changed.

## Next

Optional bounded latest-video browsing should reuse Discovery and its save tickets. Automatic caption retrieval, autonomous research and suggested channels remain roadmap items. The parent owns updates to the existing Build concept/ledger contract; approved specifications remain immutable and Platform Build feature development is separate.

## Import proxy-origin regression

The import route previously compared the browser's public Origin with Next's internal HTTP origin, rejecting valid imports behind Caddy. It now uses the shared proxy-aware request-origin policy with this request's host/protocol, still requires a well-formed browser Origin and rejects `Sec-Fetch-Site: cross-site`. No global second-app origin is added to the allowlist. Active Location, account, impersonation and transaction fences remain unchanged. The error now explains failed origin verification and suggests reloading Studio.

Route regression tests cover public Substo/Estio origins with internal Next URLs and forwarded headers, missing/malformed/unrelated origins, cross-site requests, and both reported URL forms for video `KD71g4TK6Sg`. Local tests are synthetic and perform no real import or production write. Release integration/build/deployment remains owned by the parent.

## Deployed acceptance — 2026-11-06

Source `b7f5b6ccbc1c18ede5bd61580648da5a92c96ea7`, build `JdPUNcImpHWUj3bSyrix0`, blue/3001. The canonical merge retains all newer platform/business work and includes the proxy-origin correction. Owned migrate-only deploy, health/version, PM2 and soak passed; no pending migrations or rollback. 54 focused tests, strict affected types and real disposable creator/link transactions pass. Both public hosts accept valid browser Origins through to the tenant fence and reject missing/cross-site/unrelated Origins. Signed-in source/channel display and keyboard/mobile detail acceptance passed on existing Substo data; Estio empty Library renders. Real authenticated import/Watch save and companion generation were not submitted as tests. Legacy sources without recorded creators need user refresh/import before Watch appears. No automatic captions, YouTube subscription or monitoring is introduced. See current status for exact acceptance limits and evidence.
