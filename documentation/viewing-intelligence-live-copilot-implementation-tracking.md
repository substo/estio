# Viewing Intelligence Live Copilot Implementation Tracking

## Purpose

This document records the exact state of the Viewing Intelligence Live Copilot implementation in the IDX codebase.

It is intended to do three things:
- capture the original implementation intent in one place
- describe what is actually implemented right now
- make the remaining gaps and improvement opportunities explicit so future planning is grounded in reality

This document should be treated as the current technical handoff for the feature.

Related existing doc:
- `documentation/viewing-creation-architecture.md`

---

## 2026-04-02 Hardening + Native Audio Prep Update

This implementation slice is now layered on top of the original text-first foundation.

## 2026-04-03 Next Wave Update (Truth + Pipeline + Relay + Retention)

This slice implements the next-wave foundation from the live-copilot plan:

- thread identity and provenance hardening:
  - `ViewingSession.sessionThreadId` (with backfill migration for chained sessions)
  - message provenance/status fields (`origin`, `provider`, `model`, `modelVersion`, `transcriptStatus`, `translationStatus`, `insightStatus`)
  - insight provenance expansion (`source`, `provider`, `model`, `modelVersion`)
  - summary provenance expansion (`source`, `modelVersion`, `usedFallback`, `generatedByUserId`)
- pipeline split:
  - Stage 2a translation queue (`viewing-session-translation`)
  - Stage 2b insight queue (`viewing-session-insights`)
  - backward-compatible `analysisStatus` stays derived from translation/insight status
- transcript canonicalization and revision UX:
  - append-only corrections via `supersedesMessageId`
  - effective transcript rendering in client/admin UIs hides superseded rows by default
  - revision history remains available on demand
- consent gating hardening:
  - explicit client disclosure checkbox in join UX
  - `live-auth` and relay reject client transport when consent is missing
  - admin cockpit surfaces consent status
- transport state machine enforcement:
  - invalid transitions rejected with API 409 errors
  - events now include both `previousTransportStatus` and `nextTransportStatus`
- backend relay handoff expansion:
  - live-auth now returns relay websocket URL + relay session token + thread metadata
  - relay endpoint metadata reflects dedicated backend relay transport
  - dedicated process entrypoint added: `scripts/start-viewing-live-relay.ts`
- policy hardening:
  - v1 live tool policy is read-only (`resolve_viewing_property_context`, `search_related_properties`, `fetch_company_playbook`)
  - model-input redaction for emails/phones/id-like tokens/internal notes before analysis/summary prompting
- retention artifact split:
  - new retention cleanup module removes conversation artifacts (messages/insights and non-final summaries)
  - preserves `ViewingSessionEvent`, `ViewingSessionUsage`, and final summary business records
  - cleanup available via:
    - cron route: `GET /api/cron/viewing-session-retention`
    - script: `npm run ops:viewings:retention`

### Newly delivered in this slice

- Session hardening fields and policy snapshotting:
  - `ViewingSession.transportStatus`
  - `ViewingSession.liveProvider`
  - `ViewingSession.consentStatus`
  - `ViewingSession.appliedRetentionDays`
  - `ViewingSession.transcriptVisibility`
  - `ViewingSession.estimatedCostUsd`
  - `ViewingSession.actualCostUsd`
  - `ViewingSession.lastTransportEventAt`
- Message hardening fields:
  - `ViewingSessionMessage.sequence`
  - `ViewingSessionMessage.sourceMessageId`
  - `ViewingSessionMessage.messageKind`
  - `ViewingSessionMessage.persistedAt`
  - `ViewingSessionMessage.supersedesMessageId`
  - uniqueness/indexing for `(sessionId, sequence)` and `(sessionId, sourceMessageId)`
- New append-only audit and metering models:
  - `ViewingSessionEvent`
  - `ViewingSessionUsage`
- Premium-voice feature gating:
  - `lib/viewings/sessions/feature-flags.ts`
  - `assistant_live_voice_premium` is now blocked in create/live-auth when feature-flagged off
- Message API contract update:
  - server-side per-session sequencing in transaction
  - idempotent `sourceMessageId` handling
  - `supersedesMessageId` validation
- Pipeline split:
  - Stage 1: persisted message + immediate SSE
  - Stage 2: fast message analysis worker (translation + insights)
  - Stage 3: debounced synthesis queue (`viewing-session-synthesis`) for draft/final summary updates
- Summary pipeline hardening:
  - `ViewingSessionSummary.status` now supports `draft | generating | final | failed`
  - dedicated LLM summary step with fallback to heuristic builder
  - usage/cost accounting added for summary generation
- Usage accounting now recorded for:
  - analysis token usage
  - summary token usage
  - relay-reported audio/token/tool usage
- Join-flow consent and policy enforcement:
  - `aiDisclosureAccepted` now supported and enforced when required
- Realtime event surface extended:
  - `viewing_session.transport.status.changed`
  - `viewing_session.usage.updated`
- Location policy settings wired in admin AI settings:
  - viewing-session retention days
  - transcript visibility
  - AI disclosure required
  - raw audio storage enabled flag (default off)

### Relay status in this slice

- Added backend relay endpoint:
  - `POST /api/viewings/sessions/[id]/relay`
  - handles authenticated relay event ingestion for transport, transcript/tool messages, and usage
  - persists events/messages/usage and emits SSE updates
- `GET /api/viewings/sessions/[id]/relay` currently reports:
  - `websocketUpgradeSupported: true`
  - relay metadata now points clients at the dedicated backend relay process while this route remains the persisted ingestion boundary

## 2026-04-03 Hardening Wave Two Update (Lineage + Consent Audit + Stage Routing + Reprocess)

This slice closes the next operational gaps that remained after the truth/pipeline/relay pass.

Delivered in this wave:

- transcript lineage is now explicit:
  - `ViewingSessionMessage.utteranceId`
  - legacy rows backfilled to root lineage ids
  - correction rows inherit the superseded row's `utteranceId`
  - effective transcript rendering now means "latest non-superseded row for each utterance lineage"
- consent audit is now first-class:
  - `ViewingSession.consentAcceptedAt`
  - `ViewingSession.consentVersion`
  - `ViewingSession.consentLocale`
  - `ViewingSession.consentSource`
  - `SiteConfig.viewingSessionAiDisclosureVersion`
- stage-level model routing is now snapshotted onto the session:
  - `ViewingSession.translationModel`
  - `ViewingSession.insightsModel`
  - `ViewingSession.summaryModel`
  - location/site settings can override each worker stage independently
- sanitization is now path-specific:
  - translation uses raw utterance text
  - insights and summary prompts use sanitized context and transcript previews
  - live tool outputs are sanitized before being sent back into the live model
