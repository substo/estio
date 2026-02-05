# Microsoft Outlook Hybrid Integration Guide

This guide details the "hybrid" architecture used for Outlook integration in Estio. This approach combines two methods to achieve maximum reliability and feature coverage:

1.  **Puppeteer (OWA Scraping)**: Used for syncing **emails** (Inbox & Sent). This was chosen over the Graph API for email sync due to reliability issues with the Graph API for certain account types and to handle "Strict OWA" checks.
2.  **Microsoft Graph API**: Used for syncing **contacts**. This remains the standard way to bidirectionally sync contacts.

---

## 1. Architecture Overview

### Email Sync (Puppeteer)
- **Source**: `lib/microsoft/owa-email-sync.ts` & `lib/microsoft/outlook-puppeteer.ts`
- **Mechanism**: Launches a headless browser (Puppeteer) to log in to Outlook Web Access (OWA), intercepts internal API responses, and scrapes the DOM as a fallback.
- **Trigger**: 
    - **Initial**: On user connection (if chosen).
    - **Cron**: Scheduled every 5 minutes via server cron job.
- **Handling**: Checks for "Strict OWA" sessions, handles MFA checks (by failing gracefully), and manages session cookies.

### Contact Sync (Graph API)
- **Source**: `lib/microsoft/contact-sync.ts`
- **Mechanism**: Uses standard OAuth2 tokens (Graph API) to fetch contact changes via Delta Query.
- **Trigger**: Same cron job as email sync.

### State Tracking (`OutlookSyncState`)
- **Table**: `OutlookSyncState`
- **Purpose**: Stores the timestamp of the last successful email sync (`lastSyncedAt`) and delta links for efficient querying.
- **Key Logic**: Uses the user's actual `outlookEmail` (or a unique fallback) to satisfy database uniqueness constraints, ensuring reliable status updates even for Puppeteer sessions.
- **Usage**: Used to populate the "Sync Health" dashboard in the UI.

---

## 2. Infrastructure & Cron Job

The synchronization is driven by a scheduled task running on the production server.

### Cron Job Endpoint
- **Path**: `/api/cron/outlook-sync`
- **Logic**:
    1.  Uses `export const dynamic = 'force-dynamic'` to prevent caching.
    2.  Fetches users with `outlookSyncEnabled` AND valid `outlookSessionCookies`.
    3.  Iterates through users sequentially (to limit browser resource usage).
    4.  **Step A**: Calls `syncEmailsFromOWA` for 'inbox' and 'sentitems'.
    5.  **Step B**: Calls `syncContactsFromOutlook` (Graph API). Catches errors if the user only has Puppeteer credentials.

### Server-Side Scheduling
The cron job is managed by a robust shell script to ensure reliability (locking, logging, timeouts).

- **Script**: `scripts/cron-outlook-sync.sh`
- **Log File**: `logs/outlook-sync-cron.log`
- **Schedule**: Every 5 minutes (default).

**Deployment**:
The scheduler is installed via `scripts/install-cron.sh`, which adds the following entry to the system crontab:
```bash
*/5 * * * * /path/to/project/scripts/cron-outlook-sync.sh
```
```bash
*/5 * * * * /path/to/project/scripts/cron-outlook-sync.sh
```

---

## 3. User Interface & Monitoring

The system provides real-time visibility into the sync status:

### Integration Dashboard
- **Location**: `/admin/settings/integrations/microsoft`
- **Features**:
    - **Sync Health Card**: Displays "Last Inbox Sync" (e.g., "5 mins ago"), "Session Status" (e.g., "Expires in 6 days"), and "Auto-Sync" status.
    - **Connection Status**: Shows current connection method (OAuth/Puppeteer) and email.

### Sync Manager Dialog
- **Location**: Contact Mission Control -> "Outlook Emails" button.
- **Features**:
    - **Status Badge**: Shows "Last synced: [Time] ago" indicator.
    - **Manual Sync**: Allows triggering an immediate sync for that specific contact/user.

### Disconnecting & Data Cleanup
When a user clicks **Disconnect**, the system performs a hard delete of all sensitive session data to ensure security:
1.  **Cookies**: The encrypted `outlookSessionCookies` are permanently deleted.
2.  **Credentials**: The `outlookPasswordEncrypted` and `outlookEmail` fields are set to null.
3.  **State**: `outlookAuthMethod` and `outlookSyncEnabled` are reset.
4.  **Tokens**: any stored OAuth tokens (`outlookAccessToken`) are wiped.

This ensures that no usable credentials remain in the database. To reconnect, the user must re-enter their credentials.

---

## 3. Key Components

### A. Puppeteer Service (`lib/microsoft/outlook-puppeteer.ts`)
This singleton service manages the browser instance:
- **`loadSession(userId)`**: Loads encrypted cookies from the DB and restores the session.
- **`loginToOWA(...)`**: Handles the full login flow with **Immediate Cookie Capture**.
    - Captures "Connected" state/cookies immediately after password verification.
    - Gracefully handles redirects to OWA that may time out on slower servers.
- **Stealth**: Uses various flags to mask the automation implementation.
- **Resource Management**: Auto-closes the browser after 5 minutes of inactivity (`IDLE_TIMEOUT_MS`).

### B. OWA Sync Logic (`lib/microsoft/owa-email-sync.ts`)
This function orchestrates the scraping:
- **Session Restoration**: Ensures the page is on OWA, handling redirects or expired sessions.
- **Data Extraction**:
    - **Primary**: Intercepts network responses (`FindItem`, `GetItem` JSON responses).
    - **Fallback**: Dumps the DOM (`div[role="option"]`) and parses specific selectors for sender, subject, and date.
- **Date Parsing**: Includes a robust parser for OWA's various date formats (e.g., "Sun 01/02/2026", "14:46", "Yesterday").

### C. Contact Sync (`lib/microsoft/contact-sync.ts`)
- **Direction**: Bidirectional (mostly Inbound for cron).
- **Method**: Delta Query (`/me/contacts/delta`).
- **Matching**: Matches incoming contacts to existing `Contact` records by Outlook ID, then Email/Phone.

---

## 4. Setup & Troubleshooting

### Prerequisites
- **Server**: Must support Puppeteer (Chrome/Chromium dependencies installed).
- **Environment**: 
    - `CRON_SECRET`: Must be set in `.env` for the API route to accept requests.
    - `DATABASE_URL`: For persistent storage.

### Common Issues

1.  **"Session Invalid" / 401 in Logs**:
    - **Cause**: Cookies expired (usually after 7-14 days).
    - **Fix**: User must re-authenticate via the UI to generate fresh cookies.

2.  **Browser Crash / Timeout**:
    - **Cause**: Server ran out of memory or CPU.
    - **Fix**: The cron job has a `flock` lock to prevent overlaps. Check server RAM.

3.  **Graph API Errors for Contacts**:
    - **Cause**: User authenticated via Puppeteer but didn't grant OAuth permissions (or tokens expired).
    - **Result**: Contacts won't sync, but emails will continue to work.

### Manual Verification
You can manually trigger the sync for testing:
```bash
# On Server
./scripts/cron-outlook-sync.sh
```
Or call the API route locally:
```bash
curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/outlook-sync
```
