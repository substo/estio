# WhatsApp horizontal device-egress security, privacy, and policy review

Last updated: 2026-07-20. This is the PR 7 engineering review. It is not legal approval, security-owner risk acceptance, rollout approval, or permission to mutate production.

## Decision summary

- Production remains on the single-node compatibility path. PR 5/6/7 code is deployed and migration `20260720120000_whatsapp_session_auth_placement` is applied, but all four controls remain explicitly off/local/disabled and no canary is active.
- The three critical production dependency findings are resolved in the PR 7 dependency graph. The post-change production-only audit contains 25 findings (1 low, 11 moderate, 13 high, 0 critical). Canary activation remains blocked if any critical finding returns; Security owns the remaining triage.
- The unofficial `whatsapp-web.js` transport requires written Product, Legal/Policy, Privacy, and Security-owner disposition before canary activation. Engineering cannot represent it as Meta-approved.
- Prisma 6.19 verifies all 63 production migrations are current. The prior schema-engine ambiguity is resolved.
- The dedicated exact-key KMS resource is provisioned with enabled symmetric version 1 and 90-day rotation. Both node service accounts have exact-key encrypter/decrypter access, no project roles, and no user-managed keys. Workload authentication delivery remains pending until node 2 exists.
- Private R2 is provisioned and independently passed the application's immutable write/read/delete preflight. Second-node DNS/TLS, per-node credential delivery, an exact canary, and Product/Legal-Policy/Privacy/Security dispositions remain activation blockers.

## Trust boundaries and authority

| Boundary | Data/authority crossing it | Required controls | Failure disposition |
|---|---|---|---|
| Browser/admin to control plane | Clerk session, tenant/location selection, operator mutation | Clerk middleware plus route-local authentication; database-derived location scope; no metadata-only grant | Reject; never select another tenant |
| Control plane to PostgreSQL | binding, assignment, lease, auth epochs, audit events | exact location/session/binding predicates; transactions/row locks; monotonic checks; append-only audit trigger | Roll back/fence |
| Control plane to Redis | hashed rate-limit scopes, dispatch locks | no recipients/database IDs in keys; TTL; PostgreSQL safety lock; rate mode independent | Disabled by default; enforce fails closed |
| Control plane to gateway | five-minute JWT and authenticated internal operations | exact audience/node/tenant/session/binding/device/assignment/credential version; bounded JTI replay; internal secret | Reject wrong/stale/replayed scope |
| Gateway to Android | WSS tunnel and TCP frames | exact WSS URL, TLS port/path/suffix, no redirect/IP/credentials/query/fragment; Android repeats validation | Disconnect/re-token; no alternate endpoint |
| Gateway to bridge | start/fence/health/proof operations | loopback destination, required exact shared secret, bounded bodies/timeouts, ownership descriptor | Reject/fence browser |
| Bridge to WhatsApp Web | Chromium profile and Web protocol | one authoritative browser, current gateway generation, active collection probe, webhook freshness | Non-ready or `relink_required` |
| Bridge to KMS | generation data-key wrap/unwrap | exact configured key name; key-only IAM; bounded SDK call | Do not publish/restore |
| Bridge to private R2 | immutable encrypted generations | derived exact endpoint; bucket-only credential; opaque keys; size/digest/tag/read-back | Quarantine/fallback to older verified generation |

Tenant authority is always the tuple `locationId`, database bridge `sessionId`, `bindingId`, device, gateway node, assignment epoch, owner instance, and lease epoch. No state transition may infer tenant authority from a session ID alone. Assignment, lease, and auth epochs are independent monotonic fences and never decrease during rollback.

## Threat review

### Tokens, replay, and device repair

- Tunnel JWTs contain audience, node, tenant, database session, binding, device, credential version, assignment epoch, placement mode, JTI, issued-at, and expiry. Five-minute expiry bounds exposure.
- Token exchange consumes a one-time signed challenge and rechecks the enrolled P-256 key and current device credential version. Re-pair increments the version; older tokens fail.
- The gateway rechecks current database tenant/binding/device/session/node/epoch state. Wrong-node, wrong-tenant, stale assignment, revoked device, wrong audience, expiry, and replay are rejected.
- JTI replay state is per process, purges expired entries, is capped (default 10,000), and fails closed at capacity. Restart loses only this short replay cache; durable epoch and credential fences remain.