- relay read-only tools are now budgeted:
  - 6 calls/minute/session
  - 2 concurrent calls/session
  - 4-second timeout
  - TTL caching for property context, playbook, and related-property search
- insight generation now has explicit current-generation semantics:
  - `ViewingSessionInsight.supersededAt`
  - `ViewingSessionInsight.generationKey`
  - current insight queries filter `supersededAt IS NULL`
- admin/agent reprocessing is now supported:
  - `POST /api/viewings/sessions/[id]/reprocess`
  - `target: "message_analysis"` reruns translation + insights for the effective utterance
  - `target: "summary"` regenerates draft/final summary from effective transcript rows and current unsuperseded insights
- usage authority is now explicit:
  - `ViewingSessionUsage.usageAuthority`
  - `ViewingSessionUsage.costAuthority`
  - worker rows are written as `derived / estimated`
  - relay rows are written as `provider_reported / estimated` unless the provider exposes billed cost

### Newly delivered in this slice

- schema and migration:
  - `prisma/migrations/20260403120000_viewing_session_hardening_wave_two/migration.sql`
- admin AI settings now expose:
  - disclosure version
  - translation model override
  - insights model override
  - summary model override
- admin cockpit now surfaces:
  - consent metadata
  - stage model routing
  - recent usage authority labels
  - transcript reprocess actions
  - summary regenerate actions
- focused automated coverage now includes:
  - utterance lineage selection
  - path-specific redaction behavior
  - stage-model routing defaults and overrides
  - usage authority/cost authority defaults

## 2026-04-03 Quick Field Assist Update (Instant Entry + Progressive Context)

This slice adds the missing field-operations product layer without replacing the existing `ViewingSession` backbone.

Delivered in this wave:

- `ViewingSession` now supports quick-operational modes and progressive enrichment:
  - `sessionKind` (`structured_viewing | quick_translate | listen_only | two_way_interpreter`)
  - `participantMode` (`agent_only | shared_client`)
  - `speechMode`
  - `savePolicy`
  - `entryPoint`
  - `quickStartSource` (`global | property | contact | viewing`)
  - `assignmentStatus`
  - `assignedAt`
  - `assignedByUserId`
  - `contextAttachedAt`
  - `convertedFromSessionKind`
- `viewingId`, `contactId`, `primaryPropertyId`, and join credentials are now nullable for instant-start sessions.
- Fast-start APIs were added:
  - `POST /api/viewings/sessions/quick-start`
  - `PATCH /api/viewings/sessions/[id]/context`
  - `POST /api/viewings/sessions/[id]/convert`
  - `POST /api/viewings/sessions/[id]/close`
  - `GET /api/viewings/sessions/thread/[threadId]/preview`
  - `POST /api/viewings/sessions/[id]/audio-transcribe` (fallback clip transcription)
- Runtime policy is now session-kind aware through `resolveViewingSessionPipelinePolicy(...)`:
  - structured sessions keep full pipeline behavior
  - quick/listen/interpreter sessions default to transcript + translation fast path
  - quick modes disable automatic insights/summary/tool invocation by default
- Internal field UI is now split:
  - structured sessions continue to use the cockpit
  - non-structured sessions now render a mobile-first quick assist surface with:
    - `Speak`, `Listen`, `Share` controls
    - live translation-first transcript presentation
    - attach-context dialog
    - save/discard controls
    - relay mic capture + audio-clip + browser-STT fallback path
- Admin navigation and entrypoints now support one-tap quick assist:
  - dedicated sessions index/assignment queue page
  - top-nav and sidebar quick entry
  - contextual quick-start from contact, property, and viewing workflows
- Contact timeline support now includes:
  - `VIEWING_SESSION_SAVED`
  - `VIEWING_SESSION_ATTACHED`
  - preview modal fetch via `sessionThreadId`
- Shared mode conversion now lazily issues join credentials and returns domain-aware join URL.
- Relay now accepts agent-side microphone streaming events in quick internal mode.

## 2026-04-03 Production Incident Analysis (Live Relay Connection Failed)

Session analyzed:
- `ViewingSession.id = cmnj8aogp000ca4ryk8nkfege`
- Admin URL: `https://estio.co/admin/viewings/sessions/cmnj8aogp000ca4ryk8nkfege`

Observed timeline (UTC and local Cyprus time):
- `2026-04-03 18:21:00Z` (`2026-04-03 21:21:00` EEST): first `viewing_session.live_auth.issued` and transport moved to `connecting`
- `2026-04-03 18:21:16Z`, `18:22:41Z`, `18:23:52Z`: additional `live-auth` attempts; transport remained `connecting`
- no `connected`, `reconnecting`, or relay `disconnect` transition was persisted for this session

Evidence captured:
- `ViewingSession.transportStatus` remains `connecting`
- repeated `viewing_session.live_auth.issued` + `viewing_session.transport.status` events from `api.live-auth`
- no relay-origin transport transition events (`source: relay`) were persisted
- no session-id hits in PM2 app logs for this session id
- production host had no listener on `:8788` and no dedicated relay process running (`scripts/start-viewing-live-relay.ts`)
- `VIEWING_SESSION_BACKEND_RELAY_WS_URL` was not set in deployed `.env`, so app fallback is `ws://127.0.0.1:8788/ws`
- current `/etc/caddy/Caddyfile` does not expose a public websocket route for relay traffic

Most likely failure chain:
1. `live-auth` succeeds and returns relay metadata.
2. Browser attempts websocket connection using fallback relay URL behavior.
3. Dedicated relay process is not reachable/running, so websocket never opens.
4. UI surfaces `Live relay connection failed.` while session remains stuck in `connecting`.

Immediate operational remediation:
1. Run relay process under process supervision (PM2/systemd), e.g. `npm run start:viewing-live-relay`.
2. Set `VIEWING_SESSION_BACKEND_RELAY_WS_URL` to a browser-reachable `wss://` endpoint.
3. Add Caddy websocket reverse-proxy route for relay path to relay port (`8788` by default).
4. Add relay health checks/alerts (`/health`) and restart policy.
5. Validate by confirming DB event sequence: `live_auth.issued -> transport connecting -> transport connected (source=relay)`.

Recommended production-grade debugging/tracking baseline:
- structured correlation ids in all logs: `sessionId`, `sessionThreadId`, `locationId`, `requestId`, `transportStatus`, `eventType`, `source`
- funnel counters and rates:
  - `live_auth_issued_total`
  - `relay_ws_open_total`
  - `relay_ws_open_failed_total` (with reason/category)
  - `transport_connected_total`
  - `transport_connecting_timeout_total` (no connected event within N seconds)
- latency SLOs:
  - P50/P95 time from `live_auth.issued` to first `connected`
  - P50/P95 time from audio input to first transcript persist
