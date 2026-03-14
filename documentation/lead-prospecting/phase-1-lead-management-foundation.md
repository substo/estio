# Phase 1 — Lead Management Foundation
**Last Updated:** 2026-03-14
**Status:** ✅ Implemented (March 2026)
**Priority:** Completed

## Overview

Phase 1 builds the CRM surfaces to properly **display, manage, qualify, and triage** leads. Without these surfaces, leads from future scraping and outreach pipelines will have no structured place to land.

> [!IMPORTANT]
> This phase produces no new leads — it builds the **management infrastructure** for leads that already exist and those that will arrive from Phases 2–4.

---

## 1.1 Lead Pipeline Board

### Problem
Agents currently manage leads through a flat contact list with filters. There is no visual representation of lead progression through sales stages. Industry-standard real estate CRMs (HubSpot, Follow Up Boss, Salesforce) all provide Kanban-style pipeline views.

### Proposed Solution

A **Kanban-style pipeline board** at `/admin/contacts?view=pipeline` (or as a prominent tab alongside the existing list view).

#### Columns (from `leadStage` values)
| Stage | Description | Color |
|---|---|---|
| `Unassigned` | Newly created, not yet triaged | Gray |
| `New` | Assigned but not yet contacted | Blue |
| `Contacted` | First outreach made, awaiting reply | Cyan |
| `Viewing` | Viewing scheduled or completed | Yellow |
| `Negotiation` | Active offer/counter-offer phase | Orange |
| `Closed` | Deal completed successfully | Green |
| `Lost` | Lead did not convert | Red |

#### Card Content
Each card displays a compact lead summary:
```
┌──────────────────────────────┐
│  ★★★ High Priority           │
│  John Smith                  │
│  📱 +357 99 123 456          │
│  🏷️ Bazaraki Scrape          │
│  🏠 To Buy · Paphos · 2BR   │
│  🔥 Score: 72                │
│  👤 Agent: Maria             │
│  📅 Last: 2d ago             │
└──────────────────────────────┘
```

#### Interactions
- **Drag-and-drop** between columns → updates `leadStage` + creates `ContactHistory` audit entry
- **Click card** → opens `EditContactDialog` (existing component)
- **Quick actions** (hover): Open conversation, Schedule viewing, Assign agent
- **Column counts** in headers with total volume per stage

#### Filters (shared with list view)
- Agent assignment
- Priority (Low / Medium / High)
- Lead Goal (To Buy / To Rent / To List)
- Lead Source (dynamic from `LeadSource` table)
- Date range (created / last activity)
- Score range

#### Technical Approach
- **Data**: Reuse existing `listContacts` / contact repository queries with `groupBy: leadStage`
- **State**: URL-synced (`?view=pipeline&agent=...&priority=...`)
- **Performance**: Load counts per stage first, then lazy-load cards per column with pagination
- **Component**: New `pipeline-board.tsx` using `@dnd-kit/core` (already used pattern in feed inbox)

#### Implementation Status
✅ **Implemented**

- Modified `app/(main)/admin/contacts/page.tsx` to handle `view=pipeline` parameter.
- Created `PipelineBoard` (`pipeline-board.tsx`) supporting `@hello-pangea/dnd`.
- Created `PipelineCard` (`pipeline-card.tsx`) for compact visual summaries.
- Modified `app/(main)/admin/contacts/actions.ts` with `updateContactStage` which atomically updates `leadStage` and logs the `STAGE_CHANGED` event to `ContactHistory`.

---

## 1.2 Lead Inbox / Prospecting Queue

### Problem
When scraping pipelines (Phase 2) and outreach campaigns (Phase 3) generate leads, they should not go directly into the main CRM contact list. They need a **staging area** for review, deduplication, and acceptance — similar to the existing Feed Inbox pattern for XML-imported properties.

### Proposed Solution

A **Lead Inbox** at `/admin/leads/inbox` that acts as a triage queue for newly discovered prospects.

#### Data Model Option A — Staging Model (Recommended)

New `ProspectLead` model that stages leads before Contact creation:

