# GHL Calendar & Viewing Synchronization Guide

## Overview

This feature integrates GoHighLevel (GHL) Calendars into the IDX application, allowing for seamless synchronization of viewing appointments. When a viewing is created in IDX, it automatically reserves a slot in the corresponding GHL Calendar for the assigned agent.

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
*   **`createViewing` Action**: When a viewing is created:
    1.  The system checks if the assigned agent has a `ghlCalendarId`.
    2.  If yes, it calls the GHL API to book the appointment.
    3.  If successful, the `ghlAppointmentId` is saved to the Viewing record.

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
*   **Rescheduling**: Implementing update logic in `editViewing` to move GHL appointments when local times change.
*   **cancellation**: Deleting the GHL appointment when a viewing is cancelled.

### 3. Advanced Calendar Configuration
*   Expose more GHL Calendar settings in the "Create Calendar" dialog (e.g., Availability, Buffers, Notification details).