- synthetic canary checks every 5-10 minutes:
  - obtain live-auth for a test session
  - open relay websocket
  - post a short transcript/audio payload
  - assert persisted relay message + transport connected event exists
- alerting thresholds:
  - zero `transport_connected` events over rolling window
  - abnormal spike in `relay_ws_open_failed_total`
  - relay health endpoint down for >2 consecutive checks

## 2026-04-03 Production Reliability Fix Applied (Relay Runtime + Gatekeeping)

Implemented in codebase:
- `live-auth` now performs relay health validation before issuing live transport credentials.
- `live-auth` now rejects loopback-only relay websocket URLs for non-local/browser requests.
- relay diagnostics are now returned with explicit failure codes:
  - `LIVE_RELAY_UNAVAILABLE`
  - `LIVE_RELAY_WS_URL_INVALID`
- session events are now written for relay bootstrapping failures:
  - `viewing_session.live_auth.relay_unavailable`
  - `viewing_session.live_auth.relay_url_invalid`
- relay websocket URL resolution is now environment/host aware and no longer defaults blindly to a browser-unreachable loopback URL in production.
- deploy runtime now ensures:
  - dedicated relay PM2 process is started (`estio-viewing-live-relay`)
  - relay readiness check passes (`/health`)
  - Caddy has a websocket route for `/viewings-live-relay/*`
- relay process bind default is now localhost (`127.0.0.1`) and is intended to be exposed through Caddy only.

---

## Executive Summary

The live copilot has been introduced as a new first-class layer on top of the existing `Viewing` scheduling and sync system.

The existing scheduling/sync architecture remains intact:
- `Viewing` is still the scheduling source of truth
- Google Calendar and GHL sync still flow through the existing viewing outbox/sync engine

The new implementation adds:
- `ViewingSession` and related live-session tables
- secure tenant-facing join links with token + PIN
- role-scoped session JWT access
- session SSE realtime events
- persisted session messages and AI insights
- a queue-backed analysis pipeline
- an admin cockpit page
- a lightweight tenant client join page
- post-session summary generation

Important reality check:
- the feature now supports internal quick-start field operations, including admin/browser mic capture through the backend relay plus clip/STT fallback
- the public shared client path is still mostly text-first and does not yet provide a full browser-native Gemini Live media session
- current "live" behavior still depends on persisted messages, SSE updates, relay events, and backend staged analysis/synthesis

---

## Original Product Intent

The intended product shape was:
- keep existing viewing scheduling as-is
- introduce a new live session layer anchored to viewing/contact/property/agent
- support two live modes:
  - `assistant_live_tool_heavy`
  - `assistant_live_voice_premium`
- give the client a minimal tenant-branded mobile experience
- give the agent a realtime cockpit with transcript, objections, replies, pivots, and summary
- preserve original utterances and translated utterances
- use property/contact/company context for grounded analysis
- generate post-viewing structured sales intelligence

That remains the north star.

---

## Current Scope Delivered

### Delivered

- New Prisma models for live viewing sessions:
  - `ViewingSession`
  - `ViewingSessionMessage`
  - `ViewingSessionInsight`
  - `ViewingSessionSummary`
- Additional append-only/audit and metering models:
  - `ViewingSessionEvent`
  - `ViewingSessionUsage`
- Manual SQL migration for the new schema
- Secure join flow with:
  - hashed join token
  - hashed PIN + salt
  - failed attempt counting
  - temporary lock window
  - join audit trail
- session-level AI disclosure enforcement and consent snapshotting
- Role-scoped session JWTs for client/agent access
- Viewing-session server actions:
  - create
  - start
  - pause
  - complete
- Viewing-session API surface:
  - join
  - events
  - messages
  - live-auth
  - relay
  - insight state override
  - quick-start
  - context attach
  - session convert
  - session close
  - session-thread preview
  - audio-transcribe fallback
- Realtime SSE channel with replay support
- Queue-backed multi-stage processing:
  - Stage 2 message analysis
  - Stage 3 debounced/final synthesis
- Context assembler using property/contact/location data
- Hybrid objection layer:
  - static objection library
  - model-generated phrasing/insights
- Post-session summary generation:
  - dedicated LLM summary step
  - heuristic fallback
  - summary text
  - CRM note
  - follow-up drafts
  - next-step recommendations
- server-side message sequencing and idempotent `sourceMessageId` handling
- transport-state tracking and chained-session transport rollover handling
- usage/cost accounting for analysis, summary, and relay-reported live usage
- premium voice canary/env feature gating
- Admin cockpit UI for a single session
- Tenant-facing join page with minimal session UI
- "Start Live Session" entrypoint from the existing viewing manager
- One-tap quick assist start from:
  - global launcher
  - contact context
  - property context
  - viewing context
- Session chaining logic for 15-minute live-window rollover
- Gemini model/mode resolver and live config scaffolding
- Session-kind fast-path policy routing for quick/listen/interpreter modes
- Internal quick assist UI with:
  - `Speak` / `Listen` / `Share` controls
  - progressive context attachment
  - save/discard flow with assignment semantics
  - relay mic + clip + browser-STT fallback capture modes
- Dedicated admin sessions index page with assignment queue
- Contact timeline preview actions for saved/attached session threads
- Location-level viewing-session policy settings in admin AI settings:
  - retention
  - transcript visibility
  - AI disclosure requirement
  - raw audio storage flag

### Not Delivered Yet

- full public-client browser microphone PCM capture and push-to-talk relay parity
- fully validated production-grade vendor audio playback path on public shared sessions
- ephemeral Google Live auth tokens for direct browser-to-Google Live sessions
- automatic related-property ranking/search engine
- rich company knowledge-base retrieval
- route-level automated tests for join/message/realtime/relay flows
- production process documentation for relay/worker bootstrap and scheduling

---

## Current Code Map

## Schema and migration

- `prisma/schema.prisma`
- `prisma/migrations/20260402182000_viewing_session_live_copilot/migration.sql`
- `prisma/migrations/20260402223000_viewing_session_hardening_native_audio/migration.sql`
- `prisma/migrations/20260403003000_viewing_session_next_wave/migration.sql`
- `prisma/migrations/20260403120000_viewing_session_hardening_wave_two/migration.sql`
- `prisma/migrations/20260403153000_viewing_session_quick_field_assist/migration.sql`

## Session backend

- `app/(main)/admin/viewings/sessions/actions.ts`
- `app/api/viewings/sessions/join/route.ts`
- `app/api/viewings/sessions/events/route.ts`
- `app/api/viewings/sessions/[id]/messages/route.ts`
- `app/api/viewings/sessions/[id]/live-auth/route.ts`
- `app/api/viewings/sessions/[id]/relay/route.ts`
- `app/api/viewings/sessions/[id]/reprocess/route.ts`
- `app/api/viewings/sessions/[id]/insights/[insightId]/state/route.ts`
- `app/api/viewings/sessions/quick-start/route.ts`
- `app/api/viewings/sessions/[id]/context/route.ts`
- `app/api/viewings/sessions/[id]/convert/route.ts`
- `app/api/viewings/sessions/[id]/close/route.ts`
- `app/api/viewings/sessions/thread/[threadId]/preview/route.ts`
- `app/api/viewings/sessions/[id]/audio-transcribe/route.ts`

