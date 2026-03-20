§# Phase 2 — Strategic Scraping Infrastructure
**Status:** Completed

## Overview

Phase 2 builds the tooling to **discover property owners and interested parties** from external listing sites. The scraped data feeds into the **Scraped Listings Inbox** for human review and CRM acceptance. The architecture separates **Listings** (properties) from **Prospects** (people/sellers), enabling precise triage workflows.

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
    *   **Fields:** `authUsername`, `authPassword`, `sessionState` (Playwright cookies), `status` (active/banned/rate_limited/needs_auth), `healthScore`.
*   **`ScrapingTask` Model**
    *   **Purpose:** Stores configuration for specific scheduled scraping jobs utilizing a Connection Pool.
    *   **Fields:** `name`, `connectionId`, `enabled`, `scrapeFrequency`, `maxPagesPerRun`, `extractionMode` (`css_selectors`, `ai_extraction`, `hybrid`), `scrapeStrategy`, `targetSellerType`, `delayBetweenPagesMs`, `delayJitterMs`, `maxInteractionsPerRun`,  `selectors` (JSON), `aiInstructions` (Text), `targetUrls` (String array), `fieldMappings` (JSON).
*   **`ScrapingRun` Model**
    *   **Purpose:** Telemetry tracking for monitoring scraping success and errors.
    *   **Fields:** `taskId`, `status`, `pagesScraped`, `listingsFound`, `leadsCreated`, `duplicatesFound`, `errors`, `errorLog`, `metadata`.

### Run History UI

Each scheduled or manually triggered run emits a `ScrapingRun` record. The Admin UI features an expandable **Run History Panel** for each task card that displays these records in real-time. This provides immediate observability into pages scraped, listings found, and surfaces any error stack traces without needing to check server logs.

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
│                      │  3. Dedup check     │       │
│                      │  4. Gen Prospect    │       │
│                      │  5. Gen ScrapedList │       │
│                      └─────────┬───────────┘       │
│                                │                   │
│                    ┌───────────▼──────────┐        │
│                    │   ScrapedListing     │        │
│                    │   (Listings Inbox)   │        │
│                    │        ↕             │        │
│                    │   ProspectLead       │        │
│                    │   (People / Sellers) │        │
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

3.  **Targeted Deep Extraction (Profile Rescrape):**
    *   When an agent clicks "Scrape Other Listings" on a Contact or Property view, a `deep_extraction` task is created explicitly linked to that `prospectLeadId`.
    *   The scraper dynamically fetches the `knownPhone` of the Prospect.
    *   All extracted properties are natively bound to the matching CRM Contact, and **the scraper bypasses the "Show Phone Number" interaction**, conserving interaction budgets while capturing High-Res imagery and full property details.

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

### Auto-Triggering Re-authentication
If an active login session expires or the platform forces a logout, the `ListingScraperService` cleanly intercepts the failure (e.g., being blocked by a sign-in wall during deep scrapes).
- The credential's `status` in the database is automatically set to `needs_auth`.
- The run gracefully halts or fails the specific extraction without burning further rate limits.
- The Admin UI surfaces a `⚠️ Needs Auth` badge, prompting the administrator to edit the credential and re-trigger the QR flow out-of-band. Once a new session is captured via SSE, the credential reverts back to `active`.

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

### Extraction Fields — Single-Listing Deep Scrape

**File:** `app/api/admin/scrape-listing/route.ts`

