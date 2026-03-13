# AI Skills Runtime Rewrite Handoff (Full Rewrite, Global Compliance, Human Approval)

## Summary
- Replace rigid template-based automation with one unified skill runtime across manual draft, semi-auto, mission orchestration, and cron follow-ups.
- Keep human approval only; all generated text goes to `AiSuggestedResponse`.
- Implement adaptive policy decisions per contact/deal instead of fixed `maxFollowUps/cadence` enums.
- Standardize observability so every generated suggestion has full trace + token/cost attribution visible in Trace UI and AI Usage Dashboard.

## What Went Wrong
- Automation was implemented as fixed templates and enum-bounded settings (`followUpCadence`, `researchDepth`, `styleProfile`) rather than adaptive, per-client decisioning.
- Skill system exists but is not the central automation contract; cron planner bypasses skill metadata and is hardwired to template collectors.
- Multiple overlapping runtimes remained active (`agent.ts` planner/executor, `orchestrator.ts`, `semi-auto predictor`, template cron), so AI components do not operate as one goal-driven system.
- Admin UX exposes rigid numeric controls instead of skill-level policies/outcome optimization.
- Existing restrictions like plain-text-only prompt overrides blocked richer skill instructions and references.
- Queue behavior can appear “empty after loading” when no pending items are returned for scoped conversation/deal, without enough runtime-state diagnostics.

## Expected Behavior
- One control plane where admins configure strategy by skill, segment, channel, and business objective.
- One runtime that evaluates each contact/deal context, chooses the best skill, chooses timing, and writes suggested responses with reasons.
- Flexible decisioning (adaptive to engagement, consent, stage, and prior outcomes), not hardcoded frequency limits.
- Enterprise safety by policy constraints: consent, opt-out, quiet hours, channel rules, role permissions, audit trails.
- Full traceability: every suggestion links to decision record, skill execution trace, token usage, and policy decision.

## Implementation Changes (Full Rewrite)
1. Unified runtime and contracts
- Introduce `AiSkillPolicy` (per location + skill) as the primary admin contract; deprecate `automationConfig` enums.
- Keep `SKILL.md` as skill instruction source, but require structured frontmatter fields: `id`, `description`, `risk`, `channels`, `requiredTools`, `inputsSchema`, `outputsSchema`, `policyHints`.
- Replace template routing with skill routing: decision engine picks candidate skills and executes top candidate only in V1.
- Collapse legacy flows so manual draft, semi-auto, mission actions, and cron call the same `runAiSkillDecision()` pipeline.

2. New data model
- Add `AiSkillPolicy`: `locationId`, `skillId`, `enabled`, `objective`, `channelPolicy`, `contactSegments`, `decisionPolicy`, `compliancePolicy`, `stylePolicy`, `researchPolicy`, `humanApprovalRequired`, `version`.
- Add `AiDecision`: immutable decision log with input features, evaluated skills, selected skill, score breakdown, hold/reject reason, policy version.
- Add `AiRuntimeJob`: generic durable worker job (`decisionId`, `status`, locking, retries, backoff, dead-letter, idempotency key).
- Keep `AiSuggestedResponse`; extend metadata with `decisionId`, `skillId`, `policyVersion`, `scoreBreakdown`.
- Keep old `AiAutomationSchedule`/`AiAutomationJob` read-only during migration, then remove after cutover.

3. Scheduler and worker rewrite
- Replace `/api/cron/ai-automations` internals with `planDecisions()` + `processRuntimeJobs()` using skill policies.
- Planner generates decisions from event sources: inbound inactivity windows, stage transitions, post-viewing windows, listing changes, custom triggers.
- Decision logic uses adaptive scoring, not fixed max-count: `engagementScore`, `fatiguePenalty`, `stageUrgency`, `consentValidity`, `channelHealth`, `recentOutcomeDelta`, `quietHoursBlock`.
- Worker executes selected skill through orchestrator/skill loader and persists one pending suggested response (idempotent).
- Human approval remains default and enforced server-side.

4. Admin UX rewrite
- Replace rigid controls with “Skill Policies” UI.
- Enable/disable per skill.
- Objective presets: `nurture`, `book_viewing`, `revive`, `listing_alert`, `deal_progress`.
- Adaptive aggressiveness bands (not fixed counts): `conservative`, `balanced`, `assertive`.
- Research policy: allowed sources, depth budget, citation requirement.
- Style policy as reusable prompt profile blocks.
- Add “Decision Simulator” for any contact/deal to preview why a skill/timing was selected or held.
- Add runtime health panel with due decisions, retries, dead letters, last cron run, and policy violations.

5. Observability, security, and compliance
- Every runtime execution must create/attach one root `AgentExecution` trace with `taskTitle=automation:skill:<skillId>`.
- AI Usage Dashboard must expose automation breakdown by skill and source (`manual`, `semi_auto`, `automation`).
- Suggested response cards show trace link and policy rationale.
- Enforce tool allowlist per skill (frontmatter + server validation), prompt-injection guardrails, and cross-location isolation.
- Enforce global compliance defaults for outreach: consent/opt-out handling, revocation handling, quiet-hour constraints, sender-auth and unsubscribe rules, and EU-grade consent withdrawal handling.

6. Migration and cutover
- Phase A: dual-write decisions and suggested responses while old cron still active (shadow mode, no send changes).
- Phase B: switch cron to new planner/worker; keep legacy tables for audit reads only.
- Phase C: remove template enum config UI and old template collectors.
- Phase D: delete deprecated code paths and mark historical docs as archived references.