### Lease and browser ownership

- Only exact canary tokens acquire an authoritative PostgreSQL lease. Compatibility tokens never acquire one, even in a canary-capable process.
- Acquisition/renewal requires active binding, healthy non-draining node, exact node/assignment/owner scope, and a higher lease epoch on takeover.
- Two missed renewals stop work; expiry, reassignment, drain, or ownership mismatch closes streams and fences the exact browser.
- A stale owner cannot accept proxy work, report ready, persist proof/webhooks, publish a checkpoint, or complete attach/detach.
- Replacement order remains: stop and fence old browser; exit exact Chromium children/release profile; checkpoint only if healthy and authoritative; start new gateway generation; wait for Android proxy; restore durable auth; start one browser; require collection and authenticated webhook freshness.

### Durable auth, KMS, R2, and archive safety

- AES-256-GCM uses a generation data key, per-generation AAD, plaintext/ciphertext digests, bounded sizes (512 MiB maximum), tag verification, and exact KMS key enforcement.
- Archive create/restore rejects traversal, absolute/escaping paths, symlinks, excessive entries/expansion, missing required stores, corruption, and a held profile lock. Live-profile copy is prohibited.
- Publication is serializable and fenced by exact placement plus ownership. Stale checkpoint publication cannot win after an auth-epoch advance.
- Object keys are opaque and immutable. Read-back occurs before publication. Retention never deletes current/last-known-good, pending, held, seven daily, or four weekly generations; retired generations also receive a 30-day hold. Deletion is state-fenced and last-known-good protected.
- If all generations fail, state becomes `relink_required`; there is no server-egress fallback.

### URL trust and SSRF

- API, gateway, canary parser, and Android require WSS, TLS port 443/implicit, exact `/device-tunnel`, a reviewed suffix and Android `estio.co` boundary, and reject credentials, query, fragment, literal IP, alternate path, and redirects.
- Operational DNS/TLS preflight rejects private/reserved DNS results and pins each reviewed address for no-redirect TLS probes. Rebinding therefore cannot redirect the preflight request to a newly resolved private address.
- Browser TCP targets are domain-form port 443 and constrained to reviewed WhatsApp/Meta suffixes; literal IPs and QUIC are rejected.

### Operator, observability, and denial of service

- Gateway drain/resume requires an exact secret, loopback access, bounded change reference, stable node ID, and process-start generation. Bridge operations now fail closed when its secret is absent.
- Operational JSON bodies are bounded, responses are `no-store`/`nosniff`, and exceptions return allowlisted codes rather than arbitrary messages.
- New bridge health emits one-way session/location references and a profile-path fingerprint, not raw identifiers or the absolute session directory. Consumers accept legacy fields only for mixed-version reads.
- Tunnel frames, streams, canary scopes, JWT lifetime/JTI cache, provider payload sizes, archive sizes/counts, and request bodies are bounded. Redis keys hash scope identifiers.
- KMS wrap/unwrap calls have an explicit 30-second deadline; R2 connect and request deadlines remain 5 and 60 seconds respectively.
- PM2 reachability and cached readiness are insufficient; health requires a live browser collection probe and authenticated webhook freshness.

## Compatibility inventory

| Path | Classification | PR 7 disposition |
|---|---|---|
| Controls unset/off: global URL, no assignment/rebalance, local profile, no lease, rate limit disabled | Required current-production compatibility | Retained, named `compatibility`, covered by startup/token/routing tests |
| Non-selected session inside a canary-capable process | Required rollout compatibility | Retained; receives compatibility token and no lease/durable auth |
| Missing/invalid rate-limit value silently becoming disabled | Ambiguous/dead behavior | Removed; missing defaults to disabled, invalid now fails with `rate_limit_mode_invalid` |
| Missing bridge secret treated as authorized | Unsafe compatibility behavior | Removed; internal bridge API now fails closed |
| Operator unbind switching the session to server egress | Unsafe obsolete path | Removed; session remains `device_tunnel` and disconnected/unbound |
| Duplicated canary parsing, internal HTTP, bridge start/fence, drain state sequencing | Duplicate mechanics | Extracted to shared tested modules |
| LocalAuth mode, global URL, compatibility placement mode, existing schema fields/tables | Post-migration removal only | Retained |

