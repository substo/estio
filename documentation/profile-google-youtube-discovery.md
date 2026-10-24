# Profile Google connections and Studio YouTube discovery

Google authorization belongs to the signed-in user's profile in the selected
app, keyed by **host-resolved app realm + Clerk user ID**. It is not a Studio
workspace credential. Estio and Substo identities do not merge through email.
A user can connect without having a Studio workspace. Studio separately checks
workspace membership/location authority before consuming that user's grant.
Workspace OpenAI keys/budgets retain their separately approved workspace scope.

## Personal connection

`/account/connections` is shared by both brands and linked from My profile,
the user menu, and Studio. The new capability is **Google — YouTube read
access**. Existing Estio Contacts/Gmail/Calendar credentials and sync settings
are unchanged; this slice neither copies those tokens nor enables Business
sync when a user grants YouTube consent.

The consent flow requests only `youtube.readonly` with offline access and
PKCE. It is app-host bound, tied to the exact Clerk user/session, expires in
10 minutes, and has a one-use database state record. State is protected in an
HttpOnly, SameSite=Lax, host-only cookie (Secure on HTTPS). Callback redirects
are fixed to the current app's profile page, with no-referrer/no-store headers.
The callback rejects missing read scope or refresh token rather than guessing
that an older token belongs to the newly selected Google account.

Refresh tokens are AES-GCM encrypted with associated data containing the app
realm, user ID, and purpose, using the existing server secret keyring. The
`platform_google_youtube_connections` and OAuth-state tables have no workspace
ID or workspace FK. They live in the shared Supabase project, with service-only
access; their logical owner is the app user profile. Ciphertext never reaches
page/client props. Access tokens are refreshed for requests and are not saved.
Actual returned scopes are recorded with the profile grant. A client-ID change
requires reconnection. User impersonation cannot connect or use a grant.

Removing saved access deletes that profile's YouTube credential and pending
consents. It also prevents an already-running callback from reconnecting after
removal. It does not revoke or clear existing Estio Business Google grants.
The page links to Google account permissions for provider-side revocation,
which can affect other capabilities using that Google OAuth client. Realm-specific account deletion cleanup is now implemented locally through the
dedicated signed profile webhook and terminal deletion marker. See
[its configuration and acceptance contract](studio-profile-deletion-webhook.md).
Both production realm registrations/secret/instance configuration and live
verification remain pending; no existing Business webhook was changed.

## Discovery and deliberate workspace sharing

`/studio/workspace/<id>/youtube` supports:

- Public search, labeled `public_search`.
- Workspace-approved public channels, labeled `approved_channel`. Owners/admins
  (Estio location ADMIN) approve a YouTube channel URL, @handle, or ID and enter
  their own label. Handles resolve only through Google's fixed API endpoint.
- Personal subscriptions, available only through the current app user's own
  profile token. Subscription-channel requests recheck `mine=true` membership,
  then fetch public uploads. They are labeled `subscription`.
- A user-supplied single video URL, labeled `saved_url`.

This integration has no personalized home-feed mode or signed-in browser
scraping. Each result page is bounded to 20 entries with opaque API pagination.
Channel discovery uses the uploads playlist and validates returned public video
IDs. Private/unlisted videos are not offered for sharing through this flow.
The connected YouTube channel is identified while browsing subscriptions.

API titles/channel names/publish dates are displayed from the response; no
thumbnails, descriptions, statistics, or complete subscription list are saved
in the database. A 20-minute encrypted selection ticket records the actual
source/query/channel/observation time and video identity, bound to the app user
and authorized workspace. The user supplies their own research title and
explicitly chooses **Save public link to workspace**. This stores the chosen
bookmark URL, user title, and discovery context as a research reference. It
never downloads media/captions, authorizes third-party reuse, starts
transcription, or spends the workspace OpenAI budget.

Save retries deduplicate by workspace/video ID and preserve later hosted edits.
An existing exact canonical YouTube reference can be reused without overwriting
its notes or provenance. Other legacy URL variants are not silently merged.
All writes recheck membership/brand inside service-only RPCs. A token/profile
connection confers no workspace membership, and membership confers no access to
another user's Google token or subscriptions. API usage is capped at 50 discovery
operations per workspace per UTC day, including channel resolution; Google
project quotas also apply. No specific quota-unit price is hardcoded.

Saved links are user research bookmarks, not a provider metadata cache. Before
adding persisted API snippet/statistics caching or automatic synchronization,
implement the applicable refresh/deletion policy and review the production
consent/privacy presentation. The current slice does not claim production API
policy approval or live OAuth verification.

## Runtime setup and activation

