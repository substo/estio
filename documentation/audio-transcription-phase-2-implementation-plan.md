# Audio Transcription Phase 2 Implementation Plan

## Purpose

This document defines the next implementation phase after Phase 1 transcription rollout.
It is designed as an execution guide for developers and AI agents to continue work with industry best practices.

Companion docs:
- Phase 1 tracking: `documentation/audio-transcription-phase-1-implementation-tracking.md`
- Provider research: `documentation/audio-transcription-provider-research.md`

---

## Phase 2 Objectives

1. Add on-demand transcription for audio with no transcript record.
2. Add safe historical backfill flows for existing conversations.
3. Add long-audio structured extraction for property viewing workflows.
4. Improve searchability, reporting, and reliability.
5. Keep Google-only provider runtime for now, while preserving future provider abstraction.

---

## Scope

### In scope
- "Transcribe now" action for transcript-missing audio.
- "Regenerate transcript" action for completed transcripts.
- Conversation-level "Transcribe unprocessed audio" action.
- Structured "Extract viewing notes" action from completed transcript text.
- Transcript search/filter support in conversation context.
- Cost/usage aggregation and admin visibility.

### Out of scope (still future)
- Runtime multi-provider switching.
- Full live speech-to-speech translation.
- Global historical backfill across all locations without explicit throttling controls.

---

## Phase 2A: On-Demand and Backfill Transcription

## 2A.1 UX updates

Message-level controls:
- If audio attachment has no transcript row:
  - show `Transcribe now`.
- If transcript is completed:
  - show `Regenerate transcript`.
- If transcript failed:
  - keep `Retry transcript`.

Conversation-level controls:
- Add action: `Transcribe unprocessed audio`.
- Optional filter in modal:
  - last 30 days
  - all messages in this conversation

## 2A.2 Backend changes

### Actions
File target:
- `app/(main)/admin/conversations/actions.ts`

Add:
- `requestWhatsAppAudioTranscript(conversationId, messageId, attachmentId, options?)`
- `bulkRequestWhatsAppAudioTranscripts(conversationId, options?)`

Rules:
- Always enforce location-scoped auth.
- Validate audio media type before enqueue.
- Reuse `enqueueWhatsAppAudioTranscription(...)`.
- For regenerate:
  - pass `force: true`.

### Queue behavior
File target:
- `lib/queue/whatsapp-audio-transcription.ts`

Enhancements:
- Add optional priority mapping (`normal|high`) if needed.
- Preserve deterministic `jobId` by `attachmentId`.
- Return structured enqueue results for bulk UI progress summary.

## 2A.3 Acceptance criteria

1. Old audio (no transcript row) can be transcribed from conversation UI.
2. Re-clicking button does not create duplicate transcript rows.
3. Bulk action remains non-blocking and reports queued/skipped counts.
4. Conversation refresh reveals pending/progress/completed states without manual page reload.

---

## Phase 2B: Structured Viewing Notes Extraction

## 2B.1 Product behavior

For completed transcript:
- show `Extract viewing notes`.
- produce structured output:
  - prospects
  - requirements
  - budget
  - locations
  - objections
  - nextActions
- allow `Regenerate notes`.

## 2B.2 Proposed data contract

```ts
type ViewingNotesExtraction = {
  prospects: string[];
  requirements: string[];
  budget: string | null;
  locations: string[];
  objections: string[];
  nextActions: string[];
};
```

## 2B.3 Persistence strategy

Recommended (industry-practice):
- Add dedicated extraction table (instead of overloading transcript text row):

```prisma
model MessageTranscriptExtraction {
  id                String   @id @default(cuid())
  transcriptId      String
  provider          String   @default("google")
  model             String
  status            String   @default("pending") // pending|processing|completed|failed
  payload           Json?
  error             String?
  promptTokens      Int?
  completionTokens  Int?
  totalTokens       Int?
  estimatedCostUsd  Float?
  startedAt         DateTime?
  completedAt       DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  transcript MessageTranscript @relation(fields: [transcriptId], references: [id], onDelete: Cascade)

  @@index([transcriptId])
  @@index([status])
  @@index([createdAt])
}
```

## 2B.4 Implementation

Service:
- `lib/ai/audio/viewing-notes-extraction-google.ts`

Worker:
- `lib/queue/whatsapp-audio-extraction.ts`

Action:
- `extractWhatsAppViewingNotes(conversationId, messageId, attachmentId, force?)`

CRM integration:
- Write extraction summary to existing CRM log pipeline with source linkage:
  - transcript id
  - message id
  - attachment id

