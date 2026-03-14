# Phase 3 — AI Outreach Automation
**Last Updated:** 2026-03-14
**Status:** Planned (after Phase 2)

## Overview

Phase 3 uses AI to generate and execute **personalized, multi-channel outreach campaigns** at scale. It builds on the Lead Inbox (Phase 1) and Scraping Infrastructure (Phase 2) to convert discovered prospects into engaged leads.

> [!IMPORTANT]
> All AI-generated outreach **requires human approval** by default. This aligns with the existing `AiSuggestedResponse` pattern and the `humanApprovalRequired` flag on `AiSkillPolicy`. Auto-send is a future opt-in feature for low-risk messages only.

---

## 3.1 Outreach Campaign Model

### Data Model

```prisma
model OutreachCampaign {
  id         String   @id @default(cuid())
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  locationId String

  name          String
  description   String?
  type          String   @default("sequence") // sequence, one_shot, drip
  status        String   @default("draft")    // draft, active, paused, completed, archived
  channel       String   @default("whatsapp") // whatsapp, email, sms, multi_channel

  // Targeting
  targetSegment   Json?    // Filter criteria for auto-enrollment
  targetSource    String?  // e.g., "bazaraki_scrape" — auto-enroll from specific source
  maxEnrollments  Int?     // Cap on total contacts enrolled

  // AI Configuration
  aiPersonalization Boolean @default(true)
  aiModel           String? // Override default model
  aiToneInstructions String? // e.g., "Professional, friendly, mention their listing"
  aiContextTemplate  String? // Template with placeholders for AI to fill

  // Compliance
  respectQuietHours  Boolean @default(true)
  requireConsent     Boolean @default(true)
  includeOptOut      Boolean @default(true)

  // Stats (aggregated)
  totalEnrolled    Int @default(0)
  totalSent        Int @default(0)
  totalDelivered   Int @default(0)
  totalReplied     Int @default(0)
  totalConverted   Int @default(0)
  totalOptedOut    Int @default(0)

  // Relations
  location     Location           @relation(fields: [locationId], references: [id], onDelete: Cascade)
  steps        OutreachStep[]
  enrollments  OutreachEnrollment[]

  @@index([locationId, status])
}

model OutreachStep {
  id         String   @id @default(cuid())
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  campaignId String

  stepOrder      Int     // 1, 2, 3... execution sequence
  channel        String  // whatsapp, email, sms (can differ per step)
  delayHours     Int     @default(0, 0)   // hours after previous step (0 = immediate)
  delayDays      Int     @default(0)      // days after previous step

  // Content
  subjectTemplate    String?  // Email subject (supports {{name}} placeholders)
  bodyTemplate       String   @db.Text // Message body template
  aiEnrich           Boolean  @default(true) // Whether AI should personalize
  aiInstructions     String?  // Per-step AI customization

  // Conditions
  skipIfReplied      Boolean  @default(true)  // Don't send if contact already replied
  skipIfConverted    Boolean  @default(true)  // Don't send if already converted
  exitOnReply        Boolean  @default(true)  // Exit sequence on reply

  campaign OutreachStep_Campaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)

  @@index([campaignId, stepOrder])
}

model OutreachEnrollment {
  id         String   @id @default(cuid())
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  campaignId String
  contactId  String
  locationId String

  status        String   @default("active")  // active, completed, paused, exited, opted_out
  currentStep   Int      @default(0)          // Which step was last executed
  exitReason    String?  // "replied", "opted_out", "converted", "manual_exit"

  // Timing
  nextStepAt    DateTime?  // Scheduled time for next step execution
  lastSentAt    DateTime?
  lastReplyAt   DateTime?
  completedAt   DateTime?

  // Result tracking
  messagesSent    Int @default(0)
  messagesOpened  Int @default(0) // Email only
  replies         Int @default(0)
  conversions     Int @default(0)

  campaign OutreachCampaign @relation(fields: [campaignId], references: [id], onDelete: Cascade)

  @@unique([campaignId, contactId])
  @@index([campaignId, status, nextStepAt])
  @@index([contactId, status])
  @@index([locationId, status, nextStepAt])
}
```

