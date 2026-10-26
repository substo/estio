# CRM and Studio tenant context: investigation and implementation plan

> **Superseded summary:** read [How Estio and Substo work](how-the-app-works.md) first. This page is kept as history.

**Implemented routing correction, 2026-10-25:** Studio now uses clean `/studio/...` product routes with the CRM active Location as sole tenant authority. The original recommendation to retain UUID URLs/readable aliases is superseded. Legacy UUID links are authorized compatibility handoffs to the same Location and a clean URL; existing UUID storage keys remain private and do not select a separate tenant. See the latest [implementation record](studio-implementation-progress.md).


**Presentation correction, 2026-10-25:** the user's later clarification supersedes this document's app-adjacent logo, create/manage-tenant entry and separate support-control recommendations. The sidebar owns the sole app logo; the header contains only the current tenant selector. CRM and Studio use the same selector and the same existing access choices. Location = brand = subscribed tenant; there is no separate user-managed Studio workspace. Remove additional tenant creation from Studio, and put Team/General configuration in Settings. Preserve internal workspace storage IDs, realm boundaries and audited support access.


Research only, 2026-10-25. Source baseline `8e7d4bb0`; deployed runtime `aef15c20`. No implementation, deployment, invitation, migration, rename or data repair is included.

## Recommendation

Keep the existing tenant: Prisma `Location`, scoped by `authRealm`. CRM and Studio are products within that tenant. Studio workspace UUIDs remain internal storage identities. Build one shared tenant identity control and one server context adapter over existing access services; do not create another organization/workspace membership system or rename database tables.

The top-left header in both products should contain the app logo/name followed immediately by the selected tenant name. One eligible tenant shows plain text; multiple eligible tenants show a dropdown. Estio says Location; Substo says Brand (the existing vocabulary). Product controls say CRM and Studio. Remove overview/sidebar tenant-switch duplicates and Business-as-product wording. Team is tenant administration, with explicit copy that membership grants CRM and Studio access, subject to the existing role/capability rules.

Keep explicit tenant identity in Studio deep links: it makes bookmarks, two tabs, shared links and back navigation unambiguous. Keep existing UUID routes for the immediate release. For a later additive polish, offer `/studio/b/<readable-handle>` as an entry alias redirecting to the existing workspace route. A handle is a separate realm-unique, normalized field on Location with reserved names, collision checks, explicit rename and retained redirects; it is not a truncated UUID, a display-name-derived authorization key, or the public website slug. This gives usable links without migrating all Studio routes, API payloads, SQL foreign keys, object keys or imported data. Do not promise the UUID disappears from the final address bar in this small slice; that requires a separate canonical route migration and is not justified solely by appearance today.

## Evidence and current behavior

### Identity and cardinality

- `prisma/schema.prisma`: Location has a CUID primary key, `authRealm`, nullable name, `isPlatformMaster`, and nullable unique `studioWorkspaceId`. User identity is realm-scoped; equal emails across apps are different identities. `User.locations` connection plus exactly one `UserLocationRole` is required. The role pair has a unique constraint. Realm triggers were added by the existing realm migration; retain them.
- `studio/supabase/migrations/20261022000000_studio_workspace_core.sql`: workspace UUID primary key; app discriminator `brand` is Estio/Substo, not the tenant brand. Estio workspace has `estio_location_id`, unique for Estio. Substo retains historical `substo_standalone` type and its own membership table.
- Estio: Location -> zero or one Studio workspace, enforced by the Studio unique index. Substo: Location -> zero or one workspace via nullable unique `Location.studioWorkspaceId`; a workspace can be referenced by at most one Location. These are separate databases, so no cross-database foreign key guarantees existence or correct app/type. The intended invariant is one workspace per initialized tenant, not that every tenant already has a workspace.
- `lib/studio/access.ts`: Estio access validates the workspace's mapped Location. Substo resolves Location by workspace ID and derives authority from the Prisma team. `lib/brands/brand-service.ts::resolveBrandWorkspaceAccess` mirrors the current role into Studio SQL membership, or deletes the mirror when access is revoked. SQL rows are enforcement mirrors, not independent product entitlements.
- `prepareSubstoSignIn` claims invitations, adopts legacy workspaces as Locations using their existing names, then creates an automatic brand only if appropriate. Legacy Studio-only workspaces therefore need adoption, not a second selectable tenant list. Already-linked workspaces must never be re-imported to restore revoked members. A workspace without a mapping is not authorized simply because its old Studio membership exists.