## 2B.5 Acceptance criteria

1. Extraction returns all required keys every run (no partial schema).
2. Extraction failures persist error reasons.
3. Regeneration is idempotent and auditable.
4. CRM note is created once unless forced regenerate mode requests additional write.

---

## Phase 2C: Search, Reporting, and Reliability

## 2C.1 Search
- Make transcript text searchable within conversation window.
- Add keyword chips for real estate terms.
- Add jump-to-message behavior from search match.

## 2C.2 Reporting
- Add monthly reporting by location:
  - transcript count by status
  - usage tokens and estimated cost by model
  - failure categories

## 2C.3 Reliability hardening
- Add dead-letter handling for repeatedly failed jobs.
- Add retry scheduler for transient provider/storage failures.
- Add stale-processing watchdog (reset stuck `processing` rows).

## 2C.4 Security and compliance
- Add role-based transcript visibility policy.
- Add retention policy controls (for example 30/90/365 days).
- Add audit logs for manual actions:
  - transcribe now
  - regenerate transcript
  - extract notes

---

## Technical Work Breakdown

## Workstream A: API and action layer

Files likely touched:
- `app/(main)/admin/conversations/actions.ts`
- `lib/ghl/conversations.ts`

Tasks:
- Add on-demand and bulk action endpoints.
- Add extraction action endpoints.
- Standardize return envelopes for UI:
  - `success`, `mode`, `queuedCount`, `skippedCount`, `failedCount`, `message`.

## Workstream B: Queue and processing

Files likely touched:
- `lib/queue/whatsapp-audio-transcription.ts`
- `lib/queue/whatsapp-audio-extraction.ts` (new)
- `lib/ai/audio/transcription-google.ts`
- `lib/ai/audio/viewing-notes-extraction-google.ts` (new)

Tasks:
- Bulk enqueue helpers.
- Priority support.
- Dead-letter and stale-job recovery.

## Workstream C: UI

Files likely touched:
- `app/(main)/admin/conversations/_components/message-bubble.tsx`
- `app/(main)/admin/conversations/_components/chat-window.tsx`
- `app/(main)/admin/conversations/_components/conversation-interface.tsx`

Tasks:
- Add controls for missing/completed transcript states.
- Add bulk action UI and progress toasts.
- Add extraction output panel and regenerate option.
- Add transcript search/filter UI.

## Workstream D: Data and migrations

Files likely touched:
- `prisma/schema.prisma`

Tasks:
- Add extraction persistence entity.
- Add optional indexes for reporting/search paths.
- Ship migration with deploy-safe sequencing.

---

## Industry Best Practices to Enforce

1. Keep all webhook paths non-blocking.
2. Use deterministic idempotency keys and unique constraints.
3. Treat queue failures as recoverable and store terminal state.
4. Never trust client payload ownership; always verify message/attachment/location relationships on server.
5. Keep lifecycle statuses explicit and finite.
6. Store model/provider metadata per run for auditability.
7. Keep extraction schema strict and versionable.
8. Include migration application in release gate before traffic switch.

---

## Testing Plan

## Functional
1. Manual transcribe for old audio without transcript.
2. Bulk transcribe unprocessed audio in one conversation.
3. Regenerate transcript updates text and timestamps.
4. Extract notes from long transcript and render in UI.

## Negative
1. Missing API key -> failed with readable error.
2. Non-audio attachment request -> rejected.
3. Unauthorized location access -> rejected.

## Reliability
1. Queue down -> fallback path preserves failure/completion states.
2. Duplicate enqueue attempts -> no duplicate transcript rows.
3. Stuck `processing` row recovers via watchdog.

## Performance
1. Webhook response not blocked by transcript work.
2. Polling remains bounded and stops after terminal statuses.

---

## Rollout Strategy

1. Release 2A behind feature flag:
   - `whatsappTranscriptOnDemandEnabled`
2. Validate on staging using old audio history.
3. Pilot in one production location.
4. Monitor:
   - queue latency
   - completion rate
   - failure rate
   - cost per hour
5. Release 2B extraction for pilot.
6. Expand after quality/cost targets are met.

---

## Definition of Done (Phase 2)

Phase 2 is complete when:
1. Old audio can be transcribed manually from conversation UI.
2. Bulk backfill is available per conversation and stable under load.
3. Structured viewing notes extraction is production-ready and CRM-connected.
4. Reporting and reliability controls are in place.
5. End-to-end tests cover auth, idempotency, failure, and performance guardrails.

