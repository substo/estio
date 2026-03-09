# GHL Calendar & Viewing Synchronization Guide

## Overview

This feature integrates GoHighLevel (GHL) Calendars into the IDX application for viewing synchronization. This document covers GHL-specific setup and operator expectations only.

> [!NOTE]
> The full viewing scheduling architecture, timezone model, Google sync behavior, and outbox worker flow are documented in [viewing-creation-architecture.md](/Users/martingreen/Projects/IDX/documentation/viewing-creation-architecture.md).

## Implementation Details

### 1. Database Schema
Two key fields were added to support this integration:
*   `User.ghlCalendarId`: Stores the GHL Calendar ID associated with a system user (Agent).
*   `Viewing.ghlAppointmentId`: Stores the specific GHL Appointment ID for a created viewing.

### 2. GHL API Service (`lib/ghl/calendars.ts`)
A dedicated service handles all interactions with the GHL Calendar API:
*   **`createCalendarService`**: Creates new calendars (services) in GHL directly from IDX.
*   **`getCalendars`**: Fetches available calendars for a location.
*   **`createAppointment`**: Books an appointment in a specific calendar.

**Key Improvement**: We implemented `ghlFetchWithAuth`, a robust fetching utility that automatically handles GHL token refreshes. This eliminates "401 Unauthorized" errors by ensuring a valid token is always used.

### 3. User & Team Management
*   **Team Management Page**: Located at `/admin/team`. This unified page allows Admins to:
    *   View all team members with their roles (ADMIN/MEMBER).
    *   Invite new users to the location.
    *   Map GHL Calendars to specific users.
    *   **Create New Calendars**: Admins can create a "Consultation Calendar" for an agent directly from this UI, which is immediately linked to the user.
    *   **Remove users**: Revoke access to the location.

> [!NOTE]
> The old `/admin/settings/team` page has been deprecated and consolidated into `/admin/team` (Dec 2025).

### 4. Viewing Synchronization
*   Viewing sync now uses the shared `ViewingOutbox` + `ViewingSync` architecture.
*   On create/update/delete, local mutations enqueue provider jobs first.
*   GHL sync runs through the shared task-sync cron worker (`/api/cron/task-sync`).
*   If the assigned agent has a `ghlCalendarId`, the GHL provider attempts to create or update the remote appointment and stores the remote appointment id in sync state.

## Setup & Configuration

### Prerequisites
*   The GHL Location must have the **Calendar** scopes enabled (Read/Write).
*   **User Action Required**: After deployment, the admin must "Sign In with GHL" to regenerate tokens with these new permissions.

### Linking a Calendar
1.  Navigate to **Admin > Team**.
2.  Find the target user.
3.  Select an existing GHL Calendar from the dropdown OR click the **"+"** button to create a new one.

## Future Development

### 1. Two-Way Sync (Webhooks)
Currently, sync is **One-Way (IDX -> GHL)**.
To implement full synchronization (changes in GHL reflecting in IDX), we need to:
*   Create a GHL Workflow that triggers on "Appointment Status Update".
*   Send a webhook to IDX (`/api/webhooks/ghl/appointment`).
*   Update the `Viewing` status in IDX based on the webhook payload.

### 2. Appointment Management
*   **Rescheduling**: Supported through the shared viewing sync engine. Local viewing updates enqueue `update` jobs.
*   **Cancellation**: Supported through `delete` sync jobs.

> [!WARNING]
> GHL may still reject a reschedule when the selected slot is no longer available. In that case the outbox row becomes `dead` with the provider error preserved in `ViewingSync.lastError`.

### 3. Advanced Calendar Configuration
*   Expose more GHL Calendar settings in the "Create Calendar" dialog (e.g., Availability, Buffers, Notification details).
