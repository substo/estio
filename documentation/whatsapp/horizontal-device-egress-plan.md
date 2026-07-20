# Horizontal WhatsApp device-egress implementation plan

## Objective

Move from the current single-host tunnel runtime to a horizontally scalable model with this invariant:

> One Estio WhatsApp Web session is bound to exactly one authorized device tunnel and is owned by exactly one runtime node at a time.

The tenant boundary is `locationId`. Multiple staff members using the same Estio location and WhatsApp account intentionally share that location's session and tunnel. A physical device cannot be assigned to two sessions at once.

This design improves tenant isolation and removes the shared Hetzner egress IP from device-tunnel traffic. It is not a browser-fingerprint evasion system and does not make `whatsapp-web.js` an officially supported WhatsApp API. Meta policy review, consent, anti-abuse controls, and an official Cloud API option remain required.

## Implementation status

Last updated: 2026-07-20.

| Phase | Status | Production state |
|---|---|---|
| PR 1 — Node registry and fenced lease primitives | Complete (`6c53c5e`) | Migrated and deployed; registry heartbeat is live; distributed placement remains disabled. |
| PR 2 — Distributed rate limiter | Complete (`0d6c77a`) | Migrated and deployed; limiter defaults to `disabled` pending the shadow rollout. |
| PR 3 — Node-scoped device tokens and routing | Complete (`a2bcb4a`); pushed, pending review/deployment | Compatibility mode still returns the global URL; distributed placement remains disabled in production. |
| PR 4 — Co-located runtime ownership | Next implementation PR | Lease primitives exist but do not yet fence gateway/bridge runtime ownership. |
| PR 5 — Durable session-auth placement | Not started | Production still uses host-local `LocalAuth`. |
| PR 6 — Multi-node deployment and operations | Not started | One production egress node is registered. |
| PR 7 — Cleanup and security review | Not started | Single-node compatibility code remains required. |

The production data path is intentionally unchanged after PRs 1–2. `DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT=false` preserves single-node routing, and an absent or invalid `WHATSAPP_RATE_LIMIT_MODE` resolves to `disabled`. Do not enable distributed placement until PRs 3–5 are complete. Rate limiting may be advanced independently from `disabled` to `shadow`, observed for at least one complete daily window, and then moved to `enforce` after Redis and queue telemetry are healthy.

PR 3 is implemented in commit `a2bcb4a` without a migration. Binding assignment is row-locked in PostgreSQL, retains an eligible current node, and increments `assignmentEpoch` only when `gatewayNodeId` changes. Five-minute tunnel JWTs contain audience, node, session, binding, device, tenant, assignment epoch, JTI, issued-at, and expiry claims. The gateway revalidates those claims against current binding, session, device credential, node health, and assignment state before accepting a WebSocket. Its per-process JTI cache purges expired entries, has a configurable hard bound, and fails closed rather than evicting an unexpired replay fence. Android validates and uses each exchange response's WSS URL, requests a fresh challenge/token for every reconnect, and applies exponential backoff with full jitter.

With `DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT=false`, token exchange continues to return `DEVICE_TUNNEL_PUBLIC_URL`, does not assign or rebalance bindings, and the gateway preserves the existing single-node observation writes. The new five-minute scoped token contract applies in both modes. No production flag, rate-limit mode, lease ownership, Chromium behavior, session-auth storage, or node count is changed by PR 3.

### Implemented in PR 1

- Migration `20260719160000_device_tunnel_node_registry_leases` added `DeviceTunnelGatewayNode`, assignment fields on `DeviceTunnelBinding`, and `DeviceTunnelSessionLease`.
- `lib/device-tunnel/gateway-node-registry.ts` registers stable node identity and uses `startedAt` fencing so an old process cannot overwrite a replacement process's heartbeat.
- `lib/device-tunnel/distributed-placement.ts` contains deterministic healthy-node selection, stable-assignment preference, capacity checks, and monotonic assignment epochs.
- `lib/device-tunnel/session-lease.ts` provides PostgreSQL-backed acquire, renew, and expire operations scoped by binding, session, node, assignment epoch, owner, and lease epoch.
- `scripts/device-tunnel-gateway.ts` registers and heartbeats the current production gateway without changing token routing or bridge ownership.
- Concurrency tests cover competing owners, stale renewals, epoch takeover, node health, capacity, and heartbeat fencing.

### Implemented in PR 2