| Field | Selector | Notes |
|---|---|---|
| **Title** | `h1.title-announcement`, `#ad-title` (fallback: `h1`) | |
| **Description** | `.js-description` | |
| **Price** | `.announcement-price__cost` | Parsed to integer |
| **Currency** | `meta[itemprop="priceCurrency"]` `content` attr | Defaults to `EUR` |
| **Location** | `.announcement__location span[itemprop="address"]` | |
| **Owner Name** | `.author-info .author-name` → `.author-info a[data-user]` → `.author-info [itemprop="name"]` | Overridden by contacts dialog name if available |
| **Phone** | Click `.phone-author.js-phone-click` → wait for `.contacts-dialog` popup → `a[href^="tel:"]` | Pre-click fallback: `.phone-author-subtext__main` |
| **Images** | `.announcement__images-item.js-image-show-full, .gallery img` | Extracts full resolution from `data-full \|\| data-src`, max 10 |
| **Thumbnails** | `.announcement__thumbnails-item.js-select-image` | Low-resolution previews from `src` paired with full images |
| **Property Type** | `.breadcrumbs__link` (last) | |
| **Listing Type** | Parsed from URL (`-rent` → `rent`, else `sale`) | |
| **Listing ID** | Regex from URL: `/adv/(\d+)/` | |
| **Bedrooms** | `ul.chars-column li` → `.key-chars` = "Bedrooms" | Generic extractor loop |
| **Bathrooms** | Same pattern, key = "Bathrooms" | |
| **Property Area** | Same pattern, key = "Property area" | |
| **Plot Area** | Same pattern, key = "Plot area" | |
| **Construction Year** | Same pattern, key = "Construction year" | |
| **Latitude** | `.js-static-map` `data-default-lat` | |
| **Longitude** | `.js-static-map` `data-default-lng` | |
| **Seller ID** | `.author-info .author-name[data-user]` | |
| **Seller Registration** | `.date-registration` (page) or `.contacts-dialog__date` (dialog) | |
| **Other Listings URL** | `a.other-announcement-author` `href` | |
| **WhatsApp Phone** | `a._whatsapp[href]` → parse `phone=` param | Free extraction — no click budget |
| **Contact Channels** | Presence checks: `.js-card-messenger`, `._email`, WhatsApp href | Array: `["whatsapp","chat","email"]` |
| **Raw Attributes** | All `ul.chars-column li` key-value pairs | Stored as JSON catch-all |
| **Expired Status** | `.phone-author--sold` or `.phone-author__subtext` text | Flags `isExpired` in DB to visually dim the UI across hubs |

#### Phone Extraction: Contacts Dialog Flow

Bazaraki's phone button (`.phone-author.js-phone-click`) does not inline-reveal the number. Instead, it opens a jQuery UI popup dialog (`.contacts-dialog`):

1. **Pre-click**: The phone may be partially visible in `.phone-author-subtext__main` — extract first as fallback.
2. **Click**: Click the `.phone-author.js-phone-click` button.
3. **Wait**: Allow 2s for the `.contacts-dialog` popup to appear.
4. **Extract from dialog**:
   - Phone: `.contacts-dialog__phone a[href^="tel:"]`
   - Real Owner Name: `.contacts-dialog__name` (direct text, excluding child elements)
   - Registration: `.contacts-dialog__date`

> [!TIP]
> The WhatsApp button `href` contains the phone number without requiring a click. This is a **free extraction** that doesn't consume interaction budget: `a._whatsapp[href]` → parse `phone=` URL param.

#### Defensive Error Handling in Single-Listing Scrape

The WhatsApp/contact-channels extraction section (`a._whatsapp[href]`, `.js-card-messenger`, `._email`) is wrapped in its own `try-catch` to prevent errors in optional fields from crashing the entire scrape. If this section fails, a warning is logged but the rest of the extracted data (title, price, images, phone, etc.) is preserved.

#### Partial Data Recovery: Save Anyway

When a scrape fails mid-extraction (e.g. browser error during phone reveal), the backend now sends the partially-extracted data alongside the error event via `partialData` field in the SSE stream. The `ScrapeListingDialog` UI renders:

1. **Partial Data Preview** — amber card showing what was successfully extracted before the crash
2. **"Save Anyway" button** — calls `/api/admin/save-listing` to persist the partial data to the database, overwriting the existing listing record

This ensures no data is lost even when the scrape terminates abnormally.

**Endpoint:** `app/api/admin/save-listing/route.ts`
- **Method:** `POST`
- **Body:** `{ listingId?, platform, url, data }` — where `data` follows the `ScrapedData` shape
- **Logic:** Reuses the same upsert logic for `ProspectLead` and `ScrapedListing` as the main scrape route

### Extraction Fields — Batch Index Scrape

**File:** `lib/scraping/extractors/bazaraki.ts`

The selectors cover both search/category pages and seller profile pages:

