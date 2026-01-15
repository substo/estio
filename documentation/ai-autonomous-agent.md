# AI Autonomous Agent - Technical Documentation

## Overview

The Estio AI system has evolved from a simple "Draft Generator" to a full **Autonomous Agent** capable of reasoning, planning, and executing actions in the CRM. Inspired by state-of-the-art agentic systems (Manus, etc.), it uses a structured "Plan -> Act -> Verify" methodology.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AI COORDINATOR PANEL                          │
│                   /admin/conversations (UI)                          │
├─────────────────────────────────────────────────────────────────────┤
│ [Generate Suggestion]     │    [Run Agent (Autonomous)]             │
│   └── generateAIDraft()   │         └── runAgentAction()            │
│       (Simple Prompt)     │             (Agentic Loop)              │
└───────────────────────────┴─────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         lib/ai/agent.ts                              │
│                                                                      │
│  ┌───────────────┐    ┌──────────────────────────────────────────┐  │
│  │ System Prompt │───▶│  Google Gemini 2.5 Pro                   │  │
│  │ (MANUS-Style) │    │  • responseMimeType: application/json    │  │
│  └───────────────┘    │  • Outputs: thought, tool_calls, draft   │  │
│                       └──────────────────────────────────────────┘  │
│                                      │                               │
│                       ┌──────────────┴──────────────┐               │
│                       ▼                              ▼               │
│              Tool Execution Loop               Final Response        │
│              (lib/ai/tools.ts)                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. `lib/ai/agent.ts`

The brain of the system. Contains:

*   **`MANUS_SYSTEM_PROMPT`**: A detailed system instruction that defines the agent's persona ("Estio Real Estate Super-Agent"), methodology (Plan -> Act -> Verify), available tools, and output format.
*   **`runAgent(contactId, locationId, history)`**: The main entry point for single-contact analysis. Fetches context, calls Gemini, parses the JSON response, and executes tool calls.
*   **`DealAgent` class**: A wrapper for Deal Room scenarios (multi-contact coordination). Instantiated with `new DealAgent(apiKey, dealId, locationId)`.

### 2. `lib/ai/tools.ts`

A library of **executable functions** that the AI can invoke:

| Tool                       | Purpose                                                                 |
|----------------------------|-------------------------------------------------------------------------|
| `updateContactRequirements`| Modifies `requirementStatus`, `requirementDistrict`, `requirementMaxPrice`, etc. on a Contact. |
| `searchProperties`         | Queries `db.property.findMany` with filters (district, price, bedrooms). Returns up to 5 matching listings. |
| `createViewing`            | Creates a `Viewing` record in the database AND syncs to GHL Calendar if configured. |
| `appendLog`                | Appends a timestamped log entry to the Contact's `requirementOtherDetails` field (e.g., `[15/01/2026] AI Agent: Scheduled viewing for...`). |

### 3. Server Actions

*   **`app/(main)/admin/conversations/actions.ts` > `runAgentAction()`**: Fetches conversation history from the local DB, formats it, calls `runAgent`, and returns the result to the UI.
*   **`app/api/agent/run/route.ts`**: A REST API endpoint for triggering the agent externally (e.g., webhooks, cron jobs). `POST { contactId, locationId }`.

### 4. UI Integration

*   **Location**: `app/(main)/admin/conversations/_components/coordinator-panel.tsx`
*   **Button**: "Run Agent (Autonomous)" – visible in single-chat mode (not Deal Room).
*   **Display**: Shows `reasoning` (agent's thought process), `draft` (suggested reply), and `agentActions` (list of tools executed with results).

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
Response must be valid JSON:
{
  "thought": "Internal reasoning process...",
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
5.  Agent sends prompt to **Gemini 2.5 Pro** (JSON mode).
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
*   Model selection applies to the Agent as well (defaults to `gemini-2.5-pro`).

---

## Future Roadmap

### Planned Enhancements

1.  **Auto-Pilot Mode**: For low-risk intents (e.g., acknowledgements), bypass human approval and auto-send.
2.  **Webhook Trigger**: Automatically run agent when a new inbound message arrives.
3.  **Deal Room Agent**: Extend `DealAgent` to handle multi-party coordination with full tool support.
4.  **More Tools**:
    *   `send_email`: Trigger outbound email via GHL or native SMTP.
    *   `create_task`: Add a follow-up task to the agent's calendar.
    *   `lookup_property`: Fetch detailed info on a specific property reference.
5.  **Memory/State**: Persist agent "memory" across sessions for long-running negotiations.

---

## Related Documentation

*   [AI Agentic Conversations Hub](ai-agentic-conversations-hub.md) – Original architecture and Deal Room concept.
*   [AI Configuration](ai-configuration.md) – Model selection and Brand Voice settings.
*   [Google Contact Sync](google-contact-sync.md) – How Vision ID integrates with Google Contacts.
