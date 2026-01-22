# AI Draft & "Sketch-to-Draft" Feature

## 1. Overview
The AI Draft feature allows agents to quickly generate professional replies directly within the Chat Window. It supports a **"Sketch-to-Draft"** workflow where users type a rough instruction (e.g., *"say thanks and ask about budget"*) and the AI expands it into a polite, context-aware message.

## 2. Architecture: Local-First Hybrid
To ensure resilience, speed, and compatibility with both "Synced" (GHL) and "Shadow" (WhatsApp-only) conversations, we use a **Local-First** architecture.

### 2.1 The "Read" Path (Generating Drafts)
When a user clicks generic draft:
1.  **Source**: We read conversation history primarily from the **Local Database** (`db.conversation` + `db.message`).
2.  **Fallback**: We only attempt to fetch from GoHighLevel (GHL) if the local conversation is completely empty or missing.
3.  **Why**: This prevents `400 Bad Request` errors caused by sending internal IDs to GHL and ensures the UI remains responsive even if GHL's API is slow or down.

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
    *   *Result*: "Hi [Name], just confirming we have a viewing scheduled for today at 5:00 PM. Looking forward to seeing you there!"
4.  **Edit & Send**: Make any final tweaks and press Send.

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

### Common Issues
1.  **"Error generating draft"**:
    -   Check if the Google Gemini API Key is configured in `SiteConfig` or `.env`.

## 4. AI Model Selection

### Overview
Users can override the default AI model directly from the Chat Window before generating a draft.

### Workflow
1.  **Select Model**: Use the dropdown next to the "AI Draft" button (defaults to System Default `gemini-3-flash`).
2.  **Generate**: Click "AI Draft" or a suggestion bubble.
3.  **Backend**: The selected model ID is passed to `generateAIDraft` -> `generateDraft`.
4.  **Cost Tracking**: `AgentExecution` records the specific model used for accurate cost calculation.

### Configuration
-   **Default Model**: Configured in **Settings > AI Agent**.
-   **Available Models**: Fetched dynamically from Google's API to support the latest models (e.g., Gemini 3.0). Falls back to `lib/ai/pricing.ts` defaults if offline.


## 6. Smart Replies (Auto-Suggestions)

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