## Session UI

- `app/(main)/admin/viewings/sessions/[id]/page.tsx`
- `app/(main)/admin/viewings/sessions/[id]/_components/viewing-session-cockpit.tsx`
- `app/(main)/admin/viewings/sessions/[id]/_components/quick-field-assist.tsx`
- `app/(main)/admin/viewings/sessions/page.tsx`
- `app/(main)/admin/viewings/sessions/_components/quick-assist-start-button.tsx`
- `app/(public)/[domain]/viewings/session/[token]/page.tsx`
- `app/(public)/[domain]/viewings/session/[token]/_components/client-session-view.tsx`
- `components/tasks/contact-viewing-manager.tsx`

## Session libraries

- `lib/viewings/sessions/types.ts`
- `lib/viewings/sessions/security.ts`
- `lib/viewings/sessions/auth.ts`
- `lib/viewings/sessions/runtime.ts`
- `lib/viewings/sessions/events.ts`
- `lib/viewings/sessions/usage.ts`
- `lib/viewings/sessions/feature-flags.ts`
- `lib/viewings/sessions/context-assembler.ts`
- `lib/viewings/sessions/objection-library.ts`
- `lib/viewings/sessions/analysis.ts`
- `lib/viewings/sessions/summary.ts`
- `lib/viewings/sessions/live-models.ts`
- `lib/viewings/sessions/gemini-live.ts`
- `lib/viewings/sessions/redaction.ts`
- `lib/viewings/sessions/retention.ts`
- `lib/viewings/sessions/tool-policy.ts`
- `lib/viewings/sessions/transcript.ts`
- `lib/viewings/sessions/session-config.ts`
- `lib/viewings/sessions/pipeline-policy.ts`
- `lib/viewings/sessions/session-service.ts`
- `lib/realtime/viewing-session-events.ts`
- `lib/queue/viewing-session-analysis.ts`
- `lib/queue/viewing-session-insights.ts`
- `lib/queue/viewing-session-synthesis.ts`
- `lib/ai/location-google-key.ts`

## Session tests

- `lib/viewings/sessions/feature-flags.test.ts`
- `lib/viewings/sessions/live-models.test.ts`
- `lib/viewings/sessions/redaction.test.ts`
- `lib/viewings/sessions/retention.test.ts`
- `lib/viewings/sessions/runtime.test.ts`
- `lib/viewings/sessions/tool-policy.test.ts`
- `lib/viewings/sessions/session-config.test.ts`
- `lib/viewings/sessions/pipeline-policy.test.ts`
- `lib/viewings/sessions/transcript.test.ts`
- `lib/viewings/sessions/types.test.ts`
- `lib/viewings/sessions/usage.test.ts`

## Session scripts and ops entrypoints

- `scripts/start-viewing-live-relay.ts`
- `scripts/cleanup-viewing-session-retention.ts`
- `app/api/cron/viewing-session-retention/route.ts`

## Related settings surface

- `app/(main)/admin/settings/ai/page.tsx`
- `app/(main)/admin/settings/ai/actions.ts`
- `app/(main)/admin/settings/ai/ai-settings-form.tsx`
- `lib/settings/schemas.ts`

## Existing viewing architecture intentionally preserved

- `app/(main)/admin/contacts/actions.ts`
- `lib/viewings/sync-engine.ts`
- `documentation/viewing-creation-architecture.md`

---

## Data Model Implemented

## `ViewingSession`

Purpose:
- business anchor for a live conversation
- session-level security and lifecycle
- link between live analysis and the scheduled viewing

Current shape includes:
- links to `Location`, optional `Viewing`, optional `Contact`, optional primary `Property`, current active `Property`, and `User`
- `mode` and `status`
- quick-mode identity and participation fields:
  - `sessionKind`
  - `participantMode`
  - `speechMode`
  - `savePolicy`
  - `entryPoint`
  - `quickStartSource`
  - `convertedFromSessionKind`
- progressive assignment/context fields:
  - `assignmentStatus`
  - `assignedAt`
  - `assignedByUserId`
  - `contextAttachedAt`
- transport/runtime fields:
  - `transportStatus`
  - `liveProvider`
  - `lastTransportEventAt`
- secure join fields (nullable for `agent_only` quick sessions):
  - `sessionLinkTokenHash`
  - `pinCodeHash`
  - `pinCodeSalt`
  - `tokenExpiresAt`
- join protection fields:
  - `failedJoinAttempts`
  - `joinLockUntil`
  - `lastJoinAttemptAt`
  - `lastJoinedAt`
  - `joinAudit`
- consent/policy snapshot fields:
  - `consentStatus`
  - `consentAcceptedAt`
  - `consentVersion`
  - `consentLocale`
  - `consentSource`
  - `appliedRetentionDays`
  - `transcriptVisibility`
- lifecycle fields:
  - `startedAt`
  - `endedAt`
- live config:
  - `audioPlaybackClientEnabled`
  - `audioPlaybackAgentEnabled`
  - `liveModel`
  - `translationModel`
  - `insightsModel`
  - `summaryModel`
- usage rollup fields:
  - `estimatedCostUsd`
  - `actualCostUsd`
- summary caches:
  - `aiSummary`
  - `objections`
  - `keyPoints`
  - `recommendedNextActions`
- chaining support:
  - `chainIndex`
  - `previousSessionId`

## `ViewingSessionMessage`

Purpose:
- canonical stored utterance unit for the session

Current shape includes:
- `speaker`
- `utteranceId`
- `sequence`
- `sourceMessageId`
- `messageKind`
- `persistedAt`
- `supersedesMessageId`
- `originalText`
- `originalLanguage`
- `translatedText`
- `targetLanguage`
- `timestamp`
- `confidence`
- `audioChunkRef`
- `analysisStatus`
- `translatedAt`
- `metadata`

Important hardening details:
- `(sessionId, sequence)` is unique
- `(sessionId, sourceMessageId)` is unique when present
- the API now returns canonical server ordering metadata
- transcript correction/upsert flows can reference `supersedesMessageId`
- correction chains now share a stable `utteranceId`
- default transcript rendering shows the latest non-superseded row per `utteranceId`

## `ViewingSessionInsight`

Purpose:
- live derived intelligence shown to the agent

Current implemented types:
- `key_point`
- `objection`
- `buying_signal`
- `sentiment`
- `reply`
- `pivot`

