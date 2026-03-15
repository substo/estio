§# Phase 2 — Strategic Scraping Infrastructure
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
| `maxDailyInteractions`| Int | Hard limit on "heavy" clicks (deep scrapes) per day to prevent bans |
| `maxConcurrentRequests`| Int | Limit to prevent Playwright parallel floods |

#### Configuration Fields per Task

| Field | Type | Description |
|---|---|---|
| `name` | String | Display name of the specific job |
| `scrapeFrequency` | Enum | `hourly`, `every_6h`, `daily`, `weekly` |
| `maxPagesPerRun` | Int | Pagination depth limit (default 10) |
| `extractionMode` | Enum | `css_selectors`, `ai_extraction`, `hybrid` |
| `scrapeStrategy` | Enum | Determines interaction depth: `shallow_duplication` or `deep_extraction` |
| `targetSellerType` | Enum | Target constraint: `individual`, `agency`, `all` |
| `delayBetweenPagesMs`| Int | Base wait time before navigating/clicking |
| `delayJitterMs` | Int | Randomized human variance added to delay |
| `maxInteractionsPerRun`| Int | Job-specific interaction cap |
| `selectors` | Json | CSS selector mapping for structured extraction |
| `aiInstructions` | String | System prompt for AI-based extraction |
| `targetUrls` | String[] | Specific platform paths to query |
| `fieldMappings` | Json | Dynamic format mapping per target |
| `lastSyncAt` | DateTime | Last successful scrape timestamp |

### Data Model Architecture Split

To better manage scraping complexity and avoid IP bans, the data model is split to support **Credential Rotation Pools**.

*   **`ScrapingConnection` Model**
    *   **Purpose:** Houses platform-level behavior and acts as a pool for credentials.
    *   **Fields:** `name`, `platform`, `enabled`, `globalRateLimitMs`, `maxDailyInteractions`, `maxConcurrentRequests`.
*   **`ScrapingCredential` Model**
    *   **Purpose:** Specific platform login accounts rotated in a pool.
    *   **Fields:** `authUsername`, `authPassword`, `sessionState` (Playwright cookies), `status` (active/banned/rate_limited), `healthScore`.
*   **`ScrapingTask` Model**
    *   **Purpose:** Stores configuration for specific scheduled scraping jobs utilizing a Connection Pool.
    *   **Fields:** `name`, `connectionId`, `enabled`, `scrapeFrequency`, `maxPagesPerRun`, `extractionMode` (`css_selectors`, `ai_extraction`, `hybrid`), `scrapeStrategy`, `targetSellerType`, `delayBetweenPagesMs`, `delayJitterMs`, `maxInteractionsPerRun`,  `selectors` (JSON), `aiInstructions` (Text), `targetUrls` (String array), `fieldMappings` (JSON).
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
| **Human Emulation Delays** | Tasks apply `delayBetweenPagesMs` plus a randomized `delayJitterMs` to every navigational and interactive click, avoiding exact programmatic signatures. |
| **Interaction Budgets** | Hard limits (`maxDailyInteractions` / `maxInteractionsPerRun`) are enforced on clicks that unmask valuable data (e.g. phone numbers) to prevent burning credential trust scores. |
| **robots.txt** | Check and respect before scraping (config override) |
| **User-Agent** | Realistic browser User-Agent string |
| **IP rotation** | Future: proxy rotation for high-volume scraping |
| **Data retention** | Configurable TTL for rejected prospects |
| **Consent** | Scraped data is treated as public information; outreach requires consent tracking |

---

## 2.8 Enterprise Scraping Strategies

To balance lead acquisition rate against platform bans, Tasks should be configured with specific strategies rather than brute-force crawling.

### Shallow Duplication vs. Deep Extraction

The primary bottleneck on classified platforms is **action thresholds** (how many times you can click "Show Phone Number" per hour/day). To preserve this budget:

1.  **Shallow Duplication:**
    *   The scraper rapidly traverses index pages (Listings List).
    *   It extracts surface-level data: `listingId`, `title`, `price`, `status`, `sellerType` (if available visually).
    *   **No Deep Interactions.** The scraper does not open listing detail pages or click reveal buttons.
    *   This data is used to continuously map the market state quickly.
