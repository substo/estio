# Viewing Creation Architecture & Integration

## Overview

The Viewings system in Estio allows agents and administrators to schedule property viewings for contacts. Viewings are deeply integrated into contact history, the `Property` model, the AI suggestion pipeline, and provider sync-out for Google Calendar and GHL.

This document is the source of truth for viewing scheduling, timezone handling, and provider sync behavior.

## Data Models

The feature uses a durable outbox architecture so local DB writes finish first and external provider mutations run safely afterward.

1. **`Viewing`**
   - Local source of truth.
   - Stores canonical UTC instant in `date`.
   - Stores timezone metadata in `scheduledTimeZone` and `scheduledLocal` so local-time intent can be rendered deterministically later.
   - Stores sync-related metadata including `calendarEventId`, `ghlAppointmentId`, `syncVersion`, `syncRecords`, and `outboxJobs`.
2. **`ViewingOutbox`**
   - Durable provider job queue for `create`, `update`, and `delete`.
   - Uses unique `idempotencyKey` in the shape `viewingId:provider:operation:v{syncVersion}`.
3. **`ViewingSync`**
   - Provider sync state per viewing/provider/account.
   - Tracks `providerContainerId`, `providerViewingId`, `status`, `lastSyncedAt`, attempts, and last error.

Current Prisma schema reference:

- `Viewing`: [`prisma/schema.prisma`](/Users/martingreen/Projects/IDX/prisma/schema.prisma)
- `ViewingSync`: [`prisma/schema.prisma`](/Users/martingreen/Projects/IDX/prisma/schema.prisma)
- `ViewingOutbox`: [`prisma/schema.prisma`](/Users/martingreen/Projects/IDX/prisma/schema.prisma)

## Timezone Source of Truth

Viewing scheduling now uses **agent timezone** as the source of truth.

1. The server resolves timezone in this order:
   - `User.timeZone`
   - fallback `Location.timeZone`
   - otherwise validation fails
2. Local scheduling input is parsed with an explicit IANA timezone and converted to canonical UTC.
3. The original local value is retained in `scheduledLocal` and the zone is retained in `scheduledTimeZone`.
4. Invalid or ambiguous DST times are rejected rather than guessed.

Current admin surfaces:

- Agent timezone: `/admin/user-profile`
- Location fallback timezone: `/admin/site-settings`
- Google Calendar target selection: `/admin/settings/integrations/google`

## The Synchronization Engine

The sync path is intentionally split into local mutation, enqueue, and worker execution.

1. **Server Actions**
   - `createViewing` and `updateViewing` in [`app/(main)/admin/contacts/actions.ts`](/Users/martingreen/Projects/IDX/app/(main)/admin/contacts/actions.ts) write to Prisma first.
2. **Enqueueing**
   - After the write succeeds, the action calls `enqueueViewingSyncJobs({ viewingId, operation })`.
3. **Immediate Trigger**
   - On viewing update, the app also sends an authenticated best-effort request to `GET /api/cron/task-sync` via [`lib/cron/task-sync-trigger.ts`](/Users/martingreen/Projects/IDX/lib/cron/task-sync-trigger.ts).
   - This reduces visible lag without making the save path depend on provider API latency.
4. **Cron Worker**
   - [`app/api/cron/task-sync/route.ts`](/Users/martingreen/Projects/IDX/app/api/cron/task-sync/route.ts) processes both task outbox jobs and viewing outbox jobs.
5. **Provider Adapters**
   - Google Calendar: [`lib/viewings/providers/google-calendar.ts`](/Users/martingreen/Projects/IDX/lib/viewings/providers/google-calendar.ts)
   - GHL: [`lib/viewings/providers/ghl.ts`](/Users/martingreen/Projects/IDX/lib/viewings/providers/ghl.ts)
6. **Provider Registration**
   - The assigned agent chooses a preferred Google Calendar, stored on `User.googleCalendarId`.
   - Existing synced viewings stay on their original remote calendar using `ViewingSync.providerContainerId`.

### Reliability Rules

1. `syncVersion` increments on local viewing updates.
2. Outbox idempotency is versioned by `syncVersion`.
3. If a duplicate outbox key is encountered for a row already in `completed` or `dead`, the sync engine re-queues that row instead of silently skipping it.

This prevents the historical failure mode where a later viewing edit reused the old `...:update:v1` key and never produced a fresh Google update.

## Frontend UI Components