### Header, navigation and selection

- `app/(main)/admin/_components/dashbord-top-nav.tsx` renders the regular selector only for `availableLocations.length > 1`; there is no one-location label. This is a shared cardinality condition, not a Substo-specific suppression. Estio platform admins instead see `PlatformLocationLoginSwitcher`.
- `active-location-switcher.tsx` calls `/api/active-location` and document-reloads. That endpoint revalidates membership and writes a host-only HttpOnly cookie; its return paths are restricted to CRM. Reusing it unchanged for a workspace URL would leave the old workspace open under a newly selected cookie.
- `lib/auth/active-location.ts` and `active-location-policy.ts` correctly reject foreign/revoked cookie IDs. One eligible membership is automatically selected even with a stale cookie. Multiple memberships without a valid cookie require selection; do not silently pick the first.
- `studio/_components/studio-shell-data.ts` reads the cookie-based active Location, while workspace pages authorize the explicit workspace URL. The shell can display tenant A while content is tenant B. `studio-shell.tsx` parses the pathname for workspace menu/product links but does not resolve that workspace's tenant for the header.
- Estio Studio currently has a plain active-location name without a dropdown; Substo Studio has a separate BrandSwitcher. Logos are in the sidebar while the selector is in the header, so the requested adjacent app/tenant header needs a shared shell identity row, including mobile/collapsed states.
- `studio/workspace/[workspaceId]/page.tsx` displays `workspace.name` and contains Estio's extra Switch location/Business actions, or Substo's Invite your team link. `studio/page.tsx` still says Return to Estio Business. Workspace names can drift: Estio ensure returns an existing workspace without refreshing its name; Substo rename updates Location first and swallows a failed workspace rename. Location.name must be the display authority.
- `lib/auth/product-navigation.ts`, `app/api/studio/product-switch/route.ts` and `studio/actions.ts` already revalidate and map both products to the same Location. Substo's native same-origin POST -> 303 document transition is the deployed fix for cached auth/router loops. Preserve this transport; do not replace it with a client-only push.
- `/studio` Substo auto-opens a sole brand (and may provision its workspace), but does not preferentially open a valid active brand when several exist. Estio always presents the chooser. Normalize entry policy while retaining explicit chooser access.

### Roles and administration

- `platform-access.ts` grants platform administration only on Estio and never during impersonation. Ordinary tenant ADMIN is distinct from PLATFORM_ADMIN.
- `scopeDirectLocationsForSession` restricts non-impersonating PLATFORM_ADMIN direct access to connected master Locations. `PlatformLocationLoginSwitcher` lists Estio support targets and requires a separate user impersonation launch. Its provisional chosen target is not the current active tenant. Do not make these targets ordinary dropdown memberships or let Studio bypass impersonation. Show the actual active tenant in the shared identity row; put support selection in an explicitly labeled support control, preserving the existing audit/launch flow.
- `lib/studio/access-policy.ts` pins Estio impersonation to its audited Location. Retain this and expose the impersonation banner/context in Studio as well as CRM.
- Substo Team actions (`brand/actions.ts`) resolve their tenant from the cookie, while the Studio overview links to unscoped `/brand/team`. A direct workspace link can therefore send an invite for the wrong cookie-selected tenant. This must be fixed together with context coherence, not just relabeled.
- Existing Substo member role changes/removal mirror to Studio before changing Prisma; existing-account invitation and pending invitation claim rely on access-time mirror sync. Keep the single-team design and existing last-admin protection; test mirror failure/retry and do not pretend this is a cross-database atomic transaction.

