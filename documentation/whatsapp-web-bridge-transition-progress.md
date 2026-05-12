# WhatsApp Web Bridge Transition Progress

Last updated: 2026-05-12

## Purpose

This document tracks the transition from Evolution API as the primary linked-device WhatsApp path to a first-party `whatsapp-web.js` Web Bridge.

The target product split is:

- **WhatsApp Web Bridge (`web_bridge`)**: primary transport for normal WhatsApp chat, QR login, online/offline status, free-text sends, inbound replies, manual mobile/web outbound echo, and media.
- **Cloud API (`cloud_primary`)**: official Meta/WABA workflows, templates, approved template sends, Embedded Signup, health checks, and compliance-safe enterprise messaging.
- **Evolution API (`evolution_linked`)**: temporary legacy fallback only, kept for old records, old imports, legacy media parsing, LID/contact helpers, and rollback during live testing.

## Why This Transition Exists

Cloud API cannot deliver the exact “normal WhatsApp app” experience by design. It has Meta template and customer-service-window rules, and it does not mirror every manual WhatsApp mobile/web outbound message as if Estio were the same official app.

The Web Bridge fills that product gap by running a linked-device WhatsApp Web session under our own control. This is operationally more fragile than Cloud API, so it is isolated as a separate worker/service and kept replaceable.

## Current Implementation State

### Already Implemented

- Added `web_bridge` as a WhatsApp transport/provider mode.
- Added `WhatsAppWebBridgeSession` Prisma model.
- Added Web Bridge service script:
  - `scripts/whatsapp-web-bridge-service.ts`
  - Uses `whatsapp-web.js` + `LocalAuth`.
  - Runs as a long-lived worker, not inside Next.js request lifecycle.
  - Supports `qr`, `ready`, `authenticated`, `auth_failure`, `disconnected`, `message`, `message_create`, and `message_ack`.
  - Supports outbound text/media via `client.sendMessage`.
  - Supports chat listing and recent message fetch for Web Bridge locations.
- Added app-side Web Bridge helper:
  - `lib/whatsapp/web-bridge.ts`
  - Starts/stops/clears sessions.
  - Sends messages.
  - Fetches chats/messages.
  - Normalizes WhatsApp Web chat IDs and multi-device IDs.
- Added internal webhook:
  - `app/api/webhooks/whatsapp-web-bridge/route.ts`
  - Routes inbound, outbound echo, and ack updates into the existing conversation engine.
- Added Web Bridge inbound media ingestion:
  - `lib/whatsapp/web-bridge-media.ts`
  - Downloads media in the worker, sends base64 to the app webhook, stores it in the existing R2/message attachment system, and queues audio transcription for audio attachments.
- Updated conversation status:
  - `/admin/conversations` reads Web Bridge status/QR by default.
  - Evolution status/QR only appears when `whatsappProviderMode === "evolution_linked"`.
- Updated outbound routing:
  - `web_bridge` sends normal free-text/media.
  - `cloud_primary` remains the path for Cloud API/template behavior.
  - WhatsApp template sends remain Cloud API only.
  - Resend now uses the selected transport instead of hardcoding Evolution.
- Updated new conversation flow:
  - The picker now calls a generic `fetchWhatsAppChats`.
  - Web Bridge locations fetch chats/history from Web Bridge.
  - Evolution locations continue using Evolution legacy chat import.
- Added Evolution fences:
  - Evolution webhook data events are ignored for non-`evolution_linked` locations.
  - Evolution reconciliation skips non-`evolution_linked` locations.
  - Legacy `/api/whatsapp/sync` only runs for explicit Evolution legacy locations.
- Updated defaults:
  - New `Location.whatsappProviderMode` default is now `web_bridge`.
  - Migration added: `20260512120000_whatsapp_web_bridge_default`.
- Deployment script already ensures a PM2 process for `start:whatsapp-web-bridge`.

### Verification Completed

- `npm run build` passed.
- Focused WhatsApp tests passed:

```bash
npx tsx --test lib/whatsapp/web-bridge.test.ts lib/whatsapp/templates.test.ts lib/whatsapp/client.test.ts lib/whatsapp/identity.test.ts
```

- Full `tsc` note:
  - Default heap run hit Node OOM.
  - 8GB heap run did not return in a reasonable time and was stopped.
  - Current confidence is based on successful production build and focused tests.

## Files To Know

- Conversation UI status:
  - `app/(main)/admin/conversations/_components/whatsapp-status.tsx`
- Conversation actions, routing, resend, new conversation:
  - `app/(main)/admin/conversations/actions.ts`
- New conversation picker:
  - `app/(main)/admin/conversations/_components/new-conversation-dialog.tsx`
- Web Bridge service:
  - `scripts/whatsapp-web-bridge-service.ts`
- Web Bridge app helper:
  - `lib/whatsapp/web-bridge.ts`
- Web Bridge media ingestion:
  - `lib/whatsapp/web-bridge-media.ts`
- Web Bridge webhook:
  - `app/api/webhooks/whatsapp-web-bridge/route.ts`
- Evolution legacy webhook:
  - `app/api/webhooks/evolution/route.ts`
- Evolution legacy sync:
  - `app/api/whatsapp/sync/route.ts`
- Evolution reconciliation:
  - `app/api/cron/whatsapp-reconciliation/route.ts`
- Unified WhatsApp conversation ingestion:
  - `lib/whatsapp/sync.ts`
- Outbound outbox processor:
  - `lib/whatsapp/outbound-outbox.ts`
- Outbound enqueue:
  - `lib/whatsapp/outbound-enqueue.ts`
