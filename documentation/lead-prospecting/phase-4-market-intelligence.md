# Phase 4 — Market Intelligence & Competitive Analysis
**Last Updated:** 2026-03-14
**Status:** Planned (future)

## Overview

Phase 4 provides agents with **proactive market intelligence** to identify opportunities before competitors. It transforms Estio from a reactive CRM into a strategic market analysis platform.

> [!NOTE]
> Phase 4 features build on top of the scraping infrastructure (Phase 2) and outreach automation (Phase 3). They can be implemented incrementally alongside those phases.

---

## 4.1 Listing Monitor

### Problem
Agents spend significant time manually checking property portals for new, changed, or removed listings. They miss opportunities because competitors react faster to market changes.

### Proposed Solution

A **Listing Monitor** that continuously tracks listings across configured portals and generates actionable alerts.

#### Data Model

```prisma
model MonitoredListing {
  id         String   @id @default(cuid())
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  locationId String

  // External reference
  platform        String   // bazaraki, spitogatos, rightmove, etc.
  externalId      String   // Platform's listing ID
  externalUrl     String   // Full URL to listing
  
  // Snapshot data
  title           String?
  price           Int?
  currency        String?  @default("EUR")
  propertyType    String?
  bedrooms        Int?
  location        String?  // District/area
  description     String?  @db.Text
  imageUrls       String[] @default([])
  sellerName      String?
  sellerPhone     String?
  sellerEmail     String?

  // Tracking state
  status          String   @default("active") // active, sold, removed, price_changed, relisted
  firstSeenAt     DateTime @default(now())
  lastSeenAt      DateTime @default(now())
  removedAt       DateTime?
  daysOnMarket    Int      @default(0)

  // Price history
  priceHistory    Json?    // [{ price: 200000, date: "2026-03-01" }, ...]
  originalPrice   Int?
  currentPrice    Int?
  priceChangeCount Int     @default(0)

  // Linked internal records
  matchedPropertyId String?  // If we have this listing in our own portfolio
  matchedContactId  String?  // If seller matches a known contact

  // Snapshot hash for change detection
  contentHash     String?

  location_rel Location @relation(fields: [locationId], references: [id], onDelete: Cascade)

  @@unique([locationId, platform, externalId])
  @@index([locationId, platform, status])
  @@index([locationId, status, firstSeenAt(sort: Desc)])
  @@index([locationId, location, status])
}

model ListingAlert {
  id         String   @id @default(cuid())
  createdAt  DateTime @default(now())
  locationId String

  type       String   // new_listing, price_drop, price_increase, removed, relisted, expired
  severity   String   @default("info") // info, opportunity, urgent
  title      String
  body       String?
  
  listingId  String?  // MonitoredListing reference
  metadata   Json?    // Additional context data

  // Delivery
  readAt     DateTime?
  readBy     String?   // User who read it
  actionTaken String?  // "contacted_owner", "added_to_campaign", "dismissed"

  @@index([locationId, type, createdAt(sort: Desc)])
  @@index([locationId, readAt])
}
```

#### Alert Types

| Alert Type | Trigger | Severity | Example |
|---|---|---|---|
| `new_listing` | New listing appears matching agent's watch criteria | 🔵 Info | "New 3-bed villa in Paphos listed at €195,000 on Bazaraki" |
| `price_drop` | Price decreased ≥ 5% from previous snapshot | 🟡 Opportunity | "Price dropped from €220k to €195k (-11%) on Bazaraki listing #12345" |
| `expired` | Listing on market > 90 days | 🟡 Opportunity | "3-bed apartment in Kato Paphos has been on Bazaraki for 90+ days — owner may be motivated" |
| `removed` | Previously tracked listing disappeared | 🔵 Info | "Limassol villa listing removed from Spitogatos — possibly sold or withdrawn" |
| `relisted` | Previously removed listing reappears | 🟡 Opportunity | "Paphos apartment relisted after being removed 30 days ago — fell through?" |
| `price_increase` | Price increased | 🔵 Info | "Price increased from €180k to €200k on listing #12345" |

#### Agent Watch Criteria

Agents can configure monitoring rules via `/admin/settings/market-watch`:

```json
{
  "watchRules": [
    {
      "name": "Paphos Villas Under 300k",
      "districts": ["Paphos", "Peyia", "Chloraka"],
      "propertyTypes": ["house", "villa"],
      "maxPrice": 300000,
      "alertOn": ["new_listing", "price_drop", "expired"]
    },
    {
      "name": "Limassol Apartments",
      "districts": ["Limassol"],
      "propertyTypes": ["apartment"],
      "alertOn": ["new_listing", "price_drop"]
    }
  ]
}
```

#### UI — Market Watch Dashboard

New dashboard at `/admin/market` or as a tab in the main admin:

- **Alert Feed**: Chronological list of market events
- **Map View**: Monitored listings on a map with color-coded pins (status)
- **Statistics**: New listings this week, average price by district, days-on-market distribution
- **Quick Actions**: From any alert → Start conversation, Add to campaign, Create prospect

---

## 4.2 Owner Prospecting Engine

### Problem
The most valuable outreach targets are **property owners** who are trying to sell or rent independently (FSBO — For Sale By Owner) and may benefit from professional agency representation. These owners are discoverable from listing sites but require a different approach than buyer leads.

### Approach

#### Identifying Owner Prospects

