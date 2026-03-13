# AI Skills Runtime (Implemented Architecture)

**Last Updated:** 2026-03-13  
**Status:** Canonical source of truth for the current AI automation runtime.

> This document describes the implementation currently running in the codebase.
> Historical planning/reference docs:
> - `documentation/ai-skills-runtime-rewrite-handoff.md`
> - `documentation/ai-automation-hub-v1.md`
> - `documentation/ai-automation-hub-migration-guide.md`

## 1. Scope

This runtime is the unified path for:
- manual skill decisions,
- semi-auto predictions,
- mission-triggered decisions,
- cron-based automation follow-ups.

All generated text is written to `AiSuggestedResponse` and is **human-approval first**.

## 2. Canonical Code Paths

- Runtime engine: `lib/ai/runtime/engine.ts`
- Runtime policy schema: `lib/ai/runtime/config.ts`
- Cron endpoint: `app/api/cron/ai-runtime/route.ts`
- Deprecated cron endpoints:
  - `app/api/cron/ai-automations/route.ts`
  - `app/api/cron/scheduled-tasks/route.ts`
- Deprecated legacy run endpoint: `app/api/agent/run/route.ts`
- Suggested response queue UI:
  - `app/(main)/admin/conversations/_components/suggested-response-queue.tsx`
  - `app/(main)/admin/conversations/_components/chat-window.tsx`
  - `app/(main)/admin/conversations/_components/unified-timeline.tsx`
- Server actions (runtime + queue + admin APIs): `app/(main)/admin/conversations/actions.ts`
- Admin settings skill runtime UI:
  - `app/(main)/admin/settings/ai/skill-runtime-settings.tsx`
  - `app/(main)/admin/settings/ai/actions.ts`
  - `app/(main)/admin/settings/ai/page.tsx`
- DB models: `prisma/schema.prisma`

## 3. Runtime Flow

### 3.1 Planner (`planDecisions`)

Planner runs from `runAiRuntimeCron()` or `runAiRuntimeNow()`:

1. Ensures default policies exist (`ensureDefaultSkillPolicies`).
2. Loads enabled `AiSkillPolicy` records.
3. Collects candidates by policy objective:
   - `nurture` / `revive` from inactive open conversations
   - `book_viewing` from recent viewings without feedback
   - `listing_alert` from fresh listings + matching contact requirements
   - `deal_progress` from active/draft deals
4. Scores each candidate with adaptive signals:
   - `engagementScore`
   - `fatiguePenalty`
   - `stageUrgency`
   - `consentValidity`
   - `channelHealth`
   - `recentOutcomeDelta`
   - `objectiveSignal`
   - `quietHoursBlock`
5. Applies hold logic:
   - `consent_revoked_or_opted_out`
   - `quiet_hours_block`
   - `score_below_threshold`
6. Creates one `AiDecision` per due key (`@@unique([locationId, dueKey])`).
7. Creates one `AiRuntimeJob` per queued decision with idempotency key.

### 3.2 Worker (`processRuntimeJobs`)

Worker behavior:

1. Claims a pending job atomically (`status=pending -> processing`) with stale-lock recovery.
2. Verifies policy/skill/conversation context.
3. Builds runtime prompt from policy style/research + decision context.
4. Executes skill through orchestrator (`orchestrate`) with forced skill routing.
5. Rewrites root trace title to `"<source>:skill:<skillId>"` for attribution.
6. Creates pending `AiSuggestedResponse` (idempotent create).
7. Marks decision/job status:
   - success -> `completed`
   - empty draft -> decision `skipped` (`holdReason=empty_draft`)
   - retryable failure -> exponential backoff + `pending`
   - max attempts reached -> job `dead`, decision `dead`

Retry/backoff is exponential with jitter (`computeBackoffMs`), capped at 30 minutes per retry, max attempts default `6`.

## 4. Data Model (Current Prisma Schema)

Schema source: `prisma/schema.prisma`.

### 4.1 `AiSkillPolicy`

```prisma
model AiSkillPolicy {
  id                     String   @id @default(cuid())
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
  locationId             String
  skillId                String
  enabled                Boolean  @default(true)
  objective              String   @default("nurture")
  channelPolicy          Json?
  contactSegments        Json?
  decisionPolicy         Json?
  compliancePolicy       Json?
  stylePolicy            Json?
  researchPolicy         Json?
  humanApprovalRequired  Boolean  @default(true)
  version                Int      @default(1)
  metadata               Json?
  location               Location @relation(fields: [locationId], references: [id], onDelete: Cascade)
  decisions              AiDecision[]

  @@unique([locationId, skillId])
  @@index([locationId, enabled])
  @@index([locationId, objective, enabled])
}
```