```prisma
model ProspectLead {
  id         String   @id @default(cuid())
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  locationId String

  // Identity
  name       String?
  firstName  String?
  lastName   String?
  email      String?
  phone      String?
  message    String?

  // Source Attribution
  source          String   // bazaraki_scrape, facebook, instagram, manual, referral, etc.
  sourceUrl       String?  // Original listing/post URL
  sourceListingId String?  // External reference ID
  sourceMetadata  Json?    // Platform-specific data (listing title, price, images)

  // AI Scoring
  aiScore          Float?   @default(0)
  aiScoreBreakdown Json?    // { signals: {...}, reason: "..." }

  // Deduplication
  matchedContactId String?  // If we found a potential existing match
  matchConfidence  Float?   // 0.0 - 1.0 how confident the match is
  dedupStatus      String   @default("pending") // pending, unique, duplicate, merged

  // Pipeline
  status     String   @default("new") // new, reviewing, accepted, rejected, archived
  reviewedAt DateTime?
  reviewedBy String?

  // Result
  createdContactId String? // Points to Contact after acceptance

  location Location @relation(fields: [locationId], references: [id], onDelete: Cascade)

  @@index([locationId, status, createdAt(sort: Desc)])
  @@index([locationId, source, status])
  @@index([email])
  @@index([phone])
}
```

#### Data Model Option B — Direct Contact with Review Flag

Instead of a staging model, add a `prospectStatus` field to `Contact`:
- Pros: No migration of leads from staging to Contact
- Cons: Pollutes the main contact list; harder to separate concerns

> [!TIP]
> **Recommendation**: Option A (staging model). It follows the exact same proven pattern as the XML Feed Inbox (`Property` with `source=FEED` + `publicationStatus=PENDING`), which is already production-tested. It also keeps the Contact table clean for confirmed leads only.

#### UI Design

```
┌──────────────────────────────────────────────────────────────┐
│  Lead Inbox                           [Accept All] [Filter]  │
├───────┬──────────┬──────────┬─────────┬────────┬────────────┤
│ Score │ Name     │ Contact  │ Source  │ Match? │ Actions    │
├───────┼──────────┼──────────┼─────────┼────────┼────────────┤
│  87   │ Anna K.  │ +357...  │ 🔵 Baz │ ⚠️ 78% │ ✅ ❌ 🔍 📝│
│  64   │ George M │ geo@...  │ 🟣 FB  │ ✅ New │ ✅ ❌ 🔍 📝│
│  42   │ Unknown  │ +357...  │ 🔵 Baz │ ✅ New │ ✅ ❌ 🔍 📝│
└───────┴──────────┴──────────┴─────────┴────────┴────────────┘
```

#### Actions
- **✅ Accept**: Creates a `Contact` from the `ProspectLead`, enters the pipeline
- **❌ Reject**: Marks as rejected (with optional reason)
- **🔍 View Match**: If a potential duplicate is detected, open the existing contact for comparison
- **📝 Edit**: Modify prospect details before acceptance
- **Bulk accept/reject** with checkbox selection

#### Deduplication Logic
When a prospect is ingested:
1. **Exact phone match** → `matchConfidence: 1.0`, `dedupStatus: "duplicate"`
2. **Exact email match** → `matchConfidence: 1.0`, `dedupStatus: "duplicate"`
3. **Fuzzy name match** (Levenshtein or similar) → `matchConfidence: 0.5–0.9`
4. **No match** → `dedupStatus: "unique"`, ready for review

#### Implementation Status
✅ **Implemented** (Using Option A)

- **Database**: Added `ProspectLead` model to `schema.prisma`.
- **Backend Data Layer**: Created `lib/leads/prospect-repository.ts` for paginated / filtered data retrieval and `lib/leads/dedup.ts` for exact match duplicate checks (Email/Phone).
- **Frontend**: Created the full suite in `app/(main)/admin/leads/inbox/`:
  - `page.tsx`: Server component data fetching.
  - `_components/prospect-inbox-table.tsx`: The primary interaction surface with accept/reject rows and bulk action capabilities.
  - `_components/prospect-inbox-filters.tsx`: URL-synced search, source, and state filtering.