Current state model:
- `active`
- `pinned`
- `dismissed`
- `resolved`

Important note:
- there is no separate `ViewingRecommendation` table yet
- recommendation/pivot output currently lives as `ViewingSessionInsight` rows of type `pivot`
- current-generation insight queries must filter `supersededAt IS NULL`

## `ViewingSessionSummary`

Purpose:
- structured post-session sales artifact

Current shape includes:
- `sessionSummary`
- `status` (`draft | generating | final | failed`)
- `crmNote`
- `followUpWhatsApp`
- `followUpEmail`
- `translatedFollowUp`
- `propertyComparisonDraft`
- `recommendedNextActions`
- `likes`
- `dislikes`
- `objections`
- `buyingSignals`
- provider/model metadata
- token/cost metadata

## `ViewingSessionEvent`

Purpose:
- append-only lifecycle, audit, transport, and worker event log

Current shape includes:
- `sessionId`
- `locationId`
- `type`
- `actorRole`
- `actorUserId`
- `source`
- `payload`

## `ViewingSessionUsage`

Purpose:
- persisted metering for analysis, summary, and live transport usage/cost

Current shape includes:
- `phase`
- `provider`
- `model`
- `transportStatus`
- `usageAuthority`
- `costAuthority`
- audio seconds
- token counts
- tool call counts
- estimated and actual cost
- arbitrary metadata

---

## Current Runtime Architecture

## 1. Session creation

Two creation paths now exist.

Current flow:
1. Existing viewing is created and synced through the current `Viewing` pipeline.
2. User clicks "Live" from the existing viewing manager.
3. `createViewingSession(viewingId, input)` creates a `ViewingSession`.
4. A secure join token + PIN are generated.
5. Token and PIN hashes are stored, not plaintext.
6. The UI shows:
   - tenant join URL
   - PIN
   - cockpit link

Current implementation notes:
- the session is anchored to an existing `Viewing`
- related properties are stored as `relatedPropertyIds: String[]`
- public join URL generation depends on the location/site domain
- location-level retention/visibility/disclosure policy is snapshotted onto the session at creation time
- premium voice mode is rejected unless enabled by env/canary feature flags for that location

## 1b. Quick field start and progressive enrichment

Quick assist can now start without requiring a pre-existing viewing/contact/property.

Current flow:
1. User triggers quick start from global, contact, property, or viewing context.
2. `POST /api/viewings/sessions/quick-start` creates an active `ViewingSession` with:
   - quick `sessionKind` (default `quick_translate`)
   - `participantMode` default `agent_only`
   - no required viewing/contact/property
3. Quick UI opens immediately on the created session id.
4. Context can be attached later using `PATCH /api/viewings/sessions/[id]/context`.
5. Session can be upgraded using `POST /api/viewings/sessions/[id]/convert`.
6. Session can be closed with explicit retention behavior using `POST /api/viewings/sessions/[id]/close`.
7. Saved quick sessions without contact context can be worked from the assignment queue page.

## 2. Client join flow

Current join path:
1. Client opens tenant path `/viewings/session/[token]`.
2. Client enters PIN.
3. Client must acknowledge AI disclosure when the location policy requires it.
4. `POST /api/viewings/sessions/join` validates:
   - token hash
   - PIN hash
   - expiry
   - lock window
   - location/domain match
5. If valid, backend issues a short-lived session JWT.

Current security behavior:
- repeated failed joins increment `failedJoinAttempts`
- the session locks temporarily after too many bad attempts
- successful joins clear failed-attempt state
- each attempt is appended to `joinAudit`
- join outcomes are also appended to `ViewingSessionEvent`
- consent acceptance/decline is reflected in `ViewingSession.consentStatus`
- consent audit metadata is also snapshotted with accepted timestamp, disclosure version, locale, and source

## 3. Message persistence and analysis

Current flow:
1. Client or agent submits text to `POST /api/viewings/sessions/[id]/messages`.
2. The API assigns the next canonical server `sequence` inside the write transaction.
3. Duplicate `sourceMessageId` values are treated as idempotent success.
4. Message is persisted first.
5. SSE event `viewing_session.message.created` is published immediately.
6. If translation/analysis is still needed:
   - analysis worker is initialized
   - Stage 2 queue job is enqueued
   - inline fallback is used if queue enqueue fails
7. Stage 3 synthesis is enqueued separately using the `viewing-session-synthesis` queue.
8. `runViewingSessionMessageAnalysis(...)` remains as a backward-compatible wrapper around:
   - `runViewingSessionMessageTranslation(...)`
   - `runViewingSessionMessageInsights(...)`
9. Translation stage:
   - uses `ViewingSession.translationModel` with fallback to stage defaults
   - passes raw utterance text to the translation prompt
   - updates translated fields and translation status
10. Insights stage:
   - uses `ViewingSession.insightsModel` with fallback to stage defaults
   - sanitizes context/transcript inputs before prompting
   - supersedes prior current non-manual insights for that message
   - creates new insights with `generationKey`
   - updates session key point/objection caches from unsuperseded rows only
   - publishes `message.updated` and `insight.upserted`
   - records derived/estimated usage rows when model usage data is available
11. Pipeline behavior is now session-kind aware:
   - `structured_viewing` keeps translation + insights + summary + tools behavior
   - `quick_translate` defaults to transcript + translation fast path
   - `listen_only` defaults to translated subtitle fast path
   - `two_way_interpreter` defaults to bidirectional translation with optional speech-back
   - quick modes do not auto-run insights/summary/tools unless explicitly upgraded/converted

Important reality check:
- quick modes now support fast translation loops, but full voice-native Gemini Live behavior is still incomplete
- the core persisted loop remains "persist message/event -> stage processing -> SSE updates"

## 4. Relay and transport runtime

Current relay path:
1. `POST /api/viewings/sessions/[id]/live-auth` returns session transport metadata plus relay auth material.
2. A backend relay token is issued from the existing session token flow.
3. `scripts/start-viewing-live-relay.ts` owns the long-lived backend WebSocket process and vendor Gemini Live session lifecycle.
4. `POST /api/viewings/sessions/[id]/relay` accepts authenticated persisted relay events for:
   - `connect`
   - `disconnect`
   - `transcript`
   - `tool_result`
   - `usage`
5. Relay transcript/tool events are persisted into `ViewingSessionMessage`, then SSE/analysis/synthesis continue from the same persisted pipeline.
6. Relay usage events are stored in `ViewingSessionUsage` and rolled into session aggregate cost.
7. Relay read-only tools now run under per-session budgets, timeout enforcement, and TTL caching.
8. Tool outputs are sanitized before they are returned to the live model.

