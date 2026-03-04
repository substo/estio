# WhatsApp Integration: Custom Channel ("Linked Device")
**Last Updated:** 2026-03-01
**Related:** [Legacy Integration](whatsapp-integration-legacy.md)

## Overview

We use a **Custom Messaging Channel** (shadowed by Evolution API) to solve "Unsuccessful Message" errors and provide full 2-way sync with GoHighLevel (GHL).

> [!NOTE]
> **Evolution-only media support (images, audio & documents)** is implemented in this integration. Media is stored in a **private Cloudflare R2 bucket** (`whatsapp-media`) and served to the UI through an app-authenticated attachment route. The Twilio/Meta WhatsApp implementations were not changed.

### Architecture
We use a **Hybrid Approach**:
-   **Transport**: **Evolution API** performs the actual WhatsApp sending/receiving (via "Linked Device").
-   **Integration**: **GHL Custom Provider** allows us to appear as a native conversation channel ("WhatsApp Linked") in the GHL UI.
-   **Sync**: Our server mediates between Evolution API and GHL API.

### Key Benefits
1.  **No "Unsuccessful" Errors**: Using `type: 'Custom'` bypasses GHL's strict checks for official WhatsApp subscriptions.
2.  **2-Way Sync**: Messages sent from the GHL UI are relayed to WhatsApp; messages received on WhatsApp are pushed to GHL.
3.  **Correct Type**: Messages appear as "WhatsApp Linked" (or Custom SMS) rather than generic "SMS".
4.  **Private Media Storage**: WhatsApp media received/sent through the App UI (Evolution path) is stored privately in Cloudflare R2 and exposed only via short-lived signed URLs.

### Message Flow

#### A. Outbound (GHL -> WhatsApp)
1.  **User Action**: User sends a message in GHL Conversations using the **"WhatsApp Linked"** channel.
2.  **Webhook**: GHL sends a payload to `POST /api/webhooks/ghl/custom-provider`.
3.  **Relay to Evolution**:
    -   Server looks up the `location` by `locationId`.
    -   Server calls `evolutionClient.sendMessage` to send via the linked WhatsApp instance.
    -   **Loop Prevention**: We pre-emptively create the DB message to prevent `sync.ts` from duplicating it when Evolution confirms sending.

#### B. Outbound (App -> WhatsApp -> GHL)
1.  **User Action**: User sends a message in the App's custom UI.
    -   **Text**: `sendReply(...)`
    -   **Media (Evolution-only)**: paperclip upload flow (images/audio/documents) + voice recorder in the chat window
2.  **Text Path**: Server calls `evolutionClient.sendMessage(...)`.
3.  **Media Path (Evolution-only)**:
    -   App calls `createWhatsAppMediaUploadUrl(...)` to get a short-lived presigned **R2 `PUT` URL**.
    -   Browser uploads the file directly to the private `whatsapp-media` bucket.
    -   App calls `sendWhatsAppMediaReply(...)`.
    -   Server validates the upload, signs a short-lived **R2 `GET` URL**, then calls `evolutionClient.sendMedia(...)`.
    -   Server creates the local `Message` plus `MessageAttachment` row (stored as `r2://bucket/key`).
4.  **GHL Sync**:
    -   Server calls GHL API `POST /conversations/messages` with `type: 'Custom'` and `conversationProviderId`.
    -   For media sends, GHL currently receives placeholder/caption text (`[Image]`, `[Audio]`, `[Document]`, or caption text for images/documents); the binary attachment remains in our app/R2 storage.

#### C. Inbound (WhatsApp -> GHL)
1.  **Webhook**: Evolution API sends `MESSAGES_UPSERT` to `POST /api/webhooks/evolution`.
2.  **Parsing**: `parseEvolutionMessageContent(...)` unwraps nested message containers (ephemeral / view-once) and normalizes text, reactions/stickers, and media message types.
3.  **Processing**: `lib/whatsapp/sync.ts` writes the normalized message to the local DB.
4.  **Media Attachment Ingestion (Evolution-only)**:
    -   If the message is an image, audio, or document, webhook/history sync triggers `ingestEvolutionMediaAttachment(...)` asynchronously.
    -   The server calls `evolutionClient.getBase64FromMediaMessage(...)` (on-demand, not webhook base64).
    -   The media is uploaded to private R2 and saved as a `MessageAttachment`.
    -   **LID-safe behavior**: If inbound processing is deferred due to an unresolved `@lid`, media attachment ingestion is also deferred and runs after the LID retry worker successfully processes the message. This prevents the previous `message_not_found` race.