## Exact-target production diagnostic

Identified deployment from `deploy-local-build.sh` and the active Hetzner symlink `/home/martin/estio-app` -> green. Its BUILD_ID matches the recorded `aef15c20` release: `vAhJCRF75QuCBoYdCJiI9`. Read the runtime environment privately; no secrets were printed. Prisma reads ran inside `SET TRANSACTION READ ONLY`; Studio used one exact-ID REST GET. No app provisioning/access helper was invoked by these diagnostics.

For the explicitly supplied Substo account and workspace:

- Exactly one connected Substo Location: `cmvntrnxm0001a4die51ayr85`, name **`test`**.
- Its unique role is ADMIN, contact access ASSIGNED_ONLY. Account platformRole is STANDARD; Location isPlatformMaster is false.
- Location.studioWorkspaceId is **`7c74d024-c990-4e47-a7b8-511726e7e4d0`**.
- That Studio row is app substo, type substo_standalone, name **`test`**, with no Estio Location ID (correct for this type).
- The Location has no SiteConfig. It is not marked as the auto-created brand for this account. These observations do not prove its historical creation path.

Conclusion: this is a real linked CRM tenant and Studio workspace with matching stored names, not merely a stale workspace label or proven mapping mismatch. The intended Substo company/master identity is not represented by the queried platform flags. No second intended tenant was identified in this account's memberships; no broader tenant scan was performed. Do not grant platform privileges, mark master, merge, or rename based on an email/domain or the word agency.

`middleware.ts` redirects Substo `/` to `/studio`. Public tenant sites currently use `/sites/[siteSlug]`. Therefore owning the Substo root front page is a separate routing/publication decision; changing `test` to Substo would not publish a front page. Do not couple this UI slice to marketing-site publication or platform authorization.

Browser limitation: own Default-profile tab opened the exact workspace and returned title Studio | Substo; both snapshot calls failed with `Preview automation snapshot timed out after 15000ms.` No live visual acceptance is claimed. The initial document GET can invoke the application's existing access-time membership reconciliation; it is not proof of zero server-side effects. No switch/form action, provisioning navigation, invite or explicit database write was performed. Subsequent mapping evidence came only from the direct reads above.

## Implementation stages and owner files

### 1. Immediate shared header fix (code only, no data prerequisites)

Create shared `components/tenant-selector.tsx` (controlled options/current ID plus product-specific submission target) and `components/app-tenant-identity.tsx` (AppLogo + selector). Keep vocabulary and authority outside presentational components. Render plain selected name for one option, dropdown for multiple, explicit no-selection/choose state when appropriate, no UUID as name fallback, keyboard focus and truncation with full accessible name.

Owners: `admin/_components/dashbord-top-nav.tsx`, `active-location-switcher.tsx`, `admin-shell-layout.tsx`, `dashboard-side-bar.tsx`, `studio/_components/studio-shell.tsx`, `components/app-logo.tsx`. Put the app identity next to tenant identity in the header at every breakpoint; sidebar remains navigation and the existing product switch. Do not add another tenant selector there. Keep cost/notifications/user controls on the right. Preserve support/impersonation controls separately.

Update `lib/auth/active-location-contract.test.ts`: it currently explicitly tests that a sole-location header has no label, so the old expectation must change. Add real render assertions for zero/one/multiple rather than only source-text regexes. This first slice can ship the missing one-location label without renaming `test`; include route-derived Studio context before declaring full cross-product correctness.

### 2. One authorized context for the whole rendered surface

Add a small server adapter, e.g. `lib/auth/tenant-context.ts`, returning app, Location ID/name, eligible Locations, tenant role, mapped workspace ID, product and impersonation state. Reuse resolveActiveLocation/validateActiveLocationSelection and workspace access; do not introduce new grants or a second tenant store. Distinguish pure lookup from provisioning and mirror synchronization so a header lookup does not accidentally create tenants/workspaces.

