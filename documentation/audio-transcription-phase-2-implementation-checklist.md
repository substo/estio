# Audio Transcription Phase 2 Implementation Checklist

This checklist is for human QA/release validation of the Phase 2 implementation completed in this conversation (PR1, PR2, PR3, PR4).

Use this as an execution sheet:
- Check each item as you validate it.
- Capture evidence (screenshots/logs/query results) for each section.
- Run both backend and frontend checks for every PR.

---

## 0) Pre-Flight (Environment + Data)

- [ ] Confirm `GOOGLE_API_KEY` or location `SiteConfig.googleAiApiKey` is available.
- [ ] Confirm Redis is reachable for BullMQ workers.
- [ ] Confirm `CRON_SECRET` is set for cron route protection.
- [ ] Confirm Prisma client is generated.
- [ ] Confirm DB schema is pushed for all Phase 2 fields/tables.
- [ ] Confirm at least one location has `whatsappTranscriptOnDemandEnabled = true`.
- [ ] Confirm test conversation includes WhatsApp audio messages (old + new).

Operational commands used in this implementation:
- `npx prisma generate`
- `npx prisma db push --accept-data-loss`

---

## PR1 Checklist (Phase 2A: On-Demand + Backfill Transcription)

### Backend

- [ ] `getWhatsAppTranscriptOnDemandEligibility` exists and returns meaningful `enabled/reason`.
- [ ] `requestWhatsAppAudioTranscript(...)` validates location/conversation/message/attachment ownership.
- [ ] `requestWhatsAppAudioTranscript(...)` rejects non-audio attachments.
- [ ] `requestWhatsAppAudioTranscript(...)` supports `force` regenerate mode.
- [ ] `bulkRequestWhatsAppAudioTranscripts(...)` supports `window = 30d | all`.
- [ ] Bulk action returns structured counts: `scannedCount`, `audioCount`, `queuedCount`, `skippedCount`, `failedCount`.
- [ ] `retryWhatsAppAudioTranscript(...)` uses force flow and does not duplicate transcript rows.
- [ ] Queue layer uses deterministic transcription `jobId` by attachment.
- [ ] Queue layer supports `priority: normal | high`.
- [ ] Queue down path returns clear queue-unavailable behavior.
- [ ] Conversation read path maps transcript state into `fetchMessages`.

### Frontend

- [ ] Message bubble shows `Transcribe now` when audio has no transcript.
- [ ] Message bubble shows `Regenerate transcript` for completed transcripts.
- [ ] Message bubble shows `Retry transcript` for failed transcripts.
- [ ] Conversation header shows `Transcribe unprocessed` with 30d/all selector.
- [ ] Toasts/messages reflect queued/skipped/failure outcomes.
- [ ] Conversation view refreshes and shows pending/processing/completed states without hard reload.

### Manual QA

- [ ] Trigger `Transcribe now` on old audio with no transcript row.
- [ ] Click `Transcribe now` repeatedly; verify no duplicate transcript row is created.
- [ ] Trigger bulk transcribe for last 30 days; verify only eligible attachments are queued.
- [ ] Trigger bulk transcribe for all conversation messages; verify non-audio attachments are skipped.
- [ ] Simulate queue unavailable path; verify user receives a clear error.

---

## PR2 Checklist (Phase 2B: Viewing Notes Extraction)

### Backend

- [ ] `MessageTranscriptExtraction` table exists with status/token/cost/payload fields.
- [ ] `extractWhatsAppViewingNotes(...)` requires completed transcript.
- [ ] Extraction uses strict JSON schema keys:
  - `prospects`
  - `requirements`
  - `budget`
  - `locations`
  - `objections`
  - `nextActions`
- [ ] `enqueueWhatsAppAudioExtraction(...)` uses deterministic extraction job id (`extract:<extractionId>`).
- [ ] Extraction supports regenerate (`force`) without duplicate logical state.
- [ ] Extraction error state persists with readable `error`.
- [ ] CRM log write is created for extraction result with source linkage fields.
- [ ] CRM log dedupe behavior is preserved unless forced regeneration requests additional write.

### Frontend

- [ ] Message bubble shows `Extract viewing notes` for completed transcripts.
- [ ] Message bubble shows `Regenerate notes` when extraction already exists.
- [ ] Extraction status badges show `pending/processing/completed/failed`.
- [ ] Completed extraction payload renders all key sections.
- [ ] Failed extraction shows retry action and readable error.

### Manual QA

- [ ] Complete transcription, then run extraction and verify payload shape.
- [ ] Force regenerate extraction and verify status/payload updates.
- [ ] Cause extraction failure (e.g., invalid key) and verify failed state is persisted + shown.
- [ ] Verify CRM log entry includes transcript/message/attachment/extraction references.

---

## PR3 Checklist (Phase 2C: Search + Reporting Endpoints/UI)

### Backend

- [ ] `searchConversationTranscriptMatches(...)` endpoint returns:
  - `totalMatches`
  - `results[]`
  - per-result message + attachment linkage + snippet
