# WhatsApp Integration

## Active Architecture

Estio uses two WhatsApp transports:

- **WhatsApp Web Bridge (`web_bridge`)** for normal linked-device chat: QR login, free-text messages, media, inbound replies, history sync, and mobile/web outbound echo.
- **Meta Cloud API (`cloud_primary`)** for official WABA operations: Embedded Signup, approved templates, template sends, health checks, and Meta-managed phone numbers.

Evolution API has been retired. Historical `whatsapp_evolution` records may remain readable, but no active runtime path calls Evolution.

## Normal Chat Flow

1. User connects WhatsApp through the Web Bridge QR flow.
2. `scripts/whatsapp-web-bridge-service.ts` owns the persistent `whatsapp-web.js` session.
3. Bridge events post to `/api/webhooks/whatsapp-web-bridge`.
4. Messages are normalized through the conversation engine and deduped by WhatsApp message id.
5. Outbound sends queue through `WhatsAppOutboundOutbox` and dispatch through Web Bridge.

## Media

New WhatsApp media uses Web Bridge storage paths under `whatsapp/web-bridge/v1/...` and private R2 attachments. Historical missing Evolution media is not re-fetched; the UI reports it as unavailable from a retired provider.

## Identity

Web Bridge identity resolution relies on WhatsApp Web metadata and `WhatsAppIdentityMap`. `@lid` identifiers are internal identities, not phone numbers. When no trusted phone is available, contacts stay phone-pending instead of inventing a fake number.
