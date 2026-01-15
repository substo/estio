# WhatsApp Integration: Custom Channel ("Linked Device")
**Last Updated:** 2026-01-13
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

#### B. Inbound (WhatsApp -> GHL)
1.  **Webhook**: Evolution API receives message.
2.  **Processing**: `lib/whatsapp/sync.ts` normalizes the message.
3.  **JIT Sync**: Server ensures the contact exists in GHL (`ensureRemoteContact`).
4.  **GHL Push**: Server pushes the inbound message to GHL using `type: 'Custom'` and `conversationProviderId`.

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
Add the Provider ID to your `.env`:
```env
GHL_CUSTOM_PROVIDER_ID=696637215906b847a442aa45
```

### 3. Status Tracking & Resend Logic
We track message delivery status (`sent`, `delivered`, `read`, `failed`) by listening to Evolution API's `messages.update` webhook event.
- **Mapping**: Evolution statuses (SERVER_ACK, DELIVERY_ACK, READ) map to our DB status enum.
- **Resend**: A server action `resendMessage(messageId)` allows retrying failed messages. It re-uses the existing DB record but generates a new `wamId`.

## Troubleshooting & Fixes

| Issue | Fix |
|-------|-----|
| **"Unsuccessful" Message** | Ensure you are using the Custom Channel ID and not `type: 'WhatsApp'`. Verify `GHL_CUSTOM_PROVIDER_ID` in `.env`. |
| **Duplicates in GHL** | Check loop prevention logic in `custom-provider/route.ts`. Ensure `wamId` is stored before generic sync runs. |
| **Split Brain (Offline/Online)** | **Production Only**: Local Development environments connect to their own Evolution instances but share the Production Database. To prevent Local from setting the Prod DB status to "Offline", we wrapped the DB status update in `if (process.env.NODE_ENV === 'production')` in `actions.ts`. |
| **Evolution API Crash Loop** | **Error P2000**: "Value too long". Occurs if a Contact name or Profile Pic URL exceeds 191 chars. **Fix**: Manually altered the Postgres `Contact` table columns (`pushName`, `profilePicUrl`) to `TEXT` (unlimited length). |
| **QR Code Broken Image** | The UI component was double-embedding the base64 prefix. Fixed in `whatsapp-status.tsx`. |
| **Duplicate Conversations (Same Contact)** | **Issue**: Race conditions can create multiple conversations for one contact. **Fix**: Run `scripts/merge-same-contact-conversations.ts` to merge them. **Prevention**: Logic updated to search last 2 digits for robust matching (`sync.ts`). |

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

## Production Resilience (Jan 2026)

The following safeguards are in place to prevent and recover from Evolution API failures:

### Docker Auto-Restart
- **Container Policy**: All Evolution containers (`evolution_api`, `evolution_postgres`, `evolution_redis`) have `restart: always` policy.
- **Server Reboot Recovery**: `deploy-direct.sh` runs `docker update --restart=always` after each deploy to ensure containers survive server reboots.

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

## Data Model (Prisma)


No schema changes required specifically for this, but we rely on:
-   `Location.evolutionInstanceId`
-   `Contact.ghlContactId`
-   `Message.ghlMessageId` / `Message.wamId` mapping.
-   **CRITICAL DB ALTERATION**: `Contact` table columns `pushName` and `profilePicUrl` MUST be type `TEXT` or `VARCHAR(1000+)` to prevent crashes. Check migration history.
