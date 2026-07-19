# Horizontal WhatsApp device-egress implementation plan

## Objective

Move from the current single-host tunnel runtime to a horizontally scalable model with this invariant:

> One Estio WhatsApp Web session is bound to exactly one authorized device tunnel and is owned by exactly one runtime node at a time.

The tenant boundary is `locationId`. Multiple staff members using the same Estio location and WhatsApp account intentionally share that location's session and tunnel. A physical device cannot be assigned to two sessions at once.

This design improves tenant isolation and removes the shared Hetzner egress IP from device-tunnel traffic. It is not a browser-fingerprint evasion system and does not make `whatsapp-web.js` an officially supported WhatsApp API. Meta policy review, consent, anti-abuse controls, and an official Cloud API option remain required.

## Recommended architecture decision

Use co-located **egress worker nodes**. Each node runs:

- one device-tunnel gateway process;
- one WhatsApp Web bridge process;
- loopback-only SOCKS listeners created per connected device;
- durable access to the WhatsApp session-auth volume assigned to that node.

Keep the Estio web application, PostgreSQL, Redis, and outbound queue as the shared control plane.

Do not build a cross-node SOCKS/data mesh in the first scalable version. The current gateway returns a `127.0.0.1` proxy, so co-location preserves the proven data path and avoids another privileged internal hop. A mesh can be evaluated later only if independent bridge and gateway scaling becomes necessary.

```text
Estio control plane
  ├─ PostgreSQL: bindings, node registry, fenced leases, audit records
  ├─ Redis/BullMQ: outbound queue, rate limits, short-lived presence
  └─ scheduler: stable session-to-node placement

Egress worker node A
  ├─ WhatsApp bridge session A ── local SOCKS ── gateway A
  └─ gateway A ══ WSS ══ authorized Android A ══ mobile/Wi-Fi TCP ══ WhatsApp

Egress worker node B
  ├─ WhatsApp bridge session B ── local SOCKS ── gateway B
  └─ gateway B ══ WSS ══ authorized Android B ══ mobile/Wi-Fi TCP ══ WhatsApp
```

## Non-negotiable invariants

1. `DeviceTunnelBinding.deviceId` and `.sessionId` remain unique.
2. A session has one active node lease and one lease epoch at a time.
3. A gateway accepts a device token only when its `nodeId` and lease epoch match the current database assignment.
4. A bridge starts a browser only while it owns the same valid lease epoch.
5. Lease loss fences and stops the old browser before a replacement browser becomes send-capable.
6. Tunnel loss fails closed. Web Bridge sends become `blocked_egress`; they never silently use server egress.
7. Outbound messages for one WhatsApp session are serialized. At most one provider send is in flight.
8. Rate-limited jobs are rescheduled without consuming a send attempt and without being marked failed.
9. Provider IDs, local idempotency keys, and monotonic acknowledgements prevent duplicate sends and status regression.
10. Full public IPs, message content, recipients, tunnel tokens, and device secrets are not written to operational logs.

## Control-plane data model

Add a migration in a first behavior-preserving PR.

### `DeviceTunnelGatewayNode`

- `id`: stable configured node ID, not a PID-derived value.
- `region`, `publicUrl`, `internalUrl`.
- `status`: `online | draining | offline | quarantined`.
- `capacitySessions`, `activeSessions`.
- `version`, `startedAt`, `lastHeartbeatAt`.
- `metadata`: deployment/provider information that contains no secrets.

### Extend `DeviceTunnelBinding`

- `gatewayNodeId`: durable assignment; reference the node registry.
- `assignmentEpoch`: monotonically increasing integer.
- `assignedAt`, `desiredState`, `drainRequestedAt`.
- Keep current live/proof fields, but treat them as observations rather than placement authority.

### `DeviceTunnelSessionLease`

- `sessionId` unique.
- `bindingId`, `gatewayNodeId`, `ownerInstanceId`.
- `epoch`, `acquiredAt`, `renewedAt`, `expiresAt`.
- `state`: `acquiring | active | draining | expired`.

