# Phase 4: Coordinator & Scheduling

**Duration**: Weeks 7–8  
**Priority**: 🟡 High  
**Status**: ✅ Completed
**Dependencies**: Phase 0 (MCP, Tracing), Phase 2 (Buyer Profile), Phase 3 (Search Results)

---

## Objective

Build a **Coordinator Agent** that autonomously manages the multi-party scheduling nightmare:

1. **Check availability** across Agent, Lead, and Owner calendars
2. **Propose time slots** to the Lead
3. **Confirm with the Owner** when the Lead selects a slot
4. **Send calendar invitations** to all parties
5. **Follow up** after viewings to capture feedback and drive next steps

---

## 1. The Coordination Problem

### Current State
- `create_viewing` tool exists but is **single-action**: it creates a DB record and syncs to GHL Calendar.
- **No calendar checking** — the agent has no idea if the proposed time conflicts.
- **No multi-party negotiation** — the agent doesn't coordinate between Lead and Owner.
- **No post-viewing follow-up** — after the viewing, silence.

### Target State
An autonomous coordinator that handles the full viewing lifecycle:

```
Lead says "I'd like to see Property X"
    │
    ▼
[1] Check Agent's calendar for free slots (Google Calendar)
    │
    ▼
[2] Check Owner's availability (message Owner or check shared calendar)
    │
    ▼
[3] Propose 3 time slots to Lead
    │
    ▼
[4] Lead picks a slot
    │
    ▼
[5] Confirm with Owner → Send calendar invites to ALL parties
    │
    ▼
[6] Send reminders (24h before, 1h before)
    │
    ▼
[7] Post-viewing: Ask Lead for feedback → Store insights
    │
    ▼
[8] Based on feedback: Suggest offer OR search alternatives
```

---

## 2. Skill Definition

```yaml
# lib/ai/skills/coordinator/SKILL.md
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
  - draft_reply
  - store_insight
---

# Coordinating Viewings

## When to Use
- Lead expresses interest in viewing a property
- Intent: SCHEDULE_VIEWING or AVAILABILITY_QUESTION
- Deal Stage transitions to "Viewing" phase
- Post-viewing follow-up is due

## Strategy: The 3-Slot Method
Always propose exactly 3 time slots across different days/times.
This gives the illusion of choice while keeping scheduling manageable.

Example:
"I have three available times for viewing:
1. Tuesday, Feb 18 at 10:00 AM
2. Wednesday, Feb 19 at 2:00 PM
3. Friday, Feb 21 at 11:00 AM
Which works best for you?"

## Rules
1. NEVER propose a slot without checking calendar availability first
2. ALWAYS include morning AND afternoon options
3. Minimum 24 hours advance notice for viewings
4. If Owner availability unknown, propose Agent-side slots and note "pending owner confirmation"
5. After confirmation, ALWAYS send calendar invites to ALL parties
6. Schedule follow-up for 2 hours post-viewing
7. If Lead cancels, offer to reschedule immediately

## Viewing States
- `proposed` → Slots sent to Lead
- `lead_confirmed` → Lead picked a slot, pending Owner confirmation
- `confirmed` → Both parties confirmed, invites sent
- `reminded` → Reminders sent (24h and 1h before)
- `completed` → Viewing happened
- `cancelled` → Cancelled by either party
- `rescheduled` → Moved to a new time

## Post-Viewing Actions
Based on Lead's feedback:
- "Loved it" → Transition to Negotiator skill, suggest offer
- "Liked it" → Ask what they liked, store insights, suggest similar
- "Not interested" → Store dealbreaker insights, trigger Searcher for alternatives
- No response in 4 hours → Send gentle follow-up
```

---

## 3. Calendar Integration

### 3.1 Calendar Availability Check