Precedence: verified host/session + impersonation limits -> explicitly authorized workspace/tenant route -> authorized cookie -> sole membership -> chooser/no access. An unauthorized explicit workspace fails closed; never silently substitute cookie content. The name and Team/Settings/product targets come from that same resolved Location.

The current `/studio/layout.tsx` cannot obtain descendant workspace params reliably. Add `studio/workspace/[workspaceId]/layout.tsx` to authorize params and render the shell with explicit context; make the outer Studio layout a common wrapper, not a second shell. Wrap the chooser separately using cookie context. `brand/layout.tsx` also supplies validated tenant context. Audit nested Studio links/headings using `access.workspace.name`; expose a tenant display name from access/context instead of rewriting internal workspace names.

Selection remains a server operation: CRM -> requested Location -> CRM landing; Studio -> requested Location -> ensure its existing mapping/workspace if needed -> workspace overview. Do not carry record IDs, drafts or tenant-specific query strings into another tenant. Warn about unsaved changes through existing form behavior where applicable. On normal entry `/studio`, open the authorized active tenant; show the chooser for invalid/missing selection among multiple, and keep explicit choose mode.

Owners: `lib/studio/access.ts`, `lib/brands/brand-service.ts` lookup boundary, `studio-shell-data.ts`, `studio/layout.tsx`, new workspace layout, `studio/page.tsx`, `studio/actions.ts`, `lib/auth/product-navigation.ts`, `/api/active-location/route.ts`, `/api/studio/product-switch/route.ts`. Keep existing Estio action transport and Substo native document POST. Reuse shared destination services for any new tenant-selection endpoint; enforce same-origin, realm and membership before cookie/provisioning.

Direct-link/back semantics: route context always wins over a stale cookie. After authorized workspace entry, synchronize the last-used cookie through a same-origin POST that validates the workspace mapping and does **not** call ensure/provisioning. This can reuse an extracted selection service behind a small `/api/studio/tenant-selection` handler; it must recheck membership at execution and return no-store. Gate unscoped exits until synchronization, or submit an explicit-context form for those exits. Do not write cookies during Server Component rendering. On history restoration revalidate context, including browser back/forward cache behavior. Product exits must remain explicit-context POSTs even if synchronization fails. Multiple tabs share the last-used cookie by design; the last completed selection wins only for unscoped entry, never for content or actions on an explicit route. State this limitation rather than promising tab-local cookies.

### 3. Bind Team and Settings to the displayed tenant

Keep existing team services. For Studio -> Team/Settings, carry explicit Location identity in the URL (add validated `locationId` query to existing pages for the smallest route change) and use it for page context. Forms include the rendered tenant ID and reauthorize it server-side; the cookie is a fallback for legacy entry, not authority for a submitted form. A forged ID grants nothing. This avoids cross-tab cookie changes moving an invitation or rename to another tenant. Also bind other brand actions (role/remove/revoke/rename), not just invite.

Owners: `brand/team/page.tsx`, `brand/settings/page.tsx`, `brand/layout.tsx`, `brand/actions.ts`, `brand/_components/brand-forms.tsx`, `lib/brands/substo-brands.ts`, `studio-shell.tsx`, workspace overview, plus Estio `admin/team` page/actions/forms for equivalent rendered-tenant binding. Change copy from Studio-only membership and later CRM to current CRM + Studio access. Remove overview Invite your team shortcut in favor of a consistently placed Team link; if retained as onboarding, name the tenant and hide management-only actions for members.

Remove Switch location/Business/Return to Business duplicates in workspace overview and chooser; retain only CRM/Studio product switch and header tenant selector. Keep create/manage tenant entry in the selector menu/chooser; no competing Workspace identity. Profiles/Google connections remain account-scoped, AI keys and budgets remain workspace-scoped.

