# Phase 6: Semi-Auto & Event-Driven Architecture

**Duration**: Weeks 13–16  
**Priority**: 🟢 Enhancement  
**Dependencies**: Phase 0-5 (All previous phases must be stable)  
**Last Updated**: February 15, 2026 — Revised to Semi-Auto (no autonomous sending)

---

## Objective

Transform the system from **reactive** (user clicks "Run Agent") to **proactive prediction** (agent auto-drafts on events, but **never sends autonomously**).

> **Critical Design Constraint**: The AI may predict, draft, and suggest — but **every outbound message requires human approval**. No autonomous sending, ever.

1. **Event-Driven Triggers** — Agent auto-drafts responses to incoming messages, new leads, and time-based events.
2. **Semi-Auto Mode** — AI predicts next steps and drafts replies; user reviews and approves all outbound messages.
3. **Proactive Outreach** — Agent drafts follow-ups, re-engagement, and market alerts for human review.
4. **Context Compaction** — Long-running deals are summarized to prevent context overflow.
5. **MCP Apps** *(Future)* — Interactive UI widgets delivered inside chat via MCP protocol.

---

## 1. Event-Driven Architecture

### 1.1 Event Sources

| Source | Event | Handler Logic |
|:-------|:------|:--------------|
| **WhatsApp Webhook** | `message.received` | Draft reply via Orchestrator |
| **Email Sync** | `email.received` | Draft reply via Orchestrator |
| **CRM** | `lead.created` | Set initial lead score + Draft welcome message |
| **Calendar** | `viewing.completed` | Mark viewing complete (follow-up scheduled separately) |
| **Cron** | `follow_up.due` | Draft follow-up message |
| **Cron** | `listing.new` | Draft personalized listing alert |
| **Deal** | `deal.stage_changed` | Log stage change |

### 1.2 Event Bus Implementation

The system uses an in-process `EventBus` that logs all events to the database for observability.

```typescript
// lib/ai/events/event-bus.ts

export type EventType =
    | "message.received"
    | "email.received"
    | "lead.created"
    | "follow_up.due"
    | "listing.new"
    // ... other types

export interface AgentEvent {
    type: EventType;
    payload: Record<string, any>;
    metadata: {
        timestamp: Date;
        sourceId: string;
        conversationId?: string;
        contactId?: string;
    };
}

class EventBus {
    // ... implementation with database logging to `agent_events` table
    async emit(event: AgentEvent) {
        // 1. Log to DB (status: processing)
        // 2. Run handlers
        // 3. Update DB (status: processed/error)
    }
}
```

### 1.3 Event Handlers (Semi-Auto)

All handlers follow the **Semi-Auto** philosophy: they delegate to the `predictor` which enforces rate limits and ensures output is **always a draft**.

```typescript
// lib/ai/events/handlers.ts

import { predictAndDraft } from "../semi-auto/predictor";

export function registerEventHandlers() {
    // ── Message Received ──
    eventBus.on("message.received", async (event) => {
        const { conversationId, contactId, message } = event.payload;
        
        // 1. Check if Semi-Auto is enabled
        const conversation = await db.conversation.findUnique({
            where: { id: conversationId },
            select: { semiAuto: true }
        });

        if (!conversation?.semiAuto) return;

        // 2. Delegate to Predictor (enforces rate limits + cooldowns)
        await predictAndDraft({
            conversationId,
            contactId,
            triggerMessage: message,
            triggerSource: "webhook"
        });
    });

    // ── Follow-Up Due ──
    eventBus.on("follow_up.due", async (event) => {
        // Similar logic: check semiAuto -> predictAndDraft
        // Trigger message: "FOLLOW_UP_TRIGGER"
    });
}
```

---

## 2. Semi-Auto Prediction Engine

The predictor orchestrates the AI's response but constrains it to **drafting only**.

### 2.1 Configuration

Currently controlled by a single boolean flag `Conversation.semiAuto`.
*Future:* A JSON column will allow granular control (e.g., `draftReplies: true, draftFollowUps: false`).

### 2.2 Predictor Logic

```typescript
// lib/ai/semi-auto/predictor.ts

export async function predictAndDraft(input: PredictionInput) {
    // 1. Rate Limit Check (Max 50 drafts/day)
    // 2. Cooldown Check (Min 2 mins between drafts)
    
    // 3. Orchestrate (Classify -> Plan -> Skill -> Draft)
    const result = await orchestrate({ ...input });

    // 4. Store Draft (NEVER Send)
    if (result.draftReply) {
        await db.agentExecution.create({
            data: {
                status: "draft", // Explicit state
                draftReply: result.draftReply,
                // ... other fields
            }
        });
    }

    // 5. Update Suggested Actions
    // e.g. ["review_draft_reply", "propose_viewing_slots"]
}
```

---

## 3. Scheduled Tasks (Cron)

A consolidated cron endpoint `/api/cron/scheduled-tasks` runs every 30 minutes to generate proactive events.

### 3.1 Tasks
1.  **Post-Viewing Follow-Ups**: Checks for confirmed viewings >2h ago without feedback. Emits `follow_up.due`.
2.  **Expiring Offers**: Checks pending offers expiring within 48h. Emits `deal.stage_changed` (logging only for now).
3.  **Inactive Leads**: Checks qualified leads with score >30 and no activity for 7 days. Emits `follow_up.due`.
4.  **New Listings**: Checks listings created in last hour. Matches against contact requirements (Location + Budget). Emits `listing.new` with matching contact IDs.

---

## 4. Context Compaction

### 4.1 Problem
Long-running deals can have 100+ messages. Loading full history into the LLM context window is slow and expensive.

### 4.2 Solution
Progressive summarization cached on the `Conversation` record.

```typescript
// lib/ai/context/compaction.ts

export async function compactContext(conversationId: string) {
    // 1. Fetch all messages
    // 2. Keep last 20 verbatim
    // 3. Summarize the rest using a cheap model (Gemini Flash)
    // 4. Cache summary in `Conversation.contextSummary` (valid for 1 hour)
}
```

---

## 5. Database Schema Changes

```prisma
model Conversation {
  // ... existing fields
  semiAuto         Boolean   @default(false)
  contextSummary   String?   @db.Text
  lastSummarizedAt DateTime?
}

model AgentEvent {
  id             String   @id @default(cuid())
  type           String
  payload        Json
  status         String   @default("processed")
  error          String?
  processedAt    DateTime @default(now())
  // ... relations
}
```

---

## 6. Future: MCP Apps (Phase 7)

Interactive UI widgets delivered inside chat via MCP protocol.

> **Released**: January 2026 by Anthropic  
> **Status**: Planned for future enhancement

### Concept
Instead of plain text lists for properties, the agent returns a **UI Widget**:
- **Property Carousel**: Images, prices, "Schedule" buttons.
- **Viewing Scheduler**: Calendar grid for slot selection.
- **Offer Summary**: Visual breakdown of terms.

This requires a chat UI capable of rendering custom widgets (not supported in native WhatsApp).

---

## 7. Verification Checklist

- [x] **TypeScript Build**: 0 errors on new modules.
- [x] **Event Bus**: Logs events to `agent_events` table.
- [x] **Semi-Auto**: Handlers produce drafts only, no auto-sending.
- [x] **Cron**: Endpoint secure (`Bearer` token) and triggers events.
- [x] **Compaction**: Summarizes long histories correctly.
