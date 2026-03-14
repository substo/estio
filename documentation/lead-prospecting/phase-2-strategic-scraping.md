§# Phase 2 — Strategic Scraping Infrastructure
**Last Updated:** 2026-03-14
**Status:** Planned (after Phase 1)

## Overview

Phase 2 builds the tooling to **discover property owners and interested parties** from external listing sites. The scraped data feeds into the Lead Inbox (Phase 1.2) for human review and CRM acceptance.

> [!IMPORTANT]
> Phase 1 Lead Inbox must be operational before scraping pipelines are activated, otherwise discovered leads have no structured place to land.

---

## 2.1 Scraping Target Configuration

### Admin UI

New settings page at `/admin/settings/prospecting` (or under existing `/admin/settings` navigation):

#### Configuration Fields per Target Site

| Field | Type | Description |
|---|---|---|
| `name` | String | Display name (e.g., "Bazaraki Properties") |
| `domain` | String | Target domain (e.g., "bazaraki.com") |
| `baseUrl` | String | Starting search URL with location/category presets |
| `enabled` | Boolean | Active/inactive toggle |
| `scrapeFrequency` | Enum | `hourly`, `every_6h`, `daily`, `weekly` |
| `maxPagesPerRun` | Int | Pagination depth limit (default 10) |
| `extractionMode` | Enum | `css_selectors`, `ai_extraction`, `hybrid` |
| `selectors` | Json | CSS selector mapping for structured extraction |
| `aiInstructions` | String | System prompt for AI-based extraction |
| `lastSyncAt` | DateTime | Last successful scrape timestamp |
| `lastSyncStatus` | String | `success`, `partial`, `error` |
| `lastSyncError` | String? | Error message from last run |

#### Data Model

```prisma
model ScrapingTarget {
  id         String   @id @default(cuid())
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  locationId String

  name              String
  domain            String
  baseUrl           String
  enabled           Boolean  @default(true)
  scrapeFrequency   String   @default("daily") // hourly, every_6h, daily, weekly
  maxPagesPerRun    Int      @default(10)
  extractionMode    String   @default("hybrid") // css_selectors, ai_extraction, hybrid
  selectors         Json?    // CSS selector mapping
  aiInstructions    String?  // AI extraction prompt
  targetType        String   @default("listings") // listings, social_posts, profiles

  // Sync state
  lastSyncAt        DateTime?
  lastSyncStatus    String?
  lastSyncError     String?  @db.Text
  lastSyncStats     Json?    // { discovered: 15, new: 8, duplicates: 7, errors: 0 }

  location Location @relation(fields: [locationId], references: [id], onDelete: Cascade)
  runs     ScrapingRun[]

  @@index([locationId, enabled])
  @@index([domain])
}

model ScrapingRun {
  id         String   @id @default(cuid())
  createdAt  DateTime @default(now())
  targetId   String

  status         String    @default("running") // running, completed, partial, failed
  pagesScraped   Int       @default(0)
  listingsFound  Int       @default(0)
  leadsCreated   Int       @default(0)
  duplicatesFound Int      @default(0)
  errors         Int       @default(0)
  completedAt    DateTime?
  errorLog       String?   @db.Text
  metadata       Json?

  target ScrapingTarget @relation(fields: [targetId], references: [id], onDelete: Cascade)

  @@index([targetId, createdAt(sort: Desc)])
}
```

---

## 2.2 Listing Scraper Service

### Architecture

```
┌────────────────────────────────────────────────────┐
│            Cron: /api/cron/scrape-listings          │
│            (runs per target schedule)               │
├────────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────────┐    ┌─────────────────────┐      │
│  │ ScrapingTarget│───▶│  ListingScraperService│     │
│  │ (config)     │    │                     │      │
│  └──────────────┘    │  1. Fetch pages     │      │
│                      │  2. Extract listings │      │
│                      │  3. AI enrichment   │      │
│                      │  4. Dedup check     │      │
│                      │  5. Create prospects │      │
│                      └─────────┬───────────┘      │
│                                │                   │
│                    ┌───────────▼──────────┐        │
│                    │   ProspectLead       │        │
│                    │   (Lead Inbox)       │        │
│                    └─────────────────────┘        │
└────────────────────────────────────────────────────┘
```

