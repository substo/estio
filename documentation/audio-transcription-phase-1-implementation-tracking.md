# Audio Transcription Phase 1 Implementation Tracking (Google-Only)

## Purpose

This document records the exact Phase 1 implementation that is already in the IDX codebase.
It is intended as a technical handoff for developers and AI agents who need to understand, debug, or recreate the current behavior.

Related research doc:
- `documentation/audio-transcription-provider-research.md`

---

## Phase 1 Scope (Delivered)

### Delivered
- Automatic transcription for newly received WhatsApp audio attachments.
- Automatic transcription for newly sent WhatsApp audio attachments.
- Async queue-based processing with retries and idempotent job IDs.
- Transcript persistence with status lifecycle and metadata.
- Conversation UI rendering of transcript status/content under audio player.
- Retry action for failed transcripts.
- Per-location transcription model setting in AI settings.

### Not Delivered in Phase 1
- Manual "Transcribe now" for old audio that has no transcript row.
- Historical backfill tool.
- Viewing-note extraction pipeline.
- Live translation.

---

## Architecture (Current)

Inbound audio flow:
1. Webhook event enters `app/api/webhooks/evolution/route.ts`.
2. Message sync persists `Message`.
3. Media ingest persists `MessageAttachment` via `lib/whatsapp/evolution-media.ts`.
4. For audio, enqueue transcription job to `whatsapp-audio-transcription`.
5. Worker calls Google transcription service.
6. `MessageTranscript` is updated through `pending -> processing -> completed|failed`.
7. `fetchMessages` returns transcript payload to UI.
8. Message bubble renders transcript panel.

Outbound audio flow:
1. User sends media via `sendWhatsAppMediaReply(...)`.
2. Outbound `Message` + `MessageAttachment` is created.
3. If attachment is audio, enqueue transcription job.
4. Worker transcribes and UI receives transcript through regular message fetch/live sync loop.

---

## Data Model (Implemented)

File:
- `prisma/schema.prisma`

### SiteConfig
- Added `googleAiModelTranscription String? @default("gemini-2.5-flash")`.

### Message relations
- Added `transcripts MessageTranscript[]`.

### MessageAttachment relations
- Added `transcript MessageTranscript?`.

### MessageTranscript model
- `id String @id @default(cuid())`
- `messageId String`
- `attachmentId String @unique`
- `provider String @default("google")`
- `model String`
- `status String @default("pending")`
- `language String?`
- `text String? @db.Text`
- `error String?`
- `promptTokens Int?`
- `completionTokens Int?`
- `totalTokens Int?`
- `estimatedCostUsd Float?`
- `startedAt DateTime?`
- `completedAt DateTime?`
- timestamps and indexes on `messageId`, `status`, `createdAt`

---

## Core Service Layer (Implemented)

File:
- `lib/ai/audio/transcription-google.ts`

### Key functions
- `transcribeAttachmentWithGoogle({ locationId, messageId, attachmentId, force? })`
- `ensurePendingMessageTranscript(...)`
- `resolveGoogleTranscriptionModelForLocation(locationId)`
- `normalizeAudioTranscriptionModel(...)`

### Behavior
- Validates attachment/message/location ownership.
- Resolves API key securely:
  - `SettingsService.getSecret('google_ai_api_key')`
  - fallback `process.env.GOOGLE_API_KEY`
- Model fallback order:
  1. `googleAiModelTranscription`
  2. `googleAiModelExtraction`
  3. `gemini-2.5-flash`
- Audio-capability guard for model selection:
  - requires `gemini` and `flash` naming
  - blocks obvious non-audio models (`embedding`, `image`, `robotics`)
- Reads attachment bytes from R2.
- Calls Gemini with plain-text transcription prompt:
  - "Transcribe this audio verbatim in the spoken language. Return plain text only. Do not summarize or translate."