```json
{
  "listingContainer": ".advert, .advert-grid, .announcement-block, .classified, .list-simple__output .announcement-container, .list-simple__output > li",
  "title": ".advert__content-title, .advert-grid__content-title, .announcement-block__title a, .classified__title",
  "listingLink": "a.swiper-slide[href], a.advert-grid__body-image-paginator-container[href], .announcement-block__title a[href], a[href*='/adv/']",
  "price": ".advert__content-price, .advert-grid__content-price, .announcement-block__price, .classified__price",
  "location": ".advert__content-place, .advert-grid__content-place, .announcement-block__place, .classified__location",
  "nextPage": "a.number-list-next, a.number-list-line"
}
```

#### Fallback Link Extraction for Seller Profiles

When the primary selectors find 0 listings (common on seller profile pages where HTML structure differs from search results), the extractor falls back to scanning all `<a href="/adv/...">` links on the page. This extracts listing URLs and external IDs directly from raw anchors, deduplicating by ID. The fallback results proceed through the same deep-extraction pipeline, ensuring seller profile scrapes are functional even without exact CSS selectors.

Debug logging is emitted when 0 listings are found, dumping the first 1000 chars of page HTML and total `/adv/` anchor count to server logs for selector diagnosis.

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

`lib/queue/scraping-queue.ts` implements a dedicated BullMQ queue specifically for scraping isolated targets. The `initScrapingWorker()` function is called globally during server boot inside `instrumentation.ts` to ensure background jobs are always processed.
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
| `app/api/admin/save-listing/route.ts` | **[NEW]** Save partial scrape data endpoint |
| `app/api/cron/scrape-listings/route.ts` | **[NEW]** Cron endpoint |
| `app/(main)/admin/settings/prospecting/page.tsx` | **[NEW]** Scraping target admin UI |
| `app/(main)/admin/settings/prospecting/actions.ts` | **[NEW]** CRUD for ScrapingTarget |
| `app/(main)/admin/settings/prospecting/_components/run-scraper-button.tsx` | **[NEW]** Manual trigger dropdown button |
| `lib/scraping/deep-scraper.ts` | **[NEW]** Deep Scrape service: visits individual listing URLs, extracts full descriptions, runs AI `isAgency` classification |
| `app/(main)/admin/settings/prospecting/_components/run-deep-scraper-button.tsx` | **[NEW]** Manual trigger button for Deep Scrape jobs |
| `lib/leads/scraped-listing-repository.ts` | **[NEW]** Repository for querying `ScrapedListing` records with prospect data joins |
| `app/(main)/admin/prospecting/layout.tsx` | **[NEW]** Shared layout with tab navigation between People and Listings Inbox |
| `app/(main)/admin/prospecting/listings/page.tsx` | **[NEW]** Listings Inbox page |
| `app/(main)/admin/prospecting/listings/actions.ts` | **[NEW]** Server actions for accept/reject/bulk operations on scraped listings |
| `app/(main)/admin/prospecting/listings/_components/scraped-listing-table.tsx` | **[NEW]** Interactive table with row-click drawer integration |
| `app/(main)/admin/prospecting/listings/_components/prospect-review-drawer.tsx` | **[NEW]** Side drawer with listing details, seller profile, and outreach actions |

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

---

## 3.0 Deep Scraping & Enterprise AI Usage Ledger
**Status:** Completed

### 3.1 Deep Scraper Service

The initial index scrape (Phase 2) only extracts surface-level data from search result pages. The **Deep Scraper** is a separate background job that visits individual listing URLs to extract full property descriptions and run accurate AI classification.

**Architecture:**
- **Service:** `lib/scraping/deep-scraper.ts` — `DeepScraperService`
- **Trigger:** Manual via "Run Deep Scrape" button on `/admin/settings/prospecting`, or scheduled via BullMQ.
- **Queue:** The `scrapingQueue` worker handles `type: 'deep_scrape'` jobs, routing them to `DeepScraperService.processPendingListings()`.

