# Multi-node WhatsApp device-egress runbook

Last updated: 2026-07-20. This runbook includes the PR 7 cleanup review. It does not authorize a production mutation. Read [the PR 7 security, privacy, and policy review](./device-egress-security-review.md) before any rollout request.

## Hard activation boundary

Do not deploy, apply migration `20260720120000_whatsapp_session_auth_placement`, provision a node or provider, change DNS/TLS, or enable a feature control without explicit approval for that exact mutation. Code deployment with all four controls off and canary activation are separate approvals. Rate limiting is never enabled as a side effect.

Current production checkpoint (2026-07-20): PR 5/6/7 code is deployed, migration `20260720120000_whatsapp_session_auth_placement` is applied and Prisma reports all 63 migrations current, and compatibility browser/Android tunnel/chat/history checks pass. The four controls below remain explicitly off/local/disabled. The dedicated KMS key, two key-scoped node identities, private R2 bucket, and bucket-scoped runtime credentials are provisioned and independently verified. Node-2 provisioning/DNS/TLS, per-node credential delivery, an exact canary scope, and required owner dispositions remain blockers. No canary is active.

The four controls are:

```dotenv
DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT=false
DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT=false
WHATSAPP_SESSION_AUTH_MODE=local
WHATSAPP_RATE_LIMIT_MODE=disabled
```

At startup, unset values resolve to this compatibility matrix. Explicit booleans must be `true` or `false`; auth must be `local` or `encrypted_snapshot`; rate mode must be `disabled`, `shadow`, or `enforce`. Placement, lease enforcement, and encrypted snapshots must be enabled together. The enabled trio additionally requires at least one exact, unexpired (maximum seven-day) scope and exact KMS/private-R2 configuration. Partial, contradictory, empty, deprecated-alias, malformed, or expired configuration fails with a non-secret code. Rate mode remains independent and does not enable any distributed control.

## Node identity, DNS, and TLS design

Each egress worker has a stable node ID and one credential-free public endpoint such as `wss://cyprus-egress-2.egress.estio.co/device-tunnel`. The registry URL is routing metadata only; assignment authority remains in `DeviceTunnelBinding` and `DeviceTunnelSessionLease`, never node `metadata` JSON.

Production node URLs must use WSS, port 443 or the implicit TLS port, the exact `/device-tunnel` endpoint, no credentials/query/fragment, no literal IP, and a hostname under `DEVICE_TUNNEL_TRUSTED_HOST_SUFFIXES`. Token routing, the gateway, the canary parser, and Android all reject alternate paths and host suffixes. TLS readiness must be checked with redirects disabled; a redirect is failure, not a new trusted endpoint.

Generate a non-secret node overlay with controls off:

```bash
npm run ops:wa-egress:node-config -- \
  --node-id cyprus-egress-2 \
  --region cyprus \
  --public-url wss://cyprus-egress-2.egress.estio.co/device-tunnel \
  --trusted-host-suffix egress.estio.co \
  --session-dir /home/martin/whatsapp-web-sessions
```

Review the output before placing it on a node. The generator deliberately omits secrets and always emits disabled compatibility controls. DNS records, Caddy/TLS configuration, firewall rules, and the second node are not created by the command.

## KMS and R2 design

Create one dedicated Google Cloud KMS key ring/key for WhatsApp session auth, separate from application and database keys. Use a distinct service account per egress node. Grant only `cloudkms.cryptoKeyEncrypterDecrypter` on the exact crypto key; do not grant project-wide KMS admin, key-ring admin, or access to unrelated keys. Record key rotation and disable/destroy schedules, but never destroy a key version while a retained generation references it.

Provisioned KMS resource: `projects/gen-lang-client-0081045346/locations/global/keyRings/estio-whatsapp-auth-keyring/cryptoKeys/whatsapp-session-auth`. It has purpose `ENCRYPT_DECRYPT`, enabled `GOOGLE_SYMMETRIC_ENCRYPTION` version 1, and a 90-day rotation period. `estio-wa-egress-1@gen-lang-client-0081045346.iam.gserviceaccount.com` and `estio-wa-egress-2@gen-lang-client-0081045346.iam.gserviceaccount.com` have exact-key `roles/cloudkms.cryptoKeyEncrypterDecrypter`, no project-level roles, and no user-managed keys. The exact-key policy also includes the infrastructure owner user; Security owns whether that administrative binding remains. Do not create or distribute workload credentials until the per-node federation/protected-credential decision is recorded.

