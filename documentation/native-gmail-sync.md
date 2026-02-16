# Native Gmail Sync Implementation Guide

**Status**: Implemented ✅
**Last Updated**: January 31, 2026
**Version**: 1.1

## 1. Overview
The **Native Gmail Sync** is a bespoke email engine built directly into Estio. It replaces the reliance on GoHighLevel (GHL) for email synchronization, acting as a "Mini-Email Client" that communicates directly with the Google Gmail API.

**Why?**
- **Speed**: Real-time updates via Google Cloud Pub/Sub (avg <2s latency).
- **Reliability**: Decouples email access from GHL webhooks, which can be flaky or delayed.
- **Data Ownership**: Stores a complete local copy of messages in our database.
- **Control**: Allows for "On-Demand" history fetching and custom deduplication logic.

---

## 2. Architecture

### A. Data Models (`prisma/schema.prisma`)
We introduced specific models to handle sync state and enhanced the standard Message model.

1.  **`GmailSyncState`**: Tracks the `historyId` cursor for each user to enable efficient "Delta Syncs" (only fetching what changed).
2.  **`Message`**: Enhanced with:
    - `emailMessageId` (Gmail ID, unique)
    - `emailThreadId` (For grouping)
    - `direction` ("inbound" vs "outbound")
3.  **`Conversation`**:
    - **Crucial Constraint**: Added `@@unique([locationId, contactId])` to strictly enforce **One Conversation per Contact**. This prevents race conditions where multiple incoming emails could spawn duplicate conversations.

### B. The Sync Engine (`lib/google/gmail-sync.ts`)
The engine operates in three modes:

1.  **Initial Sync**: 
    - Runs on first login/auth.
    - Fetches recent messages (default: last 50) to bootstrap the inbox.
2.  **Delta Sync (Real-time)**:
    - Triggered by Google Cloud Pub/Sub webhooks.
    - Uses `gmail.users.history.list(startHistoryId)` to fetch *only* changes (added/deleted messages) since the last sync.
    - Highly efficient (processing time <500ms).
3.  **On-Demand History (Lazy Load)**:
    - **Action**: `fetchContactHistory(contactId)`
    - **UI**: A "Fetch History" (Refresh) button in the Chat Window.
    - **Logic**: Searches Gmail for `from:email OR to:email` and backfills up to 100 past messages for that specific contact. This avoids bloating the database with irrelevant history.

### C. GoHighLevel Integration
We treat GHL as a **Downstream Logging Destination**.
- **Ingress**: Email arrives in Gmail -> Estio Sync Engine -> Saved to DB -> **Logged to GHL API**.
- This ensures GHL still "sees" the messages for automations/workflows, but Estio is the source of truth.

---

## 3. Setup & Configuration

### Environment Variables

**Local Development** (`.env.local`):
```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CLOUD_PROJECT_ID=estio-crm
APP_BASE_URL=https://your-ngrok-url.ngrok-free.app
```

**Production** (`.env.prod`):
```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CLOUD_PROJECT_ID=estio-crm
APP_BASE_URL=https://estio.co
CRON_SECRET=your-random-secret
```

> **Note**: `APP_BASE_URL` takes priority over `NEXT_PUBLIC_APP_URL` for OAuth redirects.

### Google Cloud Console Setup

#### OAuth Redirect URIs
In your OAuth 2.0 Client, add these **Authorized redirect URIs**:
- `https://estio.co/api/google/callback` (production)
- `http://localhost:3000/api/google/callback` (local dev)
- `https://your-ngrok-url.ngrok-free.app/api/google/callback` (tunneled dev)

#### Pub/Sub (Optional - for real-time sync)
1.  **Topic**: Create a topic named `gmail-sync`.
2.  **Subscription**: Create a "Push" subscription targeting `https://estio.co/api/webhooks/gmail`.
3.  **Permissions**: Give Gmail API Service Account permission to publish to this topic.

### Authentication Flow
- **Scopes**: `gmail.modify`, `gmail.labels`, `gmail.readonly`, `gmail.send`
- **Redirect Priority**: `APP_BASE_URL` → `NEXT_PUBLIC_APP_URL` → request origin

---

## 4. Key Workflows

### 1. Inbound Email (Push Notification)
1.  Google sends Push Notification -> `/api/webhooks/gmail`
2.  Route finds User by `emailAddress`.
3.  Calls `syncRecentMessages` (or Delta Sync logic).
4.  Engine checks for existing message ID (**Deduplication Check**).
5.  If new, Engine processes message -> `db.message.upsert`.
6.  If new, Engine logs to GHL.

### 2. Outbound Email (Send)
1.  User clicks Send in UI.
2.  `actions.ts` calls `gmail.users.messages.send`.
3.  On success, `processMessage` is called immediately to save the local copy.

### 3. Contact Matching (Auto-Creation Disabled)
- **Matching**: Incoming emails are matched to Contacts by `email`.
    - **Scope Restriction**: To prevent data leakage, matching is strictly scoped to **Locations the User has access to**. Global searches are disabled.
- **Auto-Creation**:
    - **Status**: **Disabled (Feb 2026)**.
    - Previously, emails from unknown senders would create a "Lead". This was disabled to prevent CRM clutter.
- **Deduplication**:
    - We use `db.conversation.upsert` with the `[locationId, contactId]` unique constraint to ensure atomic creation.

### 4. Contact Sync (Legacy)
The Gmail Sync cron job (`/api/cron/gmail-sync`) previously triggered a Google Contact pull. This has been **disabled**. See [Google Contact Sync](google-contact-sync.md) for details on the new manual workflow.

---

## 5. Maintenance & Debugging

### Database Cleanup
If duplicate conversations appear (from legacy data):
- A standard unique constraint is now in place.
- Run a cleanup script (already executed for existing data) to merge messages into the oldest conversation and delete duplicates.

### Common Issues
- **401 Unauthorized**: User's Google Token expired. Re-authenticate via Settings.
- **No Sync**: Check `GmailSyncState` table. If `historyId` is stale, the watch might have expired (auto-renews every 7 days, but logic exists to refresh).

---

## 6. Scheduled Polling (Fallback)

As a **best practice**, we implemented a "belt and suspenders" approach:

| Method | Latency | Reliability |
|--------|---------|-------------|
| Pub/Sub (Primary) | ~2 seconds | High (requires Google Cloud setup) |
| Cron Polling (Fallback) | Up to 5 min | Very High (always works) |

### Endpoint
`/api/cron/gmail-sync`

### Server Setup (System Crontab)
We use the server's native crontab instead of cloud-specific solutions for portability.

**Installation (one command):**
```bash
./scripts/install-cron.sh
```

This installs a cron job that runs every **15 minutes** (was 5m) to reduce server load:
- **Mutual Exclusion** (`flock` + `CronGuard`) - Strictly prevents overlapping runs.
- **Resource Checks** - Skips run if server RAM < 500MB.
- **Logging** - Writes to `logs/gmail-sync-cron.log`
- **Timeout** - **30 minute** limit per run (allows deep syncs)
- **Log Rotation** - Auto-cleans logs older than 7 days

### Security
Set `CRON_SECRET` in your PM2/environment. The endpoint checks for `Authorization: Bearer <CRON_SECRET>`.

### Manual Trigger
```bash
# Via script
./scripts/cron-gmail-sync.sh

# Via curl
curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://estio.co/api/cron/gmail-sync
```

### Monitoring
```bash
# Watch live logs
tail -f logs/gmail-sync-cron.log

# Check cron is installed
crontab -l | grep gmail
```