1.  **`ContactViewingManager`**: The primary React Server/Client hybrid component for managing a contact's viewings. It displays a list of viewings, badge states indicating external sync health, and a form dialog for creating/updating records.
2.  **`CoordinatorPanel` & `EditContactDialog`**: These surfaces inject the `contactId` into the `ContactViewingManager` so it can isolate viewings for the active conversation/contact.

## AI Suggestions & Telemetry

Viewings can be scheduled via natural language selection within a conversation (WhatsApp/SMS/Email thread).
1.  **Trigger**: Highlighting text reveals the `MessageSelectionActions` popover, where the user can click "Suggest Viewing" (an `Eye` icon).
2.  **Orchestration**: `suggestViewingsFromSelection` (in `conversations/actions.ts`) passes selected text, contact context, and an anchor context (`anchorMessageId`, `clientNowIso`, `clientTimeZone`) to the LLM and deterministic post-processors.
3.  **Structured Output + Deterministic Repair**: The LLM returns `propertyDescription`, `date`, `time`, and `notes`. Server-side post-processing then:
    - resolves relative date language (`today`, `tomorrow`, weekdays) to absolute `YYYY-MM-DD` using anchor date + timezone
    - parses explicit clock-time text if AI misses/invalidates time
    - attempts exact property auto-match by `reference` or `slug` and sets `propertyId` only on deterministic match
4. **Apply Path Time Safety**
   - Suggestion apply and manual scheduling now send explicit timezone context (`scheduledLocal` + `scheduledTimeZone`, with absolute ISO fallback support where needed).
   - The server parses with the resolved agent timezone and stores UTC + timezone metadata.
5. **Funnel Metrics**
   - Generation and apply steps are logged with resolution telemetry, including `dateResolutionSource` (`llm|deterministic|fallback`) and `propertyResolutionSource` (`exact_ref|exact_slug|none`).

## Legacy Debugging Artifact: `Viewing_contactId_fkey`

> [!NOTE]
> This section documents an older production hardening issue. It remains relevant as background, but it is not the primary scheduling or sync failure mode anymore.

### The Problem
During development, a persistent and critical production bug emerged:
```
Failed to create viewing: Invalid `prisma.viewing.create()` invocation:
Foreign key constraint violated on the constraint: `Viewing_contactId_fkey`
```
Since Prisma enforces strict referential integrity, this indicated that the `createViewing` Server Action was receiving a `contactId` that **did not exist** in the local Prisma `Contact` table.

### The Root Cause
1.  **GoHighLevel Dual-IDs**: Our application runs its own PostgreSQL database, where a Contact is assigned a local `cuid()` (e.g., `cmlicl0...`). However, it constantly syncs with GoHighLevel via the `ghlContactId` string (e.g., `NZLtO7XdwB...`).
2.  **Stale Clients & Soft Navigation**: The frontend payload fetching mechanism intentionally supplies the UI with an `id` that sometimes mapped to the GoHighLevel string ID (so the UI, which originally consumed GHL APIs, didn't break). We updated the `CoordinatorPanel` to exclusively pass the safe, local `contactContext.contact.id` (`cuid()`).
3.  **Aggressive Caching**: Next.js App Router and edge caching meant that users who did not execute a *hard refresh* of the browser were still running the older compiled Javascript chunks. These outdated chunks continued to inject the GoHighLevel ID string into the Server Action payload (`contactId`). The Server Action blindly passed this external ID to Prisma, violating the internal Forgeign Key constraint.

### The Hardened Solution
To completely decouple server integrity from frontend cache staleness, defensive self-healing was injected directly into the Server Actions (`createViewing` and `updateViewing`):

```typescript
// app/(main)/admin/contacts/actions.ts

let resolvedContactId = data.contactId;

// Defensive Hardening: Auto-heal GHL Contact IDs sent from cached clients
if (resolvedContactId && !resolvedContactId.startsWith('c')) {
    const dbContact = await db.contact.findFirst({
        where: { ghlContactId: resolvedContactId },
        select: { id: true }
    });
    if (dbContact) {
        resolvedContactId = dbContact.id;
    }
}
```
*   This pattern ensures that regardless of whether a cached client sends a native `cuid()` or an external GoHighLevel Contact/Location ID, the backend silently identifies, intercepts, and translates the mismatched ID back to the canonical local foreign key prior to executing `db.viewing.create`.
*   This identical preventative resolution method protects the `createContactTask` pipeline as well (via `resolveContact()`), making the CRM architecture exceedingly resilient to Client UI misalignment.
