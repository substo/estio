# Viewing Creation Architecture & Integration

## Overview

The Viewings system in Estio allows agents and administrators to schedule property viewings for contacts. Viewings are deeply integrated into the contact's CRM history, the `Property` model, the AI Suggestion Engine, and are synchronously linked to the agent's connected Google Calendar.

This document outlines the architecture, data models, integration components, UI, AI pipeline, and specific debugging hurdles overcome during implementation.

## Data Models

The feature uses a robust, asynchronous synchronization pattern (matching the `Task` architecture) to ensure that backend database operations complete quickly, while external API calls (like Google Calendar) are handled safely via an outbox queue.

1.  **`Viewing`**: The core application model storing `date`, `duration`, `endAt`, `notes`, `title`, `description`, `location`, `status`, `userId` (agent assigned), `contactId` (the client), and `propertyId`.
2.  **`ViewingOutbox`**: A staging table where local viewing mutations (create, update, delete) are queued as jobs.
3.  **`ViewingSync`**: A registry tracking the synchronization state of a given `Viewing` per external provider (e.g., Google Calendar), holding the external `providerId` (the Google Event ID), timestamps, and error states.

## The Synchronization Engine

To avoid blocking the UI while awaiting external APIs:

1.  **Server Actions** (`app/(main)/admin/contacts/actions.ts`): Functions like `createViewing` and `updateViewing` transact directly with Prisma to mutate the `Viewing` table.
2.  **Enqueueing**: Upon a successful DB mutation, the action immediately calls `enqueueViewingSyncJobs({ viewingId, operation })` from `lib/viewings/sync-engine.ts`. This inserts a record into the `ViewingOutbox`.
3.  **Cron Processing**: A background worker (e.g., `api/cron/sync-worker`) polls the `ViewingOutbox` and executes the appropriate adapter functions (e.g., `lib/viewings/providers/google-calendar.ts`) to mutate the Google Calendar event.
4.  **Provider Registration**: The agent configures their preferred Google Calendar via `/admin/settings/integrations/google`, which saves `googleCalendarId` on their `User` record. The sync engine references this ID when publishing events.

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
4.  **Apply Path Time Safety**: The client sends `scheduledAtIso` (browser-local `date+time` converted to UTC ISO) when applying suggestions, preventing server-timezone drift.
5.  **Funnel Metrics**: Generation and apply steps are logged with resolution telemetry, including `dateResolutionSource` (`llm|deterministic|fallback`) and `propertyResolutionSource` (`exact_ref|exact_slug|none`).

## Critical Debugging Artifact: "Viewing_contactId_fkey" Constraint

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
