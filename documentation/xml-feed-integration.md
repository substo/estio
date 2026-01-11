# XML Feed Integration

This document outlines the architecture and implementation of the XML Feed Integration system, designed to ingest property listings from external partners (developers, agencies) into the IDX platform.

## Overview

The system allows administrators to configure XML feed URLs for specific companies. A background service fetches, parses, and synchronizes these feeds, creating properties in a `PENDING` state for admin review.

## Architecture

### Database Schema

The integration introduces a new `PropertyFeed` model and updates existing models in `prisma/schema.prisma`.

*   **`PropertyFeed`**:
    *   `id`: Unique identifier.
    *   `companyId`: Relation to the `Company` providing the feed.
    *   `url`: The HTTP endpoint of the XML feed.
    *   `format`: Enum (`GENERIC`, `ALTIA`, `KYERO`) to select the parsing strategy.
    *   `lastSyncAt`: Timestamp of the last successful sync.
    *   `isActive`: Boolean flag to enable/disable the feed.

*   **`Property` Updates**:
    *   `feedId`: Link to the source feed.
    *   `feedReferenceId`: The unique ID of the property *within* the external feed.
    *   `feedHash`: A hash of the raw feed item data, used to detect changes and avoid unnecessary updates.
    *   `publicationStatus`: Default is `PENDING` for new feed items.

### Services & Parsing logic

Located in `lib/feed/`:

1.  **`FeedService` (`feed-service.ts`)**:
    *   **`syncFeed(feedId)`**: The main orchestrator. Fetches XML, parses it, and iterates through items.
    *   **Change Detection**: Calculates a hash of the incoming item. If it matches the stored `feedHash` logic for an existing property, the update is skipped.
    *   **Staging**: New properties are always created with `publicationStatus: 'PENDING'`.
    *   **Updates**: Updates to existing properties preserve the current `publicationStatus` (preventing accidental publishing or unpublishing).

2.  **Parsers (`lib/feed/parsers/`)**:
    *   **`FeedParser` Interface**: Defines the contract (`parse(content: string): Promise<FeedItem[]>`).
    *   **`GenericXmlParser`**: A robust, heuristic-based parser using `fast-xml-parser`. It handles various XML structures by aggregating generic list tags (`<property>`, `<listing>`, `<item>`) and mapping common fields (price, title, images).
    *   **Extensibility**: New parsers (e.g., specific to Kyero or Altia custom formats) can be added by implementing the interface and registering them in the `FeedFormat` enum and factory logic.

### Cron Integration

*   **Route**: `app/api/cron/sync-feeds/route.ts`
*   **Function**: Iterates through all active listings in `PropertyFeed` and calls `FeedService.syncFeed()` for each.
*   **Usage**: Can be triggered manually or via a cron scheduler (e.g., Vercel Cron, GitHub Actions).

## Admin Interface

### Feed Management

Admins can manage feeds directly from the Company Edit dialog:
*   **Component**: `app/(main)/admin/companies/_components/feed-manager.tsx`
*   **Actions**:
    *   **Add Feed**: Input URL and select format.
    *   **Delete**: Remove a feed configuration.
    *   **Sync Now**: Manually trigger synchronization for immediate feedback.

### Property Review

*   **Filters**: The Properties page (`app/(main)/admin/properties/page.tsx`) includes a filter for `Source: XML Feed`.
*   **Workflow**:
    1.  Filter by `Source: XML Feed` and `Status: Pending`.
    2.  Review imported details.
    3.  Change status to `Published` to go live.

## Adding Support for a New Feed Format

1.  **Update Schema**: Add the new format key to the `FeedFormat` enum in `schema.prisma`.
2.  **Create Parser**: Implement a new class in `lib/feed/parsers/` (e.g., `KyeroParser`) implementing `FeedParser`.
3.  **Register**: Update the factory logic in `FeedService` to instantiate your new parser when the specific format is selected.
4.  **UI**: Ensure the new format is selectable in the `FeedManager` dropdown.