- Persists usage metadata (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`) when returned.
- Supports forced re-run with field reset on `force=true`.

---

## Queue Layer (Implemented)

File:
- `lib/queue/whatsapp-audio-transcription.ts`

### Queue config
- Queue name: `whatsapp-audio-transcription`
- Payload:
  - `locationId`
  - `messageId`
  - `attachmentId`
  - `force?`
- Job config:
  - `attempts: 3`
  - exponential backoff with 1000ms base delay
  - `jobId: transcript:${attachmentId}`
- Worker concurrency: `2`

### Reliability behavior
- Pre-enqueue idempotency check through `ensurePendingMessageTranscript`.
- Skips enqueue if already completed and not forced.
- If enqueue fails, falls back to non-blocking inline transcription.

---

## Trigger Points (Implemented)

## Inbound
File:
- `lib/whatsapp/evolution-media.ts`

Behavior:
- After `messageAttachment.create(...)`, if parsed type is audio:
  - attempts worker init
  - enqueues transcription job
  - runs non-blocking wrapper

## Outbound
File:
- `app/(main)/admin/conversations/actions.ts`

Behavior:
- In `sendWhatsAppMediaReply(...)`, after outbound attachment create:
  - if media kind is audio:
    - attempts worker init
    - enqueues transcription job

## Worker initialization at webhook runtime
File:
- `app/api/webhooks/evolution/route.ts`

Behavior:
- Initializes audio transcription worker on webhook path startup.

---

## Media Storage Access (Implemented)

File:
- `lib/whatsapp/media-r2.ts`

New helper:
- `getWhatsAppMediaObjectBytes(key)`

Details:
- Uses `GetObjectCommand`.
- Converts stream safely to `Buffer` via multi-path stream helper.
- Existing signed read/upload URL helpers are unchanged.

---

## Conversation Data Fetch and Types (Implemented)

## Server action shape
File:
- `app/(main)/admin/conversations/actions.ts`

`fetchMessages(...)` now:
- Includes `attachments.transcript`.
- Maps transcript fields into response payload:
  - `status`, `text`, `error`, `model`, `provider`, `updatedAt`.

## Shared message type
File:
- `lib/ghl/conversations.ts`

Attachment interface now supports:
- `id`
- `transcript` object with status and metadata.

---

## UI Behavior (Implemented)

### Message bubble rendering
File:
- `app/(main)/admin/conversations/_components/message-bubble.tsx`

Behavior:
- Transcript panel renders under each audio attachment when transcript exists.
- State rendering:
  - `pending|processing`: "Transcribing..."
  - `completed`: transcript text + expand/collapse for long text
  - `failed`: error + retry button

### Callback plumbing
Files:
- `app/(main)/admin/conversations/_components/chat-window.tsx`
- `app/(main)/admin/conversations/_components/conversation-interface.tsx`

Behavior:
- `onRetryTranscript(messageId, attachmentId)` wired from UI to server action.

---

## Retry Action (Implemented)

File:
- `app/(main)/admin/conversations/actions.ts`

Action:
- `retryWhatsAppAudioTranscript(conversationId, messageId, attachmentId)`

Validation:
- User location authorization.
- Conversation ownership.
- Message ownership.
- Attachment ownership.
- Audio media-type guard.

Execution:
- Enqueue with `force: true`.
- Returns structured result with `mode` and user-facing message.

---

## Live Refresh Logic (Implemented)

File:
- `app/(main)/admin/conversations/_components/conversation-interface.tsx`

Behavior:
- Tracks transcript state in message signature.
- If any transcript is `pending|processing`, performs message fetch in 3s live loop even when last message body/date did not change.
- Stops extra fetch behavior once all pending transcripts become terminal.

---

## AI Settings Integration (Implemented)

Files:
- `app/(main)/admin/settings/ai/actions.ts`
- `app/(main)/admin/settings/ai/ai-settings-form.tsx`

Behavior:
- Persists/reads `googleAiModelTranscription`.
- Adds "Audio: Transcription" dropdown.
- Uses existing model source already fetched in this screen.
- Server-side normalization fallback to `gemini-2.5-flash` for invalid selections.

---

## Observability and Guardrails (Implemented)

Persisted:
- transcript status transitions
- provider/model
- token usage fields when available
- error messages and completion timestamps

Current note:
- `estimatedCostUsd` is present but can remain null in current flow.

---

## Known Limitations (Current)

1. Audio with no transcript row does not show "Transcribe now" button.
2. No bulk backfill for old audio.
3. No extraction of structured property viewing notes.
4. No transcript analytics dashboard yet.

---

## Deployment and Migration Requirement (Critical)

Because Phase 1 adds new Prisma fields/tables, deployment must include DB schema sync before traffic cutover.

If schema is not applied, runtime can fail with Prisma `P2022` errors for missing columns (for example `SearchConfig.googleAiModelTranscription`) and cause 500 responses.

Required release sequence:
1. Deploy code to target slot.
2. Apply schema migration/sync on target DB.
3. Run slot health checks.
4. Switch traffic only after healthy.

---

## Rebuild Sequence (From Zero)

1. Apply schema updates and generate client.
2. Add R2 byte-read helper.
3. Implement Google transcription service with ownership validation.
4. Implement queue + worker + inline fallback.
5. Add inbound/outbound enqueue triggers.
6. Add worker init in webhook runtime.
7. Extend message fetch payload and shared types.
8. Add transcript UI + retry action.
9. Add pending-status live refresh behavior.
10. Add AI setting for transcription model.
11. Validate inbound, outbound, failure/retry, and authorization.

