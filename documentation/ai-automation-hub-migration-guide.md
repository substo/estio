# Unified AI Automation Hub V1 Migration Guide

## Purpose
Migrate from scattered AI draft/orchestration flows to a centralized automation scheduler and shared suggested response queue.

## Migration Steps
1. Apply Database Changes
- Run Prisma migration for:
  - `AiAutomationSchedule`
  - `AiAutomationJob`
  - `AiSuggestedResponse`
- Ensure generated client matches schema.

2. Enable Cron
- Configure `CRON_SECRET`.
- Schedule internal cron calls to:
  - `GET /api/cron/ai-automations`
- Optional compatibility path exists but is deprecated:
  - `/api/cron/scheduled-tasks`

3. Configure Location AI Automation
- Update `location.ai` settings with `automationConfig`.
- Recommended starter config:
  - `enabled = true`
  - conservative `maxFollowUps`
  - moderate `dailyCaps`
  - quiet hours enabled
  - initial templates: post-viewing + re-engagement

4. Switch UI Consumption to Queue
- Use `listSuggestedResponses` in conversation/deal panes.
- Render shared `SuggestedResponseQueue`.
- Wire accept/reject/send actions through server actions.

5. Retire Legacy Pathways
- Stop any callers of `POST /api/agent/run`.
- Treat legacy docs and local-draft-only automation flows as historical references.

## Behavioral Changes
- Before:
  - automation and semi-auto outputs could be fragmented across local draft surfaces.
- After:
  - automation outputs are persisted as `AiSuggestedResponse` queue items for explicit approval.

## Rollout Strategy
1. Phase 1: Shadow Mode
- Run planner/worker with small batch size.
- Observe queue volume and dead-letter rates.

2. Phase 2: Limited Enablement
- Enable config for selected locations only.
- Monitor:
  - jobs created vs completed
  - retries/dead letters
  - acceptance/rejection rates

3. Phase 3: Full Enablement
- Expand to all approved locations.
- Keep strict caps and quiet hours for risk control.

## Monitoring Checklist
- Cron auth failures (`401`) should be zero for trusted scheduler.
- Lock contention should remain low (`skipped: locked`).
- Dead-letter ratio should be low and investigated immediately.
- Duplicate queue entries should not occur for same idempotency key.

## Rollback Plan
- Disable location-level `automationConfig.enabled`.
- Disable relevant schedules (`AiAutomationSchedule.enabled = false`).
- Keep queue records for audit; do not hard-delete historical suggestions.
