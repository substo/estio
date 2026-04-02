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
- Manual SQL migration for the new schema
- Secure join flow with:
  - hashed join token
  - hashed PIN + salt
  - failed attempt counting
  - temporary lock window
  - join audit trail
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
  - insight state override
- Realtime SSE channel with replay support
- Queue-backed continuous message analysis
- Context assembler using property/contact/location data
- Hybrid objection layer:
  - static objection library
  - model-generated phrasing/insights
- Post-session summary generation:
  - summary text
  - CRM note
  - follow-up drafts
  - next-step recommendations
- Admin cockpit UI for a single session
- Tenant-facing join page with minimal session UI
- "Start Live Session" entrypoint from the existing viewing manager
- Session chaining logic for 15-minute live-window rollover
- Gemini model/mode resolver and live config scaffolding

### Not Delivered Yet

- Native Gemini Live audio streaming transport
- PCM audio capture and browser-to-backend live relay
- actual audio output playback pipeline
- ephemeral Google Live auth tokens for direct browser Live sessions
- a dedicated session list/index page for admins
- automatic related-property ranking/search engine
- rich company knowledge-base retrieval
- model-generated post-session summaries using a dedicated summary prompt
- retention policy specific to viewing sessions
- formal automated tests for this feature

---

## Current Code Map

## Schema and migration

- `prisma/schema.prisma`
- `prisma/migrations/20260402182000_viewing_session_live_copilot/migration.sql`

## Session backend

- `app/(main)/admin/viewings/sessions/actions.ts`
- `app/api/viewings/sessions/join/route.ts`
- `app/api/viewings/sessions/events/route.ts`
- `app/api/viewings/sessions/[id]/messages/route.ts`
- `app/api/viewings/sessions/[id]/live-auth/route.ts`
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
- `lib/viewings/sessions/context-assembler.ts`
- `lib/viewings/sessions/objection-library.ts`
- `lib/viewings/sessions/analysis.ts`
- `lib/viewings/sessions/summary.ts`
- `lib/viewings/sessions/live-models.ts`
- `lib/viewings/sessions/gemini-live.ts`
- `lib/realtime/viewing-session-events.ts`
- `lib/queue/viewing-session-analysis.ts`
- `lib/ai/location-google-key.ts`

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
- lifecycle fields:
  - `startedAt`
  - `endedAt`
- live config:
  - `audioPlaybackClientEnabled`
  - `audioPlaybackAgentEnabled`
  - `liveModel`
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
- token/cost metadata placeholders

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

## 2. Client join flow

Current join path:
1. Client opens tenant path `/viewings/session/[token]`.
2. Client enters PIN.
3. `POST /api/viewings/sessions/join` validates:
   - token hash
   - PIN hash
   - expiry
   - lock window
   - location/domain match
4. If valid, backend issues a short-lived session JWT.

Current security behavior:
- repeated failed joins increment `failedJoinAttempts`
- the session locks temporarily after too many bad attempts
- successful joins clear failed-attempt state
- each attempt is appended to `joinAudit`

## 3. Message persistence and analysis

Current flow:
1. Client or agent submits text to `POST /api/viewings/sessions/[id]/messages`.
2. Message is persisted first.
3. SSE event `viewing_session.message.created` is published.
4. If translation/analysis is still needed:
   - analysis worker is initialized
   - queue job is enqueued
   - inline fallback is used if queue enqueue fails
5. `runViewingSessionMessageAnalysis(...)`:
   - assembles session context
   - resolves location Google AI key
   - translates/analyzes the message
   - creates insights
   - updates message translation fields
   - updates session key point/objection caches
   - publishes `message.updated` and `insight.upserted`

Important reality check:
- this is not native audio streaming
- the current live loop is "persist text -> analyze -> push SSE updates"

## 4. Realtime transport

Current realtime transport is session-scoped SSE, modeled after conversation realtime events.

Event types currently used:
- `viewing_session.message.created`
- `viewing_session.message.updated`
- `viewing_session.insight.upserted`
- `viewing_session.summary.updated`
- `viewing_session.status.changed`

Replay support:
- event history is stored in Redis lists
- `Last-Event-ID` replay is supported

## 5. Post-session summarization

On completion:
1. `completeViewingSession(sessionId)` marks session completed.
2. `upsertViewingSessionSummaryFromInsights(...)` composes summary artifacts.
3. The summary is stored in `ViewingSessionSummary`.
4. Session cache fields are updated.
5. A CRM note entry is written to `ContactHistory`.
6. `Contact.requirementOtherDetails` is lightly enriched from key points.

Important reality check:
- summary generation is currently heuristic and rule-based
- it is not yet a dedicated summary LLM pipeline

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

## Join secret handling

Implemented safeguards:
- join token is stored as a deterministic hash
- PIN is stored as salted hash
- plaintext token/PIN only exist at creation time in the returned share payload

## Domain protection

Join validation checks that:
- the resolved session belongs to the matching location
- the request host matches the expected tenant domain when applicable

---

## Current AI and Live Model Strategy