### 4.2 `AiDecision`

```prisma
model AiDecision {
  id               String   @id @default(cuid())
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  locationId       String
  policyId         String?
  conversationId   String?
  contactId        String?
  dealId           String?
  source           String   @default("automation")
  dueAt            DateTime @default(now())
  dueKey           String?
  status           String   @default("planned")
  holdReason       String?
  rejectedReason   String?
  selectedSkillId  String?
  selectedObjective String?
  selectedScore    Float?
  scoreBreakdown   Json?
  evaluatedSkills  Json?
  decisionContext  Json?
  traceId          String?
  policyVersion    Int?
  location         Location       @relation(fields: [locationId], references: [id], onDelete: Cascade)
  policy           AiSkillPolicy? @relation(fields: [policyId], references: [id], onDelete: SetNull)
  conversation     Conversation?  @relation(fields: [conversationId], references: [id], onDelete: SetNull)
  contact          Contact?       @relation(fields: [contactId], references: [id], onDelete: SetNull)
  deal             DealContext?   @relation(fields: [dealId], references: [id], onDelete: SetNull)
  runtimeJobs      AiRuntimeJob[]
  suggestedResponses AiSuggestedResponse[]

  @@unique([locationId, dueKey])
  @@index([locationId, status, dueAt])
  @@index([policyId, status, dueAt])
  @@index([conversationId, status, dueAt])
  @@index([contactId, status, dueAt])
  @@index([dealId, status, dueAt])
}
```

### 4.3 `AiRuntimeJob`

```prisma
model AiRuntimeJob {
  id             String   @id @default(cuid())
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  locationId     String
  decisionId     String
  status         String   @default("pending")
  scheduledAt    DateTime @default(now())
  processedAt    DateTime?
  attemptCount   Int      @default(0)
  maxAttempts    Int      @default(6)
  lockedAt       DateTime?
  lockedBy       String?
  lastError      String?  @db.Text
  idempotencyKey String   @unique
  traceId        String?
  payload        Json?
  location       Location @relation(fields: [locationId], references: [id], onDelete: Cascade)
  decision       AiDecision @relation(fields: [decisionId], references: [id], onDelete: Cascade)

  @@index([status, scheduledAt])
  @@index([locationId, status, scheduledAt])
  @@index([decisionId, status])
}
```

### 4.4 `AiSuggestedResponse`

```prisma
model AiSuggestedResponse {
  id               String   @id @default(cuid())
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  locationId       String
  conversationId   String?
  contactId        String?
  dealId           String?
  jobId            String?
  decisionId       String?
  body             String   @db.Text
  source           String
  status           String   @default("pending")
  metadata         Json?
  traceId          String?
  idempotencyKey   String   @unique
  acceptedAt       DateTime?
  rejectedAt       DateTime?
  sentAt           DateTime?
  expiresAt        DateTime?
  rejectedReason   String?
  acceptedByUserId String?
  rejectedByUserId String?
  location         Location @relation(fields: [locationId], references: [id], onDelete: Cascade)
  conversation     Conversation? @relation(fields: [conversationId], references: [id], onDelete: SetNull)
  contact          Contact? @relation(fields: [contactId], references: [id], onDelete: SetNull)
  job              AiAutomationJob? @relation(fields: [jobId], references: [id], onDelete: SetNull)
  decision         AiDecision? @relation(fields: [decisionId], references: [id], onDelete: SetNull)
  acceptedByUser   User? @relation("AiSuggestedResponseAcceptedBy", fields: [acceptedByUserId], references: [id], onDelete: SetNull)
  rejectedByUser   User? @relation("AiSuggestedResponseRejectedBy", fields: [rejectedByUserId], references: [id], onDelete: SetNull)

  @@index([locationId, status, createdAt(sort: Desc)])
  @@index([conversationId, status, createdAt(sort: Desc)])
  @@index([dealId, status, createdAt(sort: Desc)])
  @@index([contactId, status, createdAt(sort: Desc)])
  @@index([decisionId, status, createdAt(sort: Desc)])
}
```

### 4.5 Legacy Compatibility Models (Read-Only Migration State)

- `AiAutomationSchedule`
- `AiAutomationJob`

These are still in schema for compatibility/migration but are no longer the canonical control plane.

## 5. Policy Contract (`AiSkillPolicySchema`)

Policy validation is in `lib/ai/runtime/config.ts`:

- `objective`: `nurture | book_viewing | revive | listing_alert | deal_progress`
- `decisionPolicy`:
  - `aggressiveness`: `conservative | balanced | assertive`
  - `minScoreThreshold` (0..1)
  - `baseCooldownHours` (1..336)
  - `maxSuggestionsPer7d` (1..30)