2.  **Deep Extraction:**
    *   Triggered selectively. The task only attempts a Deep Extraction if the listing matches criteria (e.g., `targetSellerType === 'individual'`) and the `listingId` hasn't been scraped within X days.
    *   The Playwright instance navigates to the listing detail.
    *   Applies Human Emulation Delays + Jitter.
    *   Executes the "Show Phone Number" interaction.
    *   Deducts 1 point from the Connection's `maxDailyInteractions` budget.

By combining an hourly Shallow sweep with filtered Deep Extractions, Estio maintains full market data without triggering aggressive anti-bot captchas.

---

## 2.3 Bazaraki Integration

### Why Bazaraki First
Bazaraki is the dominant classifieds platform in Cyprus, heavily used for property listings. It is the **highest-impact single source** for the Estio user base.

### Bazaraki Authentication (WhatsApp Flow)

Logging into Bazaraki automatically presents several challenges: Cookie consent Modals, QR code generation, and aggressive anti-bot protection. 

To overcome this, we implemented a **Real-Time Streaming QR Code** flow:
1. **Headless Browser:** The server launches a headless Playwright instance.
2. **Cookie Consent API:** The script bypasses the CMP UI overlay via native JS (`__cmp('setConsent', ...)`).
3. **SSE Stream:** The backend extracts the generated WhatsApp QR Code (base64 image) and streams it down to the Admin UI using Server-Sent Events (SSE). The admin scans this code with their real phone to link the session.
4. **Cloudflare Turnstile Bypass:** 
   - Bazaraki protects the post-scan redirect with Cloudflare. Normal Playwright/Puppeteer will hit a "Verify you are human" block and fail to capture the `sessionid`.
   - **Solution:** We process the login using `playwright-extra` and `puppeteer-extra-plugin-stealth`. This completely evades Turnstile, allowing the backend redirect to complete naturally.
   - **Webpack Build Fix:** Because `puppeteer-extra` utilizes dynamic `require()` statements, Vercel/Next.js will fail to build. You **must** add `playwright-extra` and `puppeteer-extra-plugin-stealth` to `serverExternalPackages` in `next.config.js`.
5. **Session Capture:** Once navigated away from `/login/`, the `context.storageState()` is extracted and saved directly to the database in `ScrapingCredential`. 

**Required Dependencies:**
```bash
npm i playwright-extra puppeteer-extra-plugin-stealth
npm i -D @types/puppeteer @types/puppeteer-extra-plugin-stealth
```

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

### Selector Configuration (New DOM via `.advert`)

Recent changes to Bazaraki require using the nested `.advert__content` classes.

```json
{
  "listingContainer": ".advert",
  "title": ".advert__content-title a[href]",
  "price": ".advert__content-price",
  "location": ".advert__content-place",
  "nextPage": "a.number-list-next, a.number-list-line"
}
```

### Bazaraki Pagination Control

Because Bazaraki paginates results into indexes, the scraping task will follow the `nextPageUrl` extracted via the `nextPage` selector. The recursive fetch runs inside a `while` loop within `ListingScraperService` until the `TargetUrl` pages are exhausted or the `interactionsRemaining` budget hits 0.

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

### Manual Scrape Trigger ("Run Now")

In addition to scheduled cron runs, tasks can be triggered manually from the Admin UI.

- **`ScrapingJobData`** now accepts an optional `pageLimit?: number` field.
- **`ListingScraperService.scrapeTask()`** accepts `options?: { pageLimit?: number }` — this caps `MAX_DEPTH` for the pagination loop, overriding the task's `maxPagesPerRun` default.
- **`manualTriggerScrape(taskId, locationId, pageLimit?)`** server action enqueues the task into BullMQ with the selected page limit.
- **`RunScraperButton`** — a client component rendered on each task card in the Admin UI, providing a dropdown with:
  - **Scrape 1 Page (Test Run)** — ideal for verifying selectors work.
  - **Scrape 5 Pages** — quick validation with broader data.
  - **Run Full Configured Scrape** — uses task's `maxPagesPerRun` setting.

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
| `app/(main)/admin/settings/prospecting/_components/run-scraper-button.tsx` | **[NEW]** Manual trigger dropdown button |

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