Post-migration deletion requires all production bindings migrated, at least one full release window with no compatibility token or local-profile read, verified durable generations for every active session, tested rollback without old code, audit/telemetry proving zero use, a reversible migration/design, database backup, and explicit approval. Flags, fields, tables, columns, and local profile handling must not be deleted in PR 7.

## Startup configuration matrix

| Placement | Lease | Auth | Rate | Scopes/providers | Result |
|---|---|---|---|---|---|
| unset/false | unset/false | unset/`local` | unset/`disabled` | no scope required | valid compatibility |
| false | false | local | shadow/enforce | no scope required | structurally valid; rate rollout remains separately approved |
| true | true | `encrypted_snapshot` | any valid rate mode | at least one exact unexpired <=7-day scope; exact KMS/private R2 | valid canary-capable process; only selected sessions activate |
| Any partial placement/lease pair | | | | | reject `placement_lease_mismatch` |
| Durable auth without both ownership controls, or ownership controls with local auth | | | | | reject `durable_auth_control_mismatch` |
| Invalid/empty/legacy boolean aliases, invalid auth/rate mode, malformed/expired scope, invalid provider | | | | | reject with a non-secret code |

Rate limiting remains independent and defaults to disabled. A valid `shadow` or `enforce` value does not activate placement, leases, or durable auth; its production enablement still requires separate approval.

## Data inventory, retention, and deletion

| Store/surface | Data | Retention/deletion | Review disposition |
|---|---|---|---|
| PostgreSQL | tenant/session/binding/device relationships; epochs; placement/generation metadata; outbox; append-only auth audit | relational deletion rules; audit events intentionally immutable; generation rows marked deleted after safe object deletion | Access must always include tenant tuple; define regulatory audit retention owner before rollout |
| Redis | hashed rate scopes and short dispatch locks | window TTL plus 60 seconds; lock expiry | No phone/recipient/database ID in keys |
| Local profile | active WhatsApp Web browser profile | current owner only; discarded after verified detach or failed undurable attach | Exact directory/process scope; never log/copy live profile |
| KMS | exact key identifier and ciphertext data keys | follows KMS key-version lifecycle; do not destroy referenced version | Key-only role per node; Security owner |
| Private R2 | encrypted immutable profile generations | 30-day holds plus daily/weekly and current/LKG protection | Bucket-only private credentials; deletion race tests mandatory |
| Logs/health | error codes, counts, timestamps, one-way references/fingerprints | application log policy (not defined in this PR) | Operations/Privacy must set and enforce retention before canary |
| Acceptance captures | redacted references, epochs, counts, booleans, timestamps | change-record retention, secure location | Never include phone/IP/JTI/token/recipient/body/media/path/key/credential/object contents |

No new health/operational response intentionally contains phone numbers, IP addresses, JWT/JTI values, recipients, message bodies/media, profile contents, raw secret-bearing paths, wrapped keys, credentials, or object contents. Combining stable one-way references with timestamps can still be identifying to an operator who has database access; captures therefore remain access-controlled and purpose-limited.

## WhatsApp/Meta policy review

Primary-source review on 2026-07-20:

- [WhatsApp Terms of Service](https://www.whatsapp.com/legal/terms-of-service) prohibit impermissible bulk/auto messaging, unauthorized non-personal use, unauthorized automated access, reverse engineering, and unauthorized substantially similar APIs.
- [WhatsApp Business Terms](https://www.whatsapp.com/legal/business-terms) require consent/security and restrict unapproved applications interacting with Business Services, scraping, reverse engineering, spam, and overloading the service.
- [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy) requires recipient number plus opt-in, honoring opt-out, data notices/permissions, approved templates outside the 24-hour window for the official Platform, and clear human escalation for automation.

Engineering finding: the browser automation stack is not the official WhatsApp Business Platform and cannot be claimed compliant or approved from these public terms. Before any canary, Product and Legal/Policy must document the authorized basis for this transport or choose the official Cloud API; Privacy must approve notices, purpose, retention, deletion, and data-subject handling; Product/Compliance must prove opt-in/opt-out and human escalation; Security must approve the residual account-enforcement and unofficial-client risk. Default disposition: block activation.

## Owners and open dispositions

| Finding | Owner | Disposition before canary |
|---|---|---|
| Unofficial browser automation/terms authorization | Legal/Policy + Product | Written approve/deny; default block |
| Consent, opt-out, service-window/template and human escalation evidence | Product + Compliance | Evidence and operating procedure |
| Log, audit, acceptance, local profile, and backup retention | Privacy + Operations | Approved schedule and deletion procedure |
| Remaining non-critical npm findings | Security + dependency owners | Triage paths/exploitability; critical recurrence blocks |
| KMS/R2 IAM, key/object lifecycle | Security + Infrastructure | Least-privilege review and approved live preflight |
| Migration status opaque schema-engine failure | Database owner | Resolve and record read-only status before migration request |
| Mixed-version app/worker rollback with redacted health | Operations | Rehearse matching bridge/app rollback with all controls off |

## Dependency audit disposition

The final `npm audit --omit=dev --json` reports 25 vulnerable package entries: 1 low, 11 moderate, 13 high, and zero critical. Exact remaining audit nodes are:

- High: `node_modules/@grpc/grpc-js`, `node_modules/@hono/node-server`, `node_modules/axios`, `node_modules/express-rate-limit`, `node_modules/fast-uri`, `node_modules/fast-xml-parser`, `node_modules/follow-redirects`, `node_modules/form-data`, `node_modules/hono`, `node_modules/lodash`, `node_modules/minimatch` plus `node_modules/glob/node_modules/minimatch`, `node_modules/next`, and `node_modules/path-to-regexp`.
- Moderate: `node_modules/@aws-sdk/xml-builder`, `node_modules/brace-expansion` plus `node_modules/glob/node_modules/brace-expansion`, `node_modules/bullmq`, `node_modules/ip-address`, `node_modules/js-yaml`, `node_modules/linkify-it`, `node_modules/markdown-it`, `node_modules/next/node_modules/postcss`, `node_modules/qs`, `node_modules/svix`, and `node_modules/uuid` plus the nested BullMQ/Svix UUID nodes.
- Low: `node_modules/esbuild`.

These entries were not accepted as safe. They remain Security/dependency-owner triage with exploitability and upgrade compatibility to be recorded before rollout; any critical recurrence blocks activation. The requested blocking critical paths are resolved: Clerk is 6.39.6/shared 3.47.8 and protobuf is 7.6.3 across both Google dependency paths.

## Final verification

- Clean install: `npm ci --legacy-peer-deps` passed. The flag is required by the repository's existing React 18/Tremor peer constraint.
- Focused PR 5/6/7 suite: 156/156 passed, including control matrices, selected/non-selected routing, authority/replay/epochs, lease loss, drain fencing, provider exactness/timeouts, archive/corruption/retention/rollback, redaction, append-only audit, compatibility, and the failure matrix.
- Authentication and process checks: Clerk bearer authorization 2/2; PM2 singleton 2/2.
- Android: `testDebugUnitTest` and `assembleDebug` passed; generated artifacts were removed from the worktree.
- Prisma validate/generate, targeted strict TypeScript checks, deployment shell syntax, static/template/dry-run operator commands, production-style gateway/bridge/API bundles, and `git diff --check` passed.
- Transformed bridge closure inspection found none of `getMessageModel()`, `__name`, or `__async`.
- Production build passed. It explicitly skips type validation and retains a dynamic protobuf import warning; full-repository `tsc --noEmit` is not claimed as passing.
- At the PR 7 review checkpoint, no production mutation occurred. A later approved rollout deployed PR 5/6/7, applied the migration from a validated backup, and verified compatibility health/history with all four controls off/local/disabled.

## Remaining activation blockers

Node 2 and its DNS/TLS endpoint are absent; per-node KMS/R2 credential delivery is undecided; no exact approved canary exists; the user-owned R2 token needs a named owner and replacement procedure; and Product/Legal-Policy/Privacy/Security dispositions remain outstanding. The dedicated KMS resource, private bucket and scoped R2 credential, provider preflight, migration, backup, compatibility deployment, and live compatibility verification are complete. Distributed placement, runtime leases, encrypted snapshots, and rate limiting remain inactive.
