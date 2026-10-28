# How Estio and Substo work

This is the short source of truth. It was written 2026-10-26 after the CRM went live on both apps, and later updated with the user's naming decision. Read it first. The other docs listed at the end are history and evidence; where they disagree with this page, this page wins.

## The product in one paragraph

One Next.js codebase serves two apps, chosen by the domain. **Estio** (estio.co) is the real-estate edition. **Substo** (substo.com) is the generic edition for anyone. Each app has the same two products:
- the **CRM**: contacts, conversations, pipeline, tasks, website and posting;
- **Studio**: content creation, research, competitor and virality tracking.

A customer is a **Location** (a business with a team; Substo screens call it a Brand), and it uses both products. There is no billing yet.

## Names: one backend name per thing

Decided 2026-10-27. In the database, code and docs, each thing has exactly one name, and Studio and the CRM use the same one. The screens may use friendlier words per app, through the vocabulary layer only.

| Backend name | Meaning | Screens | To fix in the backend |
| --- | --- | --- | --- |
| **App** | Estio or Substo: domain, login, edition. | Estio / Substo | Studio tables' `brand` column means the app; it becomes `app` |
| **Account** | One person's login in one app. The same email in the other app is a different account. | Account / profile | Prisma `User` + `authRealm` (fine as is) |
| **Location** | The customer: one business and its team. It owns all CRM and Studio data. | Estio: "Location"; Substo: "Brand" | Names using `brand` for a Location (`BrandInvitation`, `lib/brands`) become location names |
| **Team member** | An account with a role (Admin/Member) in one Location. | Team | `UserLocationRole` (fine as is) |
| **Companies** (CRM module) | Your *contacts'* companies. Not a Location. | Companies | unchanged |

**No Studio workspace.** Studio data belongs to the Location directly and uses the same `location_id` as the CRM. The approved merge uses the CRM PostgreSQL database: Prisma owns `public`, Studio SQL/functions own `studio`, and same-realm `UserLocationRole` is the authority without a stored team mirror. The `studio-db-merge` branch is being verified locally; production remains unchanged until the gated cutover in `studio-merge-cutover.md`.

## Rules

1. **Build once, share it.** Every feature is one implementation used by both apps and both products. App differences are configuration (menus, wording, capabilities), never a copied page, editor or workflow.
2. **Separate logins.** There are two Clerk instances, and accounts never merge across apps. A Location belongs to one app, and only that app's accounts can join it (enforced in the database).
3. **One Location, both products.** Joining a Location gives CRM and Studio access by role. Invites go to the Location in the app, never to Studio separately.
4. **The active Location is the only tenant input.** It's a cookie, checked against membership on every request. The header, CRM, Studio, Team and Settings all read it. URLs carry no Location or workspace IDs; old links redirect after an access check.
5. **First Substo sign-in creates a Location** if the person has none and no pending invite, and makes them its admin. An invite joins its Location instead. Estio is unchanged (invites and onboarding).
6. **One shell, one header** (`components/app-shell/`). From left to right: the Location name, or a selector if there are several; Live Assist (Estio only); the bell; usage; the profile; the theme. The app logo is in the sidebar. Team and General live under Settings.
7. **Substo CRM is default-deny.** Property-only modules (listings, imports, prospecting, viewings, print designer, match campaigns) are blocked on the server. Unfinished modules show as *Setup pending*.
8. **No GoHighLevel** on either app. The app is clean and self-hosted.
9. **Everything live while developing.** Both apps are public for testing, and unfinished parts are allowed. Every committed change gets deployed, so the live app shows what works. There are no real users yet, so no backups for now.
10. **All paid usage counts.** Every paid API call, AI or not, from CRM or Studio, is recorded against the Location. The header shows one daily and monthly total per Location. This is built up over time.

## Data and hosting

