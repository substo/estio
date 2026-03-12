# Unified AI Automation Hub (Enterprise V1)

## Status
- Canonical architecture doc for AI scheduling and follow-up drafting.
- Current scope is human-approval-first automation output into the shared conversation queue.

## Goals
- Single control plane for recurring AI follow-ups per location.
- Durable, idempotent cron planning + worker execution.
- One suggested response queue in the main conversation pane (chats + deals).
- Keep Mission Control focused on orchestration, traces, and context, not as the draft output surface for automation.

## Core Architecture
1. Scheduling Control Plane
- `AiAutomationSchedule`: recurring policy per location/template (`enabled`, cadence, timezone, quiet hours, policy JSON, next/last run markers).
- `location.ai.automationConfig`: admin-managed settings (`maxFollowUps`, cadence, research/style, enabled templates, caps, quiet hours, overrides).

2. Durable Job Outbox
- `AiAutomationJob`: planned execution units with status lifecycle (`pending`, `processing`, `completed`, `dead`), locking, retry counters, idempotency key, error state.
- Planner materializes due jobs from schedules + business candidates.

3. Suggested Response Queue
- `AiSuggestedResponse`: approval queue records linked to conversation/deal/contact/job with lifecycle:
  - `pending` -> `accepted` -> `sent`
  - `pending` -> `rejected`
  - `pending` -> `expired` (future lifecycle use)
- Queue is rendered in conversation pane and reused in deal timeline mode.

4. Cron Runtime
- Route: `GET /api/cron/ai-automations`
- Security: strict bearer auth via `CRON_SECRET`.
- Safety: `CronGuard` lock + resource checks.
- Flow:
  - planner (`materializeDueAiAutomationJobs`)
  - worker (`processAiAutomationJobs`)
  - retry/backoff + dead-letter handling

## Built-in Template Contract (V1)
- Supported templates:
  - `post_viewing_follow_up`
  - `inactive_lead_reengagement`
  - `re_engagement`
  - `listing_alert`
  - `custom_follow_up`
- V1 guardrail:
  - admin template overrides allow plain text prompt only.
  - markdown/upload-style prompt payloads are rejected.

## Public Interfaces
- Server actions:
  - `listSuggestedResponses({ conversationId | dealId, status?, limit? })`
  - `acceptSuggestedResponse(id, { mode: "insertOnly" | "sendNow" })`
  - `rejectSuggestedResponse(id, reason?)`
  - `updateAiAutomationConfig(locationId, config)`
- Cron:
  - `GET /api/cron/ai-automations`

## Conversation UX Contract
- Shared component: `SuggestedResponseQueue`
- Available actions:
  - `Accept` -> marks accepted and inserts into composer.
  - `Reject` -> marks rejected with reason.
  - `Accept + Send` -> server-permissioned immediate send.
- Same behavior in chat mode and deal timeline mode.

## Reliability and Security Standards
- Idempotency key per due candidate + slot to prevent duplicate job/suggestion creation.
- Atomic claim pattern for worker locks (`pending` -> `processing` with lock fields).
- Retry with exponential backoff; terminal dead-letter on max attempts/non-retryable failures.
- Cron endpoints use shared auth + guard conventions.
- Legacy weak endpoint `POST /api/agent/run` is retired (`410 Gone`).

## Operational Notes
- Automation output is always human-approved by default.
- `Conversation.suggestedActions` remains only for lightweight quick-intent bubbles.
- Text draft payload ownership for automation is `AiSuggestedResponse`.