5.  **JIT Sync**: Server ensures the contact exists in GHL (`ensureRemoteContact`).
6.  **GHL Push**: Server pushes the inbound message to GHL using `type: 'Custom'` and `conversationProviderId` (caption or placeholder text for media).

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
4. **Identity-Aware Manual Fetch (Feb 26, 2026)**:
   - Manual history sync and new-conversation backfill now resolve multiple candidate chat JIDs instead of assuming only `phone@s.whatsapp.net`.
   - Candidate order (deduplicated): `Contact.lid` (`@lid`) -> explicit stored chat JID (if any) -> Evolution `checkWhatsAppNumber(...)` result JID -> `phone@s.whatsapp.net` fallback.
   - This fixes cases where manually-created leads (including international numbers) have WhatsApp history stored under an LID-backed chat identity.

#### Key Files
- **`app/(main)/admin/conversations/actions.ts`**: 
    - `syncWhatsAppHistory(conversationId, limit, ignoreDuplicates, offset)`: Core manual/background history sync action with duplicate-stop logic, optional paging, and LID-aware multi-candidate JID fetch.
    - `startNewConversation(phone)`: Initial Evolution backfill now reuses the same JID resolution strategy used by manual sync.
- **`lib/whatsapp/sync.ts`**: 
    - `processNormalizedMessage`: Updated to return a status (`{ status: 'skipped' | 'processed' }`) to enable the duplicate detection logic.
- **`app/(main)/admin/conversations/_components/conversation-interface.tsx`**: 
    - Calls `syncWhatsAppHistory` silently on conversation selection.
    - Updates the UI only if new messages are found.

#### Benefits
- **Zero Latency**: User sees cached messages immediately; new ones pop in if found.
- **Efficiency**: Stops processing as soon as it hits known history.
- **Resilience**: Manual button handles edge cases.

### 6. Private Media Storage for WhatsApp Media (Images, Audio & Documents) (Feb-Mar 2026)

We use a **single private Cloudflare R2 bucket** for WhatsApp media across environments:

- **Bucket**: `whatsapp-media` (private)
- **Environment separation**: enforced via object key prefix (`/env/{env}/...`)
- **Access pattern**:
  - Browser upload: short-lived presigned `PUT`
  - Evolution sendMedia fetch: short-lived presigned `GET`
  - App UI read: `GET /api/media/attachments/{attachmentId}` -> server-authenticated redirect to signed `GET`

#### Object Key Structure (Actual Implementation)

Outbound uploads (App -> Evolution):
```text
whatsapp/evolution/v1/env/{env}/location/{locationId}/contact/{contactId}/conversation/{conversationId}/outbound/{YYYY}/{MM}/{DD}/{uuid}.{ext}
```

Inbound attachments (Webhook/History -> R2):
```text
whatsapp/evolution/v1/env/{env}/location/{locationId}/contact/{contactId?}/conversation/{conversationId}/message/{messageId}/inbound/{uuid}.{ext}
```

#### Security Notes

- The R2 bucket is **private**. We do **not** store public URLs.
- `MessageAttachment.url` stores an internal `r2://bucket/key` URI for R2-backed files (schema-compatible, no migration required).
- `fetchMessages(...)` rewrites R2-backed attachments to `/api/media/attachments/{attachmentId}` for the UI.
- `fetchMessages(...)` now also returns attachment metadata (`url`, `mimeType`, `fileName`) so the chat UI can render **inline image previews**, **audio players**, and **document download links** for supported media attachments.
- We intentionally do **not** enable webhook base64 payloads globally. Media is fetched on demand using `getBase64FromMediaMessage(...)` to avoid oversized webhook payloads.

### 6.1 Media Re-fetch Recovery (Mar 2026)

To recover from stale/missing media storage objects without deleting the WhatsApp message itself, we added a **media re-fetch** path in Conversations:

- **UI trigger**: `message-bubble` renders a `Re-fetch Media` button for WhatsApp messages when:
  - the message has renderable media attachments (image/audio/document), or
  - the message body indicates a media placeholder (`[Audio]`, `[Image]`, `[Media]`).