---

## 3.2 AI First-Contact Generator

### How It Works

The AI first-contact generator creates personalized outreach messages using:

1. **Lead profile**: Name, source, requirements, listing they were found on
2. **Property matching**: Cross-reference the prospect's listing against the agency's portfolio
3. **Campaign template**: The step's body template with `{{placeholders}}`
4. **Tone/style policy**: From `AiSkillPolicy.stylePolicy` or campaign-level `aiToneInstructions`

### Integration with AI Skills Runtime

New skill definition at `.agents/skills/first-contact/SKILL.md`:

```yaml
---
id: first_contact
name: First Contact Outreach
description: Generate personalized first-contact message to a prospected lead
risk: medium
channels: [whatsapp, email, sms]
requiredTools: [draft_reply, search_properties]
inputsSchema:
  contactName: string
  contactSource: string
  sourceListingUrl: string?
  propertyRequirements: object?
outputsSchema:
  message: string
  subjectLine: string?
  matchedProperties: array?
policyHints:
  requiresHumanApproval: true
  respectQuietHours: true
  respectOptOut: true
---
```

### Message Generation Flow

```
OutreachEnrollment (nextStepAt is due)
    │
    ▼
Load OutreachStep template + Contact context
    │
    ▼
Check guards:
  - skipIfReplied? → check conversations for reply
  - skipIfConverted? → check leadStage == "Closed"
  - isOptedOut? → check consent/opt-out flags
  - quietHours? → check time in contact's timezone
    │
    ▼ (all guards pass)
    │
Generate AI-personalized message:
  - Feed: template + contact data + source listing + matching properties
  - Output: personalized message text
    │
    ▼
Create AiSuggestedResponse (status: pending)
    │
    ▼
Await human approval → Send via channel → Update enrollment stats
```

### Example Messages

**WhatsApp first contact (Bazaraki prospect)**:
```
Hi {{name}}, I noticed your property listing on Bazaraki for the 3-bed 
apartment in Paphos. 🏡

I'm {{agentName}} from {{agencyName}}. We specialize in the Paphos area 
and currently have strong buyer demand for properties like yours.

Would you be open to a quick chat about how we could help you find the 
right buyer?

Best regards,
{{agentName}} | {{agencyPhone}}
```

**Email first contact (Owner prospect)**:
```
Subject: Your Property in {{district}} — Professional Marketing Support

Dear {{name}},

I came across your listing for {{listingTitle}} and wanted to reach out.

At {{agencyName}}, we have {{matchCount}} active buyers looking for 
properties in {{district}} within the {{priceRange}} range. Your property 
appears to be an excellent match for several of our qualified buyers.

I'd love to schedule a brief call to discuss how we can help you achieve 
the best price with our market expertise and buyer network.

Would {{suggestedDay}} work for a 15-minute introduction call?

Kind regards,
{{agentName}}
{{agencyName}} | {{agencyPhone}} | {{agencyWebsite}}
```

---

## 3.3 Sequence Engine

### Cron-Based Execution

New cron endpoint at `app/api/cron/outreach-sequences/route.ts`:

```
GET /api/cron/outreach-sequences
  Authorization: Bearer <CRON_SECRET>

Flow:
  1. Find OutreachEnrollments where:
     - status = "active"
     - nextStepAt <= now()
     - campaign.status = "active"
  2. For each enrollment:
     a. Load the next OutreachStep
     b. Check step guards (reply, convert, opt-out, quiet hours)
     c. If guards pass:
        - Generate personalized message (AI or template)
        - Create AiSuggestedResponse (human approval)
        - Advance currentStep and compute nextStepAt
     d. If guards fail:
        - Exit enrollment with reason
  3. Return execution summary
```

### Sequence Example: New Listing Owner Approach

| Step | Delay | Channel | Template Summary |
|---|---|---|---|
| 1 | Immediate | WhatsApp | Friendly intro mentioning their listing |
| 2 | 3 days | WhatsApp | Follow up with market data / buyer demand |
| 3 | 7 days | Email | Professional email with comparable sold prices |
| 4 | 14 days | WhatsApp | Final touch — offer free property valuation |