### Service Implementation

Core service at `lib/scraping/listing-scraper.ts`:

```typescript
// Pseudocode structure
interface ListingScraper {
  // Main entry point
  scrapTarget(target: ScrapingTarget): Promise<ScrapingRunResult>

  // Page fetching (per-site strategy)
  fetchSearchResultsPage(url: string, page: number): Promise<string>

  // Listing extraction
  extractListingsFromPage(html: string, target: ScrapingTarget): Promise<RawListing[]>

  // AI enrichment (optional, for unstructured listings)
  enrichWithAI(listing: RawListing, instructions: string): Promise<EnrichedListing>

  // Dedup against existing contacts and prospects
  checkDuplicates(listing: EnrichedListing, locationId: string): Promise<DedupResult>

  // Create ProspectLead record
  createProspect(listing: EnrichedListing, targetId: string, locationId: string): Promise<ProspectLead>
}
```

### Page Fetching Strategies

| Strategy | When to Use | Implementation |
|---|---|---|
| **Static HTML** (cheerio) | Simple sites, server-rendered | `fetch()` + `cheerio.load()` |
| **Browser Rendering** (Playwright) | JS-rendered SPAs, anti-bot sites | `playwright.chromium.launch()` |
| **API Direct** | Sites with known APIs | Direct HTTP client calls |

> [!TIP]
> **Default recommendation**: Use Playwright in headless mode as the primary driver. It handles all three cases (static, JS-rendered, API interception). The existing `crm-puller.ts` already uses Puppeteer — consider migrating to Playwright for consistency and better API.

### AI Extraction Pipeline

For unstructured or varied listing formats, use Gemini to extract structured data:

```
Raw HTML / Text
    │
    ▼
[AI Extraction Prompt]
"Given this listing page content, extract:
 - Owner/agent name
 - Phone number(s)
 - Email
 - Listing type (sale/rent)
 - Property type
 - Price
 - Location/district
 - Description summary"
    │
    ▼
Structured JSON → RawListing
```

### Rate Limiting & Compliance

| Measure | Implementation |
|---|---|
| **Request throttling** | Max 1 request per 2 seconds per domain |
| **robots.txt** | Check and respect before scraping (config override) |
| **User-Agent** | Realistic browser User-Agent string |
| **IP rotation** | Future: proxy rotation for high-volume scraping |
| **Data retention** | Configurable TTL for rejected prospects |
| **Consent** | Scraped data is treated as public information; outreach requires consent tracking |

---

## 2.3 Bazaraki Integration

### Why Bazaraki First
Bazaraki is the dominant classifieds platform in Cyprus, heavily used for property listings. It is the **highest-impact single source** for the Estio user base.

### Target URL Patterns

| Category | URL Pattern |
|---|---|
| Properties for Sale | `https://www.bazaraki.com/real-estate/houses-and-villas-sale/` |
| Properties for Rent | `https://www.bazaraki.com/real-estate/houses-and-villas-rent/` |
| Apartments for Sale | `https://www.bazaraki.com/real-estate/apartments-flats-sale/` |
| Apartments for Rent | `https://www.bazaraki.com/real-estate/apartments-flats-rent/` |
| Land for Sale | `https://www.bazaraki.com/real-estate/land-sale/` |
| Commercial | `https://www.bazaraki.com/real-estate/shops-offices-sale/` |

Filters can be applied via URL params (district, price range, bedrooms).

### Extraction Fields

| Field | Selector Strategy |
|---|---|
| Listing title | CSS: `.announcement-block__title` or similar |
| Price | CSS: price element |
| Phone number | Click "Show phone" button (Playwright required) |
| Location | CSS: location breadcrumb or metadata |
| Description | CSS: description block |
| Images | CSS: gallery image URLs |
| Listing URL | Anchor `href` |
| Posted date | CSS: date metadata |
| Listing ID | URL path or data attribute |

> [!WARNING]
> Bazaraki may require clicking a "Show phone number" button to reveal the contact. This requires browser automation (Playwright click + wait). Some listings may show phone as image to prevent scraping — AI OCR may be needed as fallback.

### Selector Configuration (Default)