### 4. Optional separately approved data/name follow-up

No backfill is required to fix the observed selector or mapped identity. First ask the owner to confirm that the linked `test` Location is the intended Substo company tenant and its desired name. If confirmed, use the existing tenant rename path or a separately previewed exact-target repair; preserve both IDs, content, CRM relationships, members and history. Workspace-name mirror reconciliation is optional hygiene once UI uses Location.name. Any missing mapping, orphan workspace, legacy adoption or master/admin bootstrap requires its own targeted evidence and approval under the safe-data-repair skill. Root website routing/publication is a separate product slice. No arbitrary UUID shortening or mass rename.

## Acceptance and testing

Run the relevant existing active-location, product-navigation, product-switch render, host-routing, realm isolation, brand-policy/service, Studio access and schema suites; add focused behavior tests around the new resolver/destinations/forms. Use disposable databases and mocked Clerk delivery. Run affected TypeScript checks (Next build skips full type validation here), then the production build. No need to run a deployment to validate this research or first local slice.

1. Both apps, CRM and Studio, desktop/mobile and collapsed sidebar: same app-adjacent top-left tenant control; one membership plain name, multiple dropdown, zero an honest empty/access state. No overview/top-right/sidebar duplicate tenant switch; CRM/Studio remain explicit product names. Long/empty/duplicate display names remain accessible and IDs never become labels.
2. One membership + absent/foreign/stale cookie: sole eligible tenant is shown. Multiple + missing/stale/revoked cookie: chooser, no accidental first tenant. Zero after removal: deny/chooser without provisioning a replacement through selection resolution. Test normal Substo first-sign-in provisioning separately from revoked-access handling, including the existing auto-brand guard.
3. Select A in CRM -> Studio A -> CRM A; select B in Studio -> CRM B -> Studio B, in both realms. Substo uses native POST/303 without sign-in loops. New tenant workspace provisioning occurs only after authorization; a repeated request uses the same mapping and UUID. No record detail from A is carried into B.
4. Direct workspace B with cookie A, no cookie, or selection-required cookie: content, header, menus, Team and product switch all resolve B. Refresh, bookmarked nested route, back/forward, expired sign-in return and two tabs must not mix displayed tenant or form target. Failed cookie sync cannot change the explicit route's authority. Unauthorized URL fails closed without fallback or cookie change.
5. Team form rendered for A; another tab selects B; submit still targets authorized A. Test forged ID, membership revocation, admin demotion before submit and pending invite revocation. Existing-account invitation, new verified-email claim, last-admin protection and mirror failure/retry are covered with no real invitations. New membership grants both products only in its tenant; contact scope remains enforced.
6. Estio PLATFORM_ADMIN: master tenant direct access only, support target selection does not change the displayed active tenant before login, audited impersonation is pinned across both products. Ordinary Estio multi-location admin remains a membership dropdown. Substo tenant ADMIN remains a tenant admin; no support/global privileges are inferred.
7. Same email in both Clerk realms, foreign workspace UUID, foreign posted Location ID and foreign cookies: deny cross-realm access for pages, selection, product handoff and invitations. Keep DB realm triggers and Studio brand/type validation. Studio-only legacy mapping is adopted only through the explicit existing preparation flow; missing mappings/access are not repaired by navigation or rendering.
8. Display-name drift fixture: Location.name differs from workspace.name; every tenant header/heading uses Location authority while internal IDs/storage names remain stable. Readable alias (if later built) must test collisions, reserved names, cross-realm denial, rename redirects and legacy UUID bookmarks before making any route canonical.

Sources: current code and [Substo CRM design](substo-crm-design.md), [Studio progress](studio-implementation-progress.md), [Studio handoff](studio-agent-handoff.md), [realm rollout](crm-realm-identity-rollout.md). Older handoff statements describing independent Studio teams are superseded by the approved CRM design and current access code. No external industry claim is needed for this recommendation.
