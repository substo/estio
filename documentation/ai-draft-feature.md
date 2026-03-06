# AI Draft & "Sketch-to-Draft" Feature

## 1. Overview
The AI Draft feature allows agents to quickly generate professional replies directly within the Chat Window. It supports a **"Sketch-to-Draft"** workflow where users type a rough instruction (e.g., *"say thanks and ask about budget"*) and the AI expands it into a polite, context-aware message.

As of Feb 2026, draft generation also applies a **name-greeting cadence rule** to avoid repetitive openers like `Hi George,` in consecutive short-interval messages.

As of Mar 2026, draft generation also enforces the shared **Deal-Protective Multilingual Communication Policy** for language matching, non-binding precision, and hierarchy-safe wording.  
Source of truth: [AI Communication Policy](./ai-communication-policy.md).

## 2. Architecture: Local-First Hybrid
To ensure resilience, speed, and compatibility with both "Synced" (GHL) and "Shadow" (WhatsApp-only) conversations, we use a **Local-First** architecture.

### 2.1 The "Read" Path (Generating Drafts)
When a user clicks generic draft:
1.  **Source**: We read conversation history primarily from the **Local Database** (`db.conversation` + `db.message`).
2.  **Fallback**: We only attempt to fetch from GoHighLevel (GHL) if the local conversation is completely empty or missing.
3.  **Timing Context**: Message timestamps are included in prompt context so AI can respect greeting cadence rules.
4.  **Why**: This prevents `400 Bad Request` errors caused by sending internal IDs to GHL and ensures the UI remains responsive even if GHL's API is slow or down.

### 2.2 The "Write" Path (Sending Messages)
When the user sends the message, we ensure data consistency using a **Just-In-Time (JIT) Upsync** pattern:
1.  **Check**: Does the contact have a `ghlContactId` locally?
2.  **Search**: If not, `ensureRemoteContact` searches GHL by Phone and Email to find existing matches.
3.  **Upsync (Create)**: If absolutely no match is found, the system **auto-creates** the contact in GHL immediately.
4.  **Link**: The new GHL ID is saved locally, and the message is synced.

## 3. Data & Logging
It is critical to distinguish between **Content** and **Metadata**:

| Data Type | Storage Table | Purpose | Visible in Chat? |
| :--- | :--- | :--- | :--- |
| **Draft Content** | `AgentExecution` | Audit, Cost Tracking, Debugging | **NO** |
| **Sent Message** | `Message` | Legal Record, Conversation History | **YES** |

**Key Takeaway**: Generated drafts are **never** saved to the `Message` table. They do not pollute the conversation history. They are only logged as `AgentExecution` records to track token usage and AI costs.

## 4. Usage Guide

### Sketch-to-Draft Workflow
1.  **Type Instruction**: In the chat input, type a rough command.
    *   *Example*: "tell him we have a viewing at 5pm"
2.  **Click Sparkles**: Press the AI icon (Sparkles).
3.  **Review**: The AI replaces your rough text with a polished draft.
    *   *Result*: "Just confirming we have a viewing scheduled for today at 5:00 PM. Looking forward to seeing you there!"
4.  **Edit & Send**: Make any final tweaks and press Send.

### Greeting Cadence Rules (Feb 2026)
- Name greeting (for example `Hi George,`) is allowed only when:
  - it is first outreach in the thread, or
  - the conversation resumed on a new day, or
  - there was a long break between recent messages (currently `>= 3` hours).
- For active back-to-back conversation, drafts should start directly with message intent and avoid repeating the contact's name greeting.
- A safety post-processor strips a leading name greeting when it violates this rule.

### Communication Policy (Mar 2026)
- Drafts must reply in the contact's language (latest inbound -> `Contact.preferredLang` -> thread default).
- Tone must stay neutral, factual, commercially aware, and non-pushy.
- Drafts avoid hard authority/finality claims unless confirmed in context.
- Urgency wording must be evidence-based (for example, confirmed competing offer activity), not pressure language.
- Guardrail outcomes are attached to draft metadata for review visibility.

## 5. Troubleshooting

### Logs to Watch
Search server logs for the tag `[AI Draft]`.

-   **Success (Normal)**:
    ```
    [AI Draft] Local DB Fetch Success. Found 20 messages.
    ```
-   **Fallback (Rare)**:
    ```
    [AI Draft] Local context empty/missing. Attempting GHL Fallback...
    [AI Draft] GHL Fetch Success.
    ```
-   **Warning**:
    ```
    [AI Draft] GHL Context Fetch Failed: 400 Bad Request
    ```
    *Note: This warning is now safely handled by the Local-First fallback and does not block the user.*
-   **Greeting Guard Applied**:
    ```
    [AI Draft] Removed leading name greeting based on timing rule.
    ```

### Common Issues
1.  **"Error generating draft"**:
    -   Check if the Google Gemini API Key is configured in `SiteConfig` or `.env`.

## 6. AI Model Selection

### Overview
Users can override the default AI model directly from the Chat Window before generating a draft.

### Workflow
1.  **Select Model**: Use the dropdown next to the "AI Draft" button (defaults to a server-resolved Flash model: configured `googleAiModel` if set, otherwise `gemini-flash-latest` alias with pinned fallback).
2.  **Generate**: Click "AI Draft" or a suggestion bubble.
3.  **Backend**: The selected model ID is passed to `generateAIDraft` -> `generateDraft`.
4.  **Cost Tracking**: `AgentExecution` records the specific model used for accurate cost calculation.

### Model Reuse in Selection Actions (New)
The same active model selection is also reused by message text-selection actions in the Chat Window:
- `Paste Lead`: `parseLeadFromText(selection, model?)`
- `Summarize`: `summarizeSelectionToCrmLog(conversationId, selection, model?)`
- `Custom`: `runCustomSelectionPrompt(conversationId, selection, instruction, model?)`

This keeps selection-based outputs aligned with the tone/capability of the current draft model.

### Configuration
-   **Default Model**: Resolved server-side for AI Draft (`Settings > AI Agent` override first; else `gemini-flash-latest`; fallback to pinned Flash if alias unavailable).
-   **Available Models**: Fetched dynamically from Google's API (paginated) and merged with curated aliases (e.g., `gemini-flash-latest`) so the dropdown stays current while preserving stable alias options.


## 7. Smart Replies (Auto-Suggestions)

### Overview
The system automatically analyzes inbound WhatsApp messages to suggest 3 quick "next actions" or intents (e.g., "Confirm Viewing", "Send Price List"). These appear as bubbles in the Chat Window.

### Workflow
1.  **Inbound Message**: Contact sends a message.
2.  **Background Analysis**: `lib/whatsapp/sync.ts` triggers `generateSmartReplies` (fire-and-forget).
3.  **AI Generation**: Gemini reads the last 15 messages and generates 3 short intents (JSON).
4.  **Storage**: Suggestions are stored in `Conversation.suggestedActions`.
5.  **UI Update**: When the agent views the conversation, the bubbles appear.
6.  **Action**: Clicking a bubble uses the intent text as the **Instruction** for the AI Draft generator.

### Example
-   **User**: "Is the 2-bed in Paphos still available?"
-   **Smart Suggestion**: "Confirm Availability"
-   **Agent Clicks Bubble**: "Confirm Availability"
-   **AI Draft Generates**: "Hi! Yes, the 2-bedroom apartment in Paphos is currently available. Would you like to schedule a viewing?"
