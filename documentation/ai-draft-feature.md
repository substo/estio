# AI Draft & "Sketch-to-Draft" Feature

> Historical/Reference: This document contains legacy draft-generation details.
> For enterprise scheduling and unified suggested-response queue behavior, use:
> - `documentation/ai-skills-runtime-implementation.md`
> - `documentation/ai-skills-runtime-rewrite-handoff.md` (historical planning context)

## 1. Overview
The AI Draft feature allows agents to quickly generate professional replies directly within the Chat Window. It supports a **"Sketch-to-Draft"** workflow where users type a rough instruction (e.g., *"say thanks and ask about budget"*) and the AI expands it into a polite, context-aware message.

As of Feb 2026, draft generation also applies a **name-greeting cadence rule** to avoid repetitive openers like `Hi George,` in consecutive short-interval messages.

As of Mar 2026, draft generation also enforces the shared **Deal-Protective Multilingual Communication Policy** for language matching, non-binding precision, and hierarchy-safe wording.  
Source of truth: [AI Communication Policy](./ai-communication-policy.md).

As of Mar 10, 2026, manual draft generation also supports an explicit **reply language override** at the conversation level plus a persistent contact-level default. The policy and precedence rules remain documented only in [AI Communication Policy](./ai-communication-policy.md).

## 2. Architecture: Local-First Hybrid
To ensure resilience, speed, and compatibility with both "Synced" (GHL) and "Shadow" (WhatsApp-only) conversations, we use a **Local-First** architecture.

### 2.1 The "Read" Path (Generating Drafts)
When a user clicks generic draft:
1.  **Source**: We read conversation history primarily from the **Local Database** (`db.conversation` + `db.message`).
2.  **Fallback**: We only attempt to fetch from GoHighLevel (GHL) if the local conversation is completely empty or missing.
3.  **Timeline-Parity Context (Mar 2026)**: Draft generation now reads from the same normalized timeline event pipeline used by the UI, not messages alone.
4.  **Scope Rules**:
    *   **Chats mode** uses the selected thread timeline only.
    *   **Deal mode** uses a deal-aware merged timeline across all participant conversations linked to the active deal.
5.  **Included Timeline Entities**:
    *   messages / emails
    *   voice messages (with audio transcription text when available; tagged as `VOICE_MESSAGE` in prompt context; shows `[voice message – transcript unavailable]` when transcript is pending or failed)
    *   manual notes and other relevant contact-history activity entries
    *   canonical viewing events
    *   task state events
6.  **Task Noise Policy**:
    *   open or in-progress tasks appear as `TASK_OPEN`
    *   completed tasks appear as `TASK_DONE`
    *   task update/delete churn is intentionally excluded from prompt context
7.  **Compaction**: Older timeline events are summarized deterministically, while recent timeline events remain verbatim in the prompt. This keeps token usage bounded without losing older deal/thread state.
8.  **Timing Context**: Greeting-cadence logic still derives from actual message timestamps only, even though the wider timeline is now included.
9.  **Why**: This prevents `400 Bad Request` errors caused by sending internal IDs to GHL, keeps UI and AI context aligned, and ensures the UI remains responsive even if GHL's API is slow or down.

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
- Drafts must use the shared reply-language resolver.
- Precedence is `Conversation.replyLanguageOverride` -> `Contact.preferredLang` -> latest inbound -> thread default -> fallback.
- Tone must stay neutral, factual, commercially aware, and non-pushy.
- Drafts avoid hard authority/finality claims unless confirmed in context.
- Urgency wording must be evidence-based (for example, confirmed competing offer activity), not pressure language.
- Guardrail outcomes are attached to draft metadata for review visibility.

### Reply Language Controls (Mar 10, 2026)
- The shared composer includes a `Reply language` selector next to the channel/model controls.
- Options are `Auto` plus a curated searchable language list.
- `Auto` clears the conversation override and falls back to contact default or auto-detection.
- The active source is shown in the composer as `Conversation override`, `Contact default`, or `Auto-detected`.
- The same language selection is forwarded through manual draft entry points in chats mode, deal mode, and Mission Control quick draft.

