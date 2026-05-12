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

## Phase 1 Completed: Live Chat Connection Smoke Test

Production smoke testing confirmed the first Web Bridge path is usable:

- QR pairing works from the Estio UI.
- Online/offline status works on `/admin/conversations`.
- Sending WhatsApp messages from Estio works through the default Web Bridge number.
- Tested reference conversation:
  - `https://estio.co/admin/conversations?id=cmmna7umo00a1a4i7bj7ujw61`

Remaining live checks from the original acceptance checklist:

- Manual outbound echo from WhatsApp mobile/web appears in Estio without a contact reply.
- Inbound replies appear in Estio.
- Image/audio/document media appears with attachments.
- Bridge process restart restores sessions without QR when possible.
- Disconnecting the linked device from WhatsApp mobile moves Estio to offline/disconnected.

## Phase 2 Completed: Operations Hardening

Phase 2 was deployed after production QR/status/send succeeded. It focused on reliability and observability, not new chat features.

Implemented in this phase:

- Worker `/health` now returns structured service health:
  - `ok`
  - `uptimeSeconds`
  - `sessionCount`
  - per-session `sessionId`, `locationId`, `ready`, `phone`, `status`, `startedAt`, `lastEventAt`, `lastReadyAt`, `lastError`
  - `sessionDir`
  - `maxInlineMediaBytes`
- Worker tracks runtime metadata in memory for each browser session.
- Worker logs important lifecycle events:
  - QR generated
  - authenticated
  - ready
  - disconnected
  - auth failure
  - webhook emit failure
  - persisted-session bootstrap failure
- App helper added:
  - `getWhatsAppWebBridgeHealth()`
  - `restartWhatsAppWebBridgeSession()`
- Settings server action added:
  - `getWhatsAppWebBridgeDiagnostics(locationId?)`
  - combines database session state and worker health.
  - detects stale DB-ready sessions when the worker has no matching ready session.
  - detects unreachable worker, failed/auth/disconnected states, and returns an actionable message.
- WhatsApp settings Web Bridge card now shows:
  - service reachable/unreachable
  - worker uptime
  - worker session registered/ready
  - DB status
  - connected phone
  - last ready
  - last seen
  - worker/session errors
  - stale-session warning
  - health URL
  - session directory
  - inline media limit
- Admin controls are clearer:
  - `Connect` starts the bridge and keeps provider mode as `web_bridge`.
  - `Restart Session` stops and starts the worker session while preserving LocalAuth files.
  - `Disconnect` stops the worker session while preserving pairing files where possible.
  - `Clear Session` removes LocalAuth pairing files and forces a fresh QR.

Phase 2 acceptance checklist:

1. Refresh WhatsApp settings and confirm diagnostics render.
2. Confirm worker reachable status is shown.
3. Confirm worker uptime and session count are shown.
4. Restart PM2 bridge process and confirm diagnostics recover.
5. Disconnect from WhatsApp mobile linked devices and confirm UI shows disconnected/stale state.
6. Use `Clear Session`, then confirm QR is required again.
7. Reconnect and confirm normal send still works.

## Current Phase: Phase 3 Media Reliability

Phase 3 hardens image/audio/document send and receive for the already-working Web Bridge.

Implemented in this phase:

- Worker media serialization now includes structured `mediaMeta` and `mediaError`.
- Worker logs media download success, oversized media, missing mimetype, unsupported type, and download failure.
- Worker recent-message fetch can include media payloads for recovery.
- Web Bridge media ingestion validates base64 decode output before uploading.
- Web Bridge media type handling covers image, audio, document, PDF, text, and common Office mimetypes.
- Web Bridge media ingestion returns structured failure/skip reasons.
- Web Bridge webhook stores media ingestion state in the `MessageSync.metadata.webBridgeMedia` record.
- Conversation bubbles show a clear `Media not stored` warning for Web Bridge media messages with no attachment.
- Existing `Re-fetch Media` can now recover Web Bridge media from recent WhatsApp Web history when the worker can still retrieve it.
- Web Bridge outbound media send errors are clearer for signed URL read failures, disconnected bridge sessions, invalid recipients, and WhatsApp Web send failures.

Phase 3 acceptance checklist:

1. Inbound client image stores and renders in Estio.
2. Inbound client audio stores, renders, and queues transcription.
3. Inbound client document stores and renders.
4. Manual WhatsApp mobile/web outbound image/audio/document echoes into Estio.
5. Estio outbound image/document sends through Web Bridge.
6. Oversized media shows an actionable warning instead of silently disappearing.
7. Failed media can be retried with `Re-fetch Media` or clearly explains why recovery is not possible.

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
  - Restarts sessions while preserving LocalAuth pairing files.
  - Fetches worker health.
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

Production checks:

```bash
pm2 status estio-whatsapp-web-bridge
pm2 logs estio-whatsapp-web-bridge --lines 100
curl -H "x-whatsapp-web-bridge-secret: $WHATSAPP_WEB_BRIDGE_SECRET" http://127.0.0.1:3218/health
```

Important deployment note:

- `WHATSAPP_WEB_BRIDGE_SESSION_DIR` must point to persistent storage that survives deploys and PM2 restarts. If this directory is wiped between deploys, every location will need a fresh QR pairing.

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

### Phase 3: Improve Media Reliability

Status: current implementation phase. Remaining live validation decides whether Phase 4 should include direct worker-to-R2 upload for large media.

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