Acquire and renew leases using a conditional database update. The epoch is a fencing token: a process holding epoch 12 cannot mutate or serve a session after epoch 13 exists. Do not rely only on Redis locks for ownership.

### `WhatsAppRateLimitPolicy` and audit counters

Store policy overrides and trust tier in PostgreSQL. Keep hot counters in Redis. Persist aggregated hourly/daily usage asynchronously for support, billing, and abuse investigations.

Avoid storing one database row per tunnel frame or TCP stream.

## Placement and connection flows

### Binding

1. The administrator selects a paired device in the existing WhatsApp network-relay UI.
2. The control plane selects the least-loaded healthy non-draining node in the requested region.
3. In one transaction, it writes the binding assignment, increments `assignmentEpoch`, and places the bridge session in `device_tunnel` mode.
4. Existing active browser ownership is drained before the new assignment becomes send-capable.

Use stable placement: keep an existing healthy assignment instead of moving sessions merely to improve balance.

### Device connection

1. Android requests and signs the existing short-lived challenge.
2. The token endpoint returns the assigned node's WSS URL, not one global gateway URL.
3. The JWT includes `aud`, `nodeId`, `sessionId`, `bindingId`, `deviceId`, `locationId`, `assignmentEpoch`, `jti`, `iat`, and `exp`.
4. The assigned gateway validates signature, audience, current credential version, assignment, and epoch.
5. A newer connection for the same binding replaces the older connection on that node.

Reduce the tunnel JWT lifetime from 15 minutes to 5 minutes. The established WSS may remain connected, but every reconnect obtains a fresh token. Continue using the Android Keystore private key.

### Browser ownership

1. The node acquires the database lease for the assigned session and epoch.
2. It verifies that the Android WSS is online.
3. It starts Chromium with the local SOCKS endpoint, remote-DNS enforcement, and QUIC disabled.
4. It renews the lease periodically. Two missed renewals stop sends; lease expiry closes Chromium and local SOCKS streams.
5. Browser readiness is reported only when the tunnel, lease, and WhatsApp client are all ready.

### Node failure and reassignment

1. Heartbeats mark the node unhealthy after a short grace window.
2. Pending sends remain `blocked_egress`; server-IP fallback stays disabled.
3. After the old lease expires, the scheduler increments the epoch and assigns a healthy node.
4. Android's existing reconnect loop requests a fresh token and receives the new node URL.
5. The new node attaches the session-auth volume or restores the session through an approved remote-auth mechanism, acquires the new lease, and starts the browser.
6. If auth cannot be restored, surface `relink_required`; never create two active browsers.

## Session-auth storage

`LocalAuth` currently uses `/home/martin/whatsapp-web-sessions`, which is local-host state. Horizontal placement requires one of these, chosen before multi-node rollout:

1. **Recommended first production option:** encrypted per-session persistent volumes, attached to only one egress node at a time and moved only after lease fencing.
2. **Later option:** a reviewed remote-auth store supported by the exact installed `whatsapp-web.js` version, with encryption at rest and distributed locking.

Do not copy a live Chromium profile between nodes. Test crash recovery and auth integrity before enabling automatic reassignment.

## Strict rate limits

Implement atomic Redis token buckets/sliding windows in `lib/whatsapp/rate-limit.ts`. Apply limits in the outbound worker immediately before provider dispatch, after tunnel readiness, and before opening a proof window.

Initial pilot defaults, configurable by trust tier:

