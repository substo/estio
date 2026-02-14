# Phase 6: Auto-Pilot & Event-Driven Architecture

**Duration**: Weeks 13–16  
**Priority**: 🟢 Enhancement  
**Dependencies**: Phase 0-5 (All previous phases must be stable)  
**Last Updated**: February 14, 2026 — Added MCP Apps (interactive UI in chat, SOTA Jan 2026)

---

## Objective

Transform the system from **reactive** (user clicks "Run Agent") to **proactive** (agent acts automatically on events). This is the final evolution that makes the agent truly autonomous:

1. **Event-Driven Triggers** — Agent responds automatically to incoming messages, new leads, and time-based events.
2. **Auto-Pilot Mode** — Low-risk actions execute without human approval.
3. **Proactive Outreach** — Agent initiates follow-ups, re-engagement, and market alerts.
4. **Context Compaction** — Long-running deals are summarized to prevent context overflow.
5. **MCP Apps** *(Future)* — Interactive UI widgets delivered inside chat via MCP protocol.

---

## 1. Event-Driven Architecture

### 1.1 Event Sources

| Source | Event | Handler |
|:-------|:------|:--------|
| **WhatsApp Webhook** | New message received | `onMessageReceived` |
| **Email Sync** | New email arrives | `onEmailReceived` |
| **CRM** | New lead created | `onLeadCreated` |
| **Calendar** | Viewing completed | `onViewingCompleted` |
| **Timer** | Follow-up due | `onFollowUpDue` |
| **Market** | New listing matches saved search | `onNewListing` |
| **Deal** | Stage transition | `onDealStageChanged` |
| **Signature** | Document signed | `onDocumentSigned` |

### 1.2 Event Bus Implementation

```typescript
// lib/ai/events/event-bus.ts

type EventType =
  | "message.received"
  | "email.received"
  | "lead.created"
  | "viewing.completed"
  | "follow_up.due"
  | "listing.new"
  | "deal.stage_changed"
  | "document.signed";

interface AgentEvent {
  type: EventType;
  payload: Record<string, any>;
  metadata: {
    timestamp: Date;
    sourceId: string;    // Webhook ID, cron job ID, etc.
    conversationId?: string;
    contactId?: string;
    dealId?: string;
  };
}

type EventHandler = (event: AgentEvent) => Promise<void>;

class EventBus {
  private handlers = new Map<EventType, EventHandler[]>();

  on(eventType: EventType, handler: EventHandler) {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  async emit(event: AgentEvent) {
    const handlers = this.handlers.get(event.type) ?? [];
    
    // Log event for observability
    await logEvent(event);

    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error(`Event handler error for ${event.type}:`, error);
        await logEventError(event, error);
      }
    }
  }
}

export const eventBus = new EventBus();
```

### 1.3 Event Handlers

```typescript
// lib/ai/events/handlers.ts

import { eventBus } from "./event-bus";
import { orchestrate } from "../orchestrator";

// ── Message Received ──
eventBus.on("message.received", async (event) => {
  const { conversationId, contactId, message, channel } = event.payload;

  // Check if auto-pilot is enabled for this conversation
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    include: { contact: true },
  });

  if (!conversation) return;

  const autoPilotEnabled = conversation.autoPilot ?? false;

  // Always classify and prepare a response
  const result = await orchestrate({
    conversationId,
    contactId,
    message,
    conversationHistory: await getConversationHistory(conversationId),
    dealStage: conversation.dealStage,
  });

  if (autoPilotEnabled && !result.requiresHumanApproval) {
    // Auto-send the response
    await sendMessage(conversationId, result.draftReply!, channel);
    await logAutoAction(conversationId, "auto_reply", result);
  } else {
    // Store as draft for human review
    await storeDraftReply(conversationId, result);
  }
});

// ── New Lead Created ──
eventBus.on("lead.created", async (event) => {
  const { contactId, source } = event.payload;

  // Auto-qualify: set initial lead score based on source
  const initialScore = {
    "website_form": 30,
    "whatsapp_direct": 40,
    "referral": 60,
    "portal_inquiry": 35,
  }[source] ?? 20;

  await db.contact.update({
    where: { id: contactId },
    data: { leadScore: initialScore },
  });

  // Generate welcome message
  const conversation = await findOrCreateConversation(contactId);
  const result = await orchestrate({
    conversationId: conversation.id,
    contactId,
    message: "NEW_LEAD_TRIGGER",
    conversationHistory: "",
  });

  await storeDraftReply(conversation.id, result);
});

// ── Viewing Completed ──
eventBus.on("viewing.completed", async (event) => {
  const { viewingId, contactId, propertyId } = event.payload;

  // Schedule follow-up in 2 hours
  await scheduleFollowUp(contactId, viewingId, 2 * 60 * 60 * 1000);
});

// ── Follow-Up Due ──
eventBus.on("follow_up.due", async (event) => {
  const { contactId, viewingId } = event.payload;

  const conversation = await findConversation(contactId);
  if (!conversation) return;

  const result = await orchestrate({
    conversationId: conversation.id,
    contactId,
    message: "FOLLOW_UP_TRIGGER",
    conversationHistory: await getConversationHistory(conversation.id),
  });

  await storeDraftReply(conversation.id, result);
});

// ── New Listing Matches Saved Search ──
eventBus.on("listing.new", async (event) => {
  const { propertyId, matchingContactIds } = event.payload;

  for (const contactId of matchingContactIds) {
    const conversation = await findConversation(contactId);
    if (!conversation) continue;

    // Draft a personalized alert
    const result = await orchestrate({
      conversationId: conversation.id,
      contactId,
      message: `NEW_LISTING_ALERT:${propertyId}`,
      conversationHistory: await getConversationHistory(conversation.id),
    });

    await storeDraftReply(conversation.id, result);
  }
});
```

