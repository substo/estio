# AI Autonomous Agent - Technical Documentation

## Overview

The Estio AI system has evolved from a simple "Draft Generator" to a full **Autonomous Agent** capable of reasoning, planning, and executing actions in the CRM. Inspired by state-of-the-art agentic systems (Manus, etc.), it uses a structured "Plan -> Act -> Verify" methodology.

---

## Architecture: The Planner-Executor System (V3)

The AI has evolved from a single-shot agent to a **hierarchical Planner-Executor** system. This provides transparency and human control over multi-step workflows.

```
┌─────────────────────────────────────────────────────────────┐
│                   AI MISSION CONTROL                        │
│              /admin/conversations (UI)                      │
│                                                             │
│  [Goal Input] "Qualify lead and book viewing"               │
│       │                                                     │
│       ▼                                                     │
│  [Generate Mission Plan] ───► Generates JSON Task List      │
│                                     │                       │
│  ┌──────────────────────────────────▼────────────────────┐  │
│  │  Current Plan (Stored in DB: Conversation.agentPlan)  │  │
│  │  1. [DONE] Ask for Budget (Result: €500k)             │  │
│  │  2. [PENDING] Check Availability                      │  │
│  │  3. [PENDING] Propose Viewing Time                    │  │
│  └───────────────────────────────────────────────────────┘  │
│                                     │                       │
│       ┌─────────────────────────────▼────────────────┐      │
│       │           [Execute Next Step]                │      │
│       └─────────────────────┬────────────────────────┘      │
│                             │                               │
│                             ▼                               │
│                    Agent Execution Loop                     │
│                    (lib/ai/agent.ts)                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Database State (`agentPlan`)

The `Conversation` model now has a persistent plan field:

```prisma
model Conversation {
  // ...
  agentPlan Json?  // Stores [{ id, title, status: 'pending'|'done', result }]
  totalCost Float  @default(0) // Estimated cost in USD
}
```

This allows the agent to "remember" its plan and cost metrics across sessions.

### 2. The Planner (`generateAgentPlan`)
*   **Location**: `lib/ai/agent.ts`
*   **Input**: Conversation History + User's "Ultimate Goal".
*   **System Prompt**: `PLANNER_SYSTEM_PROMPT`
*   **Output**: A JSON array of tasks. It does *not* execute tools; it only plans.

### 3. The Executor (`executeAgentTask`)
*   **Location**: `lib/ai/agent.ts`
*   **Input**: Conversation History + *Current Task* (from the plan).
*   **System Prompt**: `EXECUTOR_SYSTEM_PROMPT`
*   **Behavior**: It sees *only* the current task and uses tools to achieve it.
*   **Output**: Tool results + Draft Reply + "Task Completed" flag.

### 4. Server Actions
*   **`generatePlanAction(conversationId, contactId, goal)`**: Creates and stores the plan.
*   **`executeNextTaskAction(conversationId, contactId)`**: Runs the next pending task.
*   **`getAgentPlan(conversationId)`**: Retrieves the current plan for display.

### 5. UI (Mission Control Panel)
*   **Location**: `coordinator-panel.tsx`
*   **Goal Input**: Free-text field for the user's objective.
*   **Task List**: Visual checklist showing Pending / In-Progress / Done states.
*   **Execute Next**: Runs one task at a time with transparent feedback.

---

## System Prompt Structure (Excerpt)

```text
You are the Estio Real Estate Super-Agent, an autonomous AI designed to manage real estate leads with expert precision.

## Core Methodology (Plan -> Act -> Verify)
1. **Analyze**: Deeply understand the user's intent, the conversation history, and the current state of the contact.
2. **Plan**: Formulate a strategy. Is the lead ready to view? Do they need more properties? Are they unresponsive?
3. **Act**: Use your tools to execute the plan. Update requirements, schedule viewings, or draft replies.
4. **Verify**: Ensure the action was successful and meaningful.

## Your Capabilities (Tools)
- **update_requirements**: Set status, budget, district, fields.
- **search_properties**: Find listings matching criteria.
- **create_viewing**: Schedule a physical viewing.
- **log_activity**: Add a structured note to the CRM log.
- **draft_reply**: Generate a text response for the agent to send.

