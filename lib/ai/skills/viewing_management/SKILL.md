---
name: coordinating-viewings
description: >
  Manages multi-party scheduling for property viewings.
  Checks calendar availability, proposes time slots, confirms with owners,
  sends invitations, reminders, and post-viewing follow-ups.
  Triggers on SCHEDULE_VIEWING or AVAILABILITY_QUESTION intents.
tools:
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

### Step 1: Check Availability First
NEVER propose a slot without checking the agent's calendar first.

```
1. Call check_availability({ userId: agentId, startDate: tomorrow, endDate: nextWeek })
2. If no slots available → ask the lead for their preferred dates
3. If slots available → proceed to Step 2
```

### Step 2: Propose 3 Diverse Slots
Use `propose_slots()` to automatically select 3 slots with variety:
- Different days (spread across the week)
- Mix of morning (9-12) and afternoon (13-18) times
- Minimum 24 hours advance notice

### Step 3: Confirm the Viewing
When the lead selects a slot:

```
1. Call confirm_viewing({ viewingId, selectedSlot, attendees: [agent, lead, owner?] })
2. This will:
   - Update the viewing record
   - Create a Google Calendar event
   - Send invites to all parties with 24h and 1h reminders
```

### Step 4: Post-Viewing Follow-Up
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
1. **ALWAYS check calendar** before proposing slots
2. **ALWAYS include morning AND afternoon** options in the 3 slots
3. **Minimum 24 hours advance notice** for viewings
4. If Owner availability unknown, propose Agent-side slots and note "pending owner confirmation"
5. After confirmation, **ALWAYS send calendar invites** to ALL parties (use `confirm_viewing`)
6. Schedule follow-up for **2 hours post-viewing**
7. If Lead cancels, offer to reschedule immediately

## Output Format
When responding to a viewing request:

```
{
  "thought_summary": "Lead wants to view Property X. I'll check my calendar and propose 3 slots.",
  "thought_steps": [
    { "step": 1, "description": "Check calendar availability", "conclusion": "Found 3 slots" }
  ],
  "tool_calls": [
    { "name": "check_availability", "arguments": { "userId": "...", "..." : "..." } },
    { "name": "propose_slots", "arguments": { "agentUserId": "...", "propertyId": "..." } }
  ],
  "final_response": "I'd be happy to arrange a viewing! I have three available times:\n1. ...\n2. ...\n3. ...\nWhich works best for you?"
}
```

## Tools Reference
- `check_availability(userId, startDate, endDate, durationMinutes?)` — Check calendar for free slots
- `propose_slots(agentUserId, propertyId, daysAhead?)` — Get 3 diverse slot proposals
- `confirm_viewing(viewingId, slotStart, slotEnd, attendees[])` — Confirm and send invites
- `request_feedback(viewingId)` — Check if feedback is due
- `create_viewing(contactId, propertyId, date, notes?)` — Legacy tool (still works)
- `store_insight(contactId, text, category, importance)` — Save feedback as insights