---

## 2. Auto-Pilot System

### 2.1 Auto-Pilot Configuration

```typescript
// lib/ai/auto-pilot/config.ts

interface AutoPilotConfig {
  enabled: boolean;
  
  // Risk thresholds
  maxAutoRisk: "low" | "medium"; // Maximum risk level for auto-actions
  
  // Action whitelist
  allowedAutoActions: {
    acknowledgments: boolean;    // Auto-reply to "thanks", "ok"
    simpleQuestions: boolean;    // Auto-reply to FAQ-like questions
    viewingConfirmation: boolean; // Auto-confirm viewing slots
    followUpReminders: boolean;  // Auto-send follow-up messages
    listingAlerts: boolean;      // Auto-send new listing notifications
  };

  // Safety limits
  maxAutoRepliesPerDay: number;  // Circuit breaker
  maxAutoRepliesPerConversation: number;
  cooldownMinutes: number;       // Min time between auto-replies
}

const DEFAULT_CONFIG: AutoPilotConfig = {
  enabled: false,
  maxAutoRisk: "low",
  allowedAutoActions: {
    acknowledgments: true,
    simpleQuestions: false,
    viewingConfirmation: false,
    followUpReminders: true,
    listingAlerts: true,
  },
  maxAutoRepliesPerDay: 50,
  maxAutoRepliesPerConversation: 3,
  cooldownMinutes: 5,
};
```

### 2.2 Auto-Pilot Guard

```typescript
// lib/ai/auto-pilot/guard.ts

export async function canAutoExecute(
  conversationId: string,
  actionType: string,
  riskLevel: string
): Promise<{ allowed: boolean; reason: string }> {
  const config = await getAutoPilotConfig(conversationId);

  if (!config.enabled) {
    return { allowed: false, reason: "Auto-pilot disabled" };
  }

  // Risk check
  const riskOrder = { low: 0, medium: 1, high: 2 };
  if (riskOrder[riskLevel] > riskOrder[config.maxAutoRisk]) {
    return { allowed: false, reason: `Risk too high: ${riskLevel}` };
  }

  // Daily limit
  const todayCount = await countTodayAutoReplies(conversationId);
  if (todayCount >= config.maxAutoRepliesPerDay) {
    return { allowed: false, reason: "Daily auto-reply limit reached" };
  }

  // Per-conversation limit
  const convCount = await countConversationAutoReplies(conversationId);
  if (convCount >= config.maxAutoRepliesPerConversation) {
    return { allowed: false, reason: "Per-conversation limit reached" };
  }

  // Cooldown check
  const lastAutoReply = await getLastAutoReplyTime(conversationId);
  if (lastAutoReply) {
    const minutesSince = (Date.now() - lastAutoReply.getTime()) / 60000;
    if (minutesSince < config.cooldownMinutes) {
      return { allowed: false, reason: `Cooldown: wait ${config.cooldownMinutes - minutesSince} min` };
    }
  }

  return { allowed: true, reason: "All checks passed" };
}
```

---

## 3. Proactive Outreach

### 3.1 Cron Jobs