- Migration `20260719180000_whatsapp_distributed_rate_limits` added per-location `WhatsAppRateLimitPolicy`, `WhatsAppOutboundDispatchLock`, and user-visible rate-limit fields on `WhatsAppOutboundOutbox`.
- `lib/whatsapp/rate-limit.ts` implements an atomic Redis sorted-set sliding-window decision across all session and recipient windows. Redis keys contain hashed scopes rather than phone numbers or database IDs.
- `lib/whatsapp/dispatch-serialization.ts` combines a token-scoped Redis mutex with an expiring PostgreSQL safety lock so only one provider dispatch for a session proceeds at a time in enforcement mode.
- `processWhatsAppOutboundOutboxJob` evaluates limits immediately before provider dispatch. A denied or fail-closed send becomes `rate_limited`, is rescheduled with jitter, and does not increment `attemptCount`.
- BullMQ retries use distinct job IDs so a delayed retry cannot collide with the currently active job and disappear.
- Conversation loading and realtime patches expose the reason and exact next-eligible time to administrators.
- Focused tests cover atomic concurrent workers, lock contention, Redis failures, shadow behavior, retry identity, outbox attempt preservation, and UI state. The production build passed before deployment.

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
3. A gateway accepts a device token only when its `nodeId` and `assignmentEpoch` match the current database assignment.
4. A bridge starts a browser only while it owns the same valid lease epoch.
5. Lease loss fences and stops the old browser before a replacement browser becomes send-capable.
6. Tunnel loss fails closed. Web Bridge sends become `blocked_egress`; they never silently use server egress.
7. Outbound messages for one WhatsApp session are serialized. At most one provider send is in flight.
8. Rate-limited jobs are rescheduled without consuming a send attempt and without being marked failed.
9. Provider IDs, local idempotency keys, and monotonic acknowledgements prevent duplicate sends and status regression.
10. Full public IPs, message content, recipients, tunnel tokens, and device secrets are not written to operational logs.

## Control-plane data model

The PR 1 and PR 2 portions of this model are present in production. The PR 3 routing implementation is present on `clean-history` but is not yet recorded as deployed. Items explicitly described as future work belong to PRs 4–7.

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

Policy overrides and trust tier are stored in PostgreSQL, while hot counters are stored in Redis. Persisted aggregated hourly/daily usage remains future observability work for PR 6.

Avoid storing one database row per tunnel frame or TCP stream.

## Placement and connection flows

### Binding

1. The administrator selects a paired device in the existing WhatsApp network-relay UI.
2. The control plane selects the least-loaded healthy non-draining node in the requested region.
3. It places the bridge session in `device_tunnel` mode, then row-locks the binding assignment transaction. The transaction retains a healthy current node or writes the selected node and increments `assignmentEpoch`.
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

PR 2 implemented atomic Redis sliding windows in `lib/whatsapp/rate-limit.ts`. The outbound worker applies them immediately before provider dispatch, after transport/tunnel readiness resolution and before the provider send or proof operation.

Initial pilot defaults, configurable by trust tier:

| Scope | Default | Action |
|---|---:|---|
| Concurrent provider sends per session | 1 | Serialize |
| Session burst | 3 sends / 10 seconds | Reschedule |
| Session sustained | 6 sends / minute | Reschedule |
| Session hourly | 120 sends / hour | Reschedule |
| New session daily, first 7 days | 100 sends / day | Delay to next window; label pending review |
| Established session daily | 500 sends / day | Delay to next window; label pending review |
| Per recipient | 3 sends / minute, 20 / day | Reschedule |
| Tunnel reconnect attempts | 10 / 10 minutes per binding | Back off |
| Challenge requests | 10 / 10 minutes per device and source IP | HTTP 429 |
| Simultaneous TCP streams | 32 per device initially | Reject stream |
| Pending stream opens | 8 per device | Reject stream |

Use full-jitter scheduling and return the next eligible time. A rate-limit decision must not increment `attemptCount`. If Redis is unavailable, fail closed for new sends and token/challenge issuance while allowing established tunnel traffic long enough to recover.

Current PR 2 behavior reschedules daily-limit rows at the next eligible time and includes “pending review” in the administrator-visible reason. It does not yet provide a durable manual approval queue. If product policy requires explicit approval before a daily-limited row can resume, add that workflow as a separately reviewed PR before customer enforcement.

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

**Status: complete, deployed, and verified.** Commit `6c53c5e`; migration `20260719160000_device_tunnel_node_registry_leases`.

- Add the node, assignment, and lease schema/migration.
- Add pure placement and epoch/lease helpers with concurrency tests.
- Register and heartbeat the existing single gateway as one stable node.
- Preserve current single-host behavior behind `DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT=false`.

Acceptance: two simulated owners cannot both acquire/renew a lease; the current production tunnel still works unchanged.

Result: acceptance passed. The production gateway is registered and online, the existing WhatsApp session remained ready through deployment, and the compatibility flag remains off.

### PR 2 — Distributed rate limiter