```typescript
// lib/ai/tools/calendar.ts

import { google } from "googleapis";

interface TimeSlot {
  start: Date;
  end: Date;
  available: boolean;
}

interface AvailabilityResult {
  userId: string;
  name: string;
  freeSlots: TimeSlot[];
  busySlots: TimeSlot[];
}

/**
 * Check calendar availability for a user.
 * Supports Google Calendar (primary).
 */
export async function checkAvailability(
  userId: string,
  startDate: Date,
  endDate: Date,
  durationMinutes: number = 60
): Promise<AvailabilityResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { location: true },
  });

  if (!user) throw new Error("User not found");

  // Try Google Calendar first
  if (user.googleAccessToken) {
    return getGoogleAvailability(user, startDate, endDate, durationMinutes);
  }

  // No calendar connected — return all slots as available
  return generateDefaultSlots(userId, user.name ?? "Agent", startDate, endDate, durationMinutes);
}

async function getGoogleAvailability(
  user: any,
  startDate: Date,
  endDate: Date,
  durationMinutes: number
): Promise<AvailabilityResult> {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: user.googleAccessToken });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  // Get busy times
  const freeBusy = await calendar.freebusy.query({
    requestBody: {
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      items: [{ id: "primary" }],
    },
  });

  const busySlots = freeBusy.data.calendars?.primary?.busy ?? [];

  // Generate available slots (working hours: 9 AM - 6 PM)
  const freeSlots = generateAvailableSlots(
    startDate,
    endDate,
    durationMinutes,
    busySlots.map(b => ({
      start: new Date(b.start!),
      end: new Date(b.end!),
    }))
  );

  return {
    userId: user.id,
    name: user.name ?? "Agent",
    freeSlots: freeSlots.map(s => ({ ...s, available: true })),
    busySlots: busySlots.map(b => ({
      start: new Date(b.start!),
      end: new Date(b.end!),
      available: false,
    })),
  };
}

/**
 * Generate available slots during working hours, excluding busy periods.
 */
function generateAvailableSlots(
  startDate: Date,
  endDate: Date,
  durationMinutes: number,
  busyPeriods: { start: Date; end: Date }[]
): { start: Date; end: Date }[] {
  const slots: { start: Date; end: Date }[] = [];
  const current = new Date(startDate);

  while (current < endDate) {
    // Working hours: 9 AM to 6 PM
    const dayStart = new Date(current);
    dayStart.setHours(9, 0, 0, 0);
    const dayEnd = new Date(current);
    dayEnd.setHours(18, 0, 0, 0);

    // Skip weekends
    if (current.getDay() === 0 || current.getDay() === 6) {
      current.setDate(current.getDate() + 1);
      continue;
    }

    // Generate hourly slots within working hours
    const slotStart = new Date(dayStart);
    while (slotStart.getTime() + durationMinutes * 60000 <= dayEnd.getTime()) {
      const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);

      // Check if slot conflicts with any busy period
      const isConflict = busyPeriods.some(
        busy => slotStart < busy.end && slotEnd > busy.start
      );

      if (!isConflict && slotStart > new Date()) { // Must be in the future
        slots.push({ start: new Date(slotStart), end: new Date(slotEnd) });
      }

      slotStart.setMinutes(slotStart.getMinutes() + 60); // 1-hour increments
    }

    current.setDate(current.getDate() + 1);
  }

  return slots;
}
```

### 3.2 Slot Proposal Tool

```typescript
// lib/ai/tools/calendar.ts (continued)

/**
 * Propose 3 diverse time slots to the Lead.
 * Picks slots across different days and times for variety.
 */
export async function proposeSlots(
  agentUserId: string,
  propertyId: string,
  daysAhead: number = 7
): Promise<{ slots: TimeSlot[]; message: string }> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 1); // Minimum 24h notice
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + daysAhead);

  const availability = await checkAvailability(agentUserId, startDate, endDate, 60);
  const freeSlots = availability.freeSlots;

  if (freeSlots.length === 0) {
    return {
      slots: [],
      message: "Unfortunately, I don't have any available slots in the next week. Could you suggest a preferred date?",
    };
  }

  // Pick 3 diverse slots (different days, mix of AM/PM)
  const selected = selectDiverseSlots(freeSlots, 3);

  const property = await db.property.findUnique({ where: { id: propertyId } });

  const message = formatSlotProposal(selected, property?.title ?? "the property");

  return { slots: selected, message };
}

function selectDiverseSlots(slots: TimeSlot[], count: number): TimeSlot[] {
  const byDay = new Map<string, TimeSlot[]>();
  for (const slot of slots) {
    const key = slot.start.toDateString();
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(slot);
  }

  const selected: TimeSlot[] = [];
  const days = Array.from(byDay.keys());

  for (let i = 0; i < Math.min(count, days.length); i++) {
    const daySlots = byDay.get(days[i])!;
    // Alternate between morning and afternoon
    const preferAfternoon = i % 2 === 1;
    const chosen = preferAfternoon
      ? daySlots.find(s => s.start.getHours() >= 13) ?? daySlots[0]
      : daySlots.find(s => s.start.getHours() < 13) ?? daySlots[0];
    selected.push(chosen);
  }

  return selected;
}
```

### 3.3 Viewing Confirmation & Calendar Invites

```typescript
// lib/ai/tools/calendar.ts (continued)

/**
 * Confirm a viewing and send calendar invitations to all parties.
 */
export async function confirmViewing(params: {
  viewingId: string;
  selectedSlot: TimeSlot;
  attendees: { email: string; name: string; role: "agent" | "lead" | "owner" }[];
}): Promise<{ success: boolean; calendarEventId?: string }> {
  // Update viewing record
  await db.viewing.update({
    where: { id: params.viewingId },
    data: {
      scheduledAt: params.selectedSlot.start,
      endAt: params.selectedSlot.end,
      status: "confirmed",
    },
  });

  // Create Google Calendar event with all attendees
  const oauth2Client = new google.auth.OAuth2();
  // ... get agent's tokens

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const event = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: `Property Viewing — ${params.attendees.find(a => a.role === "lead")?.name}`,
      start: { dateTime: params.selectedSlot.start.toISOString() },
      end: { dateTime: params.selectedSlot.end.toISOString() },
      attendees: params.attendees.map(a => ({
        email: a.email,
        displayName: a.name,
      })),
      reminders: {
        useDefault: false,
        overrides: [
          { method: "email", minutes: 1440 }, // 24 hours
          { method: "popup", minutes: 60 },   // 1 hour
        ],
      },
    },
    sendUpdates: "all",
  });

  return {
    success: true,
    calendarEventId: event.data.id ?? undefined,
  };
}
```

