# XML Feed Integration

This document describes the current XML feed pipeline used to ingest external listings into IDX.

## Overview

Admins configure feeds per company from the Company UI. Feeds are parsed and synchronized into `Property` records with:

- `source: "FEED"`
- `publicationStatus: "PENDING"` (staging by default)
- `status: "ACTIVE"`

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
     - Existing record update currently updates `price` and `feedHash` only.
     - New record create sets `source: "FEED"`, `publicationStatus: "PENDING"`, and links seller company role.
   - `lastSyncAt` is updated after each successful feed run.

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

- Filters: Properties UI supports source filter with `FEED` label "XML Feed".
- Recommended workflow:
  1. Filter by `Source: XML Feed` and publication `Pending`
  2. Review/clean imported data
  3. Publish approved properties

## Adding Support for a New Feed Format

1. Add/confirm enum value in `FeedFormat` in `prisma/schema.prisma`.
2. Implement parser class in `lib/feed/parsers/` implementing `FeedParser`.
3. Update `FeedService.getParser()` to return the new parser for that format.
4. Update feed wizard/save flow if format selection should be exposed in UI (currently saved as `GENERIC`).

## Notes and Known Behavior

- Feed sync is independent from Paste Lead import; Paste Lead does not create `Property` rows directly.
- Placeholder artifacts like `unknown-<timestamp>` slug can happen if malformed rows pass mapping; current guardrails now skip those rows at sync time.
