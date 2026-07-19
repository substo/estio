# Android device egress for WhatsApp Web

This subsystem routes an explicitly bound WhatsApp Web browser session through the paired Android device's active network. It does not make the browser a mobile WhatsApp client, associate an IP address with a SIM number, or modify browser fingerprints.

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
DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT=false
WHATSAPP_RATE_LIMIT_MODE=disabled
```

`deploy-local-build.sh` starts the gateway when both secrets exist and adds the Caddy `/device-tunnel/*` WebSocket route. Apply the Prisma migration before binding a device. Rebuild and distribute the Android application so it can enroll its hardware-backed key.

The SIM Relay integration page shows the live tunnel state and the last verified WhatsApp send. Immediately before a send, the gateway snapshots the assigned tunnel's byte counters and issues a one-time nonce. A proof is written only after WhatsApp Web reports success and the gateway confirms that browser-to-phone bytes increased inside that send window. The receipt contains a truncated one-way message hash, masked phone connection IP, network type, gateway node, per-send traffic delta, and timestamps; it does not store message content or the recipient.

The gateway registers `DEVICE_TUNNEL_GATEWAY_NODE_ID` in PostgreSQL and heartbeats every 15 seconds. Use one stable ID per deployed gateway; do not derive it from a PID or container restart. Keep `DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT=false` during the PR 1 rollout. With the flag disabled, node registry fields are populated but assignment and lease enforcement are not activated, so the existing single-host browser-to-loopback-SOCKS path remains unchanged. Enabling the flag requires an explicit node ID and is reserved for the later routing/ownership phases.

After deploying the node-registry migration, verify the node's `status`, `lastHeartbeatAt`, `activeSessions`, configured URLs, region, capacity, and version in `DeviceTunnelGatewayNode`. A heartbeat update is scoped to both node ID and process `startedAt`; an older process cannot overwrite a replacement process's heartbeat.

## Distributed outbound rate limits

`WHATSAPP_RATE_LIMIT_MODE` supports a phased rollout:

- `disabled` keeps the current production send path unchanged and does not contact the limiter.
- `shadow` evaluates and records Redis sliding-window counters but does not delay sends; Redis errors are logged and allowed in this mode.
- `enforce` serializes provider dispatch per WhatsApp session with Redis plus a PostgreSQL safety lock. Redis failure fails closed and reschedules the outbox row without increasing `attemptCount`.

The default policy applies session limits of 3 sends per 10 seconds, 6 per minute, 120 per hour, and 100 per day for sessions younger than seven days or 500 per day for established sessions. Recipient limits are 3 per minute and 20 per day. Daily limits surface as pending review. `WhatsAppRateLimitPolicy.limits` can override the named values documented in `lib/whatsapp/rate-limit.ts`; keep overrides conservative and review consent, complaints, account age, and delivery quality before raising them.

Rate-limited outbox rows use status `rate_limited`, retain their current provider `attemptCount`, and expose `rateLimitReason`, `rateLimitNextEligibleAt`, and jittered `scheduledAt` values to the conversations UI. Enable `shadow` first, observe at least one complete daily cycle, then enable `enforce` only after Redis and queue dashboards are healthy.

## Activation

1. Pair the updated Android app from SIM Relay settings.
2. In the **WhatsApp network relay** panel, assign the device.
3. Confirm the tunnel status becomes `online`.
4. Restart or reconnect the location's WhatsApp Web session. The bridge refuses to start when the assigned tunnel is offline.

Disabling the binding returns the session to server egress; this is an explicit administrator action, never an automatic fallback.

## Security properties

- Android keeps its P-256 private key in Android Keystore.
- A valid SMS Relay device token can request a short-lived challenge, but only a signature from the enrolled device key can exchange it for a 15-minute tunnel token.
- The gateway listens locally behind Caddy, creates loopback-only SOCKS endpoints, allows domain-form WhatsApp/Meta destinations on port 443, rejects literal IP targets, and limits concurrent streams and frame size.
- Browser sessions configured for device egress have an explicit SOCKS proxy, remote DNS enforcement, and QUIC disabled so they cannot bypass the TCP tunnel.
- Tunnel loss blocks Web Bridge outbox rows. Cloud fallback requires detected coexistence, the same sender number, and an open customer-service window (or an eligible template).

## Operational limitations

- The active production path remains single-node and intentionally keeps its proxy endpoints on the same host as the browser bridge. The node registry and fenced-lease primitives are present for phased rollout, but routing and runtime lease enforcement remain disabled while `DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT=false`.
- The current allowlist may need additions when WhatsApp changes media/CDN hostnames. Add only observed, reviewed suffixes through `DEVICE_TUNNEL_ALLOWED_HOST_SUFFIXES`.
- Legal/Meta approval and an internal pilot remain required before exposing this transport to customer scale.

See [Horizontal WhatsApp device-egress implementation plan](./horizontal-device-egress-plan.md) for the multi-node ownership, rate-limit, failover, and rollout design.