| Scope | Default | Action |
|---|---:|---|
| Concurrent provider sends per session | 1 | Serialize |
| Session burst | 3 sends / 10 seconds | Reschedule |
| Session sustained | 6 sends / minute | Reschedule |
| Session hourly | 120 sends / hour | Reschedule |
| New session daily, first 7 days | 100 sends / day | Block pending review |
| Established session daily | 500 sends / day | Block pending review |
| Per recipient | 3 sends / minute, 20 / day | Reschedule/block |
| Tunnel reconnect attempts | 10 / 10 minutes per binding | Back off |
| Challenge requests | 10 / 10 minutes per device and source IP | HTTP 429 |
| Simultaneous TCP streams | 32 per device initially | Reject stream |
| Pending stream opens | 8 per device | Reject stream |

Use full-jitter scheduling and return the next eligible time. A rate-limit decision must not increment `attemptCount`. If Redis is unavailable, fail closed for new sends and token/challenge issuance while allowing established tunnel traffic long enough to recover.

These are product safety defaults, not techniques for bypassing WhatsApp controls. Add administrative raising of limits only after account-age, opt-in, complaint, and delivery-quality review. Never randomize fingerprints or sending behavior to evade detection.

## Gateway resource controls

In addition to message limits:

- enforce frame count and byte-rate budgets per binding;
- cap aggregate bytes per second and per day by plan;
- cap proof windows and pending nonces;
- enforce connection and DNS timeouts;
- retain the reviewed domain suffix allowlist and port 443 restriction;
- re-check resolved addresses on Android and reject private, loopback, link-local, multicast, and reserved ranges;
- bound WebSocket send queues so a slow phone cannot exhaust gateway memory;
- close all streams immediately on lease/epoch mismatch or device revocation.

## Security changes

- Replace the shared internal gateway secret with short-lived service credentials or mTLS between the control plane and egress nodes.
- Give each node its own identity and rotation lifecycle.
- Add JWT audience/node/epoch fencing and replay protection for token exchange.
- Keep P-256 hardware-backed device enrollment and increment `tunnelCredentialVersion` on revoke/re-pair.
- Encrypt session-auth volumes and backups with a separate key from application/database secrets.
- Add immutable audit events for bind, reassign, drain, revoke, limit override, and relink.
- Mask IPs in the UI. Treat the current Cloudflare-observed connection IP as relay metadata, not proof of the final WhatsApp destination IP.
- Preserve the existing byte-delta proof, but describe it accurately as proof that traffic crossed the assigned tunnel during the send window.

## Observability and SLOs

Emit metrics labeled by node and anonymized binding/session identifiers:

- active/assigned sessions and capacity per node;
- lease acquisition, renewal, conflict, and fencing counts;
- device reconnect rate and tunnel uptime;
- active/pending streams, bytes, backpressure, DNS/connect errors;
- outbound queue age, rate-limit delay, blocked-egress duration;
- send-proof success/failure and acknowledgement latency;
- browser start time, ready state, relink-required count;
- node version skew and last heartbeat.

Initial pilot targets:

- no simultaneous active lease observed for a session;
- 100% fail-closed behavior during tunnel loss;
- at least 99% of successful tunneled sends produce a proof receipt;
- p95 healthy-device reconnect under 60 seconds;
- zero duplicate provider dispatches during tested node failover.

Alert on lease conflicts, node capacity above 80%, proof success below target, queue age above five minutes, repeated reconnects, or any server-egress browser for a `device_tunnel` session.

## PR-sized delivery plan

### PR 1 — Node registry and fenced lease primitives

- Add the node, assignment, and lease schema/migration.
- Add pure placement and epoch/lease helpers with concurrency tests.
- Register and heartbeat the existing single gateway as one stable node.
- Preserve current single-host behavior behind `DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT=false`.

Acceptance: two simulated owners cannot both acquire/renew a lease; the current production tunnel still works unchanged.

### PR 2 — Distributed rate limiter

- Add Redis-backed atomic limits and policy resolution.
- Integrate with `processWhatsAppOutboundOutboxJob` so limited jobs are rescheduled without attempts.
- Add per-session serialization in BullMQ and a database safety check.
- Add admin-visible reason and next eligible time.

Acceptance: concurrent workers cannot exceed a session limit; Redis failure blocks new sends safely; no job is lost or double-sent.