- **Server action**: `refetchWhatsAppMediaAttachment(conversationId, messageId, options?)` in `app/(main)/admin/conversations/actions.ts`.
- **Lookup strategy**:
  - Requires local `Message.wamId`.
  - Resolves candidate JIDs using the same LID-aware strategy as history sync.
  - Pages Evolution `fetchMessages(...)` batches to find the exact `wamId`.
- **Recovery flow**:
  1. Snapshot existing `MessageAttachment` rows.
  2. Remove current attachment rows for that message.
  3. Re-run `ingestEvolutionMediaAttachment(...)` (Evolution `getBase64FromMediaMessage` -> R2 -> new `MessageAttachment`).
  4. If ingest fails or is skipped, restore original attachment rows.
  5. On success, delete old R2 object keys (`r2://...`) best-effort and return warnings if cleanup fails.

> [!IMPORTANT]
> Re-fetch only succeeds if Evolution/WhatsApp still returns media bytes for that historic message. If Evolution returns no base64 (`missing_base64`), there is nothing to recover automatically.

### 7. Emoji, Reactions, and Sticker Semantics (Feb 23, 2026)

To prevent emoji reactions/stickers from being mislabeled as generic media (`[Media]`), the Evolution integration now normalizes additional WhatsApp message types in **one shared parser** (`parseEvolutionMessageContent(...)`) and reuses it across:
- `POST /api/webhooks/evolution` (live webhooks)
- manual/smart history sync (`app/(main)/admin/conversations/actions.ts`)
- bulk sync (`app/api/whatsapp/sync/route.ts`)
- admin WhatsApp history fetch tools (`app/(main)/admin/settings/integrations/whatsapp/actions.ts`)

#### Current behavior
- **Emoji-only text messages** stay plain text (e.g. `👍`, `🔥🔥`).
- **Reactions** (`reactionMessage`) are stored as readable text, e.g. `Reaction: 👍` or `[Reaction removed]`.
- **Stickers** (`stickerMessage`) are stored as `Sticker: 😀` when WhatsApp includes a linked emoji, otherwise `[Sticker]`.
- **Media ingestion supports image, audio, and document types** (reactions/stickers are not ingested as attachments).

#### Why this matters
- GHL custom channels do not have native reaction objects, so we keep a human-readable text fallback for CRM sync.
- Using one parser in all sync paths prevents webhook/history mismatches (the most common cause of "`[Media]` for emoji" regressions).
- The parser preserves UTF-8 emoji content as text instead of coercing it into media placeholders.

### 8. New Conversation / Paste Lead Channel Detection (Feb 24, 2026)

To avoid defaulting every manually-created lead/thread to WhatsApp when the number is not actually registered, the app now performs an Evolution API lookup before deciding the conversation channel default:

- **Endpoint**: `POST /chat/whatsappNumbers/{instanceName}` (Evolution "Check is WhatsApp")
- **Used by**:
  - `startNewConversation(phone)` (New Conversation dialog)
  - `createParsedLead(...)` (Paste Lead import)
- **Behavior**:
  - If the phone is confirmed on WhatsApp, the conversation defaults to `TYPE_WHATSAPP`.
  - If not confirmed (or lookup fails / Evolution unavailable), it falls back to `TYPE_SMS`.

This only affects the **default channel selection** for newly created/imported conversations; it does not force-convert established email threads.

### 9. Live Inbox + Unread Behavior in Conversations UI (Feb 27, 2026)

To improve operational responsiveness during active WhatsApp handling in `/admin/conversations`, the chat UI now updates without page refresh:

- **Live Inbox Polling**: In chats + inbox view, the client polls `fetchConversations('active', activeId)` on a short interval.
- **Immediate Reorder**: Results are merged incoming-first, so conversations with a new WhatsApp message appear at the top immediately.
- **Unread Badge**: Conversation rows render `unreadCount` badges directly in the list (`99+` cap).
- **Read Reset for Active Thread**:
  - New server action: `markConversationAsRead(conversationId)` in `app/(main)/admin/conversations/actions.ts`
  - Called when opening a thread and during live refresh if that active thread has unread items.
