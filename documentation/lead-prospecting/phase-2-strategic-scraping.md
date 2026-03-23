# Phase 2 — Strategic Scraping Infrastructure
**Status:** Completed

## Overview

Phase 2 builds the tooling to **discover property owners and interested parties** from external listing sites. The scraped data feeds into the **Scraped Listings Inbox** for human review and CRM acceptance. The architecture separates **Listings** (properties) from **Prospects** (people/sellers), enabling precise triage workflows.

> [!IMPORTANT]
> Phase 1 Lead Inbox must be operational before scraping pipelines are activated, otherwise discovered leads have no structured place to land.

---

## Implementation Update — Deterministic Accepted State + Multi-Type Prospect Classification

The Prospecting stack was updated to remove non-deterministic triage behavior and replace binary agency/private classification with a typed seller model.

### 1) Canonical seller type model (with legacy compatibility)

- `ProspectLead` now stores:
  - `sellerType` (canonical, default `private`)
  - `sellerTypeManual` (nullable manual override)
- Existing `isAgency/isAgencyManual` fields remain as compatibility mirrors for legacy flows.
- Backfill/migration maps legacy booleans to seller type values (`agency` vs `private`).
- Shared helpers centralize:
  - effective seller type resolution,
  - non-private detection for gating/linking,
  - seller-type → company-type mapping (`Agency`, `Management`, `Developer`, `Other`).

### 2) Classifier + scraping pipeline changes

- Prospect classifier contract now returns typed `sellerType` + confidence + reasoning.
- Legacy boolean is still derived from typed output for backwards compatibility.
- Prospect create paths in scraping/save pipelines initialize typed seller state (`private` + manual unset).
- Deep-scrape private-only behavior is preserved by treating all non-private types as agency-side.

### 3) Accept/reject flow determinism and company-link fallback

- Accept is now allowed for all seller types.
- For non-private accepts:
  - auto-link company is attempted first,
  - if ambiguous, action returns `selection_required` with company options (existing/create),
  - selected company is applied before import.
- Accept response contract now supports structured non-success codes (`selection_required`, `not_linkable`, `invalid_selection`, etc.).
- Property import receives linked `companyId` so imported properties can get the correct company role linkage.

### 4) UI determinism for accepted/rejected state

- Listing and contact detail panels now use normalized review-state resolution (`new`, `accepted`, `rejected`, `processed`) with prospect context priority.
- Accepted records no longer show contradictory actions:
  - `Mark Accepted` and `Convert to Contact` are removed from accepted state.
  - `Mark Rejected` remains available.
- Listing scope filtering is refresh-stable:
  - accepted/rejected scopes include prospect context,
  - “new” excludes listings already under accepted/rejected prospects.

### 5) Prospecting links and in-app conversation routing

- Prospecting panels now expose explicit quick links when available:
  - `Open Property`
  - `Open CRM Contact`
  - `Open Conversation`
- Accepted-state messaging action is now in-app conversation-first (not external WhatsApp URL).
- Conversation open flow reuses existing conversation or creates one and then routes to `/admin/conversations?id=...`.

### 6) Full seller-type filtering in Prospecting Hub

- Seller-type filter is now available in both Properties and Contacts views:
  - `All`, `Private`, `Agency`, `Management`, `Developer`, `Other`
- Filter is query-param driven and server-side in repositories/loaders for deterministic refresh behavior.

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

Each scheduled or manually triggered run emits a `ScrapingRun` record. The Admin UI now includes:
- **24h KPI cards** (total runs, success rate, failed/partial, running, avg/p95 duration, top failing tasks).
- An expandable **Run History Panel** per task card with status chips, trigger source (manual vs cron), flow mode (`strategic_contact_first` vs `standard`), interaction budget usage, and structured metadata/error details.
- **Partial-run semantics:** runs that finish with recoverable errors are stored as `partial` (instead of always `completed`) so operators can distinguish clean vs degraded executions.

This gives immediate observability into scraping health without checking server logs.

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

### Triage Decision Reversibility (Enterprise Guardrail)

To prevent irreversible operator mistakes in the Prospecting Inbox, accept/reject decisions must be reversible with an auditable state transition flow:

- `rejected -> accepted`:
  - restore staged listing statuses (`REJECTED -> NEW`) for the prospect
  - reuse the previously created contact when available (reactivate instead of creating duplicates)
  - import eligible listings via the standard contact-centric import pipeline
- `accepted -> rejected`:
  - keep already imported properties as historical records (no destructive deletes)
  - set created contact status to `inactive` (soft reversal)
  - mark still-open staged listings as `REJECTED`
- Auditability:
  - write `ContactHistory` entries for decision changes
  - keep `reviewedAt/reviewedBy` updated on each decision transition
- UI behavior:
  - expose explicit `Mark Accepted` / `Mark Rejected` actions for processed records
  - do not hide actions behind New-only gating

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
    *   It extracts surface-level data: `listingId`, `title`, `price`, `status`, `sellerType` (if available visually), plus card media (`images` / `thumbnails`) when present.
    *   **No Deep Interactions.** The scraper does not open listing detail pages or click reveal buttons.
    *   This data is used to continuously map the market state quickly.
2.  **Deep Extraction:**
    *   Triggered selectively. The task only attempts a Deep Extraction if the listing matches criteria (e.g., `targetSellerType === 'individual'`) and the `listingId` hasn't been scraped within X days.
    *   The Playwright instance navigates to the listing detail.
    *   Applies Human Emulation Delays + Jitter.
    *   Executes the "Show Phone Number" interaction.
    *   Deducts 1 point from the Connection's `maxDailyInteractions` budget.

3.  **Targeted Deep Extraction (Profile Rescrape):**
    *   When an agent clicks "Scrape Other Listings" on a Contact or Property view, a task is created and linked to that `prospectLeadId`, but execution starts in `shallow_duplication`.
    *   Every discovered portfolio listing is first passed through a **listing relevance gate** (`real-estate` vs `non-real-estate`).
    *   Only real-estate relevant listings are promoted to deep extraction for full details/phone enrichment.
    *   Non-real-estate listings are persisted with `status = SKIPPED` plus system relevance metadata, so future runs reuse cached classification and avoid repeated AI/runtime cost.
    *   For uncertain cases, classification is **fail-closed**: if AI relevance classification is unavailable/invalid after retries, listing is treated as `non-real-estate` and remains `SKIPPED`.
    *   The scraper dynamically fetches the `knownPhone` of the Prospect and bypasses "Show Phone Number" when already known, conserving interaction budgets.