```json
{
  "listingContainer": ".announcement-block",
  "title": ".announcement-block__title a",
  "price": ".announcement-block__price",
  "location": ".announcement-block__city",
  "link": ".announcement-block__title a[href]",
  "phone": ".js-phone-number",
  "phoneRevealButton": ".js-show-phone-btn",
  "nextPage": ".pagination__next"
}
```

---

## 2.4 Social Media Listeners

### Facebook Marketplace / Groups

| Approach | Method | Feasibility |
|---|---|---|
| **Meta Graph API** | Official API for business pages | ✅ Available with app review |
| **Facebook Groups monitoring** | Manual or semi-automated | ⚠️ ToS limitations |
| **Marketplace scraping** | Browser automation | ⚠️ High anti-bot risk |

**Recommended approach**: Start with official Meta Business API integration for business pages and ads. Marketplace monitoring as a manual workflow with AI-assisted lead extraction from screenshots/text.

### Instagram

| Approach | Method | Feasibility |
|---|---|---|
| **Instagram Graph API** | Business account DM/comment monitoring | ✅ With Meta app review |
| **Hashtag monitoring** | Track #cyprusproperties etc. | ⚠️ API limitations |

### LinkedIn

| Approach | Method | Feasibility |
|---|---|---|
| **LinkedIn Sales Navigator** | Agent/owner profile discovery | ✅ Premium API |
| **Company page followers** | Monitor real estate company engagement | ⚠️ Limited API |

> [!NOTE]
> Social media integrations are lower priority than Bazaraki in Phase 2. They may be deferred to Phase 3 if timeline is tight.

---

## 2.5 Global Portal Connectors

For international expansion, the scraper should support additional property portals:

| Portal | Region | Type | Priority |
|---|---|---|---|
| Spitogatos | Greece/Cyprus | Classifieds | 🟡 High |
| Rightmove | UK | Portal | 🟢 Medium |
| Idealista | Spain/Portugal/Italy | Portal | 🟢 Medium |
| Zoopla | UK | Portal | 🟢 Low |
| Immobiliare.it | Italy | Portal | 🟢 Low |
| SeLoger | France | Portal | 🟢 Low |

Each portal connector follows the same `ScrapingTarget` + `ListingScraperService` architecture. The AI extraction mode allows rapid onboarding of new portals without writing custom CSS selectors.

---

## Cron Integration

New cron endpoint at `app/api/cron/scrape-listings/route.ts`:

```
GET /api/cron/scrape-listings
  Authorization: Bearer <CRON_SECRET>
  
  ?targetId=<optional filter>
  ?locationId=<optional filter>

Flow:
  1. Fetch active ScrapingTargets where nextRunDue <= now()
  2. For each target, call ListingScraperService.scrapeTarget()
  3. Create ScrapingRun audit records
  4. Update target.lastSyncAt and stats
  5. Return summary JSON
```

---

## Key Files to Create

| File | Purpose |
|---|---|
| `lib/scraping/listing-scraper.ts` | **[NEW]** Core scraping service |
| `lib/scraping/extractors/bazaraki.ts` | **[NEW]** Bazaraki-specific extractor |
| `lib/scraping/extractors/generic.ts` | **[NEW]** AI-based generic extractor |
| `lib/scraping/page-fetcher.ts` | **[NEW]** Playwright/cheerio page fetcher |
| `app/api/cron/scrape-listings/route.ts` | **[NEW]** Cron endpoint |
| `app/(main)/admin/settings/prospecting/page.tsx` | **[NEW]** Scraping target admin UI |
| `app/(main)/admin/settings/prospecting/actions.ts` | **[NEW]** CRUD for ScrapingTarget |

---

## Verification Plan

### Automated Tests
- Unit tests for extraction logic with fixture HTML
- Integration test: scrape a known Bazaraki page → verify ProspectLead created
- Deduplication tests: create existing contact, scrape same phone → verify match detected

### Manual Verification
- Configure a Bazaraki scraping target via admin UI
- Trigger manual scrape run
- Verify prospects appear in Lead Inbox with correct source attribution
- Verify scraping run stats are displayed in admin UI
- Verify rate limiting delays between page requests
