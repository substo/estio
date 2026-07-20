# Android device egress for WhatsApp Web

This subsystem routes an explicitly bound WhatsApp Web browser session through the paired Android device's active network. It does not make the browser a mobile WhatsApp client, associate an IP address with a SIM number, or modify browser fingerprints.

## Delivery progress

Last updated: 2026-07-20.

- PR 1, node registry and PostgreSQL fenced-lease primitives, is deployed as commit `6c53c5e` with migration `20260719160000_device_tunnel_node_registry_leases`.
- PR 2, distributed outbound rate limiting and per-session dispatch serialization, is deployed as commit `0d6c77a` with migration `20260719180000_whatsapp_distributed_rate_limits`.
- PR 3, node-scoped tokens and assignment-aware routing, is deployed and verified as commit `a2bcb4a`. It required no migration.
- PR 4, co-located runtime ownership, is code-deployed from `86cf242`. It required no migration; distributed placement and runtime lease enforcement remain unset/off, so its authoritative lease path is inactive.
- The 2026-07-20 ingress lifecycle hotfix is deployed through `ed8fd87` (`272f265`, `1c67a31`, and `ed8fd87`). Active readiness, gateway-generation rebinding, orphan Chromium cleanup, and safe `r` fallbacks restored live history access; the bounded backfill replayed 21 recent messages with zero failures.
- Production remains on the compatibility path: distributed placement and runtime lease enforcement are off, and outbound rate limiting is disabled by default. The deployments preserved one healthy Android tunnel and did not add a node.
- PR 5's storage architecture is selected and implementation is in progress: immutable quiesced profile snapshots in private R2, AES-256-GCM envelope encryption under a dedicated Google Cloud KMS key, and PostgreSQL single-writer placement fencing. PRs 6–7 remain two-node operations/canary, then compatibility cleanup and final security review.
- The PR 5 foundation migration and tested placement/crypto/KMS/R2/archive primitives are implemented. They remain unwired from the bridge so production still uses the existing host-local directory; the next slice must add the complete stopped-browser checkpoint/restore lifecycle before the durable mode can be enabled.

