# Agentic Conversations: Artificial Intelligence as an Intermediary

## 1. The Concept & Problem Statement

### The "Middleman" Challenge
In real estate agency operations, agents often act as intermediaries between multiple parties:
1.  **The Lead/Tenant**: Seeking a property.
2.  **The Owner/Landlord**: Providing the property.
3.  **Other Stakeholders**: Lawyers, Contractors, Previous Tenants.

Communication is fragmented across WhatsApp, SMS, and Email. The agent must constantly switch contexts, remembering that *this* lead is interested in *that* property owned by *this* person. 

### The Solution: Agentic Conversations
"Agentic Conversations" is a centralized communication hub built directly into the Estio Admin Dashboard (estio.co). It does not just aggregate messages; it introduces an **AI Coordinator** that "understands" the deal flow.

By connecting the **Message History** (from GoHighLevel) with the **Business Data** (Properties, Viewings, Deal Stages from the Database), the AI can:
*   Draft context-aware replies.
*   Suggest the next best action (e.g., "Ask for a viewing availability" to the Owner, then "Confirm viewing" to the Lead).
*   Act as a true coordinator, reducing the cognitive load on the human agent.

---

## 2. Technical Implementation

We chose to build this **internally** rather than relying on GoHighLevel's native UI to ensure deep integration with our proprietary data model.

### Architecture Overview

1.  **Hybrid Data Layer (Local-First + Sync)**:
    *   **Primary Source**: The UI reads from a local PostgreSQL database (`Conversation` and `Message` models) for instant performance (~10ms vs 500ms+ API calls).
    *   **Inbound Sync**: Webhooks (`/api/webhooks/ghl`) receive real-time events from GHL and upsert data into the local DB.
    *   **Outbound Sync**: Sent messages are optimistically saved to the DB immediately, then confirmed via the GHL API.
    *   **History Backfill**: Logic (`ensureConversationHistory`) runs in the background to fetch missing historical messages when a conversation is opened.

2.  **Intelligence Layer (Google Gemini)**:
    *   **Service**: `lib/ai/coordinator.ts`
    *   **Process**:
        1.  Fetch message history from the Local DB.
        2.  Identify the Contact.
        3.  Look up related **Properties** and **Viewings** in our Database.
        4.  Feed this "enriched context" to **System Default (e.g. Gemini 3 Flash)** to generate drafts.

3.  **User Interface**:
    *   **Location**: `/admin/conversations`
    *   **Unified Hub**: A single interface managing both individual "Chats" and multi-party "Deals".
    *   **Deal Mode Toggle**: Users can switch between standard chat view and "Deal Mode" to manage complex negotiations.
    *   **Instant Switching**: The UI uses internal state caching to switch conversations instantly, showing a loader only for the message content.

### Key Components

*   **`lib/ghl/sync.ts`**: (New) The core synchronization engine. Handles webhook processing, batch history fetching, and the **Inference Engine** which robustly determines message direction.
*   **`lib/ghl/conversations.ts`**: The API Client bridging our app and GHL.
*   **`app/(main)/admin/conversations/actions.ts`**: Server actions that now read from the DB but trigger background syncs to ensure data freshness.
*   **`prisma/schema.prisma`**: Updated to include `Conversation` and `Message` models with metadata fields (`emailFrom`, `userId`, `source`) critical for correct alignment.

## 3. Direction Inference Engine

A core challenge with the GHL API is ambiguous message direction (e.g., forwarded emails). We implemented a strict priority logic to determine "Inbound (Left)" vs "Outbound (Right)":

1.  **Contact Match**: If `emailFrom` matches the contact's email -> **INBOUND**.
2.  **Explicit Direction**: Use GHL's `direction` field if available.
3.  **User Attribution**: If a `userId` is present -> **OUTBOUND** (Agent).
4.  **Source Detection**: Sources like `workflow`, `api`, `mobile_app` -> **OUTBOUND**.
5.  **Heuristic Fallback**: Scanning body text for "On ... wrote:" patterns to catch replies.

## 4. Persistent Deal Rooms & The Unified Hub (New)

We have evolved the system from a 1:1 chat interface to a **Many-to-One Persistent Deal Room**. This solves the "Middleman" problem where an agent needs to coordinate between a Buyer and a Seller over weeks or months.

