# XML Feed Integration

This document describes the current XML feed pipeline used to ingest external listings into IDX.

## Overview

Admins configure feeds per company from the Company UI. Feeds are parsed and synchronized into `Property` records with:

- `source: "FEED"`
- `publicationStatus: "PENDING"` (staging by default)
- `status: "ACTIVE"`
- `metadata.feedSync` JSON timestamps/status (property-level sync metadata; see below)

The sync process now includes guardrails to prevent placeholder/invalid properties (for example empty titles or `unknown` external IDs).

## End-to-End Flow

1. Admin opens feed wizard in `app/(main)/admin/companies/_components/feed-manager.tsx`.
2. Wizard analyzes XML via `POST /api/feed/analyze`.
3. Wizard lets admin adjust field mapping and preview via `POST /api/feed/preview`.
4. Wizard saves feed with `mappingConfig` JSON via `addFeed` server action.
5. Sync runs via `GET /api/cron/sync-feeds` (all feeds) or `GET /api/cron/sync-feeds?companyId=<id>`.
6. `FeedService.syncFeed()` fetches, parses, validates, and upserts records.

## Architecture

### Database Schema

Defined in `prisma/schema.prisma`.

- `PropertyFeed`
  - `companyId`, `url`, `format`, `mappingConfig`, `lastSyncAt`, `isActive`
  - `format` enum values exist for `GENERIC`, `ALTIA`, `KYERO`
  - Current runtime parser is `GenericXmlParser` for all formats (see notes below)

- `Property` feed fields
  - `feedId`, `feedReferenceId`, `feedHash`
  - Unique key: `@@unique([feedId, feedReferenceId])`

### Services & Parsing logic

Located in `lib/feed/`:

1. `FeedService` (`lib/feed/feed-service.ts`)
   - `syncFeed(feedId)` fetches XML, parses feed items, and syncs each row.
   - Guardrails before create/update:
     - Skip item if `title` is empty.
     - Skip item if `externalId` is empty or equals `unknown`.
   - Change detection:
     - Item hash = `base64(JSON.stringify(item))`.
     - If hash unchanged, item is skipped.
   - Upsert behavior:
     - Match existing record by composite key (`feedId`, `feedReferenceId`).
     - Existing record with changed hash updates `price`, `feedHash`, and `metadata.feedSync`.
     - Existing record with unchanged hash is still updated to refresh `metadata.feedSync.lastSeenAt` / status (`UNCHANGED`).
     - New record create sets `source: "FEED"`, `publicationStatus: "PENDING"`, and links seller company role.
     - New record create also initializes `metadata.feedSync` with status `CREATED`.
   - `lastSyncAt` is updated after each successful feed run.
   - Current implementation note:
     - Because unchanged rows are updated to refresh sync metadata, Prisma `updatedAt` also advances on sync.

2. `GenericXmlParser` (`lib/feed/parsers/generic-xml-parser.ts`)
   - Supports strict mapping mode (`mappingConfig`) and heuristic mode.
   - Root resolution:
     - Uses configured `rootPath` first.
     - Falls back to checking inside root node if needed.
   - Field resolution:
     - Supports absolute-like paths by progressively stripping leading segments.
     - Converts object values such as `{ "#text": ... }` to scalar strings (important for RSS `<guid>`).
   - Heuristic defaults include fallback extraction for id/title/description/price/images.

3. `AiFeedMapper` (`lib/feed/ai-mapper.ts`)
   - Gemini-based mapping suggestion for `rootPath` and field paths.
   - Used by wizard analyze endpoint.

### Cron Integration

- Route: `app/api/cron/sync-feeds/route.ts`
- Behavior:
  - Fetches active feeds (`isActive = true`)
  - Optional filter by `companyId`
  - Calls `FeedService.syncFeed(feed.id)` sequentially
  - Returns per-feed result summary
- Current note:
  - This route currently has no explicit `CRON_SECRET` guard in code.

## Admin Interface

### Feed Management

Admins can manage feeds directly from the Company Edit dialog:
- Component: `app/(main)/admin/companies/_components/feed-manager.tsx`
- Actions:
  - Add Feed (opens wizard)
  - Delete Feed
  - Pause/Resume Feed (`isActive`)
  - Sync All (calls `/api/cron/sync-feeds?companyId=...`)

### Feed Wizard

Wizard component: `app/(main)/admin/companies/_components/feed-builder/feed-wizard.tsx`

1. Analyze
   - Calls `POST /api/feed/analyze`
   - Fetches XML and runs AI mapper
   - Also discovers available XML paths for manual mapping UI
2. Map
   - Admin can adjust `rootPath` and field mappings
3. Preview
   - Calls `POST /api/feed/preview` and shows first items parsed by current mapping
4. Save
   - Persists feed with `format: "GENERIC"` and `mappingConfig`

Important: although `FeedFormat` enum includes `ALTIA` and `KYERO`, current wizard save path uses `GENERIC`.

### Property Review

Implemented review surfaces:

- `/admin/properties`
  - Includes `Views` tabs: `Inventory`, `Feed Inbox`, `Feed Managed`, `All`
  - `Inventory` is the default and hides feed imports that are still `source=FEED` + `publicationStatus=PENDING`
  - Property table now shows a visible `Source` badge (including `XML Feed`)
- `/admin/properties/feed-inbox` (dedicated review queue)
  - Feed-specific filters (`feedId`, queue mode, missing fields, listing status, publication status)
  - Row + bulk triage actions (`Publish`, `Publish as Draft`, `Mark Pending`, `Withdraw`)

## Adding Support for a New Feed Format

1. Add/confirm enum value in `FeedFormat` in `prisma/schema.prisma`.
2. Implement parser class in `lib/feed/parsers/` implementing `FeedParser`.
3. Update `FeedService.getParser()` to return the new parser for that format.
4. Update feed wizard/save flow if format selection should be exposed in UI (currently saved as `GENERIC`).

## Notes and Known Behavior

- Feed sync is independent from Paste Lead import; Paste Lead does not create `Property` rows directly.
- Placeholder artifacts like `unknown-<timestamp>` slug can happen if malformed rows pass mapping; current guardrails now skip those rows at sync time.

## Admin UX Recommendation for `/admin/properties`

> [!NOTE]
> The Phase 1 and Phase 2 recommendations below are now implemented in code. Remaining items in this section are roadmap/backlog (mainly workflow hardening and richer sync lifecycle handling).

### Problem (Current State)

Feed-imported properties are stored as normal `Property` rows and currently appear in the same default list as manual/accepted listings. This is technically correct (they are real records), but it does not scale well operationally when multiple XML feeds are enabled.

Current mitigations exist, but are not enough on their own:

- `source = "FEED"` is available for filtering.
- new feed items default to `publicationStatus = "PENDING"` (staging behavior).

However, the current Properties page still defaults to a mixed list, which increases noise for agents trying to find active inventory quickly.

### Recommended Pattern (Industry-Standard Approach)

Use a **two-surface model**:

1. **Inventory view (default)**
   - Main `/admin/properties` page optimized for day-to-day property search and editing.
   - Should not be cluttered by newly imported feed records awaiting review.

2. **Feed Inbox / Feed Review view**
   - Dedicated view/page for XML-origin properties that need triage/review/approval.
   - Optimized for bulk review, feed filtering, and import-specific states.

Important: once a feed property is reviewed/published, it remains a normal property and should still be discoverable in the main inventory. The key is to move the **review workload** out of the default list, not to permanently silo feed-managed listings.

### Recommended UX for Estio

#### Option A (Implemented) - Preset Views on `/admin/properties`

Add top-level tabs or segmented views:

- `Inventory` (default)
  - Excludes feed imports awaiting review (initially: `source=FEED AND publicationStatus=PENDING`)
- `Feed Inbox`
  - Defaults to `source=FEED`, `publicationStatus=PENDING`
- `Feed Managed`
  - Defaults to `source=FEED` (all feed-origin listings, including published)
- `All`
  - Everything (existing behavior)

Implemented as URL-backed presets (`view=inventory|feed-inbox|feed-managed|all`).

#### Option B (Implemented) - Dedicated Page

Create a dedicated page such as:

- `/admin/properties/feed-inbox`

Benefits:

- Keeps the main Properties page focused for agents.
- Allows feed-specific UX without overloading the general list.
- Scales better when multiple feeds are active (per-feed counts, sync issues, bulk actions).

Implemented at `/admin/properties/feed-inbox`, using a dedicated repository/query layer while coexisting with the main properties list.

### What to Show in the Feed Inbox

#### Currently Implemented

Columns:

- Selection checkbox (bulk triage)
- `Feed` (company + feed hostname/url)
- `External ID` (`feedReferenceId`)
- `Title`
- `Missing` badges (currently derived from price/location/images presence)
- `Status`
- `Publication`
- `Sync` (from `metadata.feedSync.status`: `CREATED`, `UPDATED`, `UNCHANGED`)
- `Price`
- `Images`
- `Last Seen` (from `metadata.feedSync.lastSeenAt`)
- `Actions` (`Publish`, `Withdraw`, open property page)

Filters:

- Queue scope (`needs-review` or `all-feed`)
- Feed source (`feedId`)
- Missing fields (`any_critical`, `no_price`, `no_description`, `no_location`, `no_images`)
- Listing status
- Publication status (manual publication filter disabled while queue is `needs-review`)
- Text search (`title`, `slug`, `reference`, `feedReferenceId`)

Bulk actions:

- `Publish Selected` (`publicationStatus = PUBLISHED`)
- `Publish as Draft` (`publicationStatus = DRAFT`)
- `Mark Pending` (`publicationStatus = PENDING`)
- `Withdraw` (`status = WITHDRAWN`, `publicationStatus = UNLISTED`)

#### Planned Enhancements (Backlog)

- Changed-since-last-review filter (requires review metadata)
- Reviewer assignment / review ownership
- Bulk edit / approve-with-field-normalization workflows

### Data Model and Workflow Improvements (Implemented + Recommended)

The current implementation uses `publicationStatus = PENDING` as the review signal. This works initially, but mixes listing publication workflow with import-review workflow.