- **Live Active Thread Refresh**: If the selected conversation summary changes (`lastMessageDate`/`lastMessageBody`), the message timeline is re-fetched silently.
- **Auto-scroll to Latest**: `ChatWindow` already auto-scrolls to bottom on message updates, so live inbound messages remain visible in the active thread.

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

# Cloudflare R2 (private WhatsApp media storage)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=whatsapp-media

# Optional but recommended (used in R2 object key prefix: /env/{APP_ENV}/...)
APP_ENV=production
```

`WHATSAPP_LID_RETRY_INTERVAL_MS` and `WHATSAPP_LID_MAX_ATTEMPTS` control deferred LID retry behavior.
The code also accepts `CLOUDFLARE_R2_*` aliases (and optional `R2_ENDPOINT` / `CLOUDFLARE_R2_ENDPOINT` overrides).

#### 2a. Cloudflare R2 CORS (Required for Browser Uploads)

The media upload flow uses a browser `PUT` to a presigned R2 URL, so the bucket needs CORS for your app origins.

Example CORS policy (adjust origins for local/staging/prod):
```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://estio.co"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

> [!IMPORTANT]
> Keep the bucket **private**. The app serves attachments via `GET /api/media/attachments/{attachmentId}`, which validates the current location session and then redirects to a short-lived signed R2 URL.

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
| **Manual "Sync WhatsApp History" finds no past messages for a manually-created lead (often international numbers)** | **Issue**: Evolution may store the chat under an LID (`@lid`) while older history sync queried only `phone@s.whatsapp.net`. **Fix**: Manual sync/new-conversation backfill now try multiple JIDs (`Contact.lid`, Evolution lookup JID, phone fallback). Check logs for `History fetch candidates ... selected=... found=...`. |
| **Media message exists but no attachment appears (especially `@lid` contacts)** | Older builds could ingest media before the deferred LID message row existed (`message_not_found`). **Fix**: Attachment ingest now waits for deferred LID resolution/processing, then retries automatically. Re-sync history to backfill previously missed attachments. |
| **Media row exists but playback/download fails (missing/corrupted object in R2)** | Use `Re-fetch Media` in the message bubble. It re-downloads by `wamId` from Evolution, restores DB rows on failure, and replaces storage only after successful ingest. |
| **WhatsApp media upload fails before send** | Check R2 env vars (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`) and bucket CORS for browser `PUT`. The upload action is `createWhatsAppMediaUploadUrl(...)`. |
| **"Uploaded media not found in media storage"** | The presigned upload may have expired or the browser upload failed. Re-upload the file, then call `sendWhatsAppMediaReply(...)` again. |
| **"Unsupported media type" / size errors** | Current allow-lists: images (`jpeg/png/webp/gif/heic/heif`), audio (`ogg/opus/mp3/m4a/webm/wav/aac`), and documents (`pdf/doc/docx/xls/xlsx/ppt/pptx/txt/zip/csv`). Current max size is `16MB` for image/audio and `100MB` for documents in `createWhatsAppMediaUploadUrl(...)`. |
| **Media shows in App but not in GHL as a binary attachment** | Expected for current implementation. GHL custom channel receives placeholder/caption text (`[Image]`, `[Audio]`, `[Document]`, or image/document caption); the binary is stored/displayed through our app + private R2 path. |
| **Conversation deep link opens but center panel says "Select a conversation"** | The selected conversation may be older than the currently loaded list page (or in Archived/Trash). Fixes now include (1) injecting the URL-selected conversation into the initial payload and (2) preserving the selected conversation during client list refetches. If reproducing from Contacts, ensure the link opens the correct `view` (`archived` / `trash`) when applicable. |

### 4. Server Logging & Debugging
To investigate issues like duplicate conversations or "Contact not found" errors for specific numbers:

Host and process names used by the current deploy script (`deploy-local-build.sh`):
- **SSH Host**: `root@138.199.214.117`
- **PM2 App**: `estio-app`
- **Evolution Compose File**: `docker-compose.evolution.yml`

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
5.  **Check Evolution Containers**:
    ```bash
    cd /home/martin/estio-app && docker compose -f docker-compose.evolution.yml ps
    ```
6.  **Find Image Webhook Payloads (file logs)**:
    ```bash
    grep -RIl '"imageMessage"' /home/martin/logs/evolution | head
    ```

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
grep -Rho '"remoteJid":"[^"]*"' /home/martin/logs/evolution/*.json | grep lid

# Find image messages
grep -RIl '"imageMessage"' /home/martin/logs/evolution | head

# Inspect image payload fields (caption, mime, url, directPath, fileLength)
grep -n -C 4 -E 'imageMessage|caption|mimetype|url|directPath|fileLength' /home/martin/logs/evolution/<file>.json
```

If `jq` is installed on the server, you can still use it for prettier inspection. (It is not installed by default on our current server.)

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


No Prisma migration was required for the Evolution image/R2 feature, but we now rely on:
-   `Location.evolutionInstanceId`
-   `Contact.ghlContactId`
-   `Contact.lid` — WhatsApp Lightweight ID for LID-to-phone mapping.
-   `Message.ghlMessageId` / `Message.wamId` mapping.
-   `Message.attachments` / `MessageAttachment` for WhatsApp media files (image/audio/document).
    -   For R2-backed attachments, `MessageAttachment.url` stores an internal `r2://bucket/key` URI.
    -   The UI receives `/api/media/attachments/{attachmentId}` URLs (signed at request time).
-   **CRITICAL DB ALTERATION**: `Contact` table columns `pushName` and `profilePicUrl` MUST be type `TEXT` or `VARCHAR(1000+)` to prevent crashes. Check migration history.

## Evolution Media Support (Images, Audio & Documents) (Feb-Mar 2026)

### Supported Flows

- **Outbound (App UI only)**: Users can send image, audio, and document attachments from the app conversation UI (paperclip icon) on WhatsApp conversations. This uses `createWhatsAppMediaUploadUrl(...)` + `sendWhatsAppMediaReply(...)`. Voice recording in the chat composer is sent through the same media action.
- **Inbound (Webhook + Manual History Sync + Backfill)**: Image, audio, and document messages received from Evolution webhooks and media messages discovered during sync/backfill paths are parsed and ingested into R2 asynchronously.
- **Display**: Existing `message-bubble` UI renders message attachments once `fetchMessages(...)` hydrates attachment URLs.
- **Recovery (Re-fetch by `wamId`)**: Users can re-fetch a WhatsApp media payload for a specific message from the conversation thread using `refetchWhatsAppMediaAttachment(...)`.

### Key Files (Media Path)

| File | Role |
|------|------|
| `lib/whatsapp/media-r2.ts` | Cloudflare R2 S3-compatible client, presigned URLs, key builders, `r2://` URI helpers, and object delete helper (`deleteWhatsAppMediaObject`) |
| `lib/whatsapp/evolution-media.ts` | Evolution message parsing + inbound media ingestion (`getBase64FromMediaMessage` -> R2 -> `MessageAttachment`) |
| `lib/evolution/client.ts` | Evolution `sendMedia(...)` and `getBase64FromMediaMessage(...)` client methods |
| `app/api/webhooks/evolution/route.ts` | Webhook parsing + async media ingestion trigger for `MESSAGES_UPSERT` |
| `app/(main)/admin/conversations/actions.ts` | `createWhatsAppMediaUploadUrl(...)`, `sendWhatsAppMediaReply(...)`, `syncWhatsAppHistory(...)`, `refetchWhatsAppMediaAttachment(...)`, attachment hydration in `fetchMessages(...)` |
| `app/(main)/admin/conversations/_components/message-bubble.tsx` | Inline image/audio/document rendering and `Re-fetch Media` UI control |
| `app/api/media/attachments/[attachmentId]/route.ts` | Authenticated attachment proxy -> short-lived signed R2 GET |

### Evolution Media Retrieval Endpoint (Important)

Our deployed Evolution API expects the media fetch request body in this shape:

```json
{
  "message": { "...": "full Evolution message record" }
}
```

This is used by `evolutionClient.getBase64FromMediaMessage(...)` and is required for inbound media ingestion.

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
5. **Manual history sync participates in LID reconciliation**:
   - `syncWhatsAppHistory(...)` and `startNewConversation(...)` backfill now try multiple remote JIDs (`@lid` and phone-based) before giving up.
   - Fetched history records pass `lid` and `resolvedPhone` hints into `sync.ts` to improve contact matching during backfill.

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
