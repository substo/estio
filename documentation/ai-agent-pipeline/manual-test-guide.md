# Manual Testing Guide — AI Agent Pipeline

> **Purpose**: Step-by-step instructions to test each phase of the AI Agent Pipeline, from lead entry to booking a viewing.
> **Date**: February 15, 2026

---

## Prerequisite: Helper Tools
We have created two API endpoints to make testing easier without needing external webhooks or GHL integration.

- **Seed & Trigger**: `POST /api/test/seed` — Creates a lead + conversation + optional first message.
- **Manual Trigger**: `POST /api/test/trigger` — Simulates an incoming message to an existing conversation.

---

## Phase 1: Lead Entry & Initialization
**Goal**: Verify that a new lead entering the system (via form or SMS) immediately triggers the first AI response.

### Scenario 1.1: Real Lead Simulation (The "Hook")
Instead of creating a silent contact, we simulate a lead who just sent their first message (e.g., via a portal or website form).

**Action**: Run this command in your terminal:
```bash
curl -X POST http://localhost:3000/api/test/seed \
  -H "Content-Type: application/json" \
  -d '{"initialMessage": "Hi, I am looking for a 2-bedroom apartment in Paphos under \u20ac200k"}'
```

**✅ Verification**:
1.  **Response**: The API returns `automationResult.draftReply` with the AI's first response (e.g., "Hi [Name], I'd be happy to help...").
2.  **Database**:
    -   A new `Contact` ("AI Pipeline Test Lead") is created.
    -   A `Conversation` is created with `semiAuto: true`.
    -   The `Message` ("Hi, I am looking...") is saved as `inbound`.
3.  **UI**: Go to **Conversations**, open the new chat. You should see the AI's draft reply waiting for approval.

---

## Phase 2: Qualification (The Conversation)
**Goal**: Verify the **Qualifier Agent** gathers necessary details (budget, location, timeline) naturally.

### Scenario 2.1: Answering Questions
**Action**: Reply to the AI's question. If it asked "Is this for investment or living?", send:
```bash
# Replace YOUR_CONVERSATION_ID from the previous step response
curl -X POST http://localhost:3000/api/test/trigger \
  -H "Content-Type: application/json" \
  -d '{"conversationId": "YOUR_CONVERSATION_ID", "message": "It is for retirement living"}'
```

**✅ Verification**:
-   **Insight Stored**: Check **Contact Details** in UI. You should see an insight like "Client looking for retirement property".
-   **Profile Updated**: The contact's `leadScore` should increase.
-   **Next Question**: The AI should ask the next logical question (e.g., "When are you planning to move?").

---

## Phase 3: Property Search & Recommendations
**Goal**: Verify the **Searcher Agent** can find properties using semantic search.

### Scenario 3.1: Specific Property Request
**Action**: Ask for something specific:
```bash
curl -X POST http://localhost:3000/api/test/trigger \
  -H "Content-Type: application/json" \
  -d '{"conversationId": "YOUR_CONVERSATION_ID", "message": "Do you have anything with a sea view near Coral Bay?"}'
```

**✅ Verification**:
-   **Skill Used**: Trace should show `searcher` skill was active.
-   **Tool Call**: `search_properties` tool was called with `district: "Paphos"`, `features: ["sea view"]`.
-   **Response**: The draft reply lists 3-5 real properties from your database with links/details.

---

## Phase 4: Objection Handling
**Goal**: Verify the **Objection Handler** uses the Sales Playbook to address concerns without being pushy.

### Scenario 4.1: Price Objection
**Action**: Raise a concern:
```bash
curl -X POST http://localhost:3000/api/test/trigger \
  -H "Content-Type: application/json" \
  -d '{"conversationId": "YOUR_CONVERSATION_ID", "message": "That seems expensive for an apartment."}'
```

**✅ Verification**:
-   **Intent**: Classified as `OBJECTION` (High Risk).
-   **Badge**: UI shows **"Review Req"**.
-   **Response**: The AI acknowledges the concern (Empathy) and provides context (e.g., "ROI in this area is high...", "Prices in Coral Bay have risen..."). It does NOT offer a discount immediately.

---

## Phase 5: Scheduling & Closing
**Goal**: Verify the **Coordinator Agent** handles viewing requests and calendar slots.

### Scenario 5.1: Booking a Viewing
**Action**: Request a viewing:
```bash
curl -X POST http://localhost:3000/api/test/trigger \
  -H "Content-Type: application/json" \
  -d '{"conversationId": "YOUR_CONVERSATION_ID", "message": "Can I see the first one on Tuesday?"}'
```

**✅ Verification**:
-   **Intent**: Classified as `SCHEDULE_VIEWING`.
-   **Tool Call**: `check_availability` -> `propose_slots`.
-   **Response**: The AI proposes specific time slots (e.g., "I have 10:00 AM or 2:00 PM available on Tuesday").

---

## Phase 6: Semi-Auto/Event-Driven (Advanced)
**Goal**: Verify that *passive* events trigger drafts.

### Scenario 6.1: Back-to-Back Messages
**Action**: Send two messages quickly (simulating a user adding more info).
1.  Send: "Actually, I also need a garage."
2.  Send: "And a pool."

**✅ Verification**:
-   The system might trigger twice, or if `context_compaction` is working well, it handles the latest context.
-   Check that the final draft incorporates *both* requirements.

---

## Tips for Success
-   **Resetting**: To start over, just run `POST /api/test/seed` again. It resets the contact's state (score, stage) so you can re-test the "First Entry" flow.
-   **UI Inspection**: Keep the **Mission Control** panel open in the browser while running curl commands to see the drafts appear in real-time.
-   **Trace Dashboard**: Use the clock icon in Mission Control to see *why* the AI made a decision (e.g., "Why did it pick these 3 properties?").