**Status: complete, deployed, and verified.** Commit `0d6c77a`; migration `20260719180000_whatsapp_distributed_rate_limits`.

- Add Redis-backed atomic limits and policy resolution.
- Integrate with `processWhatsAppOutboundOutboxJob` so limited jobs are rescheduled without attempts.
- Add per-session serialization in the BullMQ worker using Redis plus a database safety check.
- Add admin-visible reason and next eligible time.

Acceptance: concurrent workers cannot exceed a session limit; Redis failure blocks new sends safely; no job is lost or double-sent.

Result: acceptance passed in focused concurrency tests and the production build. Schema and code are live with enforcement disabled. Operational completion requires a shadow observation window before enabling `enforce`; this does not block PR 3.

### PR 3 — Node-scoped device tokens and routing

**Status: complete in commit `a2bcb4a`, pushed to `clean-history`, pending review and deployment.** This adds assignment-aware routing but does not activate automatic cross-node browser failover.

- Assign bindings to a healthy node.
- Return the assigned node URL from `/api/device-relay/v1/tunnel-token`.
- Add `nodeId`, `sessionId`, epoch, audience, and JTI claims.
- Update Android models/client and retain exponential backoff with full jitter.
- Validate assignment and epoch at token issuance and again at the gateway; a database change after token issuance must fence reconnect.
- Reduce tunnel JWT lifetime from 15 minutes to 5 minutes and add bounded JTI replay protection for exchanges/reconnects.
- Preserve the current single-node path behind `DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT=false`; provide an explicit canary allowlist before a global flag.

Expected migration: none if the PR 1 assignment fields are sufficient. Add a migration only if replay records or canary assignment state require durable storage; do not overload node metadata JSON for authoritative state.

Primary code surfaces: `app/api/admin/whatsapp-egress/bind/route.ts`, `app/api/device-relay/v1/tunnel-token/route.ts`, `lib/device-tunnel/auth.ts`, gateway authentication/connection handling, and the Android tunnel token/client models.

Acceptance: the wrong node rejects the token; reassignment causes Android to reconnect to the new endpoint; stale assignment epochs and revoked/re-paired credentials cannot reconnect.

Rollback: turn distributed placement off. Existing single-node tokens and routing must continue to work without decrementing or reusing assignment epochs.

Result: no migration was required. Assignment uses `SELECT ... FOR UPDATE` on the binding and the PR 1 stable placement helper. Issuance and gateway acceptance validate the same tenant/device/binding/session/epoch scope; distributed acceptance additionally requires the configured gateway to be the healthy assigned node. JWT audience is `device-tunnel-gateway`, lifetime is five minutes, and each JTI is accepted once per gateway process. Replay state is capped by `DEVICE_TUNNEL_JTI_CACHE_MAX_ENTRIES` (default 10,000); after expired entries are removed, a full cache rejects new connections until capacity becomes available. A gateway process restart clears this best-effort cache, while node and assignment-epoch checks remain durable. Android accepts only credential-free `wss://` node URLs and obtains a new URL with every fresh token exchange. Focused TypeScript and Android unit/build checks cover stable/capacity placement, concurrency, complete claims, wrong audience/node/scope/epoch, credential revocation/version fencing, bounded replay, reassigned URLs, full jitter, and flag-off compatibility.

### PR 4 — Co-located runtime ownership

**Status: next implementation PR; PR 3 is coded but still pending production review/deployment.** This is the first phase that makes the PR 1 lease authoritative at runtime.

- Make gateway and bridge use the same node identity and lease.
- Require a valid lease before returning the local SOCKS endpoint or starting Chromium.
- Stop browser/streams on lease loss.
- Add graceful drain endpoints and deployment hooks.
- Bind browser readiness and proof-window creation to the current lease epoch; stale processes must be unable to report readiness or accept new proof work.
- Renew leases on a bounded cadence and fail closed after two missed renewals. Release is best-effort; expiry and epoch fencing remain authoritative.
- Keep queued messages in `blocked_egress` during ownership gaps and preserve the PR 2 rate-limit attempt semantics.

Expected migration: normally none. Add durable drain/audit fields only if the existing node, binding, and lease schema cannot represent the operational transition cleanly.

Acceptance: forced lease loss stops the old browser; only the new owner becomes ready; queued sends remain blocked during the gap.

Rollback: disable lease enforcement only after draining any canary owner. Never run old and new ownership modes concurrently for the same session.

### PR 5 — Durable session-auth placement

**Status: pending architecture/provider decision and PR 4.** Host-local `LocalAuth` is the blocker to safe cross-node reassignment.