Apply the new additive migration after the existing Studio migrations:

```sh
psql "$STUDIO_DATABASE_URL" -v ON_ERROR_STOP=1 -f studio/supabase/migrations/20261024030000_platform_youtube_discovery.sql
```

Keep the database/service credentials server-side. Runtime OAuth credentials
come from a complete `PLATFORM_GOOGLE_CLIENT_ID` / `PLATFORM_GOOGLE_CLIENT_SECRET`
pair when supplied; otherwise the complete existing `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` pair is reused. Pairs are never mixed. Register the exact
callback for every actual app origin on that OAuth client:

```text
https://estio.co/account/connections/google-youtube/callback
https://<actual-Substo-host>/account/connections/google-youtube/callback
```

Enable YouTube Data API v3 for the Google project and configure OAuth consent/
test users or publishing as required by that project. The existing encrypted
secret keyring must be configured. Optional server-only `YOUTUBE_DATA_API_KEY`
enables public discovery without a personal Google grant; it cannot read
subscriptions. Subscriptions always use the requesting user's OAuth token.
No secrets or Google project settings were changed by this implementation.

The Substo firewall now admits the exact `/account/connections` path tree,
protected by the selected Clerk realm. Other account/Business APIs remain
blocked. Sign-in return paths admit this profile tree as well as Studio.

Before activation, verify both app identities and callbacks, consent denial,
account switching/removal, revoked grants, project quota errors, workspace
roles, provider-data handling, and the account deletion cleanup path. Recurring
discovery is now implemented locally as described below; live activation and
Mac-off acceptance remain pending.

## Recurring discovery (local implementation)

Migration 23 (`20261024110000_studio_youtube_schedules.sql`) extends the existing
recurring schedule dispatcher and hosted worker. A user explicitly selects
one approved public channel, saved public search or one channel from their
subscriptions, pins the current profile grant version and authorizes automatic
sharing of at most ten public research links per occurrence. The subscription
channel is verified with `mine=true` and `forChannelId` on activation and each
run. No full subscription list is read or stored by scheduled processing.

Source selections remain in a service-only profile authorization. Workspace
snapshots/results omit the subscription choice; shared links carry scheduled
observation provenance and user-label-plus-video-ID titles. No provider snippet,
statistics, media or transcript is cached. Existing research edits are preserved.
The grant belongs to the original realm/user, never the workspace. Other members
cannot borrow it. Old tabs cannot silently adopt a replaced Google grant.

Local profile removal/replacement pauses its schedules and removes their private
source authorizations. Manual pause, definition changes, revoked membership,
expiry and activation generations fence queued writes. Authorization expires
after 30 days; the shared cron route prunes expired rows while RPCs reject expired
consent immediately. Already shared public research remains workspace content.
Google-side revocation is detected on provider requests; no network transaction
can undo a read already in flight. Estio Business authority is rechecked before
reads and persistence but is not atomic across the separate databases.

The existing 50 logical discovery operations/workspace/UTC-day cap also covers
scheduled attempts; Google project quotas remain separate. Repeated bounded
Google reads are possible after a worker crash. Persisted results and link
writes are idempotent and atomic, with lease/consent/grant checks at commit.
There is no OpenAI spend or media processing. The existing production schedule
owner remains `scripts/install-cron.sh`; no installation or deployment occurred.
Current validation and remaining release gates are in
[the progress record](studio-implementation-progress.md).

## Validation

- 25 focused tests passed: Google/YouTube adapters and input validation,
  personal-token usage, public-only video filtering, fixed provider endpoints,
  bounded request reads, PKCE/scope checks, realm/user/session/origin-bound state,
  workspace-bound selection tickets, and existing access/encryption/firewall
  regression checks.
- All 14 disposable PostgreSQL suites passed, including profile connection
  creation without a workspace, cross-realm isolation for equal user IDs,
  callback expiry/replay/session checks, removal versus in-flight callbacks,
  manager/member boundaries, quotas, bookmark retries, and revoked membership.
- Changed-file compiler diagnostics: zero in 24 files, not a full-project pass.
  The production Next build exited 0 and includes the profile/OAuth and discovery
  routes. Google calls were mocked; no live user consent or production migration
  was performed.

Primary implementation references: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server),
[subscriptions.list](https://developers.google.com/youtube/data/docs/subscriptions/list),
[channels.list](https://developers.google.com/youtube/v3/docs/channels/list),
[playlistItems.list](https://developers.google.com/youtube/v3/docs/playlistItems/list),
[search.list](https://developers.google.com/youtube/v3/docs/search/list), and
[YouTube data handling policies](https://developers.google.com/youtube/terms/developer-policies).