---

## 4. Post-Viewing Follow-Up

### 4.1 Automatic Follow-Up Trigger

```typescript
// lib/ai/tools/follow-up.ts

/**
 * Check for viewings that need follow-up.
 * Called by the cron job (Phase 6).
 */
export async function checkPendingFollowUps(): Promise<{
  viewingId: string;
  contactId: string;
  propertyTitle: string;
  hoursAgo: number;
}[]> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  
  const viewings = await db.viewing.findMany({
    where: {
      status: "confirmed",
      scheduledAt: { lte: twoHoursAgo },
      feedbackReceived: false,
    },
    include: {
      property: true,
      contact: true,
    },
  });

  return viewings.map(v => ({
    viewingId: v.id,
    contactId: v.contactId,
    propertyTitle: v.property?.title ?? "the property",
    hoursAgo: Math.round((Date.now() - v.scheduledAt.getTime()) / (60 * 60 * 1000)),
  }));
}
```

### 4.2 Feedback Processing

```typescript
// lib/ai/tools/follow-up.ts (continued)

interface ViewingFeedback {
  viewingId: string;
  overallRating: 1 | 2 | 3 | 4 | 5;
  liked: string[];
  disliked: string[];
  interestedInOffer: boolean;
  comments: string;
}

/**
 * Process viewing feedback and update deal state.
 */
export async function processViewingFeedback(
  feedback: ViewingFeedback
): Promise<{ nextAction: string }> {
  await db.viewing.update({
    where: { id: feedback.viewingId },
    data: {
      feedbackReceived: true,
      feedback: feedback as any,
    },
  });

  // Store liked items as positive insights
  for (const liked of feedback.liked) {
    await storeInsight({
      contactId: feedback.viewingId, // Will need to look up
      text: `Liked "${liked}" about the property`,
      category: "preference",
      importance: 7,
    });
  }

  // Store disliked items as negative insights / deal breakers
  for (const disliked of feedback.disliked) {
    await storeInsight({
      contactId: feedback.viewingId,
      text: `Disliked "${disliked}" — potential deal breaker`,
      category: "preference",
      importance: 8,
    });
  }

  // Determine next action
  if (feedback.interestedInOffer) {
    return { nextAction: "transition_to_negotiator" };
  } else if (feedback.overallRating >= 3) {
    return { nextAction: "suggest_similar_properties" };
  } else {
    return { nextAction: "search_alternatives" };
  }
}
```

---

## 5. Viewing Model Updates

```prisma
// prisma/schema.prisma — Extend Viewing model

model Viewing {
  // ... existing fields

  status            String    @default("proposed")
  // "proposed", "lead_confirmed", "confirmed", "reminded", "completed", "cancelled", "rescheduled"

  scheduledAt       DateTime?
  endAt             DateTime?
  calendarEventId   String?

  feedbackReceived  Boolean   @default(false)
  feedback          Json?     // ViewingFeedback object

  reminders         Json?     // Track sent reminders
}
```

---

## 6. Verification

### Automated Tests

```yaml
# tests/evals/coordinator.yaml
- input: "I'd like to see the Sea Caves Villa"
  expected_skill: coordinator
  expected_tools: [check_availability, propose_slots]
  assertions:
    - slots_count: 3
    - all_slots_in_future: true
    - all_slots_during_working_hours: true

- input: "Tuesday at 10am works for me"
  expected_skill: coordinator
  expected_tools: [confirm_viewing]
  assertions:
    - viewing_status: "confirmed"
    - calendar_invite_sent: true
```

### Manual Tests

- [ ] Agent checks real Google Calendar before proposing slots
- [ ] Proposed slots avoid existing meetings
- [ ] Calendar invite received by all parties
- [ ] 24h reminder sent before viewing
- [ ] Post-viewing follow-up message sent 2 hours after viewing
- [ ] Feedback captured and insights stored

---

## Files Created / Modified

| Action | File | Purpose |
|:-------|:-----|:--------|
| **NEW** | `lib/ai/skills/coordinator/SKILL.md` | Coordinator skill definition |
| **NEW** | `lib/ai/tools/calendar.ts` | Calendar availability, slot proposal, confirmation (Google-only) |
| **NEW** | `lib/ai/tools/follow-up.ts` | Post-viewing follow-up and feedback |
| **MODIFY** | `lib/ai/mcp/server.ts` | Registered 5 new tools including `submit_feedback` |
| **MODIFY** | `prisma/schema.prisma` | Extend Viewing model with status, feedback, reminders |
| **MODIFY** | GHL Calendar sync | Ensure bi-directional sync with new fields |

---

## References

- [Google Calendar API: Freebusy](https://developers.google.com/calendar/api/v3/reference/freebusy/query)
- [GHL Calendar API](https://highlevel.stoplight.io/docs/integrations/calendar-api)
- [Best Practices for Scheduling AI Agents](https://www.anthropic.com/research/practical-agents)