By combining an hourly Shallow sweep with filtered Deep Extractions, Estio maintains full market data without triggering aggressive anti-bot captchas.

### Enterprise Guardrails for Relevance Classification

To keep scraping economically viable and auditable at enterprise scale:

1. **Decision Caching + Versioning**
   - Persist relevance decision metadata in `ScrapedListing.rawAttributes` (decision, confidence, source, reason, checked timestamp, classifier version).
   - Reuse cached decisions on future runs when version matches; reclassify only after model/rule version upgrades.

2. **Cost-Aware Multi-Stage Classification**
   - Stage 1: deterministic rules (high precision on obvious non-real-estate categories).
   - Stage 2: AI fallback only for uncertain cases, with bounded retry/backoff and timeout safeguards.
   - If AI remains unavailable for an uncertain case, classification is fail-closed (`non_real_estate`) with explicit diagnostic metadata.
   - This minimizes token burn while keeping recall high.

3. **Workflow Isolation**
   - Preserve business terminal states (`IMPORTED`, `REJECTED`) even if relevance later flips to non-real-estate.
   - Mark operationally irrelevant rows as `SKIPPED` to keep triage queues clean without deleting audit history.

4. **Portfolio De-Duping by Seller Identity**
   - Strategic flow de-duplicates by seller signatures (`sellerExternalId`, profile URL, phone fallback) so the same seller portfolio is not reprocessed repeatedly inside one run.

5. **Operational Circuit Breaker**
   - Deep orchestration tracks repeated relevance fail-closed events caused by AI-unavailability diagnostics.
   - When threshold is exceeded in a run, the task trips a circuit breaker, emits a stage error with reason code `relevance_ai_unavailable`, and ends as degraded/partial instead of continuing to process noisy uncertain items.

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
| **Other Listings Count** | `a.other-announcement-author` text (regex int parse) | Example: `"Other ads from this seller (21)"` → `21` |
| **Business Name** | `.author_business__wrapper .author_business__header h1` | Agency/business profile title |
| **Business Verified** | `.author_business__wrapper .author_business__header-verified` | Boolean signal (`Verified account`) |
| **Business Posting Since** | `.author_business__wrapper .author_business__header-since` | Used as seller registration fallback |
| **Business Address** | `.author_business__wrapper .author_business__contacts .address` | Office/location context |
| **Business Website** | `.author_business__wrapper a.website` | Stored as metadata + `website` contact channel |
| **Business Description** | `.author_business__wrapper .author_business__description` | Corporate language classification signal |
| **WhatsApp Phone** | `a[href*="wa.me/"], a[href*="api.whatsapp.com/send"]` | Free extraction — no click budget. Ignores generic social share buttons to prevent false positives. |
| **Contact Channels** | Presence checks: `.js-card-messenger`, `._email`, WhatsApp href, business website | Array: `["whatsapp","chat","email","website"]` |
| **Raw Attributes** | All `ul.chars-column li` key-value pairs | Stored as JSON catch-all. Powers dynamic schema-on-read feature extraction. |
| **Expired Status** | `.phone-author--sold` or `.phone-author__subtext` text | Flags `isExpired` in DB to visually dim the UI across hubs |

#### Phone Extraction: Contacts Dialog Flow

Bazaraki's phone button (`.phone-author.js-phone-click`) does not inline-reveal the number. Instead, it opens a jQuery UI popup dialog (`.contacts-dialog`):

1. **Overlay cleanup**: Remove known consent/banner overlays that can block interaction (`#cmpwrapper`, cookie/consent wrappers).
2. **Pre-click read**: Attempt inline extraction from `.phone-author-subtext__main` and existing `tel:` links first.
3. **Retry click**: Click `.phone-author.js-phone-click` / `.js-show-popup-contact-business` with bounded retries, waiting between attempts.
4. **Dialog + tel extraction**:
   - Phone: `.contacts-dialog__phone a[href^="tel:"]`
   - Real Owner Name: `.contacts-dialog__name` (direct text, excluding child elements)
   - Registration: `.contacts-dialog__date`
5. **AJAX fallback**: If still unresolved, call the button `data-url` endpoint (`POST`, `X-Requested-With: XMLHttpRequest`) and parse phone from response payload.
6. **Normalization**: Phone values are normalized and placeholders (e.g. `+35`) are rejected.

> The WhatsApp button `href` contains the phone number without requiring a click. This is a **free extraction** that doesn't consume interaction budget: `a[href*="wa.me/"], a[href*="api.whatsapp.com/send"]` → parse URL for number. We strictly avoid generic `.js-share` parameters to prevent misattributing listings to the wrong tracker ID.

#### Enterprise Practice: `author_business__wrapper` Extraction

For enterprise reliability, this block is handled as an **optional deterministic enrichment layer**:

1. Extract only with strict CSS selectors (no AI parsing for this block).
2. Never fail the listing scrape if the wrapper is missing or partially malformed.
3. Normalize into stable metadata keys (`Seller business *`) for auditability.
4. Feed these signals into agency/private classification alongside listing count and portfolio samples.
5. Keep provenance in raw metadata so future parser upgrades are backward-compatible.
6. Persist normalized fields into `ProspectLead.sellerBusinessProfile` (when present) so downstream company matching is congruent with existing CRM `Company` ingestion patterns.

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

#### Seller Profile Card Mapping ("Other ads from this seller")

For seller profile pages (`.list-simple__output .advert-grid`), each card now maps to structured portfolio fields used by both inbox rendering and agency/private evaluation:

| Visible Card Field | Selector | Stored Field |
|---|---|---|
| Property link | `a.advert-grid__body-image-paginator-container[href]` or `a[href*="/adv/"]` | `url`, `externalId` |
| Title | `.advert-grid__content-title` | `title` |
| Price | `.advert-grid__content-price` | `price`, `currency` |
| Bedrooms (feature #1) | `.advert-grid__content-features .advert-grid__content-feature:nth-of-type(1)` | `bedrooms` + `rawAttributes["Bedrooms"]` |
| Bathrooms (feature #2) | `.advert-grid__content-features .advert-grid__content-feature:nth-of-type(2)` | `bathrooms` + `rawAttributes["Bathrooms"]` |
| Pets allowed (feature #3) | `.advert-grid__content-features .advert-grid__content-feature:nth-of-type(3)` | `rawAttributes["Pets allowed"]` |
| Size m² (feature #4) | `.advert-grid__content-features .advert-grid__content-feature:nth-of-type(4)` | `propertyArea` + `rawAttributes["Property area"]` |
| Location | `.advert-grid__content-place` | `locationText` |

> [!NOTE]
> Feature slots are interpreted in visual order from the card UI: beds → baths → pets → size. This aligns with current Bazaraki profile-grid markup and is resilient to icon URL changes.

#### Batch Card Media Extraction (Implemented)

For index/profile cards, shallow extraction now also captures card media without deep interactions:

- Candidate attributes: `data-full`, `data-src`, `data-lazy`, `src`
- URL normalization: absolute HTTP(S), protocol-relative (`//...`), and root-relative (`/...`) paths
- Deduplicated per listing and stored as:
  - `images`: first 3 normalized card images
  - `thumbnails`: first 3 normalized card images

This ensures listings discovered in initial sweeps have immediate visual context before any deep listing revisit.

#### Deep Listing Media Extraction (Parity with Re-scrape)

Deep listing extraction now collects gallery and thumbnail media directly from listing detail pages:

- Gallery sources include `.announcement__images-item.js-image-show-full`, `.gallery img`, `.announcement-media img`, `.swiper-slide img`, `.announcement-gallery img`, and related slider containers.
- Thumbnails are extracted from dedicated thumbnail wrappers when present, otherwise fall back to gallery images.
- Persisted limits:
  - `images`: up to 10 high-resolution entries
  - `thumbnails`: up to 10 preview entries

#### Seller Listing Count in Evaluation

Agency/private classification now uses seller portfolio context, not only a single listing page:

1. `ScrapedListing.otherListingsCount` is parsed from `a.other-announcement-author` text when present.
2. `ProspectLead.listingCount` is normalized as the max of:
   - Existing stored `listingCount`
   - Count of DB-linked scraped listings for the prospect
   - Max observed `otherListingsCount` from seller pages
3. Classifier input includes:
   - Listing count
   - Sample listing titles
   - Sample listing detail rows (`price`, `beds`, `baths`, `pets`, `size`, `location`, `url`)

This gives a reliable signal for distinguishing agencies from private owners based on actual seller inventory depth.

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

`lib/queue/scraping-queue.ts` implements a dedicated BullMQ queue specifically for scraping isolated targets. Worker startup is now role-gated by `PROCESS_ROLE` (`web` vs `scrape-worker`) via `instrumentation.ts`, so production web processes do not consume scraping jobs.
- **Headless Worker Runtime:** production scrape worker is launched via `npm run start:scrape-worker` (instrumentation bootstrap only), not `next start`.
- **Worker Concurrency**: 1 (Processes one target at a time to prevent server IP bans)
- **Rate Limit**: 1 job per 5 seconds globally.
- **Retries**: Configured to 1 attempt initially to prevent spamming failing target sites automatically.
- **Run Correlation Metadata:** queue payload now carries trigger context (`triggeredBy`, `triggeredByUserId`, `queuedAt`) so each worker execution can be traced end-to-end in `ScrapingRun.metadata`.
- **Deep Run Correlation:** deep jobs now also carry `runId` and are processed against an already-persisted `DeepScrapeRun` lifecycle record.
- **Deep Scrape Routing (Implemented):** `type: "deep_scrape"` jobs are routed to `DeepScrapeOrchestratorService.processLocation()` (manual-first strategic flow), not to the legacy NEW-listings-only deep pass.
- **Orchestration Config Snapshot (Implemented):** deep queue payload includes a versioned config snapshot so each deep run stores the exact execution parameters used at trigger time.
- **Dedicated Worker Health:** scraping worker heartbeats are written to Redis and exposed through diagnostics for live operational visibility.

### Manual Scrape Trigger ("Run Now")

In addition to scheduled cron runs, tasks can be triggered manually from the Admin UI.

- **`ScrapingJobData`** accepts `pageLimit?: number` plus trigger context fields (`triggeredBy`, `triggeredByUserId`, `queuedAt`).
- **`ListingScraperService.scrapeTask()`** accepts `options?: { pageLimit?: number }` — this caps `MAX_DEPTH` for the pagination loop, overriding the task's `maxPagesPerRun` default.
- **`manualTriggerScrape(taskId, locationId, pageLimit?)`** server action enqueues the task with the selected page limit and source metadata (`manual` + actor id) for auditing.
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
  2. For each target, push job params onto BullMQ `scrapingQueue` with `triggeredBy = "cron"` and timestamp context
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
| `app/(main)/admin/settings/prospecting/page.tsx` | **[NEW]** Scraping target admin UI + 24h run KPI dashboard |
| `app/(main)/admin/settings/prospecting/actions.ts` | **[NEW]** CRUD for ScrapingTarget + scoped run-history retrieval |
| `app/(main)/admin/settings/prospecting/_components/run-history-panel.tsx` | **[NEW]** Expandable run telemetry panel with status/flow/error metadata |
| `app/(main)/admin/settings/prospecting/_components/run-scraper-button.tsx` | **[NEW]** Manual trigger dropdown button |
| `lib/scraping/deep-scrape-orchestrator.ts` | **[NEW]** Manual-first deep orchestration service (seed URLs → phone gate → seller portfolio → agency/private decision → selective deep portfolio scraping) |
| `lib/scraping/deep-scrape-types.ts` | **[NEW]** Typed deep-run telemetry contracts (`DeepScrapeRunSummary`, `DeepScrapeStageLog`, `OmissionReason`, reason codes, error categories) |
| `lib/scraping/listing-relevance-classifier.ts` | **[MODIFY]** Relevance classifier hardened to `v2` (fail-closed uncertain path, word-boundary matching, AI retry/backoff + timeout diagnostics) |
| `lib/scraping/listing-scraper.ts` | **[MODIFY]** Added explicit status resolver for relevance outcomes to enforce `SKIPPED` on non-RE while preserving `IMPORTED/REJECTED` |
| `app/(main)/admin/settings/prospecting/_components/deep-runs-panel.tsx` | **[NEW]** Top-level Deep Runs monitoring panel with KPI summary, expandable stage logs, omission reasons, and metadata/error payload drill-down |
| `app/(main)/admin/settings/prospecting/_components/run-deep-scraper-button.tsx` | **[NEW]** Manual trigger button for Deep Scrape jobs |
| `app/api/admin/prospecting/deep-runs/stream/route.ts` | **[NEW]** SSE stream endpoint for live deep-run status, stage, and diagnostics snapshots |
| `app/api/admin/prospecting/deep-runs/diagnostics/route.ts` | **[NEW]** Admin diagnostics endpoint for worker heartbeat + queue depth + recent failures |
| `prisma/migrations/20260322113000_deep_scrape_orchestrator/migration.sql` | **[NEW]** Deep run history tables + status backfill (`REVIEWED -> REVIEWING`) |
| `prisma/migrations/20260322170000_deep_scrape_queued_startedat_backfill/migration.sql` | **[NEW]** Backfill queued deep runs so `startedAt` is null until worker transition to `running` |
| `lib/scraping/deep-scraper.ts` | **[LEGACY COMPATIBILITY]** Status transition kept compatible with triage/import lifecycle (`REVIEWING`), no longer primary deep orchestration path |
| `lib/queue/scraping-queue.ts` | **[NEW]** BullMQ queue/worker with trigger-context propagation, deep-run lifecycle correlation, shutdown safety, and heartbeat diagnostics |
| `instrumentation.ts` | **[MODIFY]** Queue bootstrap role-gated by `PROCESS_ROLE` to isolate web and scrape-worker runtimes |
| `scripts/start-scrape-worker.js` | **[NEW]** Headless scrape worker bootstrap (loads built instrumentation, initializes queue workers, no HTTP server binding) |
| `deploy-local-build.sh` | **[MODIFY]** Enforced production deploy path with unmanaged-process preflight guardrail, dedicated headless scrape-worker startup, and worker readiness gating |
| `deploy.sh` + `deploy-direct.sh` | **[MODIFY]** Marked unsupported for production (hard exit wrapper); use `deploy-local-build.sh` only |
| `lib/leads/scraped-listing-repository.ts` | **[NEW]** Repository for querying `ScrapedListing` records with prospect data joins |
| `app/(main)/admin/prospecting/layout.tsx` | **[NEW]** Shared layout with tab navigation between People and Listings Inbox |
| `app/(main)/admin/prospecting/listings/page.tsx` | **[NEW]** Listings Inbox page |
| `app/(main)/admin/prospecting/listings/actions.ts` | **[NEW]** Server actions for accept/reject/bulk operations on scraped listings |
| `app/(main)/admin/prospecting/listings/_components/scraped-listing-table.tsx` | **[NEW]** Interactive table with row-click drawer integration |
| `app/(main)/admin/prospecting/listings/_components/prospect-review-drawer.tsx` | **[NEW]** Side drawer with listing details, seller profile, and outreach actions |
| `lib/ai/prospect-classifier.ts` | **[NEW]** Reusable AI classifier service for Agency/Private detection with confidence scoring and ledger logging |
| `lib/ai/model-router.ts` | **[MODIFY]** Registers `"prospect_classification"` task mapping to Flash tier |
| `app/api/admin/scrape-listing/route.ts` | **[MODIFY]** Runs `classifyAndUpdateProspect()` after upsert during single-listing scrape |
| `app/(main)/admin/prospecting/_components/contact-detail-panel.tsx` | **[MODIFY]** Clickable Agency/Private/AI-Auto badge with confidence tooltip and manual override cycle |
| `app/(main)/admin/prospecting/actions.ts` | **[MODIFY]** Adds `toggleProspectAgencyStatus(id, isAgencyManual)` server action |
| `scripts/reclassify-scraped-listings.ts` | **[NEW]** One-time/operational remediation CLI to force reclassification and repair statuses for a run/date range (`--dry-run` / `--apply`) |
| `lib/scraping/listing-relevance-classifier.test.ts` | **[NEW]** Unit coverage for fail-closed uncertain handling and token-boundary matching |
| `lib/scraping/listing-scraper.relevance.test.ts` | **[NEW]** Unit coverage for status resolution safety (`NEW/REVIEWING -> SKIPPED`, preserve terminal statuses) |

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

### 3.1 Deep Scrape Orchestrator (Manual-First)

The deep path is now implemented as a **manual-first strategic orchestrator** driven by the `Run Deep Scrape` button. This replaced the old behavior that only deep-processed existing `NEW` inbox listings.

#### What Was Implemented

- **Primary trigger path:** `manualTriggerDeepScrape(locationId, limit?)` now creates `DeepScrapeRun` immediately as `queued`, then enqueues `type: "deep_scrape"` with `runId` and deep orchestration config snapshot.
- **Queue execution:** the scraping worker routes deep jobs to `DeepScrapeOrchestratorService.processLocation(locationId, { runId, ... })`.
- **Scope:** each deep run scans all **enabled `bazaraki` tasks with non-empty `targetUrls`**.
- **Per-task Run Now unchanged:** task-level manual runs still execute the normal task path for isolated debugging.
- **Lifecycle semantics:** deep runs now follow explicit state transitions: `queued -> running -> completed|partial|failed|cancelled`.

#### Reliability + Enterprise Observability Upgrade (Implemented)

This upgrade was implemented to remove production ambiguity where queue consumers could diverge across blue/green slots and to provide immediate operator feedback after clicking **Run Deep Scrape**.

##### Why

- During production diagnosis, deep jobs were successfully enqueued but UI visibility could lag or disappear when queue consumers were split across mixed process versions.
- The old model persisted deep runs only when worker execution started, so a successful enqueue could still show “nothing” in the dashboard until later.

##### What

- **Queued-first persistence contract:** deep run rows are created at click-time before enqueue.
- **Authoritative worker role isolation:** production web processes run with `PROCESS_ROLE=web`; scraping consumption runs in dedicated `PROCESS_ROLE=scrape-worker`.
- **Headless worker runtime:** scrape worker now boots queue consumers directly (`npm run start:scrape-worker`) instead of `next start`, eliminating HTTP port contention failure modes.
- **Graceful interruption handling:** active deep runs are marked `cancelled` on worker shutdown signals instead of being left ambiguous.
- **Structured heartbeat and queue diagnostics:** worker liveness, readiness, queue depth, and recent failed jobs are surfaced in admin diagnostics.
- **Realtime delivery:** deep-run monitoring now supports SSE live snapshots with polling fallback.
- **Immediate UI visibility:** optimistic queued card appears instantly after trigger; UI keeps refreshing while `queued|running`, including short burst refresh right after click.
- **Stale queued detection:** dashboard warns when queued runs exceed SLA window (worker unavailable/delayed signal).
- **Fail-safe deploy guardrails:** deploy preflight aborts on unmanaged Node/Next process drift for managed app paths/ports and never auto-kills unknown processes.
- **Post-start readiness gate:** deploy fails if scrape worker is not both PM2-online and heartbeat-ready.
- **Queue + warn trigger contract:** manual trigger still queues runs while returning immediate warning metadata when worker readiness is missing.
- **Lifecycle timestamp correction:** queued runs keep `startedAt = null` until queued->running transition.

##### Deep Scrape Reliability Fix: Headless Worker Refactor + Strict Deploy Guardrails (March 22, 2026)

After the first production trial of the upgraded flow, we observed a real deployment-time reliability gap and completed a hardening pass so the runtime contract is now deterministic.

**Observed production failure mode**
- Deep runs were queued, but worker startup was unstable across deploy boundaries.
- Preflight drift checks initially over-flagged healthy PM2-managed app listeners because `next-server` runs as child processes of PM2 parent PIDs.
- Worker bootstrap could fail on instrumentation import shape (`register()` available under CommonJS default export), which caused repeated worker restarts and readiness-gate failure.

**Implemented reliability hardening**
- **Headless worker bootstrap finalized:** `scripts/start-scrape-worker.js` now initializes queue workers without HTTP server binding, enforces `PROCESS_ROLE=scrape-worker`, and resolves instrumentation register via either `module.register` or `module.default.register`.
- **Strict deploy path governance:** production deploy is enforced through `deploy-local-build.sh`; `deploy.sh` and `deploy-direct.sh` are blocked for production usage.
- **Fail-safe unmanaged-process preflight:** deploy aborts before runtime switch when unmanaged Node/Next drift is detected on managed app paths/ports, with explicit PID/cwd/cmd/port diagnostics and manual remediation instructions (no auto-kill).
- **PM2 process lineage awareness:** preflight now includes PM2 descendant processes in the managed PID set, preventing false positives on healthy `next-server` child listeners.
- **Strict worker readiness gate:** deploy requires both PM2 `online` state and fresh Redis scrape-worker heartbeat before success.
- **Queue + warn UX contract maintained:** manual deep trigger remains queue-first and returns warning metadata when worker readiness is unavailable, so operators see immediate queued visibility plus delay warning.

**Operational outcome**
- Deploy now fails loudly and early on worker health/preflight violations, rather than completing with a dead or non-consuming scrape worker.
- Successful deploy confirms all three layers before completion: web health, traffic switch soak, and scrape-worker heartbeat readiness.

##### How

- `manualTriggerDeepScrape` now:
  - creates `DeepScrapeRun(status='queued')`
  - writes `run_queued` stage log
  - enqueues BullMQ deep job with `runId`
  - on enqueue failure, marks run `failed` and writes `run_enqueue_failed`
- `DeepScrapeOrchestratorService.processLocation` now:
  - accepts `runId`
  - transitions existing queued/in-flight run to `running`
  - preserves existing counters when resuming correlated run
  - writes terminal status safely without overriding externally terminalized runs
- `scraping-queue` worker now:
  - includes run correlation (`runId`, `jobId`, `locationId`, `triggeredByUserId`)
  - marks deep runs `failed` on unhandled worker-level failures
  - emits Redis heartbeat with worker identity and role
  - supports diagnostics reads for admin visibility

#### Why This Change Was Needed

The old deep flow did not guarantee execution from manually-added Bazaraki seed URLs at task level. The new orchestrator ensures deep scraping starts from configured task URLs, resolves seller contact context first, and only spends deep interaction budget where it is strategically valuable.

#### How The Strategic Deep Orchestration Works

For each eligible task, execution now follows explicit staged flow:

1. **Stage A: Seed crawl from configured target URLs**
   - Crawl paginated task URLs.
   - Build unique seed listing set (`externalId` dedupe).
2. **Stage B: Deep scrape each seed listing**
   - Extract richer listing details and attempt seller contact resolution.
3. **Stage C: Phone gate**
   - If no phone is resolved, omit and continue (`missing_phone`).
   - Seller/prospect dedupe lock is intentionally delayed until this gate passes, so another seed from the same seller can still attempt phone resolution within the same run.
4. **Stage D: Seller portfolio discovery**
   - If seller profile URL exists, crawl seller listings.
5. **Stage E: Seller classification**
   - Resolve `private | agency | uncertain` using confidence + manual override precedence.
6. **Stage F: Selective deep portfolio behavior**
   - `private`: deep scrape eligible portfolio listings.
   - `agency`: skip deep portfolio listings (`agency_skipped`).
   - `uncertain`: skip deep portfolio listings (`uncertain_skipped`).
7. **Stage G: Persistence and dedupe accounting**
   - Upsert listings/prospects, track duplicate and relevance outcomes, preserve interaction budgets.
   - Emit explicit stage diagnostics when relevance falls back fail-closed due to AI unavailability.
   - Trip a relevance circuit breaker on repeated fail-closed diagnostics and mark task/run degraded (`partial`) instead of continuing noisy uncertain intake.

This flow preserves listing-level uniqueness (`platform+externalId`) and seller-level dedupe keys, while allowing phone-resolution retries across same-seller seeds before contact gate lock-in. This keeps deep work deterministic and auditable without prematurely suppressing recoverable contacts.

#### Deep Run Monitoring History (Implemented)

Deep orchestration telemetry is now separated from task run telemetry:

- **`DeepScrapeRun`**: run lifecycle, trigger context, config snapshot, aggregate counters, status.
- **`DeepScrapeRunStage`**: stage-level structured logs per task, including counters, reason codes, and metadata payloads.

Run-level counters include:
- task scan/start/complete/skip counts
- URL/page/listing discovery metrics
- prospect create/match metrics
- phone gate metrics
- portfolio discovery/deep-scrape metrics
- omission totals by reason
- error totals by category

Implemented stage reason codes include:
- `agency_skipped`
- `uncertain_skipped`
- `missing_phone`
- `non_real_estate`
- `relevance_ai_unavailable`
- `duplicate_listing`
- `duplicate_contact`
- `interaction_budget_exhausted`
- `task_config_ineligible`
- `task_error`

Additional operational stages include:
- `worker_unavailable_warning` (run queued while no healthy scrape worker heartbeat is detected)
- `run_cancelled` (queued removal or cooperative active-stop request)

#### Monitoring UI and Read APIs

- A new top-level **Deep Runs** panel is available on `/admin/settings/prospecting`, separate from per-task run cards.
- The panel shows run status, duration, trigger source, KPI summary row, worker/queue diagnostics, and expandable stage logs with counters/reason codes/metadata.
- The panel now supports optimistic queued insertion, stale-queue warning, and live state transitions (`Queued`, `Starting`, `Running`, `Partial`, `Failed`, `Completed`, `Cancelled`).
- Manual cancellation uses reusable confirmation dialogs with status-aware messaging:
  - queued: remove from queue and mark run cancelled
  - running: cooperative cancel at next safe checkpoint
- Read APIs support:
  - deep run list (paged)
  - deep run details with stages
  - windowed deep KPI overview
  - realtime deep run stream (SSE snapshots)
  - queue/worker diagnostics summary

#### Manual Trigger + Worker Availability Contract

- Manual trigger checks worker readiness in UI and disables the trigger button when heartbeat is unavailable (`Worker Unavailable` state).
- Queueing still persists a `DeepScrapeRun` and can emit warning metadata when post-enqueue diagnostics show no healthy worker.
- Warning stage metadata includes `workerAlive`, `workerReady`, and `workerHeartbeatAgeSeconds` for immediate operator diagnosis.

#### Cancellation Semantics (Queued vs Active)

`cancelDeepScrapeRun(locationId, runId)` supports safe cancellation in both states:

1. **Queued run**
   - Attempts queue-job removal.
   - Marks run `cancelled` with completion timestamp.
   - Logs `run_cancelled` stage: "Run cancelled before worker execution began."
2. **Active run**
   - Queue removal may fail when state is `active`; cancellation switches to cooperative stop.
   - Marks run `cancelled` and records cancellation metadata.
   - Worker halts at next safe checkpoint and logs terminal cancellation outcome.

Cancellation metadata is persisted in run `metadata.cancellation` (request time, actor, queue result, mode), and an explicit manual-cancel note is appended to `errorLog` for forensic traceability.

#### Status Compatibility and Backfill

- Deep lifecycle now uses actionable inbox statuses (`NEW/REVIEWING/IMPORTED/REJECTED/SKIPPED`) without `REVIEWED`.
- A one-time backfill migration converts existing `ScrapedListing.status = REVIEWED` to `REVIEWING`.
- A one-time backfill migration clears `DeepScrapeRun.startedAt` for legacy queued rows created before queued-first timestamp fix.
- This keeps import/triage queries congruent with deep-processed pending records.

#### Relevance Hardening & Run-17 Remediation (March 2026)

Following production analysis of deep run `cmn27e7z80007a4c5hb95lutu` (job `17`), a targeted hardening/remediation pass was implemented.

**Observed issue**
- A small set of obvious non-real-estate items (e.g. lighting/headset/fridge listings) entered `NEW`.
- Root cause: uncertain relevance outcomes could resolve permissively when AI classification was unavailable.

**Implemented fix set**
- Relevance classifier upgraded to **`v2`**:
  - uncertain path is now **fail-closed** (`non_real_estate`) when AI is unavailable/invalid after retries
  - deterministic term matching uses boundary-aware matching (prevents substring collisions such as `cargo` → `car`)
  - AI relevance calls use bounded retry/backoff + timeout and persist diagnostic metadata
- Classifier contract updated for remediation workflows:
  - `classifyListingRelevance(listing, existingRawAttributes, { forceReclassify?: boolean })`
  - force refresh bypasses cached `v1`/stale outcomes so run-level cleanup can be applied deterministically
- Persisted relevance metadata now includes diagnostics:
  - `System listing relevance diagnostic code`
  - `System listing relevance ai attempted`
  - `System listing relevance ai attempts`
- Deep orchestrator now:
  - logs fail-closed relevance diagnostics into stage telemetry
  - emits `relevance_ai_unavailable` reason code for visibility
  - trips a small circuit breaker on repeated relevance fail-closed events to avoid degraded noisy continuation
- Listing persistence logic now centralizes status resolution to guarantee non-RE rows remain `SKIPPED` while preserving terminal business statuses (`IMPORTED`, `REJECTED`).

**Operational remediation**
- Added CLI: `npm run prospecting:reclassify -- --locationId <id> --runId <deepRunId> --dry-run|--apply`
- Run-17 remediation executed with dry-run then apply:
  - `scanned: 503`
  - `statusChanged: 24` (to `SKIPPED`)
  - final window state: `NEW: 478`, `SKIPPED: 25`
  - relevance metadata standardized to `v2` for all 503 rows in that run window.

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

  // Metadata & Dynamic Features
  rawAttributes  Json?    // All key-value pairs from chars-column (Schema-on-read)

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

### 3.4 AI-Based Agency/Private Classification with Manual Override

Classification has been upgraded from simple keyword checks to a reusable AI service with manual control in the Prospecting UI.

> [!IMPORTANT]
> Classification runs automatically during both single-listing scrape and deep scrape. It uses the existing Flash-tier routing (`callLLMWithMetadata` + `model-router`) with low per-call cost characteristics (roughly Gemini Flash pricing, around `$0.00005` per classification).

> [!IMPORTANT]
> Manual override always wins over AI. Implemented confidence threshold is `>= 70` for auto-classification; below that, the UI presents the seller as uncertain/unclassified for human review.

#### Prospect Classifier Service

**File:** `lib/ai/prospect-classifier.ts`

The classifier evaluates multiple signals in one pass:
- **Name signals**: "Properties", "Real Estate", "Developers", "Group", "Ltd", and other company markers.
- **Description signals**: Corporate language, portfolio/team phrasing, organizational tone.
- **Profile/contact signals**: Presence of profile URL, contact channels, and `author_business__wrapper` business profile fields (verified, website, address, business description).
- **Activity signals**: Listing count context (higher volume increases agency likelihood).
- **Registration signals**: Platform text patterns indicating "Company" vs individual.

Return payload:
```ts
{
  isAgency: boolean;
  confidenceScore: number; // 0-100
  reasoning: string;
}
```

The service writes classification telemetry to the enterprise ledger via `AgentExecution` with:
- `sourceType: "scraper"`
- `skillName: "prospect_classifier"`

#### Backend Integration (Implemented)

| File | Change |
|---|---|
| `lib/scraping/deep-scraper.ts` | Replaced inline classification logic with `classifyAndUpdateProspect()`, passing enriched signals (name, description, listing count, registration, profile URL). |
| `lib/scraping/extractors/bazaraki.ts` | Seller-type filtering/classification path documented as AI-backed to improve agency/private accuracy over naive keyword-only checks. |
| `app/api/admin/scrape-listing/route.ts` | After upserting prospect/listing, runs classifier and updates `isAgency` + `agencyConfidence` (+ reasoning) on `ProspectLead`. |
| `lib/leads/agency-company-linker.ts` | Stages agency profile + Company match candidate in `ProspectLead.aiScoreBreakdown.strategicScrape` before CRM import. |
| `lib/ai/model-router.ts` | Added `"prospect_classification": "flash"` in `TASK_TIER_MAP` for cost-efficient routing. |

#### Database Schema Additions (ProspectLead)

```prisma
agencyConfidence  Int?     // 0-100 AI confidence score
agencyReasoning   String?  // 1-2 sentence AI explanation for auditability/tooltips
isAgencyManual    Boolean? // null = AI-decided, true/false = human override
```

Resolution logic:

```ts
effectiveIsAgency = isAgencyManual ?? (agencyConfidence >= 70 ? isAgency : null)
```

#### Manual Toggle UI

**Files:**  
- `app/(main)/admin/prospecting/_components/contact-detail-panel.tsx`  
- `app/(main)/admin/prospecting/actions.ts`

The badge is now interactive and cycles:
1. **Private** (`isAgencyManual = false`) — green badge, `UserCheck`
2. **Agency** (`isAgencyManual = true`) — red badge, `Building2`
3. **AI Auto** (`isAgencyManual = null`) — bot-driven mode, `Bot` icon

Tooltip surfaces model confidence/reasoning (for example: `AI Confidence: 85%`).

Server action:
- `toggleProspectAgencyStatus(id: string, isAgencyManual: boolean | null)`
- When the resulting effective state is Agency, the action now stages `agencyProfile/companyMatch` immediately so Link As Company options are pre-populated without waiting for reclassification.

### 3.5 Company Congruence Stage (Pre-Import)

To keep Strategic Scraping congruent with existing CRM entities, agency seller profiles are now staged against the existing `Company` model *before* acceptance/import:

1. During classification, we derive a normalized agency profile from scraped metadata (`author_business__wrapper` + prospect fields).
2. We run deterministic Company matching in this order:
   - Website host equality (highest confidence)
   - Exact name match (case-insensitive, location-scoped)
   - Phone overlap
   - Email equality
3. We persist staging output under:
   - `ProspectLead.aiScoreBreakdown.strategicScrape.agencyProfile`
   - `ProspectLead.aiScoreBreakdown.strategicScrape.companyMatch`
4. Via explicit Prospecting action **"Link As Company"** (no Prospect acceptance):
   - Upsert/Create `Company` with `type = "Agency"`
   - Persist link metadata in `aiScoreBreakdown.strategicScrape.companyLink`
   - Keep Prospect in prospecting workflow (`new/reviewing`) for cold outreach follow-up
5. Acceptance path guardrails (implemented):
   - `acceptProspect`, `acceptProspectWithListings`, and `acceptScrapedListing` now enforce **private-only** acceptance.
   - Agency records are intentionally blocked from acceptance and instead routed to **Link As Company**.

This mirrors the existing Prospect staging pattern while adding a Company-first track for agency sellers.

#### 3.5.1 Link As Company Decision Flow (Implemented)

`Link As Company` should behave as a deterministic decision assistant, not as a blind create action.

1. User clicks **Link As Company**.
2. Backend computes candidate companies using normalized evidence:
   - Website host equality (highest trust)
   - Exact name equality (location-scoped)
   - Phone overlap
   - Email equality
   - Similar-name fallback (tokenized/fuzzy, lower trust)
3. Actions and response contracts:
   - `getProspectCompanyLinkOptions(prospectId)` returns:
     - `linkable`, `reason`
     - `agencyProfile`
     - `candidates[]`
     - `suggestedMode`, `suggestedCompanyId`
   - `applyProspectCompanyLink(prospectId, selection)` applies explicit selection:
     - `{ mode: "existing", companyId }`
     - `{ mode: "create", profileOverrides? }`
   - Compatibility wrapper `linkProspectAgencyCompany(prospectId)` now auto-links only when there is exactly one high-confidence candidate; otherwise it returns structured `code: "selection_required"`.
4. UI branches (implemented in both Properties and Contacts detail panels via shared dialog):
   - **Exactly 1 high-confidence match:** preselected existing company with explicit confirmation.
   - **Multiple plausible matches:** ranked options + confidence/evidence, explicit user selection required.
   - **No plausible match:** prefilled `Create New Company` form.
5. On completion, persist and surface durable state:
   - Store selected/created link in `aiScoreBreakdown.strategicScrape.companyLink`
   - Show persistent status badge in both Prospecting views:
     - `Company Linked: <name>` (click-through to company profile)
     - Button label changes to `Refresh Company Link` / `Change Link`
6. Guardrails and duplicate safety:
   - Linkability is status-gated with case-tolerant checks (`new/reviewing`, including uppercase variants).
   - Properties view now uses `prospectStatus` from listing row data for button enablement (instead of listing status only).
   - Create mode executes a transactional deterministic conflict re-check and reuses existing Company when exact website/email/phone/name conflicts are found.
7. Keep the prospect in prospecting (`new/reviewing`) for outreach, with acceptance still blocked for agencies.

This pattern reduces wrong links, prevents duplicate company creation, and gives users confidence that the action actually persisted.

> [!IMPORTANT]
> Current workflow policy: **Prospect acceptance is private-only**. Agency prospects are handled via outreach and explicit **"Link As Company"** action in Prospecting, without accepting/creating a CRM Contact.

Feed card behavior:
- In `ContactFeedCard`, AI-classified prospects render with a `Bot` icon, while manually set values render with the standard `Building2`/`UserCheck` icon path.

#### Manual Verification Checklist (Classification)

1. Deploy and open `/admin/prospecting` in **Contacts** view.
2. Scrape a new Bazaraki listing and verify stream/log includes a classification step.
3. Confirm badge state renders correctly as Agency / Private / Unclassified based on confidence.
4. Click the badge repeatedly and verify cycle order:
   - Private → Agency → AI Auto
5. Refresh and confirm override persists.
6. Scrape a known agency listing (e.g., "Cyprus Golden Properties") and verify high-confidence Agency classification.
7. Scrape a likely private listing and verify Private classification (or low-confidence Unclassified requiring human choice).
8. Mark a prospect as Agency and verify:
   - Accept actions are disabled/blocked.
   - **Link As Company** is available and succeeds.
   - Link button is disabled for non-linkable prospect statuses (accepted/rejected/archived).
   - Post-link state is visible and durable in both Properties and Contacts detail panels (`Company Linked: ...`).
   - No CRM Contact is created from acceptance for agency prospects.

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

### 4.3 Deep Detail Panels & Optimistic UI

Both detail panels contain dedicated action bars and tailored content views:

- **High-Res Photo Gallery:** The `images` array is exclusively used for the main property viewer to ensure agents see high-quality, zoomable photos, while the `thumbnails` array powers the carousel strip and multi-property feed cards to preserve network and layout performance.
- **Panel-Bounded Media Viewport:** Gallery surfaces are now constrained by strict panel sizing (`min-h-0` on parent flex/grid containers + `overflow-hidden` on the frame) so tall assets cannot bleed outside the top/bottom card boundary.
- **Portrait-Safe Rendering + Internal Scroll:** On image load, the UI checks orientation (`naturalHeight > naturalWidth`). Portrait images are rendered top-aligned in a dedicated internal scroll viewport (`overflow-y-auto`, `overflow-x-hidden`, `w-full h-auto`) so the operator can inspect the full vertical photo without breaking the layout. Landscape images remain centered with `object-contain` for consistent framing.
- **Action Outbound:** Pre-filled WhatsApp deep links and direct Call links.
- **Dynamic Feature Extraction:** Scraped listings utilize a schema-on-read JSON field (`rawAttributes`) to capture all non-standard property features (e.g., "Pets allowed", "Energy class"). These are rendered dynamically as badges in the Detail Panel and explicitly mapped to the core CRM `Property.features` array upon lead conversion, ensuring zero data loss.
- **Agency/Private Override Toggle:** The seller badge is clickable and cycles `Private → Agency → AI Auto`, with manual override stored in `isAgencyManual` and confidence/reasoning exposed via tooltip.
- **Optimistic UI Data Binding:** Following Enterprise SaaS best practices, detail panels do not wait for hard page refreshes after asynchronous events. When a `ScrapeListingDialog` finishes extracting data, the backend immediately returns the resolved `prospectLeadId` and `prospectName`. The detail panel intercepts this payload and applies a local optimistic state update, instantly revealing the seller's true identity and unmasking the Accept/Convert buttons without a network waterfall.
- **Scrape Other Listings:** A dedicated `DownloadCloud` button dispatches a background task (`scrapeSellerProfile`) that crawls the seller portfolio in shallow mode first, classifies each listing for relevance, and deep-scrapes only real-estate listings. Non-real-estate rows are persisted as `SKIPPED` with cached relevance metadata. Uncertain relevance decisions are fail-closed when AI is unavailable, and deep-run telemetry includes explicit diagnostics/reason codes for that path. The button is prominently available in both the Properties View and Contacts View. *(Note: When a single listing is scraped or re-scraped, the backend `scrape-listing` service automatically extracts and syncs this `profileUrl` directly to the `ProspectLead` record, ensuring this button is actionable immediately without needing to visit the contact card).*

### 4.4 Cascading Decide Actions & Keyboard Accessibility

Triage speed is maximized through keyboard shortcuts and cascading transactions:

- **Keyboard Flow:** Navigate feeds using `↑` & `↓` (which live-updates the URL).
- **One-Key Decisions:** Press `A` to Accept/Import; press `R` to Reject.

**Cascading Effect:**
- In the **Properties View**, Accept/Import applies only to the selected `$1` listing, marking it as `IMPORTED` and linking it to a newly created CRM Property via `importedPropertyId`.
- In the **Contacts View**, Accept/Reject still uses cascading actions (`acceptProspectWithListings` / `rejectProspectWithListings`) but with role-aware enforcement:
  - **Private prospects:** Accept creates a CRM Contact and imports their new listings.
  - **Agency prospects:** Accept is blocked by policy; users must use **Link As Company** to stage/create CRM Company congruence without contact acceptance.
  - Reject continues to cascade across the seller's newly scraped listings.
- **Deleting Prospects:** For corrupted or invalid leads, the UI provides a "Delete Prospect" action (`Trash2`). This permanently removes the `ProspectLead` and uses Prisma's `SetNull` to automatically unlink and reset any erroneously associated `ScrapedListing` records so they safely return to the generic `New` queue for re-triage.

### 4.5 Explicit State Filtering (Scope)

To maintain an actionable layout and prevent a cluttered "All" view, the Feed provides explicit state filtering dropdowns at the top of the feed structure:

- **New (Default):** Displays only pending items (`NEW`/`REVIEWING` status). This acts as the triage inbox.
- **Accepted:** Displays items successfully converted to the CRM (`IMPORTED` listings, `accepted` contacts).
- **Rejected:** Displays explicitly discarded items (`REJECTED` listings, `rejected` contacts), allowing recovery.
- **All:** An unfiltered view across all terminal states.

By splitting these views natively at the repository layer, Sales teams can focus exclusively on the actionable `New` queue while retaining audited historical access to explicit queues, following standard Enterprise workflow patterns.

### 4.6 Bulk Actions

For high-volume review, the feed supports Bulk Mode. Checking the box on any feed card swaps the standard header for a Bulk Action Bar, exposing one-click APIs to batch Import or Reject large segments of selected items based on the active view.