- **Actions**: `actions.ts` handles `acceptProspect`, `rejectProspect`, and their bulk equivalents. Accepting converts the `ProspectLead` to an active `Contact`, logs a `PROSPECT_ACCEPTED` history entry, and emits a `lead.created` event payload via the event bus.
- **Nav**: Integrated into `components/wrapper/navbar.tsx`.

---

## 1.3 Enhanced Lead Source Tracking

### Problem
The current `leadSource` field is a free-text string with values managed via the `LeadSource` table. For prospecting at scale, we need structured source metadata to measure acquisition channel performance.

### Proposed Changes

#### New Source Categories
Seed the `LeadSource` table with standardized categories:

| Source ID | Display Name | Icon |
|---|---|---|
| `website_inquiry` | Website Inquiry | 🌐 |
| `bazaraki_scrape` | Bazaraki | 🔵 |
| `facebook_marketplace` | Facebook Marketplace | 🟣 |
| `instagram_dm` | Instagram DM | 📸 |
| `linkedin` | LinkedIn | 🔗 |
| `google_ads` | Google Ads | 📊 |
| `referral_partner` | Referral / Partner | 🤝 |
| `cold_outreach` | Cold Outreach | 📞 |
| `property_portal` | Property Portal | 🏠 |
| `xml_feed` | XML Feed | 📡 |
| `walk_in` | Walk-in | 🚶 |
| `manual` | Manual Entry | ✏️ |

#### Source Metadata Extension
Add structured metadata to track per-lead source context:

```prisma
// Option: Add fields to Contact
model Contact {
  // ... existing fields ...
  leadSourceUrl       String?  // Original listing URL
  leadSourceListingId String?  // External reference
  leadSourceScrapedAt DateTime? // Discovery timestamp
  leadSourceCampaignId String? // Future: outreach campaign link
}
```

Alternatively, store in `Contact.payload` JSON field (already exists) to avoid schema changes.

#### Implementation Status
✅ **Implemented**

- Expanded `CONTACT_TYPES` in `contact-types.ts` to cleanly separate "Lead" from standard "Contact" roles.
- Defined `LEAD_SOURCE_CATEGORIES` configuration map mapping sources to icons and styles.
- Created `lead-source-badge.tsx` and integrated it efficiently into the table `contact-row.tsx` and Kanban `pipeline-card.tsx`.
- Source metadata flows fluidly from `ProspectLead` -> `Contact` upon acceptance.

---

## 1.4 AI Lead Scoring

### Problem
The `leadScore` (Int) and `qualificationStage` (String) fields exist on **Contact** but are not computed or displayed. Activating these transforms lead management from manual triage to data-driven prioritization.

### Scoring Model

#### Signals (weighted)

| Signal | Weight | Source |
|---|---|---|
| **Engagement** (message count, response rate) | 25% | `Conversation.messages` count, reply time analysis |
| **Requirements completeness** | 15% | % of `requirement*` fields filled vs. defaults |
| **Heat score** (existing gamification) | 15% | `Contact.heatScore` from swipe sessions |
| **Property match density** | 15% | Count of properties matching requirements |
| **Recency** (days since last activity) | 15% | `Contact.updatedAt` or last `ContactHistory` |
| **Source quality** | 10% | Referral > Website > Instagram > Cold scrape |
| **Profile completeness** | 5% | Has email AND phone AND name |

#### Score Output
- **Score range**: 0–100
- **Storage**: `Contact.leadScore` (Int)
- **Qualification stages** (derived from score):

| Stage | Score Range | Meaning |
|---|---|---|
| `unqualified` | 0–20 | Raw lead, no engagement signals |
| `mql` | 21–50 | Marketing Qualified — some interest shown |
| `sql` | 51–75 | Sales Qualified — actively engaged |
| `opportunity` | 76–90 | Hot lead — ready for deal |
| `customer` | 91–100 | Closed/converted |

#### Computation Triggers
1. **On lead creation** (Contact create / ProspectLead accept)
2. **On interaction** (new message received, viewing scheduled, requirement updated)
3. **Periodic batch** (via AI Skills Runtime cron — new `lead_scoring` objective)