### Features
1.  **Unified Timeline**: When a Deal is selected, the center pane transforms into a merged chronological stream of interactions from ALL stakeholders (Lead Emails + Owner SMS + System Notes). This provides a single source of truth for the deal's history.
2.  **Persistent `DealContext`**: Deals are now permanent database records with Stages (Active, Negotiation, Closed) and Health Scores, not just temporary session contexts.
3.  **Smart Linking**: The system automatically serves as a "Deal Binding" layer. Agents can "Bind" a conversation to a deal, and the system automatically links the contact's future messages to that deal context.
4.  **Coordinator Panel Integration**: The right-hand panel adapts to the active mode. In "Deal Mode", it becomes the **AI Coordinator**, reasoning across the entire deal history rather than a single thread.

### Workflow
1.  **Toggle "Deals"**: In `/admin/conversations`, switch to Deals mode.
2.  **Select Deal**: Click a deal to view the Unified Timeline.
3.  **AI Analysis**: The Coordinator Panel analyzes the latest updates from all parties.
4.  **Agentic Action**: The AI suggests the next move (e.g., "Draft update to Owner", "Search Properties").

## 3. Channel & Sync Management (New)

### Multi-Channel Support
The system now treats communication channels as first-class citizens:
*   **Dynamic Selector**: Agents can switch between SMS, Email, and WhatsApp within the same thread.
*   **Professional Identity**: Emails are sent using the configured GHL Location Email (e.g., `info@agency.com`) rather than generic relays, ensuring better deliverability and professional appearance.

### Robust Synchronization
We identified that the GHL API occasionally omits the most recent inbound message from its list endpoint. To solve this, we implemented a robust sync strategy using **Heuristic Matching**:
1.  **Dual Fetch**: We fetch both the message history list AND the conversation summary metadata.
2.  **Comparison**: The system checks if the latest message (from summary) exists in the fetched list using a 3-step priority match:
    *   **ID Match**: Exact match on `messageId`.
    *   **Time Match**: Checks for messages with timestamps within 2 seconds of the summary timestamp.
    *   **Normalized Body Match**: Strips HTML tags and whitespace to compare content, preventing false negatives due to formatting differences.
3.  **Real Message Retrieval**: If truly missing, we attempt to fetch the message *individually* by its ID.
4.  **Auto-Recovery**: If that fails, a "synthetic" message is injected to ensure data continuity.

### AI Output Formatting
To better handle the difference between Email and SMS/WhatsApp channels:
*   **Email**: The AI is instructed to output **HTML** (e.g., `<b>`, `<br>`) and explicitly forbidden from using Markdown to ensure professional rendering.
*   **SMS/WhatsApp**: The AI is restricted to **Plain Text Only** to avoid "leaking" markdown asterisks (`**bold**`) into customer messages.

### Email Content Hydration & Sender Resolution
The default GHL message list endpoint returns stripped-down plaintext bodies and often ambiguous sender information. To ensure high-quality display:

1.  **Deep Hydration**: We intercept all `TYPE_EMAIL` messages and trigger a parallel fetch for the detailed message object (`/conversations/messages/{id}`).
2.  **Dynamic System Email**: We calculate the correct "System" sender (e.g., `info@downtowncyprus.site`) by looking up the Location's `siteConfig.domain` in our database, rather than hardcoding defaults.
3.  **Direction Inference**: Critical for correct alignment (Left vs Right). We strictly determine Inbound vs Outbound using a prioritized logic:
    *   **Priority 1 (Contact Match)**: If the *Sender Email* matches the *Contact's Email*, it is **Inbound** (even if the API reports "sent"). This handles external replies synced via Gmail/Outlook.
    *   **Priority 2 (User Action)**: If a `userId` is present, it is **Outbound** (sent by an agent).
    *   **Priority 3 (Source)**: Sources like `workflow`, `campaign`, `api` identify as **Outbound**.
    *   **Priority 4 (Heuristic Fallback)**:
        *   If the source is `app` (ambiguous), we default to **Outbound**.
        *   **EXCEPTION**: If the body contains strong reply indicators (e.g., `gmail_quote`, `yahoo_quoted`, `wrote:`), we force **Inbound**.

### UI Experience
*   **3-Column Layout**: Implemented a responsive List | Chat | Info layout to prevent horizontal scrolling on smaller screens.
*   **Smart Bubbles**: Messages are capped at 85% width with proper overflow handling.
*   **Email Cards**: Rendered in distinct "Email Cards" with collapsible "Show More" functionality to handle long conversation threads elegantly.

