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
    -   Check if the contact has valid data (Phone/Name).
2.  **Repetitive Drafts**:
    -   The AI relies on the last 20 messages. If the history is repetitive, the AI might mimic it. Try providing a specific instruction in the input box.