Create one private Cloudflare R2 auth bucket with public access disabled. Create bucket-only credentials that can read, create, and delete objects only in that bucket. Do not reuse media R2 credentials. Application object keys are opaque, generation-specific, and immutable; a preflight write uses a unique disposable key, verifies PUT plus read-back bytes/etag, and deletes only that key. Provider write tests are production mutations and require separate approval.

Provisioned R2 resource: bucket `estio-whatsapp-session-auth-prod` in account `a5d668404eee09103a32d81b8b7dc172`, with `Workers R2 Storage Bucket Item Write` restricted to that bucket. The runtime credential and non-secret audit metadata are stored outside Git with owner-only mode `0600`. On 2026-07-20 the application adapter passed exact configuration validation, immutable overwrite rejection, byte-for-byte read-back, deletion, and confirmed post-delete absence; no disposable object remains. The credential is a user-owned Cloudflare token and becomes inactive if its owning user leaves the account. This matches [Cloudflare's R2 token lifecycle documentation](https://developers.cloudflare.com/r2/api/tokens/), but Infrastructure must assign an owner and rotation/replacement procedure before canary activation; prefer an account-owned token when account permissions permit it.

Distribute credentials through the node secret manager or a root-readable environment file outside release directories. Each node receives only its KMS identity and auth-bucket credential. Rotation order is add new credential, validate on one fenced node, restart that node, then revoke the old credential. Revoking a node means draining/fencing it first, removing its KMS binding, revoking its R2 token and internal credentials, and confirming it cannot renew a lease or read a generation.

Required durable configuration names are `WHATSAPP_SESSION_AUTH_KMS_KEY_PATH`, `CLOUDFLARE_R2_ACCOUNT_ID`, `WHATSAPP_SESSION_AUTH_R2_BUCKET`, `WHATSAPP_SESSION_AUTH_R2_ACCESS_KEY_ID`, and `WHATSAPP_SESSION_AUTH_R2_SECRET_ACCESS_KEY`. The R2 endpoint is derived from the exact account ID; alternate endpoints are rejected.

## Migration preflight

Migration `20260720120000_whatsapp_session_auth_placement` creates empty placement, generation, and append-only audit tables and foreign keys to existing tenant/session/binding/node rows. It does not rewrite existing bindings or profiles. Its checks constrain only newly created rows, so the main existing-data risk is tenant inconsistency between a binding and its bridge session. The PR 6 read-only preflight checks that invariant.

Before requesting migration approval:

```bash
npx prisma migrate status
npm run ops:wa-egress:preflight -- --database --session-dir /home/martin/whatsapp-web-sessions
```

Record the current `_prisma_migrations` row set and database backup identifier. Confirm the target migration is either absent or has one successful non-rolled-back row. Review the committed SQL; do not edit or replace it. Applying it requires explicit approval and uses `npx prisma migrate deploy`, never `db push --accept-data-loss`.

After an approved application, verify the three tables, unique session/binding/object/generation constraints, owner/operation/epoch checks, foreign keys, and append-only audit trigger. Keep all feature controls off during this verification.

## Static and live preflights

`npm run ops:wa-egress:preflight` is read-only. It validates stable node identity, exact WSS trust, canary JSON, KMS/R2 configuration shape, the committed migration, and session-directory safety. `--database` adds read-only migration and tenant-isolation queries. It never tests provider writes and reports `mutationPerformed: false`.

Before rollout also verify, without printing secrets:

- node DNS resolves only to reviewed public addresses and the TLS certificate covers the exact hostname;
- HTTPS/WSS probing with redirects disabled reaches only `/device-tunnel`;
- the gateway and bridge share the node ID and unique deployment owner;
- the session directory is an absolute persistent path outside blue/green releases;
- the current Android tunnel identity/binding is known;
- KMS wrap/unwrap succeeds for the exact configured key;
- the approved R2 disposable immutable PUT/GET/delete succeeds;
- no profile-scoped Chromium process or singleton lock exists before restore;
- the dependency audit's three critical findings have an explicit disposition before activation.

The fresh pre-change PR 7 production-only audit reproduced 32 findings: 1 low, 12 moderate, 16 high, and 3 critical. PR 7 targeted only the critical paths: `@clerk/nextjs` now resolves to 6.39.6 with backend 2.33.6, React 5.61.9, and shared 3.47.8; `protobufjs` is pinned to 7.6.3 across `@google-cloud/kms -> google-gax` and `@google/genai`. The post-change production-only audit reports 25 findings: 1 low, 11 moderate, 13 high, and zero critical. No `npm audit fix` or blanket upgrade was used. Security still owns triage of the remaining paths, and any returned critical finding blocks activation.

PR 7 final verification passed 156 focused device-tunnel/rate-limit/session-auth/bridge/security tests, separate 2/2 Clerk bearer and 2/2 PM2 singleton tests, Android unit/debug builds, Prisma validation/generation, targeted strict checks, static/template/dry-run operator commands, production bundles, transformed closure inspection, and the production build. Full-repository TypeScript is not claimed as passing. No production mutation occurred.

## Explicit canary scope

Canary selection is a JSON array in `DEVICE_TUNNEL_CANARY_SCOPES`. Every entry must exactly name tenant, database bridge session, binding, target node, canonical gateway URL, review/change reference, and expiry. Maximum scope count is 25 and maximum lifetime is seven days. Duplicate, expired, or excessively long-lived entries fail closed; an expiry also fences a connected canary on its next work/renewal boundary.

```json
[
  {
    "locationId": "<exact-location-id>",
    "sessionId": "<exact-database-session-id>",
    "bindingId": "<exact-binding-id>",
    "gatewayNodeId": "cyprus-egress-2",
    "gatewayUrl": "wss://cyprus-egress-2.egress.estio.co/device-tunnel",
    "changeRef": "approved-change-reference",
    "expiresAt": "2026-07-21T18:00:00.000Z"
  }
]
```

After a canary has passed the acceptance harness, move the same exact
tenant/session/binding tuple to `DEVICE_TUNNEL_PRODUCTION_SCOPES` and remove it
from `DEVICE_TUNNEL_CANARY_SCOPES`. Production scopes retain the exact gateway
and reviewed change reference but intentionally have no `expiresAt`. A tuple
present in both lists fails startup validation. This graduation step keeps
distributed placement, runtime lease fencing, KMS, and R2 protection active
without making a live production route depend on a temporary canary deadline.

```json
[
  {
    "locationId": "<exact-location-id>",
    "sessionId": "<exact-database-session-id>",
    "bindingId": "<exact-binding-id>",
    "gatewayNodeId": "cyprus-egress-2",
    "gatewayUrl": "wss://cyprus-egress-2.egress.estio.co/device-tunnel",
    "changeRef": "approved-production-change-reference"
  }
]
```

An exact selected scope becomes active only when distributed placement, runtime lease enforcement, durable auth, KMS, and R2 are all configured. An incomplete selected scope returns unavailable; it never falls back to compatibility routing. Non-selected bindings retain compatibility tokens even while the control plane is canary-capable. Tokens carry `placementMode=distributed_canary` or `compatibility`; gateways acquire leases only for the former. Rate-limit mode is independent and remains disabled.

## Drain, resume, reassignment, and release replacement

The gateway exposes authenticated loopback-only `POST /admin/drain` and `/admin/resume`. Both transitions are fenced by stable node ID and process `startedAt`. Drain rejects new WebSockets, marks the node draining, closes tunnel streams, expires owned leases, and fences the exact browser. The command is dry-run unless `--execute` is supplied:

```bash
npm run ops:wa-egress:control -- --action drain --change-ref CHG-123
npm run ops:wa-egress:control -- --action drain --change-ref CHG-123 --execute
npm run ops:wa-egress:control -- --action resume --change-ref CHG-123 --execute
```

For planned movement: drain; stop the bridge/browser; verify exact-profile Chromium exit; checkpoint only while healthy and authoritative; wait for old lease expiry; increment assignment epoch by selecting the target node; obtain a fresh Android token; create the new gateway proxy; acquire a higher lease epoch; attach the encrypted snapshot with a higher auth epoch; then start one browser. A browser bound to an old gateway generation is never preserved.

For abrupt loss: do not checkpoint unknown local state. Wait for the durable lease fence, reassign, restore the current verified generation, and require browser collection plus authenticated webhook freshness. If every generation is unusable, enter `relink_required`.

## Canary acceptance harness

Capture a redacted observation JSON from gateway/bridge health, PostgreSQL ownership rows, exact-profile process inspection, inbound storage, and one approved outbound test. Run:

```bash
npm run ops:wa-egress:acceptance -- --template > /secure/path/redacted-canary-observation.json
npm run ops:wa-egress:acceptance -- --observation /secure/path/redacted-canary-observation.json
```

The harness fails unless it observes exactly one authoritative lease/browser, zero profile-scoped orphans, the current gateway generation and Android proxy, restored generation/auth epoch, fresh browser and authenticated webhook probes, an advanced stored inbound timestamp, verified tunnel bytes for the outbound send, and rejection of stale-owner serve/ready/checkpoint attempts. Rollback may select an older generation but may not decrease assignment, lease, or auth epochs. Operational error codes are allowlisted; never put phone numbers, IPs, JTI/token values, recipients, bodies, profile contents/secret paths, wrapped keys, or credentials in the observation.

## Failure rehearsal matrix

Every scenario must end fail-closed with no server-egress fallback:

| Scenario | Required result |
|---|---|
| Planned drain | Healthy authoritative checkpoint, fence, lease expiry, reassignment, verified restore. |
| Abrupt gateway crash or node loss | Old browser becomes stale/fenced; no checkpoint; takeover only after lease expiry. |
| Abrupt bridge/browser crash | Orphan tree removed, exact lock released, current verified generation restored. |
| Reassignment | Wrong-node and stale assignment tokens rejected; all epochs increase. |
| Lease loss during attach/detach | Operation cannot complete or publish; deadline/fence advances auth epoch. |
| Gateway generation replacement | Cached-ready browser loses readiness and is recreated after Android reconnect. |
| Android disconnect/reconnect | Sends block; fresh token uses current node/epoch; no server path. |
| Normal post-deploy recovery | Allow the bounded 300-second reconnect/restore/probe window. `starting` or `authenticated` recovers automatically; do not require an Android restart or QR relink. |
| R2 PUT/read-back or KMS failure | No generation publication; transient valid generations are not falsely quarantined. |
| Archive tag/digest/path corruption | Generation quarantined; older verified generation tried. |
| Profile lock held | Attach/detach fails until exact orphan exits; no unsafe deletion/copy. |
| Attach/detach deadline | Operation fenced and auth epoch advanced. |
| Current corrupt, older valid | Older verified generation restores under a higher auth epoch. |
| All generations unusable | `relink_required`. |
| Operator rollback | Older verified generation, higher epochs, full readiness gates. |
| Rollback failure | `relink_required`; no live profile copy. |
| Application release rollback | Drain/fence first; old release may serve only after current ownership validation. |
| Primary plus raw history `r` | Bounded stale-browser recovery; no restart loop. |
| Isolated media `r` | Browser remains healthy; only media recovery fails. |
| Production-transformed page closure | No `getMessageModel`, `__name`, `__async`, or Node module reference in page code. |

The pure failure-policy test enumerates all scenarios in `lib/device-tunnel/multi-node-operations.test.ts`. Source and production-bundle regression tests remain mandatory before a canary.

## Rollback

1. Remove or expire the exact canary scope so no new distributed token can be issued.
2. Drain/fence the canary node and stop the browser; verify all exact-profile Chromium children exited.
3. Checkpoint only if probes are healthy and ownership is still authoritative.
4. Wait for/expire the old lease through the fenced API, then reassign to the original healthy node with a higher assignment epoch.
5. Acquire a higher lease and auth epoch. Restore the verified last-known-good generation through the authenticated rollback endpoint.
6. Require Android proxy, current gateway generation, active browser probe, authenticated webhook freshness, inbound advance, and outbound tunnel proof.
7. If restore/rollback fails, set `relink_required`. Never copy a live profile or activate server egress.
8. Keep compatibility controls for non-canary sessions unchanged. A deployment rollback does not justify decreasing database epochs or disabling enforcement while an owner is active.

## Approved rollout sequence

After explicit approvals, the order is: provision providers and second-node DNS/TLS; apply the PR 5 migration; deploy PR 5/6 code everywhere with all controls off; verify the compatibility browser, ingress/history, and Android outbound proof; request a separate exact canary approval; install one expiring scope; enable distributed placement, lease enforcement, and encrypted snapshots for that scope; run the acceptance matrix; then either remove the scope and rollback or request expansion. Rate limiting remains a separate project.