### PR 3 — Node-scoped device tokens and routing

- Assign bindings to a healthy node.
- Return the assigned node URL from `/api/device-relay/v1/tunnel-token`.
- Add `nodeId`, `sessionId`, epoch, audience, and JTI claims.
- Update Android models/client and retain exponential backoff with full jitter.

Acceptance: the wrong node rejects the token; reassignment causes Android to reconnect to the new endpoint; revoked epochs cannot reconnect.

### PR 4 — Co-located runtime ownership

- Make gateway and bridge use the same node identity and lease.
- Require a valid lease before returning the local SOCKS endpoint or starting Chromium.
- Stop browser/streams on lease loss.
- Add graceful drain endpoints and deployment hooks.

Acceptance: forced lease loss stops the old browser; only the new owner becomes ready; queued sends remain blocked during the gap.

### PR 5 — Durable session-auth placement

- Implement encrypted per-session persistent volume attach/detach.
- Add auth integrity checks, backup, restore, and `relink_required` behavior.
- Document recovery time and manual break-glass steps.

Acceptance: hard-kill one node and restore the session on another without two active browsers or a corrupted profile.

### PR 6 — Multi-node deployment and operations

- Provision at least two egress nodes in one region.
- Add node-specific WSS DNS/TLS, capacity-aware placement, drain tooling, dashboards, and alerts.
- Run load, reconnect-storm, slow-device, Redis-outage, database-latency, and node-loss tests.
- Canary with internal accounts, then a small opted-in customer cohort.

Acceptance: documented SLOs pass during the canary and rollback is rehearsed.

### PR 7 — Cleanup and security review

- Extract shared gateway/lease/rate-limit mechanics from scripts into tested service modules.
- Remove single-node compatibility code after the migration window.
- Complete threat-model, dependency, privacy, and Meta-policy review.

## Rollout and rollback

1. Ship all changes behind feature flags.
2. Shadow node assignment and rate-limit decisions before enforcing them.
3. Enable strict rate limits first on internal sessions.
4. Enable fenced leases on the existing single node.
5. Add a second node and canary selected bindings.
6. Drain rather than kill nodes during routine deploys.

Rollback must preserve binding epochs. Disable new placement and move canary bindings back to the original healthy node only after fencing the newer owner. Never roll back by allowing server egress.

## Required test matrix

- two devices racing to connect to one binding;
- one device token presented to the wrong node;
- stale token/epoch after reassignment;
- two bridge processes racing for one lease;
- gateway crash during a send and during proof verification;
- Android network change and reconnect storm;
- Redis unavailable, PostgreSQL unavailable, and delayed heartbeats;
- slow or malicious WebSocket client causing backpressure;
- allowlist bypass, DNS rebinding, literal IP, private IP, and oversized frame attempts;
- out-of-order WhatsApp acknowledgements and worker/webhook races;
- node drain with queued and in-flight messages;
- auth-volume move, corrupt profile, and relink-required recovery.

## First task for the next agent

Implement **PR 1 only**. Start by reading:

- `documentation/whatsapp/android-device-egress.md`
- `scripts/device-tunnel-gateway.ts`
- `scripts/whatsapp-web-bridge-service.ts`
- `lib/device-tunnel/auth.ts`
- `app/api/admin/whatsapp-egress/bind/route.ts`
- `app/api/device-relay/v1/tunnel-token/route.ts`
- the `WhatsAppWebBridgeSession`, `SmsRelayDevice`, and `DeviceTunnelBinding` Prisma models

Keep the existing production data path unchanged. Add migration, node heartbeat/registry, fenced lease primitives, unit/concurrency tests, feature flag, and operational documentation. Do not start PR 2 or change Android routing in the same diff.

Before handoff, run focused device-tunnel tests, Prisma validation/generation, `git diff --check`, and the production build. Request security review specifically for lease fencing, tenant scoping, and token claims.
