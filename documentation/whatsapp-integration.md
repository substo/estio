# WhatsApp Integration: Shadow API ("Coexistence")
**Last Updated:** 2026-01-11
**Related:** [Legacy Integration](whatsapp-integration-legacy.md)

## Overview

This document describes the **Shadow API** implementation for WhatsApp Business integration. This approach effectively enables "WhatsApp Coexistence," allowing users to use the **official WhatsApp Business Mobile App** alongside the **Estio CRM** on the same phone number.

Unlike the official API (which often requires disconnecting the mobile app or complex Twilio setups), this solution uses a self-hosted "Linked Device" (Evolution API) to shadow the user's phone.

## 1. Architecture

### Core Concept: "Linked Device"
Instead of connecting strictly to the Meta Cloud API, we run a containerized instance of **Evolution API v2**, which emulates a WhatsApp Web client.
- The User scans a QR code from Estio Admin.
- Evolution API links as a "Linked Device".
- **Result**: Estio receives all messages (inbound & outbound) and can send messages on behalf of the user, while the user keeps their phone app (Primary Device) fully functional.

### Infrastructure Stack
- **Evolution API (v2)**: The core service (Node.js/Baileys).
- **Redis**: Caching for the API.
- **Postgres**: Persistent storage for session data.
- **Docker Compose**: Orchestration (`docker-compose.evolution.yml`).

```yaml
# Simplified docker-compose
evolution-api:
  image: atendai/evolution-api:v2.2.0
  # ... env vars ...
postgres:
  image: postgres:15-alpine
redis:
image: redis:alpine
```

### Data Model
New fields added to the `Location` model to manage this connection:
```prisma
model Location {
  // ...
  evolutionInstanceId       String?   // Maps to Location ID usually
  evolutionApiToken         String?   // Global API Key used for auth
  evolutionConnectionStatus String?   // "open", "connecting", "close"
}
```

## 2. Implementation Components

| Component | Path | Purpose |
|-----------|------|---------|
| **API Client** | `lib/evolution/client.ts` | Wraps HTTP calls to Evolution (Create Instance, Get QR, Send Msg, Logout) |
| **Webhook Handler** | `app/api/webhooks/evolution/route.ts` | Receives messages & status updates. **Crucial**: Syncs outbound messages (`fromMe: true`) sent from the phone. |
| **UI: Settings** | `app/(main)/admin/settings/integrations/whatsapp/page.tsx` | "Linked Device" card. Displays QR code, connection status, and connect/disconnect actions. |
| **Server Actions** | `app/(main)/admin/settings/integrations/whatsapp/actions.ts` | Orchestrates the connection flow. |

## 3. Coexistence Logic

The primary goal is **Full 2-Way Sync**.

### Inbound Messages (Customer -> Estio)
1. Customer sends message.
2. WhatsApp server delivers to Phone (Primary) & Evolution API (Linked Device).
3. Evolution API fires `MESSAGES_UPSERT` webhook to Estio.
4. `processNormalizedMessage` handles it as `direction: 'inbound'`.

### Outbound from Phone (User -> Customer)
1. User sends message from WhatsApp App on their phone.
2. WhatsApp server syncs this to Linked Devices.
3. Evolution API sees the message with `key.fromMe = true`.
4. Webhook fires to Estio.
5. **Estio Logic**:
   - Detects `fromMe: true`.
   - Sets `direction: 'outbound'`.
   - Stores in `Message` table.
   - **Result**: CRM Conversation history stays perfectly in sync with the phone.

### Outbound from Estio (CRM -> Customer)
1. User types in Estio Chat.
2. `lib/evolution/client.ts` calls `POST /message/sendText`.
3. Evolution API sends to WhatsApp servers.
4. Message appears on Customer's phone AND User's mobile app.

## 4. Setup & Usage

### server Deployment
The stack is deployed via `deploy-direct.sh`, ensuring Evolution API is running on port `:8080`.
- **URL**: `https://estio.co` (Proxied via Nginx usually, or direct port if exposed - *Note: Our dev setup currently exposes 8080 or proxies /evolution route*).
- **API Key**: Secured via `EVOLUTION_GLOBAL_API_KEY`.

### User Connection Flow
1. Go to **Settings > Integrations > WhatsApp**.
2. Click **Connect Linked Device**.
3. **QR Code** appears on screen.
4. Open **WhatsApp Business App** on phone.
5. Go to **Settings > Linked Devices > Link a Device**.
6. Scan the QR.
7. Status changes to **Connected**.

## 5. Troubleshooting

| Issue | Potential Cause | Fix |
|-------|-----------------|-----|
| **QR Code not loading** | API Down or Timeout | Check Docker logs: `docker logs evolution_api`. Restart generic stack. |
| **Double Messages** | Webhook processing logic flaw | Ensure deduplication in `lib/whatsapp/sync.ts` checks `wamId`. |
| **Disconnects** | Phone offline for 14+ days | Re-scan QR code. This is a Meta limitation for Linked Devices. |

## 6. Future Considerations vs Official API
This "Shadow API" is a robust **workaround**.
- **Pros**: Zero friction for BYON. Perfect history sync. No 24h template window restrictions (technically).
- **Cons**: Self-hosted infrastructure burden. Unofficial API usage (though widely used).
- If Meta eventually releases "True Coexistence" via API globally, we can migrate back to the Official API path (documented in [legacy docs](whatsapp-integration-legacy.md)).