Implemented now (without Prisma schema changes):

- Property-level feed sync metadata stored in `Property.metadata.feedSync`:
  - `status` (`CREATED`, `UPDATED`, `UNCHANGED`)
  - `lastSeenAt`
  - `lastSyncedAt`
  - `lastChangedAt` (set on create/update)

Recommended next additions (schema-backed, phase 3+):

- Separate import review state on `Property` (example enum):
  - `PENDING_REVIEW`
  - `REVIEWED`
  - `REJECTED`
  - `AUTO_APPROVED` (optional)
- Feed sync metadata as first-class columns (instead of JSON only):
  - `feedLastSeenAt`
  - `feedLastSyncedAt`
  - `feedSyncStatus` (e.g. `SYNCED`, `UPDATED`, `REMOVED_FROM_FEED`, `ERROR`)
- Review metadata:
  - `reviewedAt`
  - `reviewedById`

This separation makes the UI much clearer:

- Listing status answers "what is the market status?"
- Publication status answers "is it visible on site/CRM?"
- Import review state answers "has an agent reviewed this imported record?"

### Query / UI Changes in Current Codebase (Implemented + Pending)

#### 1. Add view presets (Implemented)

In `app/(main)/admin/properties/page.tsx` + `lib/properties/repository.ts`:

- Implemented `view` query param (`inventory`, `feed-inbox`, `feed-managed`, `all`)
- `listProperties()` applies preset filtering, with `inventory` defaulting to hide pending feed imports
- Existing filters remain available on top of the preset

#### 2. Make feed provenance visible in the table (Implemented)

In `components/properties/property-table.tsx`:

- Main properties table now shows a `Source` badge column (desktop) and inline source badge (smaller screens)
- Feed inbox table shows feed label/URL and `feedReferenceId`

Without visible provenance, agents must open filters to understand why a record is present.

#### 3. Add feed-specific filters (Implemented in Feed Inbox)

Implemented in the dedicated feed inbox path using `lib/properties/feed-inbox-repository.ts` and feed inbox UI components:

- `feedId` filter support
- Queue scope (`needs-review` / `all-feed`)
- Missing-fields filters and feed-focused search

#### 4. Fix filter semantics / naming drift (Implemented)

The current UI labels the `source` filter as **Created By**, but the repository applies it to the `Property.source` field and XML feed filtering depends on `source = FEED`.

- Main properties filter label is now `Source`
- XML feed filtering remains clearly labeled as `XML Feed`

#### 5. Improve sorting for review workflows (Partially Implemented / Pending)

Current state:

- Main properties list still defaults to `createdAt desc`
- Feed inbox list defaults to `updatedAt desc`

Recommended additions:

- `last imported desc`
- `last updated desc`
- `needs review first`
- `feed name`

### Feed Sync Behavior Improvements (Backlog)

Implemented recently:

- Property-level sync metadata is now persisted in `Property.metadata.feedSync`
- Feed inbox surfaces sync status and `Last Seen` using that metadata

Remaining backlog:

- Update more business fields than `price` on existing records (currently business updates are still mostly `price` + `feedHash`; metadata is now also updated)
- Track removed feed items and mark as `WITHDRAWN` or equivalent instead of leaving stale active listings
- Persist per-feed sync summaries (created/updated/skipped/errors) for admin visibility
- Secure cron route with a secret/auth check

## Documentation Improvement Plan for This File

To keep this document useful as the XML feature grows, evolve it from "pipeline notes" into an operational + product spec.

### Proposed Structure (Next Revision)

1. **Purpose & Scope**
   - What this doc covers (feed ingestion + review UX + operations)
2. **Current Architecture**
   - Parser, sync, schema, cron, wizard (existing content)
3. **Current Limitations**
   - Mixed property list, minimal update behavior, no feed inbox, no sync audit history
4. **Target UX**
   - Inventory vs Feed Inbox model, default views, filters, bulk actions
5. **Data Model Changes**
   - Review state, sync metadata, optional audit table
6. **Implementation Phases**
   - Phase 1 presets, Phase 2 feed inbox page, Phase 3 review state/sync improvements
7. **Acceptance Criteria**
   - Agent can find manual inventory quickly
   - Agent can review imported listings without clutter
   - Multiple feeds remain manageable
8. **Operational Runbook**
   - How to sync, re-sync, pause feeds, troubleshoot failed imports

### Suggested Delivery Phases

#### Phase 1 (Implemented)

- Add preset views/tabs on `/admin/properties`
- Default to `Inventory` view (hide pending feed imports from default list)
- Add visible source badge in table
- Fix `source` filter labeling

#### Phase 2 (Implemented)

- Build `/admin/properties/feed-inbox`
- Add feed-specific filters (`feedId`, "needs review", missing fields)
- Add bulk actions for review/publish/withdraw
- Add bulk `Publish as Draft`
- Surface sync status / `Last Seen` in feed inbox (using `metadata.feedSync`)

#### Phase 3 (Operational Hardening)

- Add dedicated import review state and review metadata
- Expand feed sync update behavior beyond price-only updates
- Track removed feed items and sync issues
- Add cron auth and sync history visibility