- `channelPolicy`:
  - `enabledChannels`: `sms | email | whatsapp`
  - `quietHours` (enabled/start/end/timezone)
  - `dailyCapPerConversation`
  - `dailyCapPerLocation`
- `compliancePolicy`:
  - `globalBaseline = us_eu_safe`
  - consent/opt-out/quiet-hours/email-auth/unsubscribe enforcement flags
- `stylePolicy`: `profile`, `tone`, `customInstructions`
- `researchPolicy`: `allowedSources`, `depthBudget`, `citationRequired`
- `humanApprovalRequired`: default `true`

### 5.1 Skill Frontmatter Contract (`SKILL.md`)

Loaded via `SkillLoader` (`lib/ai/skills/loader.ts`):

- `id`
- `name`
- `description`
- `risk` (`low | medium | high`)
- `channels` (`sms | email | whatsapp` free-form array in current parser)
- `requiredTools` (tool allowlist used by runtime execution)
- `inputsSchema`
- `outputsSchema`
- `policyHints`

`requiredTools` is merged with legacy `tools` and used as the effective per-skill allowlist at runtime.

## 6. Public Interfaces (Implemented)

### 6.1 Cron

- `GET /api/cron/ai-runtime`
  - Requires `Authorization: Bearer <CRON_SECRET>`
  - Query params:
    - `mode=plan` (optional planner-only)
    - `locationId` (optional scope)
    - `source=automation|semi_auto|manual|mission` (optional)
    - `batch` (optional worker batch size, clamped)
  - Uses `CronGuard("ai-runtime")` for lock + resource checks.

### 6.2 Server Actions

- `listSuggestedResponses({ conversationId | dealId, status?, limit? })`
- `acceptSuggestedResponse(id, { mode: "insertOnly" | "sendNow" })`
- `rejectSuggestedResponse(id, reason?)`
- `listSkillPolicies(locationId?)`
- `upsertSkillPolicy(locationId, skillId, policy)`
- `simulateSkillDecision({ locationId, conversationId?, dealId?, contactId? })`
- `listAiDecisions({ locationId?, status?, skillId?, since?, conversationId?, dealId?, contactId?, limit? })`
- `runAiRuntimeNow(locationId, { plannerOnly?, batchSize?, source? })`
- `runAiSkillDecisionNow({ locationId, conversationId, contactId, ... })`

### 6.3 Deprecated Endpoints (410)

- `GET /api/cron/ai-automations`
- `GET /api/cron/scheduled-tasks`
- `POST /api/agent/run`

## 7. Suggested Response Queue Contract

Queue rendering is shared between chats and deals through `SuggestedResponseQueue`.

Behavior:

- `listSuggestedResponses` returns scoped rows by conversation/deal.
- Queue displays only `pending` items.
- `Accept` -> marks `accepted` and inserts text in composer.
- `Accept + Send` -> sends through composer channel path and marks `sent`.
- `Reject` -> marks `rejected` with reason + actor.

Important UX diagnostic note:
- The queue may show `loading` and then empty state if no pending rows exist for current scope.
- This is expected behavior (empty result), not a loading deadlock.

## 8. Observability and Usage Attribution

- Every runtime suggestion carries `traceId` on `AiSuggestedResponse`.
- Runtime worker retitles root trace to `<source>:skill:<skillId>` on `AgentExecution`.
- Full trace remains viewable via existing trace UI.
- AI Usage Dashboard (`getAggregateAIUsage`) aggregates by:
  - `sourceBreakdown`: `manual`, `semi_auto`, `automation`
  - `skillBreakdown` using task-title pattern `^(automation|semi_auto|manual|mission):skill:<id>`
  - `mission` is mapped into `manual` in dashboard source totals.

## 9. Security and Compliance

- Cron route is protected by `CRON_SECRET` authorization check.
- Cron lock/resource gate uses `CronGuard`.
- Admin write operations (`upsertSkillPolicy`, runtime triggers) require location admin access.
- Read/write actions are location-scoped for tenant isolation.
- Consent and quiet-hour gating are part of decision evaluation.
- Suggested responses are produced as human-approval drafts by default (`requiresHumanApproval: true` metadata path; no auto-send by planner/worker).

## 10. Migration Notes

- `location.ai.automationConfig` and template schedule/job contracts still exist for compatibility.
- New runtime contracts (`AiSkillPolicy`, `AiDecision`, `AiRuntimeJob`) are the active control plane.
- Legacy docs remain as historical reference only.