```typescript
// lib/ai/cron/scheduled-tasks.ts

/**
 * Runs every hour — checks for due follow-ups,
 * expiring offers, and re-engagement opportunities.
 */
export async function runScheduledTasks() {
  // 1. Post-viewing follow-ups
  const pendingFollowUps = await checkPendingFollowUps();
  for (const fu of pendingFollowUps) {
    await eventBus.emit({
      type: "follow_up.due",
      payload: fu,
      metadata: { timestamp: new Date(), sourceId: "cron" },
    });
  }

  // 2. Expiring offers (48h warning)
  const expiringOffers = await db.offer.findMany({
    where: {
      status: "pending",
      validUntil: { lte: new Date(Date.now() + 48 * 60 * 60 * 1000), gte: new Date() },
    },
  });
  // Notify agent about expiring offers

  // 3. Inactive leads (no interaction in 7 days)
  const inactiveLeads = await db.contact.findMany({
    where: {
      leadScore: { gte: 30 },
      qualificationStage: { in: ["basic", "qualified"] },
      updatedAt: { lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
    take: 10,
  });
  // Generate re-engagement messages

  // 4. New listings matching saved searches
  const recentListings = await db.property.findMany({
    where: { createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  for (const listing of recentListings) {
    const matchingContacts = await findMatchingContacts(listing);
    if (matchingContacts.length > 0) {
      await eventBus.emit({
        type: "listing.new",
        payload: { propertyId: listing.id, matchingContactIds: matchingContacts.map(c => c.id) },
        metadata: { timestamp: new Date(), sourceId: "cron" },
      });
    }
  }
}
```

---

## 4. Context Compaction

### 4.1 Problem

Long-running deals can have 200+ messages across weeks. Even with 1M token context, loading everything is wasteful and slow.

### 4.2 Solution: Progressive Summarization

```typescript
// lib/ai/context/compaction.ts

/**
 * Compact a long conversation into a summary + recent messages.
 * Uses the Claude Opus 4.6 Context Compaction pattern.
 */
export async function compactContext(
  conversationId: string,
  maxRecentMessages: number = 20
): Promise<{ summary: string; recentMessages: Message[] }> {
  const messages = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });

  if (messages.length <= maxRecentMessages) {
    return { summary: "", recentMessages: messages };
  }

  // Split: old messages get summarized, recent stay verbatim
  const oldMessages = messages.slice(0, -maxRecentMessages);
  const recentMessages = messages.slice(-maxRecentMessages);

  // Summarize old messages
  const summary = await summarizeConversation(oldMessages);

  return { summary, recentMessages };
}

async function summarizeConversation(messages: Message[]): Promise<string> {
  const model = getModelForTask("intent_classification"); // Cheap model for summarization

  const prompt = `Summarize this conversation between a real estate agent and a client.
Focus on:
- Key requirements discussed
- Properties shown/discussed
- Decisions made
- Outstanding questions
- Current deal stage

Conversation:
${messages.map(m => `[${m.direction}] ${m.body}`).join("\n")}

Summary:`;

  return callLLM(model, prompt);
}
```

---

## 5. Database Changes

```prisma
// Add to Conversation model
model Conversation {
  // ... existing
  autoPilot       Boolean  @default(false)
  autoPilotConfig Json?    // AutoPilotConfig
  contextSummary  String?  // Compacted context
  lastSummarizedAt DateTime?
}

// Event log for observability
model AgentEvent {
  id              String   @id @default(cuid())
  type            String   // EventType
  payload         Json
  conversationId  String?
  contactId       String?
  status          String   @default("processed")
  error           String?
  processedAt     DateTime @default(now())
  @@index([type, processedAt])
}
```

---

## 6. UI Changes

### Auto-Pilot Toggle

Add an Auto-Pilot toggle to the conversation header:
- **OFF** (default): All agent responses are drafts for review
- **ON**: Low-risk responses sent automatically, high-risk remain drafts
- Visual indicator: green pulse when auto-pilot is active
- Activity log showing all auto-actions taken

### Event Dashboard

A dashboard showing:
- Events processed per hour
- Auto-replies sent vs. reviewed
- Failed events / errors
- Cost per auto-action

---

## 7. Verification

### Automated Tests

```yaml
- event: "message.received" with body "Thanks!"
  auto_pilot: true
  assertions:
    - auto_reply_sent: true
    - reply_contains: "You're welcome"

- event: "message.received" with body "I want to offer €200k"
  auto_pilot: true
  assertions:
    - auto_reply_sent: false
    - draft_created: true
    - requires_human_approval: true
```

### Manual Tests

- [ ] WhatsApp message triggers automatic orchestration
- [ ] Auto-pilot sends low-risk replies without human action
- [ ] High-risk messages are queued as drafts (even with auto-pilot on)
- [ ] Daily auto-reply limit prevents runaway automation
- [ ] Context compaction reduces prompt size by >50% for long conversations
- [ ] Cron job detects inactive leads and generates re-engagement drafts
- [ ] New listing alert sent to matching contacts

