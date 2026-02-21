# WhatsApp Integration: Custom Channel ("Linked Device")
**Last Updated:** 2026-02-20
**Related:** [Legacy Integration](whatsapp-integration-legacy.md)

## Overview

We use a **Custom Messaging Channel** (shadowed by Evolution API) to solve "Unsuccessful Message" errors and provide full 2-way sync with GoHighLevel (GHL).

### Architecture
We use a **Hybrid Approach**:
-   **Transport**: **Evolution API** performs the actual WhatsApp sending/receiving (via "Linked Device").
-   **Integration**: **GHL Custom Provider** allows us to appear as a native conversation channel ("WhatsApp Linked") in the GHL UI.
-   **Sync**: Our server mediates between Evolution API and GHL API.

### Key Benefits
1.  **No "Unsuccessful" Errors**: Using `type: 'Custom'` bypasses GHL's strict checks for official WhatsApp subscriptions.
2.  **2-Way Sync**: Messages sent from the GHL UI are relayed to WhatsApp; messages received on WhatsApp are pushed to GHL.
3.  **Correct Type**: Messages appear as "WhatsApp Linked" (or Custom SMS) rather than generic "SMS".

### Message Flow

#### A. Outbound (GHL -> WhatsApp)
1.  **User Action**: User sends a message in GHL Conversations using the **"WhatsApp Linked"** channel.
2.  **Webhook**: GHL sends a payload to `POST /api/webhooks/ghl/custom-provider`.
3.  **Relay to Evolution**:
    -   Server looks up the `location` by `locationId`.
    -   Server calls `evolutionClient.sendMessage` to send via the linked WhatsApp instance.
    -   **Loop Prevention**: We pre-emptively create the DB message to prevent `sync.ts` from duplicating it when Evolution confirms sending.

#### B. Outbound (App -> GHL)
1.  **User Action**: User sends message in the App's custom UI (`sendReply`).
2.  **Evolution**: Message sends via `evolutionClient.sendMessage`.
3.  **GHL Sync**:
    -   Server calls GHL API `POST /conversations/messages` with `type: 'Custom'` and `conversationProviderId`.
    -   Message appears in GHL history immediately.

#### C. Inbound (WhatsApp -> GHL)
1.  **Webhook**: Evolution API receives message.
2.  **Processing**: `lib/whatsapp/sync.ts` normalizes the message.
3.  **JIT Sync**: Server ensures the contact exists in GHL (`ensureRemoteContact`).
4.  **GHL Push**: Server pushes the inbound message to GHL using `type: 'Custom'` and `conversationProviderId`.

## Architecture V2 (Jan-Feb 2026 Updates)

To handle high-volume sync and rate limits, we introduced a **Queue-Based Architecture**:

### 1. BullMQ & Redis Queues
- **Purpose**: Use persistent background queues for both GHL rate-limiting and unresolved LID retries.
- **Reuse**: `whatsapp-lid-resolve` reuses the same BullMQ + Redis infrastructure already used by `ghl-sync`.
- **`ghl-sync` Queue**:
  - Outbound sync to GHL runs through BullMQ to avoid `429 Too Many Requests`.
  - Worker rate is limited to **5 jobs per second**.
- **`whatsapp-lid-resolve` Queue**:
  - Inbound 1:1 messages with unresolved `@lid` are deferred instead of immediately creating placeholder contacts.
  - Retries run on a fixed delay until mapping is available.
  - Jobs survive process restarts because payload is in Redis.
- **Infrastructure**: Redis is required (`REDIS_HOST`, `REDIS_PORT`, default `127.0.0.1:6379`).
- **Worker Bootstrap**:
  - `instrumentation.ts` initializes the LID worker at app startup.
  - `app/api/webhooks/evolution/route.ts` also calls init as a safety net per runtime.

### 2. Full History Sync
- **Feature**: When a new instance is connected, we now set `syncFullHistory: true`.
- **Behavior**: Evolution API fetches *all* historical messages from the phone. These messages are processed by our webhook handler.
- **Handling**: The Queue System allows us to ingest thousands of historical messages without crashing or getting blocked by GHL API, as they are trickled in at a safe rate.