**Deep Scrape Flow:**
1. Query `ScrapedListing` records with `status: 'NEW'` that haven't been deep-scraped yet.
2. For each listing, fetch the full page HTML using `PageFetcher`.
3. Extract the full description using `extractBazarakiDescription()` from `lib/scraping/extractors/bazaraki.ts`.
4. Run AI classification via `callLLMWithMetadata()` using Gemini to determine `isAgency` probability.
5. Update the linked `ProspectLead.isAgency` field accordingly.
6. Log AI usage to `AgentExecution` with `sourceType: "scraper"`.

### 3.2 Enterprise AI Usage Ledger

To support enterprise-grade AI cost tracking across all features (conversations, scraping, content generation), the `AgentExecution` model was refactored:

| Field | Type | Purpose |
|---|---|---|
| `locationId` | String (required) | Links every AI execution to a tenant location for global aggregation |
| `sourceType` | String | Categorizes the origin: `"conversation"`, `"scraper"`, `"content"`, etc. |
| `sourceId` | String | Polymorphic ID referencing the source entity (conversation ID, task ID, etc.) |
| `conversationId` | String? (optional) | Kept for backward compatibility but no longer required |

The `getAggregateAIUsage()` function in `app/(main)/admin/conversations/actions.ts` now queries `AgentExecution` directly by `locationId` and groups costs by `sourceType`, providing accurate global AI cost dashboards.

### 3.3 Data Model: ScrapedListing

Listings are stored separately from Prospects (people) in a dedicated `ScrapedListing` model. The schema was expanded to capture rich property details, geo coordinates, seller intelligence, and a catch-all JSON field.

```prisma
model ScrapedListing {
  id         String @id @default(cuid())
  locationId String

  platform   String   // "bazaraki", "facebook"
  externalId String   // Original ID for deduplication
  url        String

  // Core Fields
  title        String?
  price        Int?
  propertyType String?
  locationText String?
  images       String[] // Strictly high-resolution versions
  thumbnails   String[] @default([]) // Strictly low-resolution versions for feed performance
  status       String @default("NEW") // NEW, REVIEWING, IMPORTED, REJECTED, SKIPPED

  // Link to imported Property (set when contact is accepted and property is imported)
  importedPropertyId String?

  // Property Details (expanded)
  description      String?  @db.Text
  currency         String?  @default("EUR")
  bedrooms         Int?
  bathrooms        Int?
  propertyArea     Int?     // m²
  plotArea         Int?     // m²
  constructionYear Int?
  listingType      String?  // "rent" | "sale"

  // Geo
  latitude  Float?
  longitude Float?

  // Seller Intelligence
  sellerExternalId   String?   // Bazaraki user ID (e.g. "9431239")
  sellerRegisteredAt String?   // "Company, on Bazaraki.com since feb, 2017"
  otherListingsUrl   String?   // Link to seller's other ads
  otherListingsCount Int?      // Number of other listings
  contactChannels    String[]  @default([])  // ["whatsapp","chat","email"]
  whatsappPhone      String?   // Parsed from WhatsApp button href

  // Metadata
  rawAttributes  Json?    // All key-value pairs from chars-column

  prospectLeadId String?
  prospectLead   ProspectLead? @relation(fields: [prospectLeadId], references: [id], onDelete: Cascade)

  @@unique([platform, externalId])
}
```

`ProspectLead` was also expanded with seller platform metadata:

```prisma
model ProspectLead {
  // ... existing fields ...
  platformUserId     String?  // Seller's platform ID for cross-referencing
  platformRegistered String?  // "Posting since sep, 2024"
  profileUrl         String?  // Seller's profile / other listings page (e.g. "https://www.bazaraki.com/items/author/40951")
}
```

This creates a clean **1 Person → N Properties** relationship, where `ProspectLead` holds the seller's identity and `ScrapedListing` holds the individual property data.

---

## 4.0 Master-Detail Triage UI
**Status:** Completed

### 4.1 Dual-View Architecture & Layout Reasoning

The `/admin/prospecting` section is designed as a high-efficiency **Master-Detail split-pane interface**. The primary goal of this layout is to facilitate rapid triage of scraped data without context switching.

To serve different outreach workflows, the hub features a top-level toggle between two distinct views:

