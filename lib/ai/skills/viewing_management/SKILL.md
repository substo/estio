---
name: coordinating-viewings
description: >
  Manages multi-party scheduling for property viewings.
  Checks calendar availability, proposes time slots, confirms with owners,
  sends invitations, reminders, and post-viewing follow-ups.
  Triggers on SCHEDULE_VIEWING or AVAILABILITY_QUESTION intents.
tools:
  - resolve_viewing_property_context
  - check_availability
  - propose_slots
  - confirm_viewing
  - request_feedback
  - submit_feedback
  - create_viewing
  - search_properties
  - log_activity
  - store_insight
---

# Skill: Coordinating Viewings

## Purpose
Autonomously manage the full lifecycle of property viewings: check availability, propose slots, confirm with all parties, send calendar invites, and follow up after the viewing to capture feedback and drive next steps.

## When to Use
- Lead expresses interest in viewing a property
- Intent: SCHEDULE_VIEWING or AVAILABILITY_QUESTION
- Deal Stage transitions to "Viewing" phase
- Post-viewing follow-up is due

## Strategy: The 3-Slot Method
Always propose exactly 3 time slots across different days/times.
This gives the illusion of choice while keeping scheduling manageable.

Example:
> "I have three available times for viewing:
> 1. Tuesday, Feb 18 at 10:00 AM
> 2. Wednesday, Feb 19 at 2:00 PM
> 3. Friday, Feb 21 at 11:00 AM
> 
> Which works best for you?"

## Instructions

### Step 1: Resolve Property + Back Office Logistics First
NEVER check calendars until the property is identified and viewing logistics are confirmed.

```
1. Call resolve_viewing_property_context({ contactId, conversationId, message })
2. If resolutionStatus = not_found or ambiguous:
   - Ask for property ref number or property URL first
   - Do NOT call check_availability yet
3. If property resolved:
   - Read listingType (SALE/RENT), status, schedulePath, occupancy/key fields
   - Answer practical questions (price, bills transferable, pets policy if available)
```

### Property Source Priority
When message says "this property", resolve in this order:
1. Explicit message ref/url (if present)
2. Contact `Interested Properties` (`propertiesInterested`)
3. Contact `Details / Lead Other Details` (`notes` in DB, `leadOtherDetails` in form)
4. Contact `Requirements / Requirement Other Details` (`requirementOtherDetails`)
5. Recent conversation context + linked property roles

If exactly one strong candidate is found from these, treat it as resolved and continue.
If multiple candidates remain, ask for ref/url confirmation.

### Viewing Coordination Scenarios
After property resolution, classify into one of these operational paths:
1. **Office/Keybox Access**:
   - We hold office key or keybox code
   - Proceed with direct scheduling after agent availability check
2. **Current Tenant Coordination**:
   - Property occupied by tenant or tenant controls access
   - Collect lead windows, then coordinate with tenant first
3. **External Contact Coordination**:
   - Owner/family member/partner agent controls access
   - Collect lead windows, then coordinate with named contact first

Always communicate the coordination dependency clearly before promising fixed times.

### Step 2: Decide Scheduling Route From schedulePath
- DIRECT_SCHEDULE:
  - Call check_availability with agent userId
  - Then propose 3 slots
- OWNER_COORDINATION / TENANT_COORDINATION / EXTERNAL_AGENT_COORDINATION / MANUAL_CONFIRMATION:
  - Collect lead's preferred date windows
  - Tell lead you must confirm with owner/tenant/other agent first
  - Log activity and proceed with pending confirmation workflow

### Step 3: Propose 3 Diverse Slots (Only for DIRECT_SCHEDULE)
Use `propose_slots()` to automatically select 3 slots with variety:
- Different days (spread across the week)
- Mix of morning (9-12) and afternoon (13-18) times
- Minimum 24 hours advance notice

### Step 4: Confirm the Viewing
When the lead selects a slot:

```
1. Call confirm_viewing({ viewingId, selectedSlot, attendees: [agent, lead, owner?] })
2. This will:
   - Update the viewing record
   - Create a Google Calendar event
   - Send invites to all parties with 24h and 1h reminders
```

### Step 5: Post-Viewing Follow-Up
After the viewing (2+ hours later):

```
1. Ask: "How was the viewing? What did you think?"
2. Capture feedback (liked, disliked, overall rating, interest in offer)
3. Call store_insight for each meaningful point
4. Route to next action based on feedback:
   - "Loved it" → Transition to Negotiator skill, suggest making an offer
   - "Liked it" → Ask what they liked, suggest similar properties
   - "Not interested" → Store dealbreaker insights, search alternatives
```

## Viewing States
Track the viewing lifecycle:
- `proposed` → Slots sent to Lead
- `lead_confirmed` → Lead picked a slot, pending Owner confirmation
- `confirmed` → Both parties confirmed, invites sent
- `reminded` → Reminders sent (24h and 1h before)
- `completed` → Viewing happened, feedback collected
- `cancelled` → Cancelled by either party
- `rescheduled` → Moved to a new time

## Rules
1. **First tool call must be `resolve_viewing_property_context`**
2. **Do not call `check_availability` until property is resolved**
3. **If schedulePath is not DIRECT_SCHEDULE, do not propose fixed slots yet**
4. **ALWAYS include morning AND afternoon** options in the 3 slots (when proposing)
5. **Minimum 24 hours advance notice** for viewings
6. If Owner/Tenant/Other Agent coordination is required, gather lead windows and confirm externally first
7. After confirmation, **ALWAYS send calendar invites** to ALL parties (use `confirm_viewing`)
8. Schedule follow-up for **2 hours post-viewing**
9. If Lead cancels, offer to reschedule immediately
10. Use correct absolute dates. If day/month has no year and would be in the past, clarify year before final confirmation.
11. If one property is clearly inferred from `Interested Properties` or Other Details, continue without asking unnecessary clarification.

## Output Format
When responding to a viewing request:

```
{
  "thought_summary": "Lead wants to view Property X. I'll check my calendar and propose 3 slots.",
  "thought_steps": [
    { "step": 1, "description": "Resolve property and access logistics", "conclusion": "Resolved and direct scheduling allowed" },
    { "step": 2, "description": "Check calendar availability", "conclusion": "Found 3 slots" }
  ],
  "tool_calls": [
    { "name": "resolve_viewing_property_context", "arguments": { "contactId": "...", "conversationId": "...", "message": "..." } },
    { "name": "check_availability", "arguments": { "userId": "...", "..." : "..." } },
    { "name": "propose_slots", "arguments": { "agentUserId": "...", "propertyId": "..." } }
  ],
  "final_response": "I'd be happy to arrange a viewing! I have three available times:\n1. ...\n2. ...\n3. ...\nWhich works best for you?"
}
```

## Tools Reference
- `resolve_viewing_property_context(contactId, conversationId?, message?, propertyReference?, propertyUrl?)` — Resolve property + back-office viewing logistics first
- `check_availability(userId, startDate, endDate, durationMinutes?)` — Check calendar for free slots
- `propose_slots(agentUserId, propertyId, daysAhead?)` — Get 3 diverse slot proposals
- `confirm_viewing(viewingId, slotStart, slotEnd, attendees[])` — Confirm and send invites
- `request_feedback(viewingId)` — Check if feedback is due
- `create_viewing(contactId, propertyId, date, notes?)` — Legacy tool (still works)
- `store_insight(contactId, text, category, importance)` — Save feedback as insights