Current reality check:
- relay support now includes a dedicated backend WebSocket process with Gemini Live session ownership, reconnect handling, tool-call responses, transcript persistence, and usage fanout
- reconnect semantics are now budgeted by both attempt count and elapsed reconnect time, with explicit failure transitions
- persisted DB rows plus Redis/SSE fanout remain the source of truth for UI updates
- internal quick-assist now allows agent microphone relay input, while public shared-client browser media transport is still incomplete

## 5. Realtime transport

Current realtime transport is session-scoped SSE, modeled after conversation realtime events.

Event types currently used:
- `viewing_session.message.created`
- `viewing_session.message.updated`
- `viewing_session.insight.upserted`
- `viewing_session.summary.updated`
- `viewing_session.status.changed`
- `viewing_session.transport.status.changed`
- `viewing_session.usage.updated`

Replay support:
- event history is stored in Redis lists
- `Last-Event-ID` replay is supported

## 6. Post-session summarization

On completion:
1. `completeViewingSession(sessionId)` marks session completed.
2. Stage 3 synthesis runs `upsertViewingSessionSummaryFromInsights(...)`.
3. A dedicated LLM summary step attempts to generate summary artifacts.
4. If the LLM step fails or returns invalid output, the heuristic builder is used as fallback.
5. The summary is stored in `ViewingSessionSummary` with `draft`, `generating`, `final`, or `failed` state.
6. Session cache fields are updated.
7. A CRM note entry is written to `ContactHistory` on final summary generation.
8. `Contact.requirementOtherDetails` is lightly enriched from key points.
9. Summary usage/cost is recorded into `ViewingSessionUsage`.

---

## Auth and Security Model

## Admin/agent auth

Admin-facing access still relies on existing location-scoped dashboard auth:
- Clerk auth
- `verifyUserHasAccessToLocation(...)`
- existing admin-side permission model

## Client/session auth

Client access uses session-scoped JWTs:
- issued only after token + PIN validation
- scoped to `sessionId`, `locationId`, and `role`
- used for:
  - message posting
  - SSE events
  - live-auth refresh
  - relay event ingestion

## Join secret handling

Implemented safeguards:
- join token is stored as a deterministic hash
- PIN is stored as salted hash
- plaintext token/PIN only exist at creation time in the returned share payload

## Domain protection

Join validation checks that:
- the resolved session belongs to the matching location
- the request host matches the expected tenant domain when applicable

## Audit and metering

Additional operational hardening now exists via:
- `ViewingSessionEvent` for append-only lifecycle/auth/worker/relay events
- `ViewingSessionUsage` for persisted cost and usage records
- session-level aggregate `estimatedCostUsd` and `actualCostUsd`

---

## Current AI and Live Model Strategy

## Mode support implemented

Two modes exist in code:
- `assistant_live_tool_heavy`
- `assistant_live_voice_premium`

Mode mapping:
- `assistant_live_tool_heavy` -> `gemini-2.5-flash-native-audio-preview-12-2025`
- `assistant_live_voice_premium` -> `gemini-3.1-flash-live-preview`

Availability strategy:
- `assistant_live_tool_heavy` is the default broadly available mode
- `assistant_live_voice_premium` is now gated by env/canary feature flags per location

## What is implemented

Implemented today:
- mode constants
- mode-to-model resolution
- per-stage worker model resolution and session snapshotting
- capability metadata per mode
- cost estimation helpers
- backend live-auth response payload builder
- location-scoped Google AI key resolution
- credential sanity check
- feature-flag evaluation for premium voice
- relay/session token issuance for backend-mediated live transport
- transport-status transitions and chained-session transport rollover
- admin/agent reprocessing for message analysis and summary

## What is not implemented yet

Not implemented yet:
- direct browser-to-Google Live session mode with ephemeral Google auth tokens
- full public-client PCM capture/stream path parity with internal quick-assist
- production-hardened bi-directional audio playback UX across both client and agent surfaces

Important reality check:
- backend relay runtime exists and accepts persisted relay events; media transport maturity is uneven by surface
- `lib/viewings/sessions/gemini-live.ts` is still mostly configuration/auth scaffolding
- current message analysis uses `@google/generative-ai`
- the dependency `@google/genai` is present for future live runtime work, but the live media transport is still future work

---

## UI Surfaces Implemented

## 1. Existing viewing manager entrypoint

File:
- `components/tasks/contact-viewing-manager.tsx`

Current additions:
- each viewing row now has a `Live` button
- creating a live session opens a share modal
- share modal shows:
  - session URL
  - PIN
  - expiry
  - open cockpit action
- each viewing row now also has a `Quick Assist` action for quick-mode starts pre-attached to the viewing context

## 2. Admin cockpit (structured flow)

Files:
- `app/(main)/admin/viewings/sessions/[id]/page.tsx`
- `app/(main)/admin/viewings/sessions/[id]/_components/viewing-session-cockpit.tsx`

Current UI capabilities:
- live transcript stream
- transcript lineage hiding superseded rows by default
- per-message reprocess action
- agent text entry box
- session status controls:
  - start
  - pause
  - complete
- playback toggles:
  - client
  - agent
- visible transport status and live provider state
- audio toggles only become active when transport status is `connected`
- insight cards with:
  - pin
  - dismiss
  - resolve
- session summary panel
- summary regenerate action
- audit/usage panel showing consent metadata, stage models, and recent usage authorities

Important reality check:
- cockpit remains structured-viewing-first and primarily text-driven

## 3. Quick field assist surface (internal/mobile-first flow)

Files:
- `app/(main)/admin/viewings/sessions/[id]/_components/quick-field-assist.tsx`
- `app/(main)/admin/viewings/sessions/page.tsx`
- `app/(main)/admin/viewings/sessions/_components/quick-assist-start-button.tsx`

Current quick UI capabilities:
- one-screen `Speak`, `Listen`, `Share` mode controls
- translation-forward transcript layout
- context attach modal (`contact`, `property`, `viewing`, notes) without restarting the session
- explicit save behavior (`save_transcript`, `save_summary_only`, `discard_on_close`)
- share-mode upgrade path that lazily issues join link + PIN
- internal compliance banner in `agent_only` mode
- browser mic relay input when available
- fallback capture:
  - short clip upload -> `audio-transcribe`
  - browser speech recognition text capture

## 4. Client join page (shared mode)

Files:
- `app/(public)/[domain]/viewings/session/[token]/page.tsx`
- `app/(public)/[domain]/viewings/session/[token]/_components/client-session-view.tsx`

Current client UI capabilities:
- PIN entry
- language input
- conversation stream
- manual text send
- browser speech-recognition assisted text capture
- client playback toggle
- visible transport status and live provider state
- session-kind-aware fallback labeling when property context is absent
- text-first fallback behavior when live transport is unavailable

