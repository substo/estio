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
- the feature is currently a text-first live copilot, not a full Gemini Live streaming voice product
- there is scaffolding for Gemini Live mode selection and configuration, but the browser-to-Gemini native audio streaming path is not implemented yet
- current "live" behavior is driven by persisted messages, SSE updates, browser speech recognition, and backend text analysis

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
- Session chaining logic for 15-minute live-window rollover
- Gemini model/mode resolver and live config scaffolding
- Location-level viewing-session policy settings in admin AI settings:
  - retention
  - transcript visibility
  - AI disclosure requirement
  - raw audio storage flag

### Not Delivered Yet

- browser microphone PCM capture and backend media forwarding to Gemini Live
- actual audio output playback pipeline from vendor audio responses
- ephemeral Google Live auth tokens for direct browser Live sessions
- a dedicated session list/index page for admins
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

## Session backend

- `app/(main)/admin/viewings/sessions/actions.ts`
- `app/api/viewings/sessions/join/route.ts`
- `app/api/viewings/sessions/events/route.ts`
- `app/api/viewings/sessions/[id]/messages/route.ts`
- `app/api/viewings/sessions/[id]/live-auth/route.ts`
- `app/api/viewings/sessions/[id]/relay/route.ts`
- `app/api/viewings/sessions/[id]/insights/[insightId]/state/route.ts`

## Session UI

- `app/(main)/admin/viewings/sessions/[id]/page.tsx`
- `app/(main)/admin/viewings/sessions/[id]/_components/viewing-session-cockpit.tsx`
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
- `lib/realtime/viewing-session-events.ts`
- `lib/queue/viewing-session-analysis.ts`
- `lib/queue/viewing-session-insights.ts`
- `lib/queue/viewing-session-synthesis.ts`
- `lib/ai/location-google-key.ts`

## Session tests

- `lib/viewings/sessions/feature-flags.test.ts`
- `lib/viewings/sessions/redaction.test.ts`
- `lib/viewings/sessions/retention.test.ts`
- `lib/viewings/sessions/runtime.test.ts`
- `lib/viewings/sessions/tool-policy.test.ts`
- `lib/viewings/sessions/transcript.test.ts`
- `lib/viewings/sessions/types.test.ts`

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
- links to `Location`, `Viewing`, `Contact`, primary `Property`, current active `Property`, and `User`
- `mode` and `status`
- transport/runtime fields:
  - `transportStatus`
  - `liveProvider`
  - `lastTransportEventAt`
- secure join fields:
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
  - `appliedRetentionDays`
  - `transcriptVisibility`
- lifecycle fields:
  - `startedAt`
  - `endedAt`
- live config:
  - `audioPlaybackClientEnabled`
  - `audioPlaybackAgentEnabled`
  - `liveModel`
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
- audio seconds
- token counts
- tool call counts
- estimated and actual cost
- arbitrary metadata

---

## Current Runtime Architecture

## 1. Session creation

The agent creates a live session from an existing viewing.

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
8. `runViewingSessionMessageAnalysis(...)`:
   - assembles session context
   - resolves location Google AI key
   - translates/analyzes the message
   - creates insights
   - updates message translation fields
   - updates session key point/objection caches
   - publishes `message.updated` and `insight.upserted`
   - records analysis usage/cost when model usage data is available

Important reality check:
- this is not native audio streaming
- the current live loop is "persist text -> analyze -> push SSE updates"

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

Current reality check:
- relay support now includes a dedicated backend WebSocket process with Gemini Live session ownership, reconnect handling, tool-call responses, transcript persistence, and usage fanout
- persisted DB rows plus Redis/SSE fanout remain the source of truth for UI updates
- browser-native audio wiring is still incomplete on the public client, so the backend relay is ahead of the current browser transport UI

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
- capability metadata per mode
- cost estimation helpers
- backend live-auth response payload builder
- location-scoped Google AI key resolution
- credential sanity check
- feature-flag evaluation for premium voice
- relay/session token issuance for backend-mediated live transport
- transport-status transitions and chained-session transport rollover

## What is not implemented yet

Not implemented yet:
- actual WebSocket Live session relay
- native PCM 16kHz browser audio streaming to Gemini Live
- Gemini Live tool-call roundtrip loop
- direct audio output playback from Gemini
- ephemeral Google Live auth token issuance

Important reality check:
- `lib/viewings/sessions/gemini-live.ts` is currently configuration scaffolding
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