## Mode support implemented

Two modes exist in code:
- `assistant_live_tool_heavy`
- `assistant_live_voice_premium`

Mode mapping:
- `assistant_live_tool_heavy` -> `gemini-2.5-flash-native-audio-preview-12-2025`
- `assistant_live_voice_premium` -> `gemini-3.1-flash-live-preview`

## What is implemented

Implemented today:
- mode constants
- mode-to-model resolution
- capability metadata per mode
- cost estimation helper
- backend live-auth response payload builder
- location-scoped Google AI key resolution
- credential sanity check

## What is not implemented yet

Not implemented yet:
- actual WebSocket Live session relay
- native PCM 16kHz browser audio streaming
- Gemini Live tool-call roundtrip loop
- direct audio output playback from Gemini
- ephemeral Google Live auth token issuance

Important reality check:
- `lib/viewings/sessions/gemini-live.ts` is currently configuration scaffolding
- current message analysis uses `@google/generative-ai`
- the dependency `@google/genai` has been added, but the live media transport is still future work

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
| Continuous AI insight extraction | Yes | Delivered | Queue-backed per-message analysis |
| Objection detection | Yes | Delivered | Static library + model layer |
| Suggested replies | Yes | Delivered | Stored as `reply` insights |
| Pivot suggestions | Yes | Partial | Stored as `pivot` insights, but no strong recommendation engine yet |
| Related property recommendation logic | Yes | Partial | Manual IDs/context only, no ranking/search engine |
| Post-session summary + CRM note | Yes | Delivered | Heuristic summary pipeline |
| Follow-up draft generation | Yes | Delivered | Heuristic WhatsApp/email drafts |
| Lead preference enrichment | Yes | Partial | Lightweight patch to `requirementOtherDetails` |
| Human override over AI suggestions | Yes | Delivered | Pin/dismiss/resolve state changes |
| Dual live modes | Yes | Delivered as config | Mode and model selection exist |
| Gemini Live native audio session | Yes | Not delivered | Still scaffolding only |
| Per-side audio playback toggles | Yes | Partial | Settings exist, transport/playback path not built |
| Session chaining past 15 minutes | Yes | Partial/Delivered | Chaining logic exists, but true media continuity is future work |
| Calendar-linked session workflow | Yes | Partial | Session links to `Viewing`; no deeper calendar/session UI yet |
| Retention policy for viewing sessions | Yes | Not delivered | No viewing-session-specific retention layer yet |
| Test coverage | Yes | Not delivered | No feature-specific automated tests yet |

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
- session/access token refresh support

It does not currently return:
- Google ephemeral session token
- active WebSocket URL for Live transport
- ready-to-use browser audio pipeline

## 3. Summary generation is heuristic

The original vision implied a stronger model-driven summary/follow-up layer.

Current implementation:
- derives output from stored insights
- uses deterministic summarization helpers
- writes useful artifacts, but not yet best-in-class sales intelligence output

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
- No dedicated summary-generation LLM step
- No richer company knowledge-base retrieval
- No confidence-calibrated reasoning or explanation display

## Infra/operational gaps

- No feature-specific tests yet
- No cost/usage dashboard yet for viewing sessions
- No viewing-session retention/privacy settings
- No dedicated audit log model beyond `joinAudit`, persisted entities, and `ContactHistory`
- No worker bootstrap strategy documented for production process roles

## Browser/runtime caveats

- client speech capture depends on browser speech recognition availability
- session chaining can rotate the active session id
- current client and admin pages refresh session JWTs when chaining happens, but true media continuity is still future work

---

## Verification Completed So Far

Completed during implementation:
- `npx prisma generate`
- `NODE_OPTIONS='--max-old-space-size=8192' npx tsc --noEmit`

Not completed:
- automated feature tests
- end-to-end browser QA
- non-interactive lint pass

Lint note:
- `next lint` in this repo currently prompts for ESLint setup interactively, so it was not usable as a non-interactive validation command for this feature work

---

## Improvement Planning Backlog

This is the recommended next planning split.

## Phase A: Make live transport real

- build the actual Gemini Live relay or ephemeral-token strategy
- stream PCM audio from browser to backend/live service
- support ordered input/output transcription events
- implement real audio playback on both client and agent sides
- add admin microphone capture UI

## Phase B: Upgrade intelligence quality

- move session summary/follow-up generation to a dedicated model step
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
  - SSE replay
  - summary generation
  - session chaining
- add retention/privacy controls for viewing session content
- add cost and usage tracking for session runtime
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
4. Should post-session output remain heuristic as a fallback, or move immediately to a dedicated LLM summary pipeline with stronger audit metadata?
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
- post-session summary artifacts
- admin and client UI entrypoints

But we do not yet have the full voice-native Gemini Live copilot described in the original spec.

The current implementation is best understood as:

> a working session-based live copilot foundation with text-first realtime collaboration, AI insighting, and summary generation, ready for a second phase focused on native audio transport, richer context retrieval, stronger recommendations, and production hardening.