---

## 8. MCP Apps — Interactive UI in Chat (Future: Phase 7)

> **Released**: January 2026 by Anthropic  
> **Priority**: 🟢 Post-launch enhancement (Weeks 15–16)  
> **Dependencies**: Phase 0 (MCP Server), Phase 6 (Event-Driven)

### Problem

Currently, all agent outputs are **plain text**. When the Searcher skill finds 5 matching properties, the agent formats them as a text list:

```
1. Villa in Paphos — €195,000 — 3 bed, 2 bath, sea view
2. Apartment in Kato Paphos — €175,000 — 2 bed, 1 bath
...
```

This works, but a **visual card carousel** with images, prices, and quick-action buttons ("Schedule Viewing", "More Details") would be dramatically more engaging.

### Solution: Anthropic MCP Apps (Jan 2026)

MCP Apps extend the MCP protocol so that tools can return **interactive UI components** (HTML/JS) alongside their data. The chat client renders these as rich widgets instead of plain text.

### How It Works

```
Agent calls search_properties({district: "Paphos", maxPrice: 200000})

Traditional MCP Response:
  { content: [{ type: "text", text: "[{id: 1, title: 'Villa...'}, ...]" }] }

MCP Apps Response:
  { content: [
    { type: "text", text: JSON.stringify(properties) },
    {
      type: "ui_resource",
      uri: "estio://widgets/property-cards",
      data: { properties, contactId },
      metadata: {
        title: "Matching Properties",
        interactive: true,
        actions: ["schedule_viewing", "save_property", "more_details"]
      }
    }
  ]}
```

### Implementation Plan

#### Step 1: Define UI Resource Types

```typescript
// lib/ai/mcp/ui-resources.ts

/**
 * MCP App UI resource types for Estio.
 * Each resource type defines a widget that can be rendered in chat.
 */
export type UIResourceType =
  | "property-cards"      // Carousel of property cards with images
  | "viewing-scheduler"   // Calendar widget for picking viewing slots
  | "offer-summary"       // Offer details with accept/reject/counter buttons
  | "deal-timeline"       // Visual timeline of deal stages
  | "lead-scorecard"      // Lead qualification summary with radar chart
  | "market-comparison";  // Price comparison chart for negotiation

interface UIResource {
  type: "ui_resource";
  uri: string;                    // estio://widgets/{type}
  data: Record<string, any>;      // Data to render
  metadata: {
    title: string;
    interactive: boolean;          // Has clickable actions?
    actions?: string[];            // Available action callbacks
    width?: "compact" | "full";   // Display width
  };
}
```

#### Step 2: Property Card Widget

```typescript
// lib/ai/mcp/widgets/property-cards.tsx

/**
 * Renders a scrollable carousel of property cards.
 * Each card shows: image, title, price, key specs, and action buttons.
 */
export function PropertyCardsWidget({ properties, contactId }: {
  properties: Property[];
  contactId: string;
}) {
  return (
    <div className="property-carousel">
      {properties.map(property => (
        <div key={property.id} className="property-card">
          <img src={property.imageUrl} alt={property.title} />
          <h3>{property.title}</h3>
          <p className="price">€{property.price.toLocaleString()}</p>
          <div className="specs">
            <span>{property.bedrooms} bed</span>
            <span>{property.bathrooms} bath</span>
            <span>{property.area}m²</span>
          </div>
          <div className="actions">
            <button onClick={() => scheduleViewing(property.id, contactId)}>
              📅 Schedule Viewing
            </button>
            <button onClick={() => saveProperty(property.id, contactId)}>
              ❤️ Save
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

#### Step 3: Register UI Resources in MCP Server

```typescript
// Add to lib/ai/mcp/server.ts

server.resource(
  "estio://widgets/property-cards",
  "Interactive property cards with images and action buttons",
  async (uri, data) => {
    const html = renderPropertyCards(data.properties, data.contactId);
    return {
      contents: [{
        uri: uri.href,
        text: html,
        mimeType: "text/html",
      }],
    };
  }
);