## 2. Admin cockpit

Files:
- `app/(main)/admin/viewings/sessions/[id]/page.tsx`
- `app/(main)/admin/viewings/sessions/[id]/_components/viewing-session-cockpit.tsx`

Current UI capabilities:
- live transcript stream
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

Important reality check:
- there is no admin microphone capture UI yet
- the cockpit is currently text-first

## 3. Client join page

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
- text-first fallback behavior when live transport is unavailable

Important reality check:
- this is not streaming browser microphone audio into Gemini Live
- it currently relies on browser speech recognition where available, then posts text into the session

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
| SSE realtime session events | Yes | Delivered | Session-scoped SSE with replay |
| Persist original + translated utterances | Yes | Delivered | Both fields stored on `ViewingSessionMessage` |
| Canonical message sequencing + idempotent writes | Yes | Delivered | Server assigns `sequence`; `sourceMessageId` is idempotent |
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
| Backend relay surface | Yes | Partial | HTTP relay event ingestion exists; WS upgrade still pending |
| Gemini Live native audio session | Yes | Not delivered | Still scaffolding only |
| Per-side audio playback toggles | Yes | Partial | UI/state gating exists, but vendor audio playback path not built |
| Session chaining past 15 minutes | Yes | Partial/Delivered | Chaining logic exists, but true media continuity is future work |
| Calendar-linked session workflow | Yes | Partial | Session links to `Viewing`; no deeper calendar/session UI yet |
| Retention policy for viewing sessions | Yes | Delivered | Location policy is configurable and snapshotted to session |
| Consent/disclosure handling | Yes | Delivered | Join flow enforces AI disclosure when configured |
| Usage/cost accounting | Yes | Delivered | Evented usage rows plus session rollups |
| Test coverage | Yes | Partial | Feature-flag test exists; broader flow coverage still missing |

---

## Important Deviations From The Original Plan

These are the most important places where the current implementation differs from the original spec.

## 1. "Live" currently means text-first, not audio-stream-first

The planned system assumed:
- microphone audio capture
- direct Live API streaming
- transcript events from the model

The current system does not do that yet.

Current behavior:
- client can type
- client can use browser speech recognition to produce text
- agent can type utterances
- backend persists messages and analyzes them
- UI updates via SSE

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

- No admin session index page
- No session replay UI
- No session timeline / utterance cluster view
- No rich context panel showing structured property/contact/company context to the agent
- No explicit related-properties panel fed by a search/ranking subsystem
- No polished branded share/activation workflow beyond the share modal

## AI/runtime gaps

- No true Gemini Live media session
- No function-calling loop for live property lookup during active streaming
- No richer company knowledge-base retrieval
- No confidence-calibrated reasoning or explanation display
- No productionized relay media orchestration yet

## Infra/operational gaps

- Coverage is still partial; route-level integration tests are still pending
- No cost/usage dashboard yet for viewing sessions
- No worker bootstrap strategy documented for production process roles
- Dedicated WS relay process exists, but end-to-end vendor live-media orchestration is still maturing

## Browser/runtime caveats

- client speech capture depends on browser speech recognition availability
- session chaining can rotate the active session id
- current client and admin pages refresh session JWTs when chaining happens, but true media continuity is still future work

---

## Verification Completed So Far

Completed during implementation:
- `npx prisma generate`
- `NODE_OPTIONS='--max-old-space-size=8192' npx tsc --noEmit`
- `npm run test:viewings:sessions`

## Concise live test steps with a test user

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

Not completed:
- automated join/message/realtime/relay coverage
- end-to-end browser QA
- non-interactive lint pass

Lint note:
- `next lint` in this repo currently prompts for ESLint setup interactively, so it was not usable as a non-interactive validation command for this feature work

---

## Improvement Planning Backlog

This is the recommended next planning split.

## Phase A: Make live transport real

- build the actual Gemini Live WebSocket relay runtime
- stream PCM audio from browser to backend/live service
- support ordered input/output transcription events
- implement real audio playback on both client and agent sides
- add admin microphone capture UI

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

- add a session inbox/index page
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

> a working session-based live copilot foundation with text-first realtime collaboration, staged AI insighting, hybrid summary generation, policy-aware session hardening, and backend relay preparation, ready for a second phase focused on true native audio transport, richer context retrieval, stronger recommendations, and production hardening.
