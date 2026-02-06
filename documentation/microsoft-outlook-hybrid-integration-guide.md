# Microsoft Outlook Hybrid Integration Guide

This guide details the "hybrid" architecture used for Outlook integration in Estio. This approach combines two methods to achieve maximum reliability and feature coverage:

1.  **Puppeteer (OWA Scraping)**: Used for syncing **emails** (Inbox & Sent). This was chosen over the Graph API for email sync due to reliability issues with the Graph API for certain account types and to handle "Strict OWA" checks.
2.  **Microsoft Graph API**: Used for syncing **contacts**. This remains the standard way to bidirectionally sync contacts.

---

## 1. Architecture Overview

### Email Sync (Puppeteer)
- **Source**: `lib/microsoft/owa-email-sync.ts` & `lib/microsoft/outlook-puppeteer.ts`
- **Mechanism**: Launches a headless browser (Puppeteer) to log in to OWA. Uses a "Hybrid" extraction approach: API interception (primary) + Robust DOM Scraping (fallback).
- **Folders**: Inbox, Sent Items, Archive.
- **Trigger**: 
    - **Initial**: On user connection.
    - **Cron**: Scheduled every 5 minutes.
    - **Manual**: Via "Sync Now" button in settings.
- **Incremental Sync**: The system tracks `lastSyncedAt`. The scraper automatically stops processing a folder if it encounters 5 consecutive emails older than the last sync time (with a 24h safety buffer), drastically reducing resource usage.

### Contact Sync (Graph API)
- **Source**: `lib/microsoft/contact-sync.ts`
- **Mechanism**: Uses standard OAuth2 tokens (Graph API) to fetch contact changes via Delta Query.
- **Trigger**: Same cron job as email sync.

### State Tracking (`OutlookSyncState`)
- **Table**: `OutlookSyncState`
- **Purpose**: Stores the timestamp of the last successful email sync (`lastSyncedAt`) and delta links.
- **Key Logic**: Uses `outlookEmail` fallback to satisfy uniqueness. Used for "Sync Health" and incremental cutoff calculations.

---

## 2. Infrastructure & Cron Job

The synchronization is driven by a scheduled task running on the production server.

### Cron Job Endpoint
- **Path**: `/api/cron/outlook-sync`
- **Logic**:
    1.  Uses `force-dynamic` to prevent caching.
    2.  Fetches users with active sync.
    3.  Iterates sequentially through users.
    4.  **Step A**: Calls `syncEmailsFromOWA` for **'inbox'**, **'sentitems'**, and **'archive'**.
    5.  **Step B**: Calls `syncContactsFromOutlook` (Graph API).

### Server-Side Scheduling
- **Script**: `scripts/cron-outlook-sync.sh`
- **Schedule**: Every 5 minutes (default).

---

## 3. Key Components

### A. Puppeteer Service (`lib/microsoft/outlook-puppeteer.ts`)
This singleton service manages the browser instance:
- **Headless Mode**: Run in `headless: true` for production (configurable for debugging).
- **`loadSession(userId)`**: Restores encrypted session cookies.
- **`loginToOWA(...)`**: Handles login with "Immediate Cookie Capture" to bypass slow redirects.
- **Auto-Cleanup**: Closes browser after 5 minutes of inactivity (`IDLE_TIMEOUT_MS`).

### B. OWA Sync Logic (`lib/microsoft/owa-email-sync.ts`)
This function orchestrates the scraping with a **"World-Class" Robust Strategy**:

1.  **Smart Wait**: Explicitly waits for "Skeleton" loading placeholders (`.fui-Skeleton`) to disappear before scraping, preventing race conditions.
2.  **Aggressive Attribute Scan**: Scans the entire reading pane header for emails hidden in `aria-label`, `title`, or `href` attributes. This catches most external sender emails instantly.
3.  **Hover-and-Reveal Fallback**: For internal users where the email is visually hidden, the script programmatically **hovers** over the sender's name to trigger the Persona Card and extracts the email from there.
4.  **Click-to-Load**: Clicks each email in the list to load its full body content into the reading pane for accurate extraction.
5.  **Incremental Optimization**: Bails out of the scrolling loop early if emails are older than `lastSyncedAt`.

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