- **CRM database** (Prisma/Postgres): accounts, Locations, teams, and all CRM data for both apps.
- **Studio target:** the same CRM database/pool, in schema `studio`, with Location foreign keys and canonical same-realm team authority. The old Studio Supabase project remains the frozen fallback after cutover; the local readiness round does not activate production. Both projects remain Free; R2 keys are preserved.
- **Media** is in Cloudflare R2.
- **Hosting:** Hetzner + Caddy + Cloudflare. Deploy only with `deploy-local-build.sh`, which ships the **local working tree** and runs `prisma migrate deploy` first. Never Vercel.
- **`release/studio-go-live` is the deployed branch.** Keep it equal to what's live. Never deploy from an older branch or a checkout with stale changes.
- **Platform sign-ins** (Google/YouTube and others) are OAuth connections owned by the person's account, at `/account/connections`. No cookies or passwords are imported. Long term, a local Mac app will route these sign-ins through the user's own network, so platforms see the user's location, not the server's.

## How we work

- **Ask before building** when anything is unclear. Write down the decision here, then build.
- An orchestration conversation plans and checks the work. **Sub-agents implement**, one task each.
- Keep changes small, and reuse what exists. Use no new parallel systems.

## What we learned

- **Guessing created parallel systems.** Early slices built:
  - standalone Studio workspaces with their own members and invite links;
  - Location creation from Studio;
  - workspace IDs in URLs;
  - a separate Substo website editor;
  - separate CRM and Studio headers.

  All of them were later removed or merged. Each came from guessing at an unclear point instead of asking.
- **Same thing, same name.** The confusion between location, brand, workspace, company and tenant came from having several names for one thing. The fix is one name, used everywhere, including in the backend.
- **What was worth it:** separate logins on one shared database. It is done, and doesn't need more work.
- **Keep docs short.** Long progress logs hid the current state. Update this page when a rule changes, and keep a one-line entry in the progress log.

## Status (2026-10-27)

**Studio paused: Supabase egress quota; re-key parked on wip/studio-location-rekey.** While the provider restricts the project, Studio shows "Studio is temporarily unavailable" inside the shell, and its APIs return 503. The CRM, sign-in and deploys keep working (readiness reports `degraded`). Resume notes and egress suspects: `business-rename-plan.md`.

**Working on both apps:**
- separate sign-in;
- the auto-created Location;
- team invites and roles;
- the Location selector;
- the shared shell and header;
- the CRM's reviewed modules and the shared website editor;
- Studio's library, pipeline, knowledge, uploads and transcription.

**Next:**
1. Key Studio by `location_id` and remove the workspace; rename `brand` to Location or app names in the backend (staged). Stage A is done; Stage B is parked until Supabase is reachable.
2. **First Studio workflow: onboarding chat**, planned in `onboarding-chat-plan.md`. A guided AI chat with web browsing, built on the existing assistant pieces. It asks about the person and the Location, connects their socials, and saves a Location persona that Studio uses for content.
3. **Scheduled runs**, once the user has connected YouTube at `/account/connections`. No credentials were imported from the old local app.

**Later, decided:**
- One usage total per Location (rule 10).
- CRM integrations for Substo, one by one.
- Custom fields per niche.
- Custom domains for Substo Location websites.
- One Mac companion for the network proxy and optional Studio processing, configured from Settings with detected hardware, per-feature/model choices and a researched model catalogue. Local jobs wait without a timeout or automatic paid fallback; Process now promotes queued work. See [the connected-computer plan](studio-mac-processing-plan.md).
- Billing.

**Android device gateway (SIM relay):** optional. It sends WhatsApp Web traffic out through a connected Android phone. On this server it only runs for a test-access (canary) entry, which lasts at most 7 days and is never renewed automatically. When no canary is active, the gateway and the WhatsApp bridge are **off**. They log `disabled: canary_scope_expired` and exit cleanly, without restarting. Deploys remove them and still finish. The deploy records the state in `/home/martin/.deploy-state/device-egress-status`. No Location has a device connected (the last device activity was in August 2026).

## Older docs (history and evidence)

- `substo-crm-design.md`: original decisions and slices.
- `crm-realm-identity-rollout.md`: identity migration runbook.
- `crm-studio-tenant-context-plan.md`: tenant context research; its routing and logo advice is superseded.
- `shared-website-parity.md`: website reuse audit.
- `studio-implementation-progress.md`: per-slice log.
- `studio-audit-continuation-handoff.md`: original Studio audit.