- [ ] Search limit clamping works (default + max cap).
- [ ] Snippet generation highlights around match location.
- [ ] `getAudioTranscriptMonthlyReport(...)` returns:
  - totals
  - transcript/extraction status breakdown
  - by-model token/cost aggregates
  - failure categories
  - daily trend series
- [ ] Reporting month offset behavior works for current/prior months.

### Frontend

- [ ] Chat header has `Transcript Search` toggle panel.
- [ ] Search panel has keyword chips and Enter-to-search behavior.
- [ ] Search results support jump-to-message in chat thread.
- [ ] Jump target visibly highlights after navigation.
- [ ] Chat header has `Transcript Report` toggle panel.
- [ ] Report panel supports month window switch (current and prior months).
- [ ] Report panel renders totals, statuses, by-model, failure categories, and daily trend.

### Manual QA

- [ ] Search for known keyword and verify correct matches + navigation.
- [ ] Search with no matches and verify empty-state response.
- [ ] Open report for multiple month offsets and verify totals change as expected.
- [ ] Verify extracted runs are included when `includeExtractions = true`.

---

## PR4 Checklist (Phase 2C: Reliability + Retention + Visibility + Audits)

### Backend: Reliability + Retention

- [ ] `MessageTranscript` includes `retryCount`, `lastRetryAt`, `deadLetteredAt`.
- [ ] `MessageTranscriptExtraction` includes `retryCount`, `lastRetryAt`, `deadLetteredAt`.
- [ ] Maintenance job exists and runs:
  - stale pending watchdog
  - stale processing watchdog
  - transient failed retry scheduler
  - dead-lettering after max retries
  - retention cleanup by location policy
- [ ] Cron route exists at `/api/cron/audio-transcript-maintenance`.
- [ ] Cron route is protected by `CRON_SECRET` bearer check.
- [ ] Maintenance env overrides are honored:
  - `AUDIO_TRANSCRIPT_MAX_RETRIES`
  - `AUDIO_TRANSCRIPT_STALE_PROCESSING_MINUTES`
  - `AUDIO_TRANSCRIPT_STALE_PENDING_MINUTES`
  - `AUDIO_TRANSCRIPT_RETRY_FAILED_AFTER_MINUTES`
  - `AUDIO_TRANSCRIPT_MAINTENANCE_BATCH_SIZE`
  - `AUDIO_TRANSCRIPT_RETENTION_ENABLED`
- [ ] Transcription/extraction services increment retry count on failures.
- [ ] Transcription/extraction services clear dead-letter markers on successful requeue/processing.

### Backend: Security + Visibility + Audit

- [ ] `SiteConfig` includes:
  - `whatsappTranscriptRetentionDays` (30/90/365)
  - `whatsappTranscriptVisibility` (`team` / `admin_only`)
- [ ] AI settings action persists retention + visibility fields.
- [ ] Transcript visibility policy is enforced in `fetchMessages` (content redaction for non-admin when `admin_only`).
- [ ] Transcript search endpoint is blocked for non-admin when policy is `admin_only`.
- [ ] Manual transcript/extraction actions are blocked for non-admin when policy is `admin_only`.
- [ ] Manual action audit events are written for:
  - transcribe now
  - retry/regenerate transcript
  - bulk transcribe request
  - extract/regenerate notes
- [ ] Audit payload includes actor context and enqueue outcome details.

### Frontend: Visibility + Policy UX

- [ ] AI settings UI exposes retention selector (30/90/365 days).
- [ ] AI settings UI exposes visibility selector (team/admin only).
- [ ] Transcript content panel shows policy-hidden message when redacted.
- [ ] Extraction panel shows policy-hidden message when redacted.
- [ ] Retry/regenerate/extract actions are hidden/disabled when content is restricted.
- [ ] On-demand eligibility disables action surface for blocked non-admin users.

### Manual QA

- [ ] Set visibility policy to `admin_only`; verify non-admin sees redacted transcript/extraction content.
- [ ] As non-admin with `admin_only`, verify manual transcript/extraction actions fail with policy error.
- [ ] As admin with `admin_only`, verify full transcript/extraction functionality still works.
- [ ] Trigger maintenance cron and verify returned stats shape includes transcripts/extractions/retention/errors.
- [ ] Seed stale processing rows, run cron, verify requeue/dead-letter behavior.
- [ ] Set retention to 30 days, run maintenance with retention enabled, verify old terminal transcript rows are deleted.

---

## Cross-Cut End-to-End Checks

- [ ] Inbound WhatsApp audio auto-transcribes and appears in thread.
- [ ] Outbound WhatsApp audio auto-transcribes and appears in thread.
- [ ] Manual and automatic flows are both idempotent for duplicate enqueue attempts.
- [ ] Queue fallback behavior is non-blocking and status is observable.
- [ ] Usage/cost metadata is persisted for transcript and extraction runs.
- [ ] No cross-location access to transcript/extraction data is possible.

---

## Release Sign-Off

- [ ] Backend checklist complete.
- [ ] Frontend checklist complete.
- [ ] Policy/permissions checklist complete with admin + non-admin test users.
- [ ] Reliability cron checklist complete in staging.
- [ ] Retention behavior validated on non-production dataset.
- [ ] Audit events validated in DB (`agent_events`).
- [ ] Approved for production rollout.