1. **Properties View (Listing-Centric):** 
   - **Master Feed:** A scrollable list of property cards (`ListingFeedCard`), providing instant visual context (thumbnail, price, location).
   - **Detail Panel:** Shows the full property description, photo carousel, and seller snippet. Best for agents who want to qualify the *asset* before contacting the seller.
2. **Contacts View (Seller-Centric):** 
   - **Master Feed:** A list of seller profiles (`ContactFeedCard`), showing their name, agency status, total listing count, and contact channels.
   - **Detail Panel:** Shows the seller's full profile, contact info, and a responsive grid of *all* their associated properties. Best for agents looking to acquire entire portfolios or agencies.

### 4.2 URL-Synced Previews & Cross-Navigation

All UI state has been migrated to the URL to ensure triage views are **100% bookmarkable and shareable** between team members:

- **View State:** `?view=properties` vs `?view=contacts`
- **Selection State:** `?listingId=<id>` or `?contactId=<id>` replaces local React state.
- **Scope State:** `?scope=<new|accepted|rejected|all>` explicitly controls feed filtering.

**Cross-Navigation:** The UI allows seamless hopping between the two dimensions:
- Clicking a property card from within the **Contacts View detail panel** automatically switches the user to the **Properties View** with that specific listing selected, enforcing `scope=all` in the URL to guarantee the listing remains visible even if it's already been processed.
- Clicking the seller's name from within the **Properties View detail panel** automatically switches the user to the **Contacts View** to explore the rest of that seller's portfolio, again enforcing `scope=all` to unmask the owner regardless of their accepted/rejected status.

### 4.3 Deep Detail Panels & Scraping Operations

Both detail panels contain dedicated action bars and tailored content views:

- **High-Res Photo Gallery:** The `images` array is exclusively used for the main property viewer to ensure agents see high-quality, zoomable photos, while the `thumbnails` array powers the carousel strip and multi-property feed cards to preserve network and layout performance.
- **Action Outbound:** Pre-filled WhatsApp deep links and direct Call links.
- **Scrape Other Listings:** A dedicated `DownloadCloud` button that dispatches a background task (`scrapeSellerProfile`) to extract the rest of the seller's portfolio using their `otherListingsUrl`. This button is prominently available in both the Properties View and Contacts View. *(Note: When a single listing is scraped or re-scraped, the backend `scrape-listing` service automatically extracts and syncs this `profileUrl` directly to the `ProspectLead` record, ensuring this button is actionable immediately without needing to visit the contact card).*

### 4.4 Cascading Decide Actions & Keyboard Accessibility

Triage speed is maximized through keyboard shortcuts and cascading transactions:

- **Keyboard Flow:** Navigate feeds using `↑` & `↓` (which live-updates the URL).
- **One-Key Decisions:** Press `A` to Accept/Import; press `R` to Reject.

**Cascading Effect:**
- In the **Properties View**, Accept/Import applies only to the selected `$1` listing, marking it as `IMPORTED` and linking it to a newly created CRM Property via `importedPropertyId`.
- In the **Contacts View**, Accept/Reject triggers a **cascading database transaction** (`acceptProspectWithListings` / `rejectProspectWithListings`). Rejecting a contact instantly rejects *all* their newly scraped listings simultaneously. Accepting a contact creates a CRM Contact and imports their new listings.

### 4.5 Explicit State Filtering (Scope)

To maintain an actionable layout and prevent a cluttered "All" view, the Feed provides explicit state filtering dropdowns at the top of the feed structure:

- **New (Default):** Displays only pending items (`NEW`/`REVIEWING` status). This acts as the triage inbox.
- **Accepted:** Displays items successfully converted to the CRM (`IMPORTED` listings, `accepted` contacts).
- **Rejected:** Displays explicitly discarded items (`REJECTED` listings, `rejected` contacts), allowing recovery.
- **All:** An unfiltered view across all terminal states.

By splitting these views natively at the repository layer, Sales teams can focus exclusively on the actionable `New` queue while retaining audited historical access to explicit queues, following standard Enterprise workflow patterns.

### 4.6 Bulk Actions

For high-volume review, the feed supports Bulk Mode. Checking the box on any feed card swaps the standard header for a Bulk Action Bar, exposing one-click APIs to batch Import or Reject large segments of selected items based on the active view.