### 3. Connection Self-Healing
- **Problem**: Webhook events sometimes fail to reach the server (e.g., during startup), leaving the DB status as "closed" even if the phone is connected.
- **Solution**: The frontend (`actions.ts`) now implements a "Lazy Sync" check. If the DB says "closed", it proactively polls the Evolution API. If Evolution reports "open", it auto-corrects the DB status to "open".

### 4. Clean Disconnect Procedure
- **Old Behavior**: Only logged out the session.
- **New Behavior**: Performing a disconnect now calls `deleteInstance` on Evolution API. This ensures a completely clean slate for the next connection, preventing "ghost" instances and QR code persistence issues.

### 5. Smart Background Sync (Jan 21, 2026)

**Problem**: The previous "Lazy-Load" approach triggered a full history fetch (50+ messages) every time a conversation was opened. This caused unnecessary API calls, delays, and "History Fetch" logs even when up-to-date.

**Solution**: Implemented a **Smart Background Sync** with deduplication intelligence:

#### How It Works
1. **Silent Trigger**: When a user selects a conversation, a background process starts *immediately* but does not block the UI (no loading spinners).
2. **Smart Limits**:
   - Fetches a small batch (default: 20 messages).
   - **Consecutive Duplicate Detection**: The sync loop counts how many existing messages it encounters. If it finds **5 consecutive duplicates**, it assumes the history is up-to-date and **stops early**. This prevents re-scanning thousands of old messages.
3. **Manual Override**: A "Sync History" button (refresh icon) is available in the Chat Window header. This allows the user to force a deeper history fetch if they suspect missing messages (e.g., after a long phone disconnection).

#### Key Files
- **`app/(main)/admin/conversations/actions.ts`**: 
    - `syncWhatsAppHistory(id, limit)`: The core action. accepted an optional limit and returns sync stats (synced count, skipped count).
- **`lib/whatsapp/sync.ts`**: 
    - `processNormalizedMessage`: Updated to return a status (`{ status: 'skipped' | 'processed' }`) to enable the duplicate detection logic.
- **`app/(main)/admin/conversations/_components/conversation-interface.tsx`**: 
    - Calls `syncWhatsAppHistory` silently on conversation selection.
    - Updates the UI only if new messages are found.

#### Benefits
- **Zero Latency**: User sees cached messages immediately; new ones pop in if found.
- **Efficiency**: Stops processing as soon as it hits known history.
- **Resilience**: Manual button handles edge cases.

## Setup Guide

