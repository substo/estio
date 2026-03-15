§# Phase 2 — Strategic Scraping Infrastructure
**Last Updated:** 2026-03-14
**Status:** Completed

## Overview

Phase 2 builds the tooling to **discover property owners and interested parties** from external listing sites. The scraped data feeds into the Lead Inbox (Phase 1.2) for human review and CRM acceptance.

> [!IMPORTANT]
> Phase 1 Lead Inbox must be operational before scraping pipelines are activated, otherwise discovered leads have no structured place to land.

---

## 2.1 Scraping Connection & Task Configuration

### Admin UI

New settings page at `/admin/settings/prospecting` (or under existing `/admin/settings` navigation):

#### Configuration Fields per Connection and Credential

| Field | Type | Description |
|---|---|---|
| `name` | String | Display name (e.g., "Bazaraki Properties") |
| `platform` | String | Target platform (e.g., "bazaraki") |
| `enabled` | Boolean | Active/inactive toggle |
| `globalRateLimitMs` | Int | Cross-credential delay |

#### Configuration Fields per Task

| Field | Type | Description |
|---|---|---|
| `name` | String | Display name of the specific job |
| `scrapeFrequency` | Enum | `hourly`, `every_6h`, `daily`, `weekly` |
| `maxPagesPerRun` | Int | Pagination depth limit (default 10) |
| `extractionMode` | Enum | `css_selectors`, `ai_extraction`, `hybrid` |
| `selectors` | Json | CSS selector mapping for structured extraction |
| `aiInstructions` | String | System prompt for AI-based extraction |
| `targetUrls` | String[] | Specific platform paths to query |
| `fieldMappings` | Json | Dynamic format mapping per target |
| `lastSyncAt` | DateTime | Last successful scrape timestamp |

### Data Model Architecture Split

To better manage scraping complexity and avoid IP bans, the data model is split to support **Credential Rotation Pools**.

*   **`ScrapingConnection` Model**
    *   **Purpose:** Houses platform-level behavior and acts as a pool for credentials.
    *   **Fields:** `name`, `platform`, `enabled`, `globalRateLimitMs`.
*   **`ScrapingCredential` Model**
    *   **Purpose:** Specific platform login accounts rotated in a pool.
    *   **Fields:** `authUsername`, `authPassword`, `sessionState` (Playwright cookies), `status` (active/banned/rate_limited), `healthScore`.
*   **`ScrapingTask` Model**
    *   **Purpose:** Stores configuration for specific scheduled scraping jobs utilizing a Connection Pool.
    *   **Fields:** `name`, `connectionId`, `enabled`, `scrapeFrequency`, `maxPagesPerRun`, `extractionMode` (`css_selectors`, `ai_extraction`, `hybrid`), `selectors` (JSON), `aiInstructions` (Text), `taskType`, `targetUrls` (String array), `fieldMappings` (JSON).
*   **`ScrapingRun` Model**
    *   **Purpose:** Telemetry tracking for monitoring scraping success and errors.
    *   **Fields:** `taskId`, `status`, `pagesScraped`, `listingsFound`, `leadsCreated`, `duplicatesFound`, `errors`, `errorLog`, `metadata`.

#### Data Model

```prisma
model ScrapingConnection {
  id         String   @id @default(cuid())
  locationId String

  name              String
  platform          String
  enabled           Boolean  @default(true)
  globalRateLimitMs Int      @default(5000)

  location    Location @relation(fields: [locationId], references: [id], onDelete: Cascade)
  tasks       ScrapingTask[]
  credentials ScrapingCredential[]
}

model ScrapingCredential {
  id           String   @id @default(cuid())
  connectionId String

  authUsername      String?
  authPassword      String?  @db.Text
  sessionState      Json?
  
  status            String   @default("active")
  healthScore       Int      @default(100)
  lastUsedAt        DateTime?

  connection ScrapingConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
}

model ScrapingTask {
  id           String   @id @default(cuid())
  locationId   String
  connectionId String

  name              String
  enabled           Boolean  @default(true)
  scrapeFrequency   String   @default("daily")
  maxPagesPerRun    Int      @default(10)
  extractionMode    String   @default("hybrid")
  selectors         Json?
  aiInstructions    String?  @db.Text
  taskType          String   @default("listings")
  targetUrls        String[] @default([])
  fieldMappings     Json?

  lastSyncAt        DateTime?
  lastSyncStatus    String?
  lastSyncError     String?  @db.Text
  lastSyncStats     Json?

  connection ScrapingConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  runs       ScrapingRun[]
}

model ScrapingRun {
  id         String   @id @default(cuid())
  taskId     String

  status          String    @default("running")
  pagesScraped    Int       @default(0)
  listingsFound   Int       @default(0)
  leadsCreated    Int       @default(0)
  duplicatesFound Int       @default(0)
  errors          Int       @default(0)
  errorLog        String?   @db.Text
}
```

---

## 2.2 Listing Scraper Service

### Architecture

The scraping architecture decouples cron triggering from actual browser execution using BullMQ, ensuring isolated, retriable background processing that respects Target domain rate limits.

```
┌────────────────────────────────────────────────────┐
│            Cron: /api/cron/scrape-listings         │
│            (Enqueues eligible targets)             │
├────────────────────────────────────────────────────┤
│                           |                        │
│                           ▼                        │
│                   ┌───────────────┐                │
│                   │  BullMQ Queue │                │
│                   │(scrapingQueue)│                │
│                   └───────┬───────┘                │
│                           │                        │
│  ┌──────────────┐    ┌────▼────────────────┐       │
│  │ ScrapingTarget│───▶│ ListingScraperService│      │
│  │ (config)     │    │   (Worker context)  │       │
│  └──────────────┘    │  1. PageFetcher     │       │
│                      │  2. Domain Extractor│       │
│                      │  3. AI enrichment   │       │
│                      │  4. Dedup check     │       │
│                      │  5. Gen ProspectLead│       │
│                      └─────────┬───────────┘       │
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

> [!NOTE]
> **Implementation Decision**: The stack uses `Playwright` encapsulated in `lib/scraping/page-fetcher.ts` as the primary driver instead of Puppeteer or raw fetch. This allows trivial bypassing of standard anti-bot protections and handles JS-heavy sites natively.

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

## 2.6 Queue Infrastructure (BullMQ)

Scraping is an inherently long-running task that is prone to network timeouts and anti-bot bans. Running it synchronously in a Next.js API route is an anti-pattern.

`lib/queue/scraping-queue.ts` implements a dedicated BullMQ queue specifically for scraping isolated targets.
- **Worker Concurrency**: 1 (Processes one target at a time to prevent server IP bans)
- **Rate Limit**: 1 job per 5 seconds globally.
- **Retries**: Configured to 1 attempt initially to prevent spamming failing target sites automatically.

---

## 2.7 Cron Integration

New cron endpoint at `app/api/cron/scrape-listings/route.ts`:

```
GET /api/cron/scrape-listings
  Authorization: Bearer <CRON_SECRET>
  
  ?targetId=<optional filter>
  ?locationId=<optional filter>

Flow:
  1. Fetch active ScrapingTargets where nextRunDue <= now()
  2. For each target, push job params onto BullMQ `scrapingQueue`
  3. Return summary JSON of enqueued jobs immediately.
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