## Output Format
Response must be valid JSON with structured reasoning:
{
  "thought_summary": "One-line summary of reasoning (displayed by default)",
  "thought_steps": [
    { "step": 1, "description": "What was analyzed", "conclusion": "What was determined" }
  ],
  "tool_calls": [
     { "name": "update_requirements", "arguments": { ... } },
     { "name": "log_activity", "arguments": { "message": "Updated budget to..." } }
  ],
  "final_response": "Draft text if applicable, otherwise null"
}
```

---

## Data Flow Example

1.  **User clicks "Run Agent (Autonomous)"** in the AI Coordinator panel.
2.  `handleRunAgent()` calls `runAgentAction(conversationId, contactId)`.
3.  Server action fetches the last 30 messages from `db.message`.
4.  `runAgent()` is invoked with formatted history string.
5.  Agent sends prompt to **Gemini 2.5 Pro** (or configured default) (JSON mode).
6.  Gemini returns:
    ```json
    {
      "thought": "Lead is asking for a 2-bed in Paphos under 200k. Current requirements are outdated. I should update them and search for matching properties.",
      "tool_calls": [
        { "name": "update_requirements", "arguments": { "district": "Paphos", "maxPrice": "€200,000", "bedrooms": "2 Bedrooms" } },
        { "name": "search_properties", "arguments": { "district": "Paphos", "maxPrice": 200000, "bedrooms": 2 } }
      ],
      "final_response": "Hi! I've found 3 properties in Paphos under €200k with 2 bedrooms..."
    }
    ```
7.  Agent loop executes `updateContactRequirements()` and `searchProperties()`.
8.  Results are returned to UI, which displays reasoning, actions, and draft.

---

## Configuration

### Required Environment Variables

| Variable            | Description                                                     |
|---------------------|-----------------------------------------------------------------|
| `GOOGLE_API_KEY`    | Fallback API key if not set in Site Config.                     |

### Site Config (Per-Location)

| Field               | Description                                                     |
|---------------------|-----------------------------------------------------------------|
| `googleAiApiKey`    | Location-specific Gemini API Key.                               |
| `outreachConfig`    | JSON object for enabling/disabling agent and storing prompts.   |

### AI Settings Page

**Location**: `/admin/settings/ai`

*   Toggle "Outreach Assistant" on/off.
*   Configure custom prompts for Vision ID, Icebreaker, and Qualifier (legacy extraction mode).
*   Model selection applies to the Agent as well (defaults to **System Default**).

## AI Thinking Display

The Mission Control panel now includes a **collapsible AI reasoning display** that allows users to view the complete thought process behind agent decisions on-demand.

### Design Rationale

Based on industry best practices from:
- **OpenAI o1**: Shows summaries, hides raw reasoning tokens
- **Claude**: Progressive disclosure with expandable sections
- **Gemini**: Thought summaries with configurable `thinking_level`

We implemented a hybrid approach showing:
1. **Summary by default**: One-line reasoning visible immediately
2. **Step-by-step on demand**: Click to expand detailed thought steps

### User Interface

```
┌─────────────────────────────────────────────────────────────┐
│  🧠 AI Reasoning                            [View Details]  │
├─────────────────────────────────────────────────────────────┤
│  Summary: "Lead is asking for 2-bed in Paphos under 200k"  │
│                                                             │
│  [Click to expand step-by-step thinking]                    │
└─────────────────────────────────────────────────────────────┘
```

### Technical Implementation

The executor prompt now outputs structured thinking:

```json
{
  "thought_summary": "One-line summary",
  "thought_steps": [
    { "step": 1, "description": "Analyzed conversation", "conclusion": "Budget: 200k" },
    { "step": 2, "description": "Checked requirements", "conclusion": "District outdated" }
  ],
  "tool_calls": [...],
  "final_response": "..."
}
```

### Persistence & History

To ensure the AI's reasoning is not lost, we implemented a full persistence layer:

*   **Database Model**: `AgentExecution`
    *   Stores `conversationId`, `taskId`, `thoughtSummary`, `thoughtSteps` (JSON), `toolCalls` (JSON), and `draftReply`.
*   **Workflow**:
    *   `executeNextTaskAction` creates a new `AgentExecution` record after each task.
    *   The `CoordinatorPanel` fetches the last 20 executions via `getAgentExecutions`.

### Usage & Cost Tracking

To provide transparency into AI operations, the system tracks detailed usage metrics:

*   **Token Counting**: Tracks prompt and completion tokens for every execution, and captures extended Gemini usage metadata when available (thinking/tool-use/cached-content counters).
*   **Cost Estimation**: Calculates estimated USD cost based on model pricing tiers and usage metadata.
    *   **Primary Method**: Uses explicit usage fields (including thinking/tool-use tokens).
    *   **Fallback Method**: If extended fields are missing but `totalTokens` is higher than known prompt/completion counts, the remainder is treated as inferred output tokens for a conservative estimate.
*   **Data & Visibility**:
    *   **Database**: Stores `model`, `cost`, `promptTokens`, `completionTokens` in `AgentExecution`.
    *   **Pricing Engine**: `lib/ai/pricing.ts` maintains an up-to-date registry of model rates.
    *   **UI**: **Global Header Badge** (`components/ai-cost-badge.tsx`) displays usage on all admin pages:
        *   **At a Glance**: Shows Today + This Month costs in the header
        *   **Click to Expand**: Opens detailed modal with All-Time totals and per-conversation breakdown
        *   **Top Conversations**: Lists conversations ranked by AI cost with direct navigation links
    *   **Trace Modal Behavior**: Unknown per-run cost is displayed as `N/A` (not `$0.00000`) to avoid false-zero interpretation.

### Key Files

| File | Purpose |
|------|---------|
| `lib/ai/agent.ts` | System prompts requesting structured thought output |
| `lib/ai/pricing.ts` | Model pricing registry for cost estimation |
| `components/ai-cost-badge.tsx` | Global header badge with usage modal |
| `coordinator-panel.tsx` | Collapsible UI component display + Full Trace Modal |
| `actions.ts` | Backend logic for saving `AgentExecution`, fetching history, and aggregate usage |
| `prisma/schema.prisma` | DB definition for `AgentExecution` model |


### Full Trace Modal

For deep investigation of the complete AI reasoning flow, users can click **"View Full AI Trace"** to open a comprehensive modal. This modal features a **History Sidebar** to browse past executions.

```
┌─────────────────────────┬───────────────────────────────────────────────────┐
│ HISTORY                 │  🧠 Full AI Thinking Trace                [X]     │
│                         │  Complete reasoning flow from the AI agent        │
│ [Today 8:15 AM]         ├───────────────────────────────────────────────────┤
│ Qualify Lead     [Done] │  🕐 Jan 21, 2026, 8:15 AM                         │
│                         │                                                   │
│ [Yesterday 4:00 PM]     │  ┌─────────────────────────────────────────────┐  │
│ Draft Welcome    [Done] │  │ TASK EXECUTED                               │  │
│                         │  │ Qualify the lead's budget           [done]  │  │
│                         │  └─────────────────────────────────────────────┘  │
│                         │                                                   │
│                         │  ┌─────────────────────────────────────────────┐  │
│                         │  │ SUMMARY                                     │  │
│                         │  │ Lead mentioned 200k budget...               │  │
│                         │  └─────────────────────────────────────────────┘  │
│                         │                                                   │
│                         │  ┌─────────────────────────────────────────────┐  │
│                         │  │ REASONING STEPS                             │  │
│                         │  │ ① Analyzed conversation...                  │  │
│                         │  └─────────────────────────────────────────────┘  │
└─────────────────────────┴───────────────────────────────────────────────────┘
```

**Modal Sections:**
1. **Timestamp** - When the execution occurred
2. **Task Executed** - The specific task from the plan with status badge
3. **Summary** - One-line reasoning summary
4. **Reasoning Steps** - Numbered steps with descriptions and conclusions
5. **Tool Executions** - Each tool call with success/failure status and results
6. **Generated Draft** - The AI's proposed response
7. **Raw JSON** - Collapsible view of the complete raw trace data

---

## Future Roadmap

### Planned Enhancements

1.  **Auto-Pilot Mode**: For low-risk intents (e.g., acknowledgements), bypass human approval and auto-send.
2.  **Webhook Trigger**: Automatically run agent when a new inbound message arrives.
3.  **Deal Room Agent**: Extend `DealAgent` to handle multi-party coordination with full tool support.
4.  **Strategic Goal Selection**: (In Progress) Allow users to guide the agent towards specific outcomes.
5.  **Structured Suggestions**: (In Progress) Agent returns multiple reply options for the user to choose from.
6.  **More Tools**:
    *   `send_email`: Trigger outbound email via GHL or native SMTP.
    *   `create_task`: Add a follow-up task to the agent's calendar.
    *   `lookup_property`: Fetch detailed info on a specific property reference.
7.  **Memory/State**: Persist agent "memory" across sessions for long-running negotiations.

---

## Related Documentation

*   [AI Agentic Conversations Hub](ai-agentic-conversations-hub.md) – Original architecture and Deal Room concept.
*   [AI Configuration](ai-configuration.md) – Model selection and Brand Voice settings.
*   [Google Contact Sync](google-contact-sync.md) – How Vision ID integrates with Google Contacts.
