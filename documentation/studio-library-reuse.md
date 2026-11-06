# Library source/channel slice reuse audit

Concept: understand saved evidence and connect videos to their actual creator inside Studio.

| Capability | Existing owner | Decision |
|---|---|---|
| Metadata | library-import-metadata / library-import-youtube | Preserve validated channel ID/author URL; never derive handles from names |
| Save/retry | library-import + import API | Extend existing transaction and tenant/idempotency fences for creator links |
| Summary | library-summary / companion handler / SQL request ledger | Reuse subscription-only queue and evidence fingerprint; no new executor |
| Transcript | payload.transcript / uploads / transcription | Display saved text; no public caption client found; no new provider |
| Relations | studio_record_links / record-relations | Video → channel link, reverse read for channel detail |
| Discovery | youtube.ts / studio_youtube_channels / youtube-schedules | Library watch is a saved channel, not manager approval or recurring discovery |
| Editing | LibraryRecordForm | Keep behind native keyboard-accessible disclosure |
| Knowledge | records/[recordId]/extract | Retain existing action |

How: additive payload metadata and existing relations; no new tables, jobs, cron, pairing or production changes. Platform Build development remains separate. Existing approved specification must remain immutable; parent owns ledger contract updates.

Next: optional latest-video browsing remains in existing Discovery until a bounded reuse integration is validated.

## Story for the existing Build record

Area: Studio Library

Concept: Make saved research understandable and connect sources to their real creators without another discovery system.

Achieved: Source detail separates original description, saved transcript, AI evidence basis and human notes. Editing is disclosed. Validated creator metadata survives import; watching reuses channel records and existing links.

How it works: Open a saved source, inspect its evidence, request metadata/summary recovery, or watch its recorded creator inside Studio. Channel detail shows linked saved sources. Existing approval and schedule controls remain authoritative.

Next: Parent attaches this story and evidence to the existing Library record/concept once its exact contract is supplied. No immutable approved spec is changed. Signed-in OAuth/companion and real database transaction acceptance remain integration checks; no production write is justified solely for testing.

## Local validation

35 focused import/creator/presentation/link tests and 10 existing browse/card/enrichment tests pass. Focused strict TypeScript passes for changed runtime modules, detail UI and creator tests. Production build exits 0; its global type validation remains skipped by existing configuration. No whole-project type-clean claim.

Desktop (1440×844) and phone (390×844) fixtures render the actual detail page with stubbed form/actions/attachments. Populated and empty evidence, original-source destination, preserved notes, overflow and native disclosure keyboard activation pass. Screenshots: `/tmp/library-detail-{1440,390}.png` and `/tmp/library-detail-empty-{1440,390}.png`. Existing browse/modal UI tests pass; this is not signed-in browser or real provider acceptance.

T3 preview status exposed no tabs; two corrected HTTP opens returned `Too many server browser tabs are open. Close one with t3_preview_close, or reuse a tabId from preview_status tabs.` Used a separate headless Playwright fixture browser; no human tabs/logins were operated. No new database transaction acceptance, real import, provider execution or recurring schedule was run against production.