### Timeline Context Rules (Mar 2026)
- Suggestion bubbles and explicit `AI Draft` actions both flow through the same draft generator and therefore use the same timeline-parity context rules.
- Deal-mode drafts receive cross-participant deal timeline context, but send approval still routes to the currently selected participant conversation.
- Contact enrichment still includes related properties, requirements, and viewings in addition to the normalized timeline feed.
- Prompt construction logs timeline inclusion/truncation counts so coverage is auditable in server logs.

## 5. Troubleshooting

### Logs to Watch
Search server logs for the tag `[AI Draft]`.

-   **Success (Normal)**:
    ```
    [AI Draft] Local DB Fetch Success. Found 20 messages.
    ```
-   **Timeline Compaction (Normal)**:
    ```
    [AI Draft] Timeline compaction stats: ...
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
    -   Check if the Google Gemini API key exists in `settings_secrets` (`location.ai` / `google_ai_api_key`) or fallback `.env` where applicable.
    -   Verify settings encryption env vars are set (`SETTINGS_ENCRYPTION_KEYS`, `SETTINGS_ENCRYPTION_PRIMARY_KEY_ID`).

## 6. AI Model Selection

### Overview
Users can override the default AI model directly from the Chat Window before generating a draft.

### Workflow
1.  **Select Model**: Use the dropdown next to the "AI Draft" button (defaults to a server-resolved Flash model: configured `googleAiModel` if set, otherwise `gemini-flash-latest` alias with pinned fallback).
2.  **Select Reply Language (Optional)**: Use the `Reply language` selector to keep the thread on `Auto` or force a specific language for this conversation.
3.  **Generate**: Click "AI Draft" or a suggestion bubble.
4.  **Backend**: The selected model ID and optional `replyLanguage` are passed to `generateAIDraft` -> `generateDraft`.
5.  **Cost Tracking**: `AgentExecution` records the specific model used for accurate cost calculation.

### Model Reuse in Selection Actions (New)
The same active model selection is also reused by message text-selection actions in the Chat Window:
- `Suggest Viewing`: `suggestViewingsFromSelection(conversationId, selection, model?, context?)`
- `Paste Lead`: `parseLeadFromText(selection, model?)`
- `Summarize`: `summarizeSelectionToCrmLog(conversationId, selection, model?)`
- `Custom`: `runCustomSelectionPrompt(conversationId, selection, instruction, model?)`

This keeps selection-based outputs aligned with the tone/capability of the current draft model.

Viewing-specific extraction rules such as message-timestamp anchoring for `today`/`tomorrow`, exact property reference matching, and timezone-safe apply behavior are documented in [viewing-creation-architecture.md](/Users/martingreen/Projects/IDX/documentation/viewing-creation-architecture.md).

### Configuration
-   **Default Model**: Resolved server-side for AI Draft (`Settings > AI Agent` override first; else `gemini-flash-latest`; fallback to pinned Flash if alias unavailable).
-   **Available Models**: Fetched dynamically from Google's API (paginated) and merged with curated aliases (e.g., `gemini-flash-latest`) so the dropdown stays current while preserving stable alias options.


## 7. Smart Replies (Auto-Suggestions)

### Overview
The system automatically analyzes inbound WhatsApp messages to suggest 3 quick "next actions" or intents (e.g., "Confirm Viewing", "Send Price List"). These appear as bubbles in the Chat Window.

### Workflow
1.  **Inbound Message**: Contact sends a message.
2.  **Background Analysis**: `lib/whatsapp/sync.ts` triggers `generateSmartReplies` (fire-and-forget).
3.  **AI Generation**: Gemini reads the recent conversation timeline (same normalized timeline as manual drafts, approx ~36 events) and generates 3 short intents (JSON).
4.  **Storage**: Suggestions are stored in `Conversation.suggestedActions`.
5.  **UI Update**: When the agent views the conversation, the bubbles appear.
6.  **Action**: Clicking a bubble uses the intent text as the **Instruction** for the same `generateAIDraft` pipeline used by the main draft button.
7.  **Context Parity**: Bubble-triggered drafts therefore receive the same normalized timeline context as manual draft generation, including notes, viewing events, and task state events when present in the active chat/deal scope.

### Example
-   **User**: "Is the 2-bed in Paphos still available?"
-   **Smart Suggestion**: "Confirm Availability"
-   **Agent Clicks Bubble**: "Confirm Availability"
-   **AI Draft Generates**: "Hi! Yes, the 2-bedroom apartment in Paphos is currently available. Would you like to schedule a viewing?"
