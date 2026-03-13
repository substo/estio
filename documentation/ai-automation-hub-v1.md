# Unified AI Automation Hub (Enterprise V1)

> Historical/Reference: This document describes the template-based automation hub.
> Current canonical architecture is the implemented skill runtime:
> - `documentation/ai-skills-runtime-implementation.md`
> - `documentation/ai-skills-runtime-rewrite-handoff.md` (historical planning context)

## Status
- Legacy V1 implementation remains in codebase for migration compatibility.
- New development should target the AI skill runtime (`AiSkillPolicy`, `AiDecision`, `AiRuntimeJob`).

## Legacy Notes
- Legacy cron route: `/api/cron/ai-automations` (deprecated).
- Canonical cron route: `/api/cron/ai-runtime`.
- Legacy config contract: `location.ai.automationConfig`.
- Canonical control plane: per-skill policy records in `AiSkillPolicy`.