### Individual Conversation Previews
The conversation list uses a **compact layout** by default, showing only the contact name and channel icon. To view message details without disrupting the layout:

*   **HoverCard Popovers**: Each conversation row is wrapped in a Radix `HoverCard`. Hovering over a row triggers a floating preview card to appear to the right.
*   **Preview Content**: The popover displays contact name, timestamp, status badge, channel badge, and a 4-line message preview.
*   **Non-Disorienting UX**: Unlike the previous full-panel expansion, only the hovered row shows a preview—the list panel remains stable, preventing layout shifts.

**Key Components:**
*   `components/ui/hover-card.tsx`: Radix HoverCard wrapper with 300ms open delay and 100ms close delay.
*   `conversation-preview-card.tsx`: The popover content component.
*   `conversation-list.tsx`: Wraps each row with `HoverCard` + `HoverCardTrigger` + `HoverCardContent`.

### Email Overflow Containment & Layout Stability
Large HTML emails or long text strings (URLs, JSON) could previously cause the entire app window to expand horizontally. This is now robustly fixed with:
*   **Panel Overflow Control**: `PanelGroup` and Chat `Panel` have `overflow-hidden` to contain content.
*   **Aggressive Breaking**: Message bubbles now enforce `break-all` and `overflow-x-auto`. This ensures that even unbreakable strings force a line break or verify safe horizontal scrolling within the bubble, protecting the main 3-column layout.
*   **Prose Width Constraint**: Email HTML uses `max-w-full` allowing scroll within the bubble if needed.

### Unified Message Rendering
We refactored the message display into a shared component (`_components/message-bubble.tsx`) used by both the Chat Window and the Deal Timeline. This ensures:
*   **Consistent Visuals**: Identical styling for Headers, Timestamps, and Status indicators across all views.
*   **Feature Parity**: One-click "Expand/Collapse" for emails and attachment rendering are available everywhere.
*   **Maintainability**: Updates to message styling now propagate instantly to all parts of the Admin Hub.

### Channel-Specific From/To Display
Message bubbles now display contextually appropriate sender/recipient information based on channel type:
*   **Email**: Shows email addresses (`emailFrom` → `emailTo`)
*   **SMS/WhatsApp**: Shows phone number from contact record, or falls back to contact name
*   **Styling**: Headers are styled to match the message direction (outbound = blue tint, inbound = gray)

### Conversation List Channel Type
The conversation list now correctly displays the channel type (Email, SMS, WhatsApp) of the last message:
*   **Database Field**: Added `lastMessageType` field to `Conversation` model
*   **Sync Logic**: Both webhook sync and batch sync from GHL now store the message type
*   **UI Display**: Uses stored type with SMS as fallback for legacy data

---



## 4. Workflow Example (Deal Room)

1.  **Context Creation**:
    *   Agent toggles "Build Context".
    *   Selects **Lead (John)** and **Owner (Sarah)**.
    *   System detects they are both linked to **"Sea Caves Villa"**.
2.  **AI Analysis**:
    *   AI reads John's message: "Will they take 450k?"
    *   AI reads Sarah's last message: "I won't go below 480k."
3.  **Strategy Generation**:
    *   Agent clicks "Generate Strategy".
    *   **Coordinator Panel** suggests: "Draft to John: 'The owner has a firm floor at 480k, but we might be able to negotiate furniture included. Shall we try 475k?'"
4.  **Execution**:
    *   Agent approves and sends. 


---

## 5. Agentic Coordinator (Implemented - V2)

We have upgraded the AI from a passive "Drafter" to a full **Autonomous Agent** with Tool Use capabilities. This is now the primary AI interaction in the Coordinator Panel.

### Mission Control UI Enhancements
The "Mission Control" panel has been refined to provide better visibility and control:

#### 1. "Details" Section (Formerly Context & Stats)
We replaced the static stats view with a comprehensive **Contact Details** card:
*   **Quick Actions**: Click the contact name or distinct edit icon to open the full **Edit Contact Dialog**.
*   **Essential Info**: Displays Email, Phone, Lead Status, and Contact Type at a glance.
*   **Property Context**: Automatically lists **Interested Properties** and **Recent Viewings** fetched from the database relations (`propertyRoles`, `viewings`).
*   **Usage Stats**: AI token usage and cost tracking has been relocated to a **Global Header Badge** (`components/ai-cost-badge.tsx`). This badge is visible on all admin pages and shows Today + Month costs at a glance. Clicking opens a detailed modal with all-time usage and per-conversation breakdown.