### 1. Create GHL Marketplace App (Once per Agency)
To enable the "WhatsApp Linked" channel, you must create a Private Marketplace App:
1.  **Go to**: [marketplace.gohighlevel.com](https://marketplace.gohighlevel.com)
2.  **Create App**:
    -   **Name**: `WhatsApp Linked Device`
    -   **Scopes**: `conversations/message.readonly`, `conversations/message.write`, `contacts.readonly`, `contacts.write`.
3.  **Conversations Config**:
    -   **Provider Name**: `WhatsApp Linked`
    -   **Provider Type**: `SMS`
    -   **Delivery URL**: `https://estio.co/api/webhooks/ghl/custom-provider` (or your ngrok URL for dev).
4.  **Install**: Install to your sub-account.
5.  **Get ID**: Copy the `conversationProviderId` (e.g., `6966...`).

### 2. Configure Server
Add required variables to your `.env`:
```env
GHL_CUSTOM_PROVIDER_ID=696637215906b847a442aa45
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
WHATSAPP_LID_RETRY_INTERVAL_MS=30000
WHATSAPP_LID_MAX_ATTEMPTS=240
```

`WHATSAPP_LID_RETRY_INTERVAL_MS` and `WHATSAPP_LID_MAX_ATTEMPTS` control deferred LID retry behavior.

### 3. Status Tracking & Resend Logic
We track message delivery status (`sent`, `delivered`, `read`, `failed`) by listening to Evolution API's `messages.update` webhook event.
- **Mapping**: Evolution statuses (SERVER_ACK, DELIVERY_ACK, READ) map to our DB status enum.
- **Resend**: A server action `resendMessage(messageId)` allows retrying failed messages. It re-uses the existing DB record but generates a new `wamId`.

## Troubleshooting & Fixes

| Issue | Fix |
|-------|-----|
| **"Unsuccessful" Message** | Ensure you are using the Custom Channel ID and not `type: 'WhatsApp'`. Verify `GHL_CUSTOM_PROVIDER_ID` in `.env`. |
| **Duplicates in GHL** | Check loop prevention logic in `custom-provider/route.ts`. Ensure `wamId` is stored before generic sync runs. |
| **QR Code Persists after Scan** | This is usually a sync delay. **Fix**: Refresh the page. The new "Self-Healing" logic will detect the connection and remove the QR code. |
| **Evolution API Crash Loop** | **Error P2000**: "Value too long". Occurs if a Contact name or Profile Pic URL exceeds 191 chars. **Fix**: Manually altered the Postgres `Contact` table columns (`pushName`, `profilePicUrl`) to `TEXT` (unlimited length). |
| **Duplicate Conversations (Same Contact)** | **Issue**: Race conditions can create multiple conversations for one contact. **Fix**: Run `scripts/merge-same-contact-conversations.ts` to merge them. **Prevention**: Logic updated to search last 2 digits for robust matching (`sync.ts`). |
| **Lead gets split into two contacts/conversations after reply** | **Issue**: Outbound uses phone identity, reply arrives as unresolved `@lid`. **Fix**: Inbound unresolved LID is now deferred (`whatsapp-lid-resolve` queue) until resolved to phone; verify Redis is up and worker logs show retries/resolution. |

### 4. Server Logging & Debugging
To investigate issues like duplicate conversations or "Contact not found" errors for specific numbers:

1.  **SSH into Server**:
    ```bash
    ssh root@138.199.214.117
    ```
2.  **View Live Logs** (Real-time tail):
    ```bash
    pm2 logs estio-app --lines 100
    ```
3.  **Search Past Logs**:
    Use grep to search for a specific phone number suffix (e.g., last 2-4 digits).
    ```bash
    pm2 logs estio-app --lines 1000 | grep "73"
    ```
    *Look for lines like `[WhatsApp Sync] Contact not found...` vs `Matched existing contact...`*
4.  **Check Deferred LID Retry Logs**:
    ```bash
    pm2 logs estio-app --lines 2000 | grep -E "Deferred unresolved inbound LID|LID still unresolved|Resolved LID|LID Resolve Worker"
    ```
    *If replies are creating split contacts, these lines show whether retries are running and eventually resolving to phone.*

### 5. File-Based Webhook Logging (Feb 2026)
For detailed debugging of Evolution API payloads, enable file-based logging.

**Enable in `.env`**:
```env
ENABLE_WEBHOOK_LOGGING=true
WEBHOOK_LOG_DIR=/home/martin/logs/evolution
```

**Files are saved as**: `{timestamp}_{eventType}.json`  
Example: `2026-02-09T19-30-00-000Z_MESSAGES_UPSERT.json`

**Search logged payloads**:
```bash
# Find all LID-related messages
cat /home/martin/logs/evolution/*.json | jq '.data.key.remoteJid' | grep lid

# View specific payload
cat /home/martin/logs/evolution/2026-02-09T*.json | jq '.data'
```

**Cleanup old logs** (manual):
```bash
find /home/martin/logs/evolution -mtime +7 -delete
```

> [!WARNING]
> Disable logging in production after debugging to prevent disk fill. Use `ENABLE_WEBHOOK_LOGGING=false`.

## Manual Chat Import (Feb 2026)
We introduced a modal-based tool to import historic chats from `.txt` exports (WhatsApp → More → Export Chat).

- **Location**: Conversation Header (Upload Icon).
- **Format**: Standard WhatsApp Export `.txt` (without media).
- **Behavior**:
  - Direct import into the *active* conversation.
  - Dedupes messages against existing database records.
  - Updates `lastMessageAt` to reflect imported history.
  - Auto-assigns "My" messages (outbound) based on user selection in the modal.

## Production Resilience (Jan 2026)

The following safeguards are in place to prevent and recover from Evolution API failures:

### Docker Auto-Restart
- **Container Policy**: All Evolution containers (`evolution_api`, `evolution_postgres`, `evolution_redis`) have `restart: always` policy.
- **Server Reboot Recovery**: `deploy-direct.sh` runs `docker update --restart=always` after each deploy to ensure containers survive server reboots.

### Data Persistence (Named Volumes)
WhatsApp sessions and data are **preserved across deployments** because they are stored in Docker named volumes, not inside containers:

| Volume Name | Contents |
|-------------|----------|
| `evolution_instances` | WhatsApp session keys (QR code scans) |
| `evolution_store` | WhatsApp message cache |
| `evolution_pgdata` | PostgreSQL database |
| `evolution_redis_data` | Redis cache (message queue) |

**Industry Best Practice**: The deployment script uses `docker compose down` (without `-v`) followed by `docker compose up -d`. This gracefully stops containers while explicitly preserving volumes. Data is only lost if you manually run `docker compose down -v` or `docker volume rm`.

### Health Check Endpoint
- **Client Method**: `evolutionClient.healthCheck()` in `lib/evolution/client.ts` verifies API availability before operations.
- **Graceful Degradation**: If Evolution API is unreachable, the UI displays a user-friendly message instead of a cryptic error.

### Recovery Procedures
1. **Check Docker Status**:
   ```bash
   ssh root@138.199.214.117 "docker ps --filter name=evolution"
   ```
2. **Restart Containers** (if stopped):
   ```bash
   ssh root@138.199.214.117 "cd /home/martin/estio-app && docker compose -f docker-compose.evolution.yml up -d"
   ```
3. **Force Recreate** (if corrupt):
   ```bash
   ssh root@138.199.214.117 "docker rm -f evolution_api evolution_postgres evolution_redis && cd /home/martin/estio-app && docker compose -f docker-compose.evolution.yml up -d"
   ```

## Phone Number Normalization Convention

WhatsApp APIs never include the `+` prefix. We follow **E.164** as the standard for storage:

| Context | Format | Example |
|---------|--------|---------|
| **Database / CRM** (stored) | E.164 with `+` | `+35796045511` |
| **WhatsApp API** (send/receive) | Digits only, no `+` | `35796045511` |
| **Search / Matching** | Digits only (strip all non-digits) | `35796045511` |

**How it works in code**:
- **Ingest** (`sync.ts`): Adds `+` on normalization → `from.startsWith('+') ? from : '+' + from`
- **Send** (`evolutionClient.sendMessage`): Strips `+` → `phone.replace('+', '')`
- **Match** (`sync.ts`): Compares raw digits → `contactPhone.replace(/\D/g, '')`

> [!TIP]
> Always store E.164 (with `+`), always strip for WhatsApp API calls.

## Data Model (Prisma)


No schema changes required specifically for this, but we rely on:
-   `Location.evolutionInstanceId`
-   `Contact.ghlContactId`
-   `Contact.lid` — WhatsApp Lightweight ID for LID-to-phone mapping.
-   `Message.ghlMessageId` / `Message.wamId` mapping.
-   **CRITICAL DB ALTERATION**: `Contact` table columns `pushName` and `profilePicUrl` MUST be type `TEXT` or `VARCHAR(1000+)` to prevent crashes. Check migration history.

## Group Chat & LID Support (Jan-Feb 2026)

### 1. Group Chat Strategy ("Group as Contact")
Due to the schema constraint where `Conversation` must link to a single `Contact`, we model WhatsApp Groups as follows:
-   **Group Entity**: The WhatsApp Group itself is stored as a `Contact`.
    -   **Phone**: `[GroupID]@g.us` (e.g., `123456@g.us`).
    -   **Type**: `WhatsAppGroup`.
    -   **Name**: The Group Subject (e.g., "Sales Team").
-   **Message Identification**: Since all messages in the group conversation technically come "from" the group JID, we identify the actual sender by prepending their name to the body:
    -   **Format**: `[Martin]: Hello everyone`
-   **Participant Sync**: We also extract the *actual sender's* phone number from the message metadata and ensure they exist as a distinct `Contact` in the CRM.

### 2. LID (Lightweight ID) Handling (LID-First + Reconciliation, Feb 2026)
WhatsApp can represent the same person using either:
- phone JID (`@s.whatsapp.net`)
- opaque LID (`@lid`)

The critical issue was split identity: outbound lead creation used phone, but inbound reply could arrive as unresolved `@lid`, producing a second contact/conversation.

**Current strategy ("LID-first + reconciliation") in normal terms**:
1. **Try to resolve immediately at webhook stage (`route.ts`)**:
   - Reads `senderPn`, `remoteJidAlt`, `participantAlt`, `participant`, `previousRemoteJid`, and DB `Contact.lid`.
   - If found, passes `resolvedPhone` into `sync.ts`.
2. **If inbound 1:1 LID is still unresolved in `sync.ts`**:
   - Do **not** create contact/conversation immediately.
   - Try `tryResolveLidToPhone` (DB mapping + `evolutionClient.findContact`).
   - If still unresolved, defer processing and return `status: 'deferred_unresolved_lid'`.
3. **Deferred retry is persistent (BullMQ/Redis)**:
   - Queue: `whatsapp-lid-resolve`
   - Retry interval: `WHATSAPP_LID_RETRY_INTERVAL_MS` (default `30000`)
   - Max attempts: `WHATSAPP_LID_MAX_ATTEMPTS` (default `240`)
   - If queue init fails, fallback to in-memory deferral (same retry semantics, but non-persistent).
4. **Reconciliation learns and unifies identity**:
   - Outbound dedup path captures `msg.lid` and links it to the real phone contact.
   - `CONTACTS_UPSERT` also links/merges phone<->LID mappings in background.
   - Deferred inbound retries then resolve to the existing phone contact and continue normally.

**Key outcome**: inbound reply no longer needs to create a second placeholder contact first.

#### Key Files
| File | Role |
|------|------|
| `app/api/webhooks/evolution/route.ts` | Initial LID normalization/resolution and fallback metadata extraction |
| `lib/whatsapp/sync.ts` | Defers unresolved inbound LID, retries resolution, captures LID on outbound dedup |
| `lib/queue/whatsapp-lid-resolve.ts` | Persistent BullMQ deferred retry queue for unresolved inbound LID |
| `lib/whatsapp/contact-sync-handler.ts` | Background phone<->LID reconciliation via `CONTACTS_UPSERT` |
| `instrumentation.ts` | Startup worker bootstrap for LID queue |
| `scripts/merge-lid-contact.ts` | Manual utility to merge placeholders |

#### Past Bugs Reference

| Date | Bug | Root Cause | Fix |
|------|-----|-----------|-----|
| Feb 20, 2026 | Outbound lead + inbound reply created split contacts/conversations | Inbound unresolved `@lid` was being processed before mapping existed | Added persistent deferred LID queue; retry resolution before contact creation |
| Feb 17, 2026 | Outbound messages skipped | Startled by LID, logic skipped message | Implemented flow-through & Layer 2 capture |
| Feb 9, 2026 | Contacts saved as `WhatsApp User ...@lid` | Code read `msg.senderPn` instead of `key.senderPn` | Changed to `key.senderPn || msg.senderPn` |

> [!NOTE]
> The system is "Self-Healing", but now it is also **defer-first** for unresolved inbound LID. This is what prevents immediate split-contact creation.

### 3. Outbound Naming Fix
-   **Issue**: Outbound messages (sent from phone) were triggering `Contact` creation using the *Sender's* PushName (the User), effectively renaming clients to "Martin".
-   **Fix**: `sync.ts` now ignores `contactName` (PushName) for outbound messages. It only uses it to name *new* contacts during *inbound* messages.