| Signal | Source | Approach |
|---|---|---|
| **Direct listings** (no agent) | Bazaraki, Facebook, Spitogatos | Look for listings without agency branding |
| **Long days-on-market** | Monitoring data | Listings > 90 days suggest owner might need help |
| **Price reductions** | Price history | Multiple drops suggest difficulty selling |
| **Expired listings** | Removed + not sold | Owner still wants to sell but failed |
| **Relisted properties** | Monitor status changes | Deal fell through — owner is motivated |

#### AI Owner Analysis

When an owner prospect is identified, AI generates a brief analysis:

```json
{
  "ownerName": "Andreas P.",
  "listingUrl": "https://bazaraki.com/...",
  "propertyType": "3-bed villa",
  "district": "Paphos",
  "daysOnMarket": 127,
  "priceHistory": [
    { "price": 250000, "date": "2025-11-01" },
    { "price": 230000, "date": "2026-01-15" },
    { "price": 215000, "date": "2026-03-01" }
  ],
  "aiAssessment": "Owner has reduced price twice in 4 months with no sale. Property may be overpriced for the area (comparable sold at €190-200k). Strong candidate for agency representation — we can offer professional photography and our buyer network.",
  "suggestedApproach": "Market analysis approach — offer free CMA (Comparative Market Analysis) to demonstrate value",
  "matchingBuyers": 4,
  "estimatedMarketValue": "€190,000 - €205,000"
}
```

#### Integration with Phase 3 Outreach

Owner prospects automatically feed into dedicated "Owner Acquisition" outreach campaigns with templates designed for the owner-approach use case.

---

## 4.3 Market Reports

### Auto-Generated Market Intelligence

The system generates periodic market reports using aggregated monitoring data.

#### Report Types

| Report | Frequency | Audience |
|---|---|---|
| **Weekly Market Snapshot** | Weekly | All agents |
| **District Deep Dive** | Monthly | District-specialized agents |
| **Price Trend Alert** | On change | Relevant agents |
| **Inventory Dashboard** | Real-time | Admin/managers |

#### Weekly Market Snapshot Content

```
📊 Weekly Market Snapshot — Paphos District
   Week of March 10-16, 2026

   New Listings:     23 (+8% vs last week)
   Removed/Sold:     15
   Price Drops:       7
   Average $/sqm:    €1,850 (-2.1%)
   Median Price:     €195,000
   Avg Days/Market:  67 days

   🔥 Hot Areas: Peyia (+15 new), Coral Bay (+6 new)
   📉 Slowdown:  Kato Paphos (avg 98 days on market)
   
   Top Opportunity: 5 properties in Chloraka 90+ days with
   no agent — consider owner outreach campaign
```

#### Delivery Channels
- **Email digest**: Weekly summary to subscribed agents (via existing email infrastructure)
- **Admin dashboard widget**: Real-time stats on the admin home page
- **PDF export**: For sharing with clients or team meetings

---

## 4.4 Competitor Activity Tracking

### Concept

Track what competing agencies are listing, at what prices, and how their inventory changes over time.

#### What to Track per Competitor

| Metric | How |
|---|---|
| **Active listings count** | Scrape their website or portal presence |
| **New listings this week** | Compare snapshots over time |
| **Price positioning** | Average price vs. market average |
| **Listing quality** | Photo count, description length, features highlighted |
| **Days on market** | How fast they sell |
| **Market share by district** | % of active listings per district |

#### Privacy & Ethics Note

> [!CAUTION]
> Competitor tracking uses only **publicly available listing data**. It does not involve accessing private databases, hacking, or violating terms of service. All data is aggregated at the company level, not individual agent level.

#### UI — Competitor Dashboard

Optional dashboard at `/admin/market/competitors`:

- **Market share pie chart** by district
- **Listing volume trends** per competitor
- **Price comparison** scatter plot (our listings vs. competitors)
- **Opportunity gaps**: "Competitor X has no listings in Tala — underserved market"

---

## Key Files to Create (Phase 4)

| File | Purpose |
|---|---|
| `lib/market/listing-monitor.ts` | **[NEW]** Listing change detection and alerting |
| `lib/market/market-reports.ts` | **[NEW]** Report generation engine |
| `lib/market/owner-analysis.ts` | **[NEW]** AI owner prospect analysis |
| `app/api/cron/market-monitor/route.ts` | **[NEW]** Monitoring cron |
| `app/(main)/admin/market/page.tsx` | **[NEW]** Market intelligence dashboard |
| `app/(main)/admin/market/alerts/page.tsx` | **[NEW]** Alert feed |
| `app/(main)/admin/settings/market-watch/page.tsx` | **[NEW]** Watch criteria configuration |

---

## Dependencies

| Phase 4 Feature | Depends On |
|---|---|
| Listing Monitor | Phase 2 scraping infrastructure + `ScrapingTarget` |
| Owner Prospecting | Phase 2 Bazaraki scraper + Phase 3 outreach campaigns |
| Market Reports | Listing Monitor data accumulation (need ≥ 2 weeks of data) |
| Competitor Tracking | Listing Monitor + cross-referencing agency names |

---

## Verification Plan

### Automated Tests
- Unit tests for listing change detection (price change, removal, relisting)
- Integration test: ingest listing → simulate price change → verify alert created
- Report generation with fixture data → verify output format

### Manual Verification
- Configure a market watch rule for Paphos villas
- Run a scrape cycle → verify new listing alerts appear
- Wait for a tracked listing to change price → verify price_drop alert
- Generate a weekly market snapshot → verify data accuracy
- View the market dashboard → verify charts render with real data