#### 2. Edit Contact Integration
Users can now **View and Edit** the contact without leaving the conversation context:
*   The `EditContactDialog` is fully integrated.
*   Agents can update Lead Stage, assign new Properties, or add Notes immediately while chatting.

### Agent Architecture
*   **Model**: Google Gemini 2.5 Pro (configurable).
*   **Paradigm**: Manus-inspired "Plan -> Act -> Verify" loop with JSON function calling.
*   **Location**: The "Run Agent (Autonomous)" button in the AI Coordinator panel (`/admin/conversations`).

### Available Tools (lib/ai/tools.ts)
| Tool                       | Description                                                      |
|----------------------------|------------------------------------------------------------------|
| `update_requirements`      | Updates Contact requirements (status, district, budget, etc.)   |
| `search_properties`        | Queries DB for matching properties                               |
| `create_viewing`           | Schedules a viewing and syncs to GHL Calendar                    |
| `log_activity`             | Appends timestamped log to Contact's "Other Details"             |

### How It Works
1.  Agent receives conversation history + contact context.
2.  Gemini outputs JSON with `thought`, `tool_calls`, and `final_response`.
3.  System executes each tool call sequentially.
4.  Results + draft are displayed in the UI for human approval.

> **Full Documentation**: See [AI Autonomous Agent](ai-autonomous-agent.md) for architecture, prompts, and code references.

---

## 6. Future Roadmap

### Phase 3: The "Auto-Pilot" (Low Hanging Fruit)
*   **Concept**: Allow the AI to *auto-send* replies for low-risk intents (e.g., confirming receipt, sending standard brochures).
*   **Implementation Strategy**:
    1.  Classify intent (e.g., `INTENT: ACKNOWLEDGE_RECEIPT`, `INTENT: SEND_BROCHURE`).
    2.  If `Confidence > 90%` AND `Risk == LOW`, skip the "Draft" stage and call `sendMessage`.
    3.  **UI**: Add an "Auto-Pilot" toggle per conversation.

### Phase 4: Voice & Omnichannel
*   **Result**: AI says "I see you spoke on the phone yesterday about the price. Here's a draft follow-up email confirming the negotiation."

## 7. WhatsApp Integration Plan (Native)

To reduce dependency on GHL and provide a more robust, "production-ready" experience, we are implementing a **Direct WhatsApp Cloud API Integration**.

### Architecture

1.  **Credentials & Configuration**:
    *   Stored in the `Location` model (encrypted).
    *   Fields: `whatsappBusinessAccountId`, `whatsappPhoneNumberId`, `whatsappAccessToken`, `whatsappWebhookSecret`.
    *   UI: New settings page at `/admin/settings/integrations/whatsapp`.

2.  **Webhook Handling (`/api/webhooks/whatsapp`)**:
    *   **Verification**: Handles the initial `hub.challenge` verification from Meta.
    *   **Event Processing**: Receives `messages` (text, image, document) and `statuses` (sent, delivered, read).
    *   **Normalization**: Converts WhatsApp payloads into our internal `Message` format and upserts to DB.
    *   **Deduplication**: Uses `wam_id` (WhatsApp Message ID) to prevent duplicate processing.

3.  **Sending Logic (`lib/whatsapp/client.ts`)**:
    *   Direct calls to `graph.facebook.com/v21.0/{phone_number_id}/messages`.
    *   Supports `text` and standard `template` messages.
    *   Handles 24-hour customer service window restrictions (returns error if window closed, prompting user to use a template).

4.  **UI Updates**:
    *   **Conversation View**: Visual indicator for "WhatsApp" channel.
    *   **Composer**: If the last message was > 24 hours ago, enforce Template selection instead of free text.
    *   **Status Indicators**: Real-time updates for Sent/Delivered/Read ticks using local optimistic updates + webhook confirmation.

### Integration Steps (User Facing)
1.  Go to **Settings > Integrations > WhatsApp**.
2.  Enter **App ID**, **Phone Number ID**, and **System User Access Token** (from Meta Developer Portal).
3.  Copy the generated **Webhook URL** and **Verify Token**.
4.  Configure Webhook in Meta Developer Portal.
5.  Send a test message to verify.

