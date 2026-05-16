# WhatsApp Web Bridge Transition Progress

## Current State: Evolution Removed

Estio now uses two WhatsApp paths only:

- **WhatsApp Web Bridge (`web_bridge`)**: the linked-device transport for normal chat, QR pairing, free-text send/receive, media, history sync, and outbound echo from WhatsApp mobile/web.
- **Meta Cloud API (`cloud_primary`)**: the official WABA path for Embedded Signup, templates, health checks, and compliant template sends.

The **Evolution API has been removed from active runtime and product use**. Historical rows such as old `Message.source = "whatsapp_evolution"` may still exist for audit/readability, but Estio no longer creates, sends, syncs, repairs, reconciles, or re-fetches media through Evolution.

## Completed Removal

- Removed Evolution connection UI and legacy controls from WhatsApp settings and conversations.
- Removed the Evolution webhook route.
- Removed Evolution chat/history sync, contact lookup, LID probing, media re-fetch, diagnostics, and deployment runtime support.
- Removed Evolution client/runtime files and obsolete scripts.
- Removed `docker-compose.evolution.yml`.
- Updated deploy flow so only the app, Web Bridge worker, and supporting services are part of standard deployment.
- Added migration `20260516120000_remove_evolution_api` to:
  - move remaining `Location.whatsappProviderMode = 'evolution_linked'` rows to `web_bridge`.
  - drop `Location.evolutionInstanceId`, `Location.evolutionApiToken`, and `Location.evolutionConnectionStatus`.
- Kept historical provider/source strings readable in message/sync records.

## Active WhatsApp Responsibilities

- `/admin/conversations` status and QR pairing use Web Bridge only.
- Normal text/media sends use Web Bridge.
- Template sends and template management use Cloud API.
- History sync and chat picker use Web Bridge.
- Web Bridge LID identity uses WhatsApp metadata plus `WhatsAppIdentityMap`; unresolved LIDs stay phone-pending.
- Missing media from historical Evolution messages is shown as unavailable from a retired provider.

## Deployment Checklist

1. Run the deploy script normally.
2. Run Prisma migrations on the server if the deploy script did not already apply them:
   ```bash
   npx prisma migrate deploy
   ```
3. Confirm the Web Bridge worker is running:
   ```bash
   pm2 status estio-whatsapp-web-bridge
   pm2 logs estio-whatsapp-web-bridge --lines 100
   ```
4. Confirm `WHATSAPP_WEB_BRIDGE_SESSION_DIR` points to a persistent path outside release folders.
5. Pair WhatsApp from Estio if the session is not already restored.

## Manual Acceptance

- Web Bridge QR opens and closes after pairing.
- Status becomes Online from another browser/laptop without re-pairing.
- Estio sends free-text WhatsApp messages.
- Replies from contacts appear in the same conversation.
- Messages sent manually from WhatsApp mobile/web echo into Estio.
- Image/audio/document receive and send paths work through Web Bridge.
- Cloud API templates still sync, submit, and send.
- Old Evolution messages still render if their attachments are already stored.