- WhatsApp settings:
  - `app/(main)/admin/settings/integrations/whatsapp/page.tsx`
  - `app/(main)/admin/settings/integrations/whatsapp/actions.ts`

## Environment And Runtime Requirements

Required or expected environment values:

- `WHATSAPP_WEB_BRIDGE_URL`
  - App-side URL for the bridge worker.
  - Default: `http://127.0.0.1:3218`.
- `WHATSAPP_WEB_BRIDGE_PORT`
  - Worker port.
  - Default: `3218`.
- `WHATSAPP_WEB_BRIDGE_SECRET`
  - Shared secret between app and bridge.
  - Falls back to `CRON_SECRET` when absent.
- `WHATSAPP_WEB_BRIDGE_APP_WEBHOOK_URL`
  - Worker-to-app webhook.
  - Default: `http://127.0.0.1:3000/api/webhooks/whatsapp-web-bridge`.
- `WHATSAPP_WEB_BRIDGE_SESSION_DIR`
  - Persistent LocalAuth session path.
  - Must survive deploys/restarts.
- `WHATSAPP_WEB_BRIDGE_MAX_INLINE_MEDIA_BYTES`
  - Max media size sent inline from worker to app webhook.
  - Default: 25 MB.

Runtime:

```bash
npm run start:whatsapp-web-bridge
```

The production deploy script starts this under PM2 using the app name:

```text
estio-whatsapp-web-bridge
```

## Manual Live Acceptance Checklist

Use one test location configured as `web_bridge`.

1. Open `/admin/conversations`.
2. Confirm WhatsApp status shows `Offline` with `Connect` if no session is ready.
3. Click `Connect`.
4. Scan the QR code from WhatsApp mobile: `Linked Devices -> Link a Device`.
5. Confirm status becomes `Online`.
6. Send a free-text message from Estio.
7. Confirm the message arrives in WhatsApp.
8. Send a manual message from WhatsApp mobile/web to the same contact.
9. Confirm the manual outbound message appears in Estio without waiting for the contact to reply.
10. Send an inbound reply from the contact.
11. Confirm inbound appears in Estio.
12. Send/receive image, audio, and document.
13. Confirm attachments appear in Estio and audio queues transcription where applicable.
14. Restart the Web Bridge PM2 process.
15. Confirm the session reconnects without QR when possible.
16. Disconnect the linked device from WhatsApp mobile.
17. Confirm Estio shows offline/disconnected.

## Next Phases

### Phase 1: Commit, Deploy, And Smoke Test

- Apply database migrations on the target server.
- Deploy the app and Web Bridge worker.
- Confirm PM2 has both the main app and `estio-whatsapp-web-bridge`.
- Pair one test location via QR.
- Run the manual live acceptance checklist.

### Phase 2: Harden Worker Operations

- Confirm session directory persists across blue/green deploys.
- Add log rotation or log grouping for Web Bridge events.
- Add dashboard/admin diagnostics for:
  - session status
  - connected phone
  - last ready time
  - last seen time
  - last error
  - restart/disconnect/clear session actions
- Add alerting for bridge down, repeated auth failures, and stale ready sessions.

### Phase 3: Improve Media Reliability

- Test large files, voice notes, documents, and images from both directions.
- Decide whether the 25 MB inline media limit is enough or whether the worker should stream/upload directly to R2.
- Add retry/dead-letter tracking for failed media ingestion.
- Add UI indicators when media exists but ingestion failed.

### Phase 4: Finish History And Contact Replacement

- Expand Web Bridge history/backfill coverage.
- Replace remaining normal-user “import from Evolution” flows with Web Bridge equivalents.
- Keep Evolution import only in an advanced legacy/admin area.
- Add support for controlled one-off backfill from Web Bridge chats.

### Phase 5: Identity And Dedup Hardening

- Add more Web Bridge-specific tests for:
  - inbound text
  - manual outbound echo
  - app-sent outbound echo dedupe
  - media message dedupe
  - ack/read status updates
- Audit contacts created from Web Bridge to ensure no phone-less placeholders are created when a phone is available.
- Keep groups/newsletters/channels out of normal v1 unless intentionally prioritized.

### Phase 6: Evolution Product Deprecation

- Hide Evolution from normal user settings.
- Keep a legacy/admin panel for existing `evolution_linked` locations.
- Keep old `whatsapp_evolution` records readable.
- Keep Evolution media parser only for historical messages.
- Do not remove Evolution DB columns until all active locations have migrated and old data retention is decided.

### Phase 7: Final Evolution Removal

Only after live stability:

- Remove Evolution runtime dependency from deployment.
- Remove Evolution connection UI.
- Remove Evolution background jobs.
- Remove Evolution normal chat import flows.
- Keep or migrate historical source metadata as needed.

## Known Caveats

- Web Bridge is linked-device automation and can break when WhatsApp Web changes.
- Cloud API is still the official Meta-compliant enterprise path.
- Web Bridge media currently travels from worker to app webhook as inline base64 up to the configured size limit.
- Groups/newsletters/channels are intentionally not part of the first normal-chat scope.
- Existing Evolution historical messages must remain readable during the transition.

## Rollback Strategy

For a location that has issues with Web Bridge:

1. Change `whatsappProviderMode` to `evolution_linked`.
2. Reconnect/check Evolution legacy session.
3. Confirm `/admin/conversations` shows the legacy badge.
4. Use legacy Evolution sync/import while debugging Web Bridge.

Cloud API template flows should remain unaffected by Web Bridge rollback.