## Public Interfaces
- `GET /api/cron/ai-runtime` (new canonical cron endpoint; old endpoint returns deprecation response).
- `listSkillPolicies(locationId)`
- `upsertSkillPolicy(locationId, skillId, policy)`
- `simulateSkillDecision({ locationId, conversationId|dealId|contactId })`
- `listAiDecisions({ locationId, status, skillId, since })`
- `listSuggestedResponses({ conversationId|dealId, status })`
- `acceptSuggestedResponse(id, { mode: "insertOnly" | "sendNow" })`
- `rejectSuggestedResponse(id, reason)`

## Test Plan
1. Unit tests
- Skill policy schema validation and unsafe policy rejection.
- Decision scoring behavior for consent revocation, quiet hours, fatigue, and engagement shifts.
- Idempotency key generation and retry/backoff computation.
- Skill tool allowlist enforcement and forbidden tool rejection.

2. Integration tests
- Planner creates one decision per due key and one job per decision.
- Worker retries transient errors and dead-letters terminal failures correctly.
- Suggested response lifecycle transitions remain valid and auditable.
- Usage/trace records are persisted for every generated suggestion.

3. E2E tests
- Admin can configure policy per skill and preview decisions.
- Chat mode and deal mode show identical suggested-response queue behavior.
- Accept inserts into composer; reject removes from active queue.
- Trace link from suggestion opens full thinking trace with token usage.
- AI Usage Dashboard shows automation usage under correct source and skill.

4. Security/compliance tests
- Unauthorized cron and cross-location reads/writes are blocked.
- STOP/revocation signals immediately suppress future decisions.
- Email/SMS compliance checks block non-compliant suggestions pre-queue.

## Assumptions and Defaults
- Migration strategy: Full runtime rewrite.
- Compliance baseline: Global (US+EU-safe defaults) with location overrides.
- Send behavior: Human approval only by default.
- Skill source of truth: `SKILL.md` files plus validated policy overlays in DB.
- Legacy docs remain reference-only after canonical rewrite docs land.

## Repo Evidence (Current State)
- Strict template-bounded automation config in [config.ts](/Users/martingreen/Projects/IDX/lib/ai/automation/config.ts).
- Template-specific planner/worker collectors in [hub.ts](/Users/martingreen/Projects/IDX/lib/ai/automation/hub.ts).
- Existing skill runtime and loader in [loader.ts](/Users/martingreen/Projects/IDX/lib/ai/skills/loader.ts) and [orchestrator.ts](/Users/martingreen/Projects/IDX/lib/ai/orchestrator.ts).
- Legacy parallel runtime still present in [agent.ts](/Users/martingreen/Projects/IDX/lib/ai/agent.ts) and [predictor.ts](/Users/martingreen/Projects/IDX/lib/ai/semi-auto/predictor.ts).

## Research Sources
- Anthropic Claude Code overview: [docs.anthropic.com/en/docs/claude-code/overview](https://docs.anthropic.com/en/docs/claude-code/overview)
- Anthropic CLAUDE.md memory/instructions: [docs.anthropic.com/en/docs/claude-code/memory](https://docs.anthropic.com/en/docs/claude-code/memory)
- Anthropic slash commands: [docs.anthropic.com/en/docs/claude-code/slash-commands](https://docs.anthropic.com/en/docs/claude-code/slash-commands)
- Anthropic custom subagents: [docs.anthropic.com/en/docs/claude-code/sub-agents](https://docs.anthropic.com/en/docs/claude-code/sub-agents)
- OpenAI Codex overview: [platform.openai.com/docs/codex/overview](https://platform.openai.com/docs/codex/overview)
- OpenAI AGENTS.md: [platform.openai.com/docs/codex/agents](https://platform.openai.com/docs/codex/agents)
- OpenAI Skills: [platform.openai.com/docs/codex/skills](https://platform.openai.com/docs/codex/skills)
- OpenAI approval mode: [platform.openai.com/docs/codex/approval-mode](https://platform.openai.com/docs/codex/approval-mode)
- OpenClaw docs: [docs.openclaw.ai](https://docs.openclaw.ai/)
- OpenClaw prompt templates: [docs.openclaw.ai/core-concepts/prompt-templates](https://docs.openclaw.ai/core-concepts/prompt-templates)
- OpenClaw tool calling: [docs.openclaw.ai/core-concepts/tool-calling](https://docs.openclaw.ai/core-concepts/tool-calling)
- FTC CAN-SPAM guide: [ftc.gov/.../can-spam-act-compliance-guide-business](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
- FCC text consent/revocation rule (47 CFR §64.1200): [ecfr.gov/.../section-64.1200](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-D/part-64/subpart-L/section-64.1200)
- FCC one-to-one consent order (effective Jan 27, 2025): [docs.fcc.gov/public/attachments/DA-24-910A1.pdf](https://docs.fcc.gov/public/attachments/DA-24-910A1.pdf)
- Google Email sender guidelines: [support.google.com/mail/answer/81126](https://support.google.com/mail/answer/81126)
- NIST AI RMF: [nist.gov/itl/ai-risk-management-framework](https://www.nist.gov/itl/ai-risk-management-framework)
- EU consent withdrawal guidance: [commission.europa.eu/.../what-if-somebody-withdraws-their-consent_en](https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/legal-grounds-processing-data/grounds-processing/what-if-somebody-withdraws-their-consent_en)