Important reality check:
- this is not streaming browser microphone audio into Gemini Live
- it currently relies on browser speech recognition where available, then posts text into the session

## 5. Launcher and assignment surfaces

Current additions:
- dedicated admin sessions index at `app/(main)/admin/viewings/sessions/page.tsx`
- location-scoped assignment queue for saved quick sessions without attached contact context
- quick launcher entrypoints in:
  - top nav
  - sidebar
  - contact detail view
  - property detail view

## Route-group note

The original plan called for a dedicated client route that avoids the heavy public-site layout.

Current implementation achieves that with:
- a route under `app/(public)/[domain]/viewings/session/[token]`

This keeps the client page outside the normal `app/(public-site)` header/footer stack.

---

## Planned vs Actual Status

| Capability | Planned | Current Status | Notes |
| --- | --- | --- | --- |
| Keep existing `Viewing` scheduling/sync intact | Yes | Delivered | Existing outbox/sync engine remains untouched |
| New first-class `ViewingSession` model | Yes | Delivered | Implemented with related tables |
| Secure token + PIN join flow | Yes | Delivered | Hashed token/PIN, lockout, JWT |
| Tenant-branded client route | Yes | Delivered | Implemented via `app/(public)/[domain]/...` |
| Admin cockpit page | Yes | Delivered | Session-specific cockpit exists |
| One-tap quick start with no required context | Yes | Delivered | `quick-start` route + launcher entrypoints across global/contact/property/viewing contexts |
| Agent-only mode split from shared-client mode | Yes | Delivered | `participantMode` drives join credentials and consent behavior |
| Progressive context attach after session start | Yes | Delivered | `PATCH /context` updates context snapshot and assignment state mid-session |
| Session conversion between quick/shared/structured | Yes | Delivered | `POST /convert` supports share upgrade and structured-mode guardrails |
| Explicit quick-session close/save policy flow | Yes | Delivered | `POST /close` supports transcript/summary/discard retention behavior |
| Admin assignment queue for unassigned quick sessions | Yes | Delivered | Dedicated `/admin/viewings/sessions` index surface |
| Timeline preview for saved/attached quick threads | Yes | Delivered | `VIEWING_SESSION_SAVED/ATTACHED` + thread preview modal |
| SSE realtime session events | Yes | Delivered | Session-scoped SSE with replay |
| Persist original + translated utterances | Yes | Delivered | Both fields stored on `ViewingSessionMessage` |
| Stable utterance lineage and correction rendering | Yes | Delivered | `utteranceId` plus supersession rules now define effective transcript rendering |
| Canonical message sequencing + idempotent writes | Yes | Delivered | Server assigns `sequence`; `sourceMessageId` is idempotent |
| Consent audit versioning | Yes | Delivered | Accepted timestamp, version, locale, and source are now persisted |
| Per-stage model routing | Yes | Delivered | Translation/insights/summary models snapshot independently from live mode |
| Continuous AI insight extraction | Yes | Delivered | Queue-backed per-message analysis |
| Separate synthesis pipeline | Yes | Delivered | Debounced Stage 3 queue for draft/final summary refresh |
| Objection detection | Yes | Delivered | Static library + model layer |
| Suggested replies | Yes | Delivered | Stored as `reply` insights |
| Pivot suggestions | Yes | Partial | Stored as `pivot` insights, but no strong recommendation engine yet |
| Related property recommendation logic | Yes | Partial | Manual IDs/context only, no ranking/search engine |
| Post-session summary + CRM note | Yes | Delivered | Dedicated LLM summary step with heuristic fallback |
| Follow-up draft generation | Yes | Delivered | Summary pipeline produces WhatsApp/email drafts |
| Lead preference enrichment | Yes | Partial | Lightweight patch to `requirementOtherDetails` |
| Human override over AI suggestions | Yes | Delivered | Pin/dismiss/resolve state changes |
| Dual live modes | Yes | Delivered with gating | Premium voice is feature-flagged per location |
| Backend relay surface | Yes | Partial/Delivered | Dedicated relay runtime + ingestion path exists; public media parity still pending |
| Gemini Live native audio session | Yes | Partial | Internal quick-assist supports relay mic path; full direct browser live mode is not delivered |
| Per-side audio playback toggles | Yes | Partial | Internal quick surface can play relay chunks; full production parity across surfaces is pending |
| Session chaining past 15 minutes | Yes | Partial/Delivered | Chaining logic exists, but true media continuity is future work |
| Calendar-linked session workflow | Yes | Partial | Session links to `Viewing`; no deeper calendar/session UI yet |
| Retention policy for viewing sessions | Yes | Delivered | Location policy is configurable and snapshotted to session |
| Consent/disclosure handling | Yes | Delivered | Join flow enforces AI disclosure when configured |
| Reprocessing semantics | Yes | Delivered | Message analysis and summary can now be regenerated explicitly |
| Usage/cost accounting | Yes | Delivered | Evented usage rows plus session rollups |
| Test coverage | Yes | Partial | Focused unit coverage expanded, but route/integration coverage still missing |

---

## Important Deviations From The Original Plan

These are the most important places where the current implementation differs from the original spec.

## 1. "Live" behavior is split by surface

The planned system assumed:
- microphone audio capture
- direct Live API streaming
- transcript events from the model

The current system now does this partially, not universally.

Current behavior:
- internal quick-assist: browser mic relay input is supported, with clip/STT fallback
- public shared-client flow: still primarily text + browser speech recognition
- agent can still type utterances in structured cockpit
- backend persists all messages/events and analyzes through staged queues
- UI updates via SSE remain the source-of-truth display path

## 2. Live auth is configuration, not full Live transport

The `live-auth` endpoint currently returns:
- mode
- model
- capability metadata
- transport status
- live provider
- premium-voice enablement state
- session/access token refresh support
- relay session token support

It does not currently return:
- Google ephemeral session token
- active WebSocket URL for Live transport
- ready-to-use browser audio pipeline

## 3. Summary generation is now hybrid, not purely heuristic

The original vision implied a stronger model-driven summary/follow-up layer.

Current implementation:
- runs a dedicated LLM summary step
- falls back to deterministic summarization helpers on failure
- writes useful artifacts with usage accounting, but not yet best-in-class sales intelligence output

## 4. Recommendations are insight-level, not a dedicated recommendation subsystem

There is no separate persisted recommendation engine yet.

Current pivots are:
- inferred as `ViewingSessionInsight` rows
- optionally linked by `propertyId` in metadata

There is no:
- ranking model
- alternative-property search pipeline
- explanation-backed recommendation scoring

---

## Current Constraints and Known Gaps

## Product/UX gaps

- No full transcript replay workspace beyond the current thread preview modal
- No session timeline / utterance cluster view
- No rich side-by-side context panel showing structured property/contact/company context to the agent in quick mode
- No explicit related-properties panel fed by a search/ranking subsystem
- Share/activation flow is functional but still minimally branded