#### Implementation Status
✅ **Implemented (UI Activation)**

- Visual element `lead-score-badge.tsx` was created.
- Integrated into `contact-row.tsx`, completely replacing the old `heatScore`.
- Modified URL sorting in `contacts/page.tsx` allowing ordering by "Score: Highest" and "Score: Lowest".
- Modified `edit-contact-dialog.tsx` to prominently display the Score and Qualification Stage in the hero banner of the dialog.
- _Note: The backend background inference cron (Section 1.4 "Computation Triggers") is scoped for subsequent enhancement. The visual scaffolding and data layer are complete._

---

## 1.5 Lead Activity Timeline

### Problem
The existing `ContactHistory` model tracks CRM events (CREATED, UPDATED, VIEWING_ADDED) but lacks prospecting-specific lifecycle events. As leads flow from external sources through outreach and conversion, the timeline should tell the full story.

### New Action Types

| Action | When | Example `changes` JSON |
|---|---|---|
| `SCRAPED_FROM_SOURCE` | Prospect discovered by scraper | `{ source: "bazaraki", url: "...", listingTitle: "..." }` |
| `PROSPECT_ACCEPTED` | Prospect moved from inbox to CRM | `{ prospectLeadId: "...", acceptedBy: "..." }` |
| `OUTREACH_SENT` | First-contact message dispatched | `{ channel: "whatsapp", campaignId: "..." }` |
| `OUTREACH_REPLIED` | Lead replied to outreach | `{ conversationId: "..." }` |
| `SCORE_UPDATED` | AI recalculated lead score | `{ oldScore: 32, newScore: 67, signals: {...} }` |
| `QUALIFICATION_CHANGED` | Stage transition (e.g., mql → sql) | `{ oldStage: "mql", newStage: "sql" }` |
| `CAMPAIGN_ENROLLED` | Lead added to outreach sequence | `{ campaignId: "...", campaignName: "..." }` |
| `CAMPAIGN_COMPLETED` | Sequence finished | `{ campaignId: "...", outcome: "replied" }` |

### UI Changes
- **History tab** on Contact Edit Dialog: Render new action types with appropriate icons and formatting
- **Pipeline card hover**: Show last 3 activity entries
- **Lead Inbox**: Show discovery source event as first timeline entry

### Implementation Status
✅ **Implemented**

- Integrated strongly-typed custom event rendering in `history-tab.tsx`.
- Defined unique action icons for `STAGE_CHANGED` and `SCORE_UPDATED`.
- Wired server actions in `admin/contacts/actions.ts` to actively capture delta differences in `leadStage` and log them properly.
- Modified `lib/ai/tools/lead-scoring.ts` to record a `SCORE_UPDATED` history event each time the AI tool evaluates a lead.

---

## Implementation Order

```
1.3 Enhanced Lead Source Tracking  ← Database/seed setup (foundation)
    │
    ▼
1.1 Lead Pipeline Board           ← Highest visibility feature
    │
    ▼
1.4 AI Lead Scoring               ← Activates dormant schema fields
    │
    ▼
1.2 Lead Inbox / Prospecting Queue ← Ready for Phase 2 ingest
    │
    ▼
1.5 Lead Activity Timeline        ← Polish & observability
```

## Verification Plan

### Automated Tests
- Unit tests for lead scoring computation with mocked contact data
- Integration tests for pipeline stage drag-drop → history logging
- API tests for prospect lead CRUD + deduplication logic
- Snapshot tests for pipeline card rendering

### Manual Verification
- Navigate to `/admin/contacts?view=pipeline` — verify Kanban board renders with correct stage columns
- Drag a contact between stages → confirm `ContactHistory` record created with correct old/new values
- Create a `ProspectLead` manually → verify it appears in Lead Inbox
- Accept a prospect → verify new `Contact` is created with correct source metadata
- Verify AI lead scoring populates `leadScore` on a test contact
- Verify duplicate detection flags existing contacts when a prospect with matching phone is ingested