server.resource(
  "estio://widgets/viewing-scheduler",
  "Calendar widget for selecting viewing time slots",
  async (uri, data) => {
    const html = renderViewingScheduler(data.slots, data.propertyId, data.contactId);
    return {
      contents: [{
        uri: uri.href,
        text: html,
        mimeType: "text/html",
      }],
    };
  }
);
```

### Use Cases

| Widget | Trigger | What it Shows |
|:-------|:--------|:--------------|
| **Property Cards** | Searcher returns results | Image carousel with Save/Schedule buttons |
| **Viewing Scheduler** | Coordinator proposes slots | Calendar with available times to pick |
| **Offer Summary** | Negotiator drafts offer | Price breakdown with Accept/Counter buttons |
| **Deal Timeline** | Any deal-stage query | Visual progress bar from Lead → Closed |
| **Lead Scorecard** | Qualifier completes profile | Radar chart: Budget, Urgency, Motivation, Fit |
| **Market Comparison** | Negotiator justifies price | Price bar chart vs. comparable properties |

### Rendering Integration

For our Next.js frontend, MCP App responses are rendered in the Chat Window:

```typescript
// components/chat/mcp-app-renderer.tsx

export function McpAppRenderer({ resource }: { resource: UIResource }) {
  // Sanitize and render the HTML in a sandboxed iframe
  return (
    <div className="mcp-app-widget">
      <h4>{resource.metadata.title}</h4>
      <iframe
        srcDoc={resource.data.html}
        sandbox="allow-scripts"
        style={{ width: resource.metadata.width === "full" ? "100%" : "400px" }}
      />
    </div>
  );
}
```

### Why This is Post-Launch

1. **Backend-first**: Our V1 agent is backend-only (WhatsApp/Email). MCP Apps require a **chat UI** to render widgets.
2. **WhatsApp limitation**: WhatsApp doesn't support HTML widgets — only text, images, and buttons. MCP Apps are for our **web dashboard chat**.
3. **Complexity**: Requires frontend widget framework, sandboxed rendering, action callback routing.
4. **High impact once done**: When we build a customer-facing web chat (Phase 7+), MCP Apps will be a massive differentiator.

---

## 9. No-Code Skill Builder (Future: Phase 8)

> **Source**: Claude Skills Expansion (Dec 2025)  
> **Priority**: 🟢 Nice-to-have (post-launch)

Anthropic released a no-code skill builder that lets non-technical users create custom skills via a visual interface. While not critical for V1, this would allow:

- **Real estate agents** to define custom follow-up sequences without code
- **Managers** to create approval workflow skills
- **Admins** to add new objection rebuttals to the Sales Playbook

### Proposed Approach

A simple form-based UI where users define:
1. **Trigger**: When should this skill activate? (Intent, deal stage, keyword)
2. **Instructions**: Natural language description of what to do
3. **Tools**: Which tools can the skill use? (checkboxes)
4. **Output**: What should the skill produce? (Draft reply, update record, send alert)

This generates a `SKILL.md` file that is saved to the skill registry and loaded by the orchestrator.

---

## Files Created / Modified

| Action | File | Purpose |
|:-------|:-----|:--------|
| **NEW** | `lib/ai/events/event-bus.ts` | Event bus |
| **NEW** | `lib/ai/events/handlers.ts` | Event handlers |
| **NEW** | `lib/ai/auto-pilot/config.ts` | Auto-pilot configuration |
| **NEW** | `lib/ai/auto-pilot/guard.ts` | Safety guards |
| **NEW** | `lib/ai/cron/scheduled-tasks.ts` | Hourly proactive tasks |
| **NEW** | `lib/ai/context/compaction.ts` | Context summarization |
| **NEW** | `lib/ai/mcp/ui-resources.ts` | MCP Apps UI resource types *(Future)* |
| **NEW** | `lib/ai/mcp/widgets/property-cards.tsx` | Property card widget *(Future)* |
| **NEW** | `components/chat/mcp-app-renderer.tsx` | MCP App widget renderer *(Future)* |
| **MODIFY** | `prisma/schema.prisma` | Add autoPilot fields, AgentEvent model |
| **MODIFY** | WhatsApp webhook handler | Emit `message.received` event |
| **MODIFY** | Email sync | Emit `email.received` event |
| **MODIFY** | Conversation UI | Add Auto-Pilot toggle |

---

## References

- [Claude Opus 4.6: Context Compaction](https://www.anthropic.com/news/claude-opus-4-6)
- [Event-Driven Architecture Patterns](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/event-driven)
- [OpenAI: Building Autonomous Agents](https://platform.openai.com/docs/guides/agents)
- [Bull/BullMQ: Node.js Job Queue](https://docs.bullmq.io/) — For production cron jobs
- [Circuit Breaker Pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)
- [Anthropic MCP Apps Announcement](https://thenewstack.io/anthropic-mcp-apps) — Jan 2026
- [Claude Skills Open Specification](https://www.anthropic.com/news/agent-skills) — Dec 2025
- [OpenClaw (ClaudeBot) Architecture](https://github.com/openclaw/openclaw) — Reference for multi-channel agent runtime
