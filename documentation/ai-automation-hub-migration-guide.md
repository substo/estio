# Unified AI Automation Hub V1 Migration Guide

> Historical/Reference: This migration guide applies to the old template-based automation hub.
> Current canonical migration target:
> - `documentation/ai-skills-runtime-implementation.md`
> - `documentation/ai-skills-runtime-rewrite-handoff.md` (historical planning context)

## Current Migration Direction
- Move from template schedule/job pipeline to unified skill runtime.
- Use `/api/cron/ai-runtime` for planner/worker execution.
- Configure policies via `AiSkillPolicy` records (not `automationConfig` enums).
- Keep `AiAutomationSchedule` and `AiAutomationJob` read-only during migration phases.

## Compatibility
- `/api/cron/ai-automations` now returns deprecation guidance.
- `/api/cron/scheduled-tasks` now returns deprecation guidance.
- `scripts/cron-ai-automations.sh` runs runtime endpoint for backward operational compatibility.
