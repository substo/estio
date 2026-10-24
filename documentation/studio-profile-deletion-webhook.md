# Studio profile deletion webhook

This is local implementation, not a production registration or a general account
or Business-data erasure operation. The current status is in
[the implementation progress record](studio-implementation-progress.md).

## Endpoint and realm binding

Register a **separate profile-only endpoint** in each actual Clerk application's
Webhooks dashboard, subscribing to `user.deleted`:

- Estio: `https://estio.co/api/webhooks/clerk-profile`.
- Substo: `https://substo.com/api/webhooks/clerk-profile`, after separately
  authorized hostname/realm activation and verification.

These exact first-party paths are independent of browser Clerk authentication
and browser-key readiness. Tenant hosts and adjacent/subpaths are rejected.
The existing `/api/webhooks/clerk` Business signup/phone-sync handler and
`/api/webhooks/clerk-mail` are unchanged. Do not repoint their registrations or
reuse their secrets as a configuration shortcut.

Server-only configuration for the new endpoints:

- `ESTIO_CLERK_PROFILE_WEBHOOK_SECRET`: the Estio profile endpoint's Svix signing
  secret from its actual dashboard endpoint.
- `ESTIO_CLERK_INSTANCE_ID`: that Estio Clerk application's exact `instance_id`.
- `SUBSTO_CLERK_PROFILE_WEBHOOK_SECRET`: the Substo profile endpoint's own Svix
  signing secret.
- `SUBSTO_CLERK_INSTANCE_ID`: that Substo Clerk application's exact `instance_id`.

The two signing keys and instance IDs must be distinct. Missing, malformed or
shared signing configuration fails closed. The new endpoint has no fallback
to the existing `CLERK_WEBHOOK_SECRET`. Keep secrets in the existing private
server secret configuration; do not put them in public environment variables,
client props, source control or chat. No secret/configuration was changed locally.

The trusted exact host selects the realm. The raw request bytes (at most 64 KiB)
and Svix headers are verified with the installed Svix implementation before
processing. The signed instance must match the configured instance; event
metadata, email, `external_id` and submitted realm hints never choose a profile.
A well-formed signed `user.deleted` must name a deleted user object and Clerk
user ID. Unrelated verified events are acknowledged without synchronization.
Old event timestamps are accepted with a currently valid delivery signature,
so delayed provider retries remain usable; stale delivery signatures reject.

## Atomic cleanup and replay

Migration 25, `20261024130000_platform_profile_deletion.sql`, targets only the
dedicated Studio project. It adds realm/user deletion markers and minimal
verified-event audit rows. Stored event metadata is ID, user/realm, event and
receipt time, raw-body digest and cleanup counts; raw Clerk payloads, names and
emails are not retained by this handler.

The RPC serializes on the same profile lock used by YouTube credentials, then:

1. Records a terminal deletion marker for that exact realm/Clerk ID.
2. Pauses that principal's enabled recurring workflows, including text jobs.
3. Deletes their encrypted profile YouTube credential, pending OAuth states and
   private scheduled-source authorizations.
4. Records the verified event and cleanup result in the same transaction.

A failed step rolls the whole transaction back and returns a retryable HTTP
failure. Identical event delivery returns its original result. Conflicting
reuse of an event ID is refused; the same event ID in another signing realm is
independent. Later events cannot clear the deletion marker. A deleted ID cannot
begin/finish OAuth, recreate its grant, create a new Substo workspace or accept
an invitation. Current Studio/profile access and unattended checks reject the
marker, including when an old signed-in session still exists. Existing SQL
membership/AI/YouTube/schedule authority helpers also check active profile state.
Concurrent commands take shared profile claims; deletion takes the exclusive
claim. The marker remains necessary after cleanup to prevent resurrection.

A callback/source request already in flight cannot be undone. Its later grant
commit or recurring-result write must still pass the deletion/consent fence.
The deletion event is asynchronous: the fence starts after successful event
processing, not at the instant the user clicks delete in Clerk. Undelivered or
misconfigured webhooks cannot be treated as successful cleanup. Monitor the
provider's endpoint delivery status and replay failures under a reviewed plan.

## Preserved scope

Other realms' equal Clerk IDs, other profiles' grants and recurring work are
unchanged. Shared research/content, evidence, media, workspaces, memberships and
ownership roles, invitations/audit history, workspace AI keys/budgets and paid
usage/results are retained. Retained roles cannot authorize a deleted principal
through Studio's active-profile checks. No ownership transfer or workspace
cascade is performed; owner succession and wider data-erasure policies need
their own reviewed scope. Existing already-authorized one-off workspace jobs are
not cancelled, and uncertain paid holds are not released or reconciled here.

No Estio Business/Prisma user, contact, team or existing Google integration is
removed or changed. This endpoint blocks Studio/profile capabilities rather
than replacing Business identity lifecycle policy. It makes no Google-side
revocation call, which could affect other capabilities using that OAuth client;
it removes the stored profile credential locally. Explicitly shared workspace
research remains workspace content after the personal connection is gone.

## Separately authorized rollout and acceptance

Verify the dedicated target and backups, drain workers and apply the reviewed
migration with matching code before enabling the new endpoints. Deploy does
not apply migrations. Configure both realms' endpoint-specific secrets/instance
IDs from their actual dashboards and register the exact production URLs.
Verify existing Business/mail endpoints retain their original registrations.
None of those actions occurred during this local implementation.

Use disposable accounts and synthetic shared research for authorized live
acceptance. Verify each realm's signed deletion, retry, stale/cross-realm
rejection, connection/pending-state/source removal, recurring pause and old
session/callback denial. Check that the other realm's profile and workspace
research/roles remain intact, and that mismatched/offline Studio dependencies
return failure so delivery can retry. Include representative remaining-owner
and last-owner cases without silently transferring or deleting workspaces.
Real Google grants, Clerk events, signed-in cross-brand checks and server
Mac-off acceptance remain pending.

Primary references: [Clerk webhook delivery and deletion ordering](https://clerk.com/docs/guides/development/webhooks/overview),
[Clerk sync/webhook verification](https://clerk.com/docs/guides/development/webhooks/syncing).
The implementation also checks the installed Svix verifier and Clerk deleted
object types rather than assuming browser SDK behavior.