## AI/runtime gaps

- No true Gemini Live media session
- No route-level integration coverage for join/live-auth/relay/reprocess flows yet
- No richer company knowledge-base retrieval
- No confidence-calibrated reasoning or explanation display
- No billed-cost provider reconciliation yet beyond authority flags

## Infra/operational gaps

- Coverage is still partial; route-level integration tests are still pending
- No cost/usage dashboard yet for viewing sessions
- No worker bootstrap strategy documented for production process roles
- Dedicated WS relay process exists, but end-to-end vendor live-media orchestration is still maturing

## Browser/runtime caveats

- internal quick-assist capture prefers relay mic stream, then clip transcription, then browser speech recognition
- public shared-client capture still depends on browser speech recognition availability
- session chaining can rotate the active session id
- current client and admin pages refresh session JWTs when chaining happens, but true media continuity is still future work

---

## Verification Completed So Far

Completed during implementation:
- `npx prisma generate`
- `NODE_OPTIONS='--max-old-space-size=8192' npx tsc --noEmit`
- `npm run test:viewings:sessions`

Latest observed outcomes (2026-04-03 quick-assist wave):
- TypeScript: pass (`tsc --noEmit`)
- Viewing-session test suite: pass (`31/31` tests)
- Prisma client generation: pass

Focused automated coverage now includes:
- transport transition rules
- transcript supersession and utterance-lineage selection
- redaction and path-specific translation-vs-analysis sanitization behavior
- stage-model routing defaults and overrides
- usage authority and cost authority defaults
- feature-flag, retention, tool policy, and analysis-status helpers
- quick-session config defaults (`session-config.test.ts`)
- quick/session-kind pipeline gating behavior (`pipeline-policy.test.ts`)

## Concise live test steps with a test user

### A. Structured live session path

1. In admin, open a real or test contact that already has a scheduled viewing.
2. In the viewing manager, click `Live` on that viewing.
3. In `Live Session Ready`, copy the tenant session link and PIN, then open the agent cockpit.
4. Send the session link and PIN to the test user and have them open the public join page.
5. Have the test user enter the PIN, accept the AI disclosure if shown, and join the session.
6. Confirm the client page shows the session as connected/joined and the admin cockpit opens the live transcript view.
7. Ask the test user to send a few messages or use the browser mic if speech recognition is available.
8. Verify each client utterance appears in the admin `Live Transcript`, then check that translated text and insights appear shortly after.
9. From the cockpit, send an agent note/utterance and confirm it appears on the client side.
10. In the cockpit, pin or dismiss an insight and verify the state updates immediately.
11. Complete the session in admin and confirm a draft/final session summary is generated.
12. Sanity-check that transport status, transcript, insights, and summary all persisted after a page refresh.

### B. Quick field assist path

1. In admin, open `/admin/viewings/sessions` and click `Start Quick Translate` (or launch quick assist from contact/property/viewing entrypoints).
2. Confirm the quick-assist screen opens immediately without requiring contact/property/viewing context.
3. Use `Start Mic` and verify one of the capture paths works:
   - relay mic stream
   - clip upload transcription fallback
   - browser speech recognition fallback
4. Confirm translated text appears quickly in the quick transcript view.
5. Attach context mid-session from `Attach Context` and verify assignment status updates.
6. Click `Share` and confirm a join URL + PIN are produced for shared-client mode.
7. Close with each save policy on test sessions (`save_transcript`, `save_summary_only`, `discard_on_close`) and verify expected retention behavior.
8. For saved quick sessions without contact attachment, verify they appear in the assignment queue and can be reopened.
9. After attachment/saving, open the contact timeline and confirm `VIEWING_SESSION_SAVED` / `VIEWING_SESSION_ATTACHED` entries can open thread preview.

Not completed:
- automated join/message/realtime/relay coverage
- automated reprocess route coverage
- end-to-end browser QA
- non-interactive lint pass

Lint note:
- `next lint` in this repo currently prompts for ESLint setup interactively, so it was not usable as a non-interactive validation command for this feature work

---

## Improvement Planning Backlog

This is the recommended next planning split.

## Phase A: Make live transport real

- extend relay media transport parity across public shared-client surfaces
- harden PCM streaming reliability and reconnect semantics for long field sessions
- support ordered input/output transcription events
- harden audio playback UX on both client and agent sides

## Phase B: Upgrade intelligence quality

- improve summary/follow-up prompting, evaluation, and fallback behavior
- enrich context assembly with:
  - stronger property strengths/weaknesses
  - comparable listings
  - company playbook content
  - prior viewing/contact history signals
- add real recommendation ranking for pivot properties
- make objection handling explainable and traceable

## Phase C: Operationalize the feature

- add automated tests for:
  - join flow
  - lockout behavior
  - message persistence
  - idempotent `sourceMessageId` writes
  - transcript supersede flows
  - SSE replay
  - summary generation
  - session chaining
- add relay connect/disconnect/reconnect coverage
- expand retention cleanup coverage (scheduled runs, metrics, and alerting)
- add cost and usage dashboards for session runtime
- add admin list/search/replay views for sessions

## Phase D: Improve the UX

- expand session inbox/assignment queue filtering and bulk triage controls
- improve cockpit density and glanceability
- add collapsible context and related-property panels
- improve mobile client join flow with clearer trust/identity framing
- add more deliberate branding and motion to the client surface

---

## Recommended Next Planning Questions

Before the next implementation round, these are the most valuable questions to answer:

1. Do we want the first serious improvement to focus on true audio streaming, or on better AI output quality within the current text-first architecture?
2. Should Gemini Live run through a backend relay, or do we want a direct browser session with short-lived Google auth material?
3. Do we want recommendation logic to stay insight-based, or should we introduce a dedicated `ViewingRecommendation` model and ranking service?
4. How much stronger do we want the dedicated summary pipeline to become, and what audit/evaluation metadata should it emit?
5. What retention/privacy policy should apply to viewing-session transcript, insight, and summary data by location?

---

## Bottom Line

The feature is no longer just a plan.

We now have:
- a durable session model
- secure join/auth flow
- session persistence
- realtime updates
- AI analysis
- append-only audit and usage metering
- transport-state tracking
- relay event ingestion
- post-session summary artifacts
- admin and client UI entrypoints

But we do not yet have the full voice-native Gemini Live copilot described in the original spec.

The current implementation is best understood as:

> a working session-based live copilot foundation with structured and quick field-assist modes, progressive context attachment, staged AI insighting, hybrid summary generation, policy-aware hardening, and backend relay readiness, now positioned for a second phase focused on full public media transport parity, richer retrieval/recommendation depth, and production hardening.