See the [horizontal implementation plan](./horizontal-device-egress-plan.md#implementation-status) for the implementation record, remaining migrations, acceptance criteria, dependencies, and rollback boundaries for every PR.

## Required production configuration

```dotenv
DEVICE_TUNNEL_JWT_SECRET=<independent random secret, at least 32 bytes>
DEVICE_TUNNEL_INTERNAL_SECRET=<independent random secret, at least 32 bytes>
DEVICE_TUNNEL_PUBLIC_URL=wss://estio.co/device-tunnel
DEVICE_TUNNEL_GATEWAY_PORT=3220
DEVICE_TUNNEL_GATEWAY_URL=http://127.0.0.1:3220
DEVICE_TUNNEL_GATEWAY_NODE_ID=cyprus-egress-1
DEVICE_TUNNEL_GATEWAY_REGION=cyprus
DEVICE_TUNNEL_GATEWAY_CAPACITY_SESSIONS=100
DEVICE_TUNNEL_JTI_CACHE_MAX_ENTRIES=10000
DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT=false
DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT=false
# Required on both co-located processes only for a later enabled canary:
# DEVICE_TUNNEL_RUNTIME_OWNER_INSTANCE_ID=<unique deployment instance ID>
# DEVICE_TUNNEL_RUNTIME_LEASE_TTL_MS=30000
# DEVICE_TUNNEL_RUNTIME_LEASE_RENEW_INTERVAL_MS=10000
WHATSAPP_RATE_LIMIT_MODE=disabled
# PR 5 code remains dormant until a later explicitly approved canary:
# WHATSAPP_SESSION_AUTH_MODE=local
# WHATSAPP_SESSION_AUTH_KMS_KEY_PATH=projects/<project>/locations/<region>/keyRings/<ring>/cryptoKeys/<auth-key>
# WHATSAPP_SESSION_AUTH_R2_BUCKET=<private-auth-bucket>
# WHATSAPP_SESSION_AUTH_R2_ACCESS_KEY_ID=<auth-bucket-only-access-key>
# WHATSAPP_SESSION_AUTH_R2_SECRET_ACCESS_KEY=<auth-bucket-only-secret-key>
# WHATSAPP_SESSION_AUTH_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
```

`deploy-local-build.sh` starts the gateway when both secrets exist and adds the Caddy `/device-tunnel/*` WebSocket route. Apply the Prisma migration before binding a device. Rebuild and distribute the Android application so it can enroll its hardware-backed key.

The SIM Relay integration page shows the live tunnel state and the last verified WhatsApp send. Immediately before a send, the gateway snapshots the assigned tunnel's byte counters and issues a one-time nonce. A proof is written only after WhatsApp Web reports success and the gateway confirms that browser-to-phone bytes increased inside that send window. The receipt contains a truncated one-way message hash, masked phone connection IP, network type, gateway node, per-send traffic delta, and timestamps; it does not store message content or the recipient.

The gateway registers `DEVICE_TUNNEL_GATEWAY_NODE_ID` in PostgreSQL and heartbeats every 15 seconds. Use one stable ID per deployed gateway; do not derive it from a PID or container restart. Keep `DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT=false` during the PR 1 rollout. With the flag disabled, node registry fields are populated but assignment and lease enforcement are not activated, so the existing single-host browser-to-loopback-SOCKS path remains unchanged. Enabling the flag requires an explicit node ID and is reserved for the later routing/ownership phases.

PR 3 keeps that flag-off routing behavior: token exchange returns the global `DEVICE_TUNNEL_PUBLIC_URL`, and gateway connect/disconnect observations may continue updating `gatewayNodeId` as before. With distributed placement enabled in a later controlled phase, bind/token exchange keeps an eligible current assignment or selects a healthy online, non-draining node with capacity. The binding row is locked transactionally; a node ownership change increments `assignmentEpoch`, while a stable assignment does not. The endpoint returns the assigned registry node's validated WSS URL. Node URLs must be credential-free WebSocket URLs with no query or fragment; production accepts only `wss://`.

PR 4 runtime enforcement activates only when both `DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT` and `DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT` are `true`. The gateway and bridge must share the same stable gateway node ID and the same unique deployment-instance owner ID. The gateway acquires the existing PostgreSQL lease before listening on a loopback SOCKS port, renews it on a bounded cadence, and passes both assignment and lease epochs to the bridge. New proxy work, Chromium startup, browser readiness, send-proof start and verification, webhook mutations, and proof persistence all require the exact current tenant/session/binding/node/assignment/owner/lease scope. Two missed renewals, lease expiry, reassignment, node drain, or binding drain stop new work, close tunnel streams, and stop only the browser carrying the fenced descriptor. Ownership gaps keep outbox work `blocked_egress` without incrementing the provider attempt count.

### Gateway restart and ingress-readiness invariant

A device-tunnel gateway restart destroys its loopback SOCKS listeners even when the Android tunnel reconnects successfully. A browser launched against the old listener must never be preserved merely because its in-memory WhatsApp `ready` flag remains true. Every gateway process therefore exposes a new opaque `gatewayGeneration`; the bridge records the generation used to obtain its proxy and restarts/rebinds the browser whenever the current generation differs. This applies with distributed placement and runtime lease enforcement both off as well as on.

Bridge readiness is active, not cached. A ready session must complete a bounded WhatsApp Web collection probe and a no-content heartbeat through the application webhook within the freshness window. A failed or stale probe removes the session from readiness, and stale browser errors trigger the bounded restart path. The opaque `whatsapp-web.js` error `r` can mean either a stale page or a failure while fully serializing one cached chat or message model. Chat-list and history reads therefore attempt a narrow lightweight/raw-model fallback first. The history fallback reads the cached collection directly and maps only the webhook fields; it must not call `WWebJS.getMessageModel()`, because that re-enters the failing whole-model serializer. Browser-evaluated fallback closures must also be tested after the production TypeScript transform: locally assigned callback functions can acquire a transpiler helper reference that does not exist inside the page, so in-page filters remain inline and self-contained. `r` triggers the bounded stale restart when that safe fallback also fails. An isolated media fetch may still fail without restarting the browser.

All follow-up PRs must preserve and test this lifecycle ordering: fully stop the prior browser and release its persistent-profile lock, start the gateway generation, wait for Android reconnect and proxy creation, bind one new browser, then require active browser-plus-webhook readiness. Deployment or failover tooling must not preserve a browser across a gateway generation change, must not leave orphan Chromium children after the bridge exits, must not rely on PM2 reachability or cached `ready`, and must verify ingress as well as outbound egress before declaring the session healthy.

### Durable session-auth decision

PR 5 does not use one Hetzner Volume per session: the provider permits only 16 attached Volumes per server and supplies no Volume snapshot/backup facility, which does not fit the planned node density or recovery requirements. It also does not use the installed `whatsapp-web.js` 1.34.7 `RemoteAuth` loop directly because that implementation periodically archives profile directories while Chromium is live and does not remove local scratch on `destroy()`.

The selected provider stores immutable encrypted profile generations in a private Cloudflare R2 auth bucket. Each generation has a random AES-256-GCM data key wrapped by a dedicated Google Cloud KMS key; the KMS key and R2 credentials are separate from application, database, settings, and tunnel secrets. PostgreSQL stores only non-secret placement, monotonically increasing `authEpoch`, object/integrity metadata, and audit state. Attach is bounded to 120 seconds and checkpoint/detach to 180 seconds. A checkpoint is allowed only after the exact browser tree has stopped and released its profile lock. Restore verifies the encryption tag, ciphertext and plaintext digests, size bounds, safe archive paths, and required profile directories before Chromium can start.

The current verified generation, seven daily points, four weekly points, and a superseded last-known-good generation for at least 30 days are retained under unique object keys. Corrupt generations are quarantined; recovery increments `authEpoch` and may try only an older verified generation. If none restores, the session becomes `relink_required`. Rollback follows the same fence-stop-verify-restore sequence and never resets assignment, lease, or auth epochs. Production remains in `local` mode throughout PR 5; distributed placement and runtime lease enforcement remain off, no second node is added, and no server-egress fallback is introduced.

After deploying the node-registry migration, verify the node's `status`, `lastHeartbeatAt`, `activeSessions`, configured URLs, region, capacity, and version in `DeviceTunnelGatewayNode`. A heartbeat update is scoped to both node ID and process `startedAt`; an older process cannot overwrite a replacement process's heartbeat.

## Distributed outbound rate limits

`WHATSAPP_RATE_LIMIT_MODE` supports a phased rollout:

- `disabled` keeps the current production send path unchanged and does not contact the limiter.
- `shadow` evaluates and records Redis sliding-window counters but does not delay sends; Redis errors are logged and allowed in this mode.
- `enforce` serializes provider dispatch per WhatsApp session with Redis plus a PostgreSQL safety lock. Redis failure fails closed and reschedules the outbox row without increasing `attemptCount`.

The default policy applies session limits of 3 sends per 10 seconds, 6 per minute, 120 per hour, and 100 per day for sessions younger than seven days or 500 per day for established sessions. Recipient limits are 3 per minute and 20 per day. Daily limits are delayed until the next window and surface a “pending review” reason; there is not yet a durable manual approval queue. `WhatsAppRateLimitPolicy.limits` can override the named values documented in `lib/whatsapp/rate-limit.ts`; keep overrides conservative and review consent, complaints, account age, and delivery quality before raising them.

Rate-limited outbox rows use status `rate_limited`, retain their current provider `attemptCount`, and expose `rateLimitReason`, `rateLimitNextEligibleAt`, and jittered `scheduledAt` values to the conversations UI. Enable `shadow` first, observe at least one complete daily cycle, then enable `enforce` only after Redis and queue dashboards are healthy.

## Activation

1. Pair the updated Android app from SIM Relay settings.
2. In the **WhatsApp network relay** panel, assign the device.
3. Confirm the tunnel status becomes `online`.
4. Restart or reconnect the location's WhatsApp Web session. The bridge refuses to start when the assigned tunnel is offline.

Disabling the binding returns the session to server egress; this is an explicit administrator action, never an automatic fallback.

## Security properties

- Android keeps its P-256 private key in Android Keystore.
- A valid SMS Relay device token can request a short-lived challenge, but only a signature from the enrolled device key can exchange it for a five-minute tunnel token.
- Tunnel JWTs contain `aud`, `nodeId`, `sessionId`, `bindingId`, `deviceId`, `locationId`, `assignmentEpoch`, `jti`, `iat`, and `exp`. Issuance rechecks the tenant, current device token hash and credential version, enrolled key, binding, and session egress mode after consuming the one-time challenge; distributed issuance also rechecks assignment, node health, and the registry WSS URL. Every successful device-key enrollment increments `tunnelCredentialVersion`, so an older token cannot survive re-pairing.
- The gateway verifies signature and audience, rejects tokens for another node, and rechecks current tenant/device/binding/session/assignment epoch and device credential state before creating a proxy. Each JTI is consumed once per gateway process. Expired entries are purged; the cache is bounded by `DEVICE_TUNNEL_JTI_CACHE_MAX_ENTRIES` and fails closed when full. A process restart clears only this bounded replay cache; durable wrong-node, credential-version, and assignment-epoch fencing still applies.
- Android accepts only credential-free `wss://` endpoints returned by the token exchange. Every reconnect obtains a new challenge and token, so reassignment supplies the new node URL. Failed reconnects retain exponential backoff capped at 60 seconds with full jitter.
- The gateway listens locally behind Caddy, creates loopback-only SOCKS endpoints, allows domain-form WhatsApp/Meta destinations on port 443, rejects literal IP targets, and limits concurrent streams and frame size.
- Browser sessions configured for device egress have an explicit SOCKS proxy, remote DNS enforcement, and QUIC disabled so they cannot bypass the TCP tunnel.
- Runtime ownership is PostgreSQL-backed rather than a Redis-only lock. Assignment and lease epochs are independent monotonic fences; neither is reset or reused during rollback.
- Tunnel loss blocks Web Bridge outbox rows. Cloud fallback requires detected coexistence, the same sender number, and an open customer-service window (or an eligible template).

## Operational limitations

- The active production path remains single-node and intentionally keeps its proxy endpoints on the same host as the browser bridge. PR 4 code is fail-closed when explicitly enabled, but runtime enforcement remains inactive while distributed placement is false and its own flag is false.
- Rate-limit schema, Redis counters, dispatch locks, queue rescheduling, and admin UI support are deployed, but production enforcement remains off until the required shadow observation cycle is completed.
- Cross-node browser failover is not safe yet: the PR 5 provider contract is selected, but production session authentication is still stored on the local host and the durable mode is not enabled. Do not enable multi-node automatic failover, move/copy a live profile, or provision a second node during PR 5.
- A 2026-07-20 production incident showed why process reachability is insufficient: deployment restarted the gateway but preserved a browser bound to the removed gateway proxy, leaving outbound browser operations and inbound webhooks stale while health still claimed ready. Recovery also found an orphan Chromium child retaining the profile lock after PM2 removed the bridge, and a clean browser reproduced `r` only in full chat-model serialization. Gateway-generation fencing, child-process cleanup, active ingress probes, and the safe raw-model fallback are required regression boundaries for PRs 5–7.
- The current allowlist may need additions when WhatsApp changes media/CDN hostnames. Add only observed, reviewed suffixes through `DEVICE_TUNNEL_ALLOWED_HOST_SUFFIXES`.
- Legal/Meta approval and an internal pilot remain required before exposing this transport to customer scale.

See [Horizontal WhatsApp device-egress implementation plan](./horizontal-device-egress-plan.md) for the multi-node ownership, rate-limit, failover, and rollout design.