### Exit Conditions
- **Reply received** → exit, move to Conversations Hub for human follow-up
- **Opted out** → exit, mark contact as opt-out
- **Converted** → exit, lead stage changed to Viewing/Negotiation/Closed
- **All steps completed** → mark enrollment as completed
- **Manual exit** → agent removes contact from campaign

---

## 3.4 Campaign Analytics Dashboard

### UI at `/admin/campaigns`

#### Campaign List View

```
┌──────────────────────────────────────────────────────────────────┐
│  Campaigns                                    [+ New Campaign]  │
├────────┬──────────┬──────┬──────┬──────┬──────┬───────┬────────┤
│ Status │ Name     │ Type │ Sent │ Open │ Reply│ Conv. │ Actions│
├────────┼──────────┼──────┼──────┼──────┼──────┼───────┼────────┤
│ 🟢 Act │ Baz Own  │ Seq  │  142 │  89  │  23  │   8   │ ⏸ 📊 │
│ 🔵 Drf │ FB Leads │ One  │   0  │   0  │   0  │   0   │ ▶ 📊 │
│ ⏸ Pau  │ Jan Cold │ Seq  │  67  │  41  │  12  │   3   │ ▶ 📊 │
└────────┴──────────┴──────┴──────┴──────┴──────┴───────┴────────┘
```

#### Campaign Detail View

- **Funnel visualization**: Enrolled → Sent → Delivered → Opened → Replied → Converted
- **Per-step breakdown**: Message performance for each sequence step
- **Timeline chart**: Daily enrollment/reply activity over time
- **Contact list**: All enrolled contacts with their current step and status
- **ROI metrics**: Cost per lead (AI costs + channel costs), cost per reply, cost per conversion

---

## Campaign Builder UI

### Step-by-step wizard at `/admin/campaigns/new`:

1. **Campaign Type**: Sequence, One-Shot, or Drip
2. **Target Audience**: Select from segments (source, score, stage, tags) or import from Lead Inbox
3. **Channel**: WhatsApp, Email, SMS, or Multi-Channel sequence
4. **Steps**: Build the sequence with templates, delays, and conditions
5. **AI Settings**: Enable/disable personalization, set tone, add context
6. **Compliance**: Quiet hours, opt-out messaging, consent requirements
7. **Review & Launch**: Preview sample messages, confirm, activate

---

## Key Files to Create

| File | Purpose |
|---|---|
| `lib/outreach/campaign-service.ts` | **[NEW]** Campaign CRUD and enrollment logic |
| `lib/outreach/sequence-engine.ts` | **[NEW]** Step execution and guard logic |
| `lib/outreach/message-generator.ts` | **[NEW]** AI message personalization |
| `.agents/skills/first-contact/SKILL.md` | **[NEW]** First-contact AI skill definition |
| `app/api/cron/outreach-sequences/route.ts` | **[NEW]** Cron endpoint |
| `app/(main)/admin/campaigns/page.tsx` | **[NEW]** Campaign list page |
| `app/(main)/admin/campaigns/[id]/page.tsx` | **[NEW]** Campaign detail/analytics |
| `app/(main)/admin/campaigns/new/page.tsx` | **[NEW]** Campaign builder wizard |
| `app/(main)/admin/campaigns/actions.ts` | **[NEW]** Server actions |

---

## Verification Plan

### Automated Tests
- Unit tests for sequence engine step advancement and guard logic
- Integration test: enroll contact → verify AiSuggestedResponse created at correct time
- Test exit conditions: simulate reply → verify enrollment exits
- Test quiet hours: verify message deferred when in quiet period

### Manual Verification
- Create a test campaign with 3-step WhatsApp sequence
- Enroll a test contact
- Verify step 1 message appears in SuggestedResponse queue
- Accept and send → verify enrollment advances to step 2
- Simulate a reply → verify enrollment exits with reason "replied"
- Check campaign analytics show correct funnel numbers