- Implement encrypted per-session persistent volume attach/detach.
- Add auth integrity checks, backup, restore, and `relink_required` behavior.
- Document recovery time and manual break-glass steps.
- Select and document the storage/volume provider, single-writer guarantees, encryption-key ownership, backup retention, and attach/detach timeout before coding.
- Move a volume only after the previous runtime is fenced and all Chromium processes using it are stopped; never copy a live profile.
- Record non-secret auth placement and recovery state in PostgreSQL and immutable audit events.

Expected migration: auth-placement state, recovery status, integrity/version metadata, and audit records. Secrets and profile contents must not be stored in PostgreSQL.

Acceptance: hard-kill one node and restore the session on another without two active browsers or a corrupted profile.

Rollback: reattach the last known-good encrypted volume to its prior fenced node or mark `relink_required`; do not start with an unverified copied profile.

### PR 6 — Multi-node deployment and operations

**Status: pending PRs 3–5.** This provisions the second real node and exercises the complete failure path.

- Provision at least two egress nodes in one region.
- Add node-specific WSS DNS/TLS, capacity-aware placement, drain tooling, dashboards, and alerts.
- Run load, reconnect-storm, slow-device, Redis-outage, database-latency, and node-loss tests.
- Canary with internal accounts, then a small opted-in customer cohort.
- Add persisted hourly/daily rate-limit aggregates and dashboards for delays, blocks, Redis errors, queue age, and session lock contention.
- Monitor version skew and prevent placement onto incompatible or quarantined nodes.
- Rehearse node drain, hard failure, rollback, auth restore, and relink-required runbooks before customer canary expansion.

Expected infrastructure/data changes: node-specific DNS/TLS and deployment configuration; operational metric/audit storage may require a migration. No shared cross-node SOCKS mesh is part of this PR.

Acceptance: documented SLOs pass during the canary and rollback is rehearsed.

Rollback: stop new placement, drain canary bindings, fence their current epochs, and return them to the original healthy node. Server-egress fallback remains prohibited.

### PR 7 — Cleanup and security review

**Status: final phase after the migration window.** Do not remove compatibility paths until all production bindings use the multi-node contract and rollback has been rehearsed.

- Extract shared gateway/lease/rate-limit mechanics from scripts into tested service modules.
- Remove single-node compatibility code after the migration window.
- Complete threat-model, dependency, privacy, and Meta-policy review.
- Remove obsolete configuration only after production configuration and runbooks are updated; reject ambiguous mixed-mode startup.
- Review JWT replay boundaries, tenant scoping, lease/epoch fencing, SSRF/DNS rebinding controls, auth-volume key access, log redaction, and audit immutability.
- Resolve or explicitly accept production dependency audit findings, including the critical findings currently reported by `npm audit`, before broad customer rollout.

Expected migration: only cleanup/backfill constraints proven safe by production data. Destructive column/table removal should be a separate, reversible migration after a full release window.

Acceptance: the threat model is signed off, dependency/privacy/policy findings have owners and dispositions, no deprecated runtime path remains active, and a clean install/build/test/deploy succeeds.

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

## Next implementation task

Implement **PR 4 only: co-located runtime ownership**. PRs 1 and 2 are deployed. PR 3 is complete in commit `a2bcb4a` and pushed but is not recorded as deployed. Do not recreate earlier migrations, alter PR 2 rate-limit enforcement, implement PR 5 session-auth movement, or provision another node. Start by reading:

- `documentation/whatsapp/android-device-egress.md`
- `scripts/device-tunnel-gateway.ts`
- `scripts/whatsapp-web-bridge-service.ts`
- `lib/device-tunnel/session-lease.ts`
- `lib/device-tunnel/assignment.ts`
- `lib/device-tunnel/gateway-authorization.ts`
- `lib/whatsapp/web-bridge.ts`
- the `WhatsAppWebBridgeSession`, `DeviceTunnelBinding`, `DeviceTunnelGatewayNode`, and `DeviceTunnelSessionLease` Prisma models

Keep the production path unchanged when `DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT=false`. When runtime ownership is explicitly enabled for a later canary, require the gateway and bridge to use the same stable node identity and valid fenced lease before serving the loopback proxy, starting Chromium, accepting proof work, or reporting readiness. Renew on a bounded cadence, fail closed after the documented missed-renewal threshold, and stop streams/browser activity on fencing or lease loss. Queue sends as `blocked_egress`; never add server-egress fallback. Do not move or copy `LocalAuth` data in PR 4.

Before handoff, run focused device-tunnel, lease, gateway, bridge, outbox, and authentication tests; run Prisma validation/generation if schema changes; run `git diff --check` and the production build. Review tenant scoping, node/assignment/lease epoch fencing, split-brain behavior, lease-loss shutdown, proof/readiness fencing, secret logging, compatibility rollback, and the prohibition on server-egress fallback.
