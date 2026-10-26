# How Estio and Substo work

This is the short source of truth. It was written 2026-10-26 after the CRM went live on both apps, and later updated with the user's naming decision. Read it first. The other docs listed at the end are history and evidence; where they disagree with this page, this page wins.

## The product in one paragraph

One Next.js codebase serves two apps, chosen by the domain. **Estio** (estio.co) is the real-estate edition. **Substo** (substo.com) is the generic edition for anyone. Each app has the same two products:
- the **CRM**: contacts, conversations, pipeline, tasks, website and posting;
- **Studio**: content creation, research, competitor and virality tracking.

A customer is a **Business** with a team, and it uses both products. There is no billing yet.

## Names: one word per thing, everywhere

The same name is used in the database, the code, the docs and the screens of both apps. Nothing is hidden behind an internal alias. Where the code still uses an old name, it is listed below as **to rename**, not treated as correct.

| Name | Meaning | Today in code (to rename) |
| --- | --- | --- |
| **App** | Estio or Substo: domain, login, edition. | `HostBrand`, `authRealm`; Studio tables' `brand` column means app |
| **Account** | One person's login in one app. The same email in the other app is a different account. | Prisma `User` + `authRealm` (fine as is) |
| **Business** | The customer: one business and its team. It owns all CRM and Studio data. | Prisma `Location`; "Location" on Estio screens, "Brand" on Substo screens |
| **Team member** | An account with a role (Admin/Member) in one Business. | `UserLocationRole` |
| **Companies** (CRM module) | Your *contacts'* companies. Not a Business. | unchanged |

**Studio workspace: removed as a concept.** Studio data belongs to the Business directly and uses the same Business ID as the CRM. Today Studio still has a separate `studio_workspaces` record and ID, mapped 1:1; this is to be removed.

The rename runs as staged migrations: add the new names first, then switch the code, then drop the old names. It is tracked in `studio-implementation-progress.md`.

## Rules

1. **Build once, share it.** Every feature is one implementation used by both apps and both products. App differences are configuration (menus, wording, capabilities), never a copied page, editor or workflow.
2. **Separate logins.** There are two Clerk instances, and accounts never merge across apps. A Business belongs to one app, and only that app's accounts can join it (enforced in the database).
3. **One Business, both products.** Joining a Business gives CRM and Studio access by role. Invites go to the Business in the app, never to Studio separately.
4. **The active Business is the only tenant input.** It's a cookie, checked against membership on every request. The header, CRM, Studio, Team and Settings all read it. URLs carry no Business or workspace IDs; old links redirect after an access check.
5. **First Substo sign-in creates a Business** if the person has none and no pending invite, and makes them its admin. An invite joins its Business instead. Estio is unchanged (invites and onboarding).
6. **One shell, one header** (`components/app-shell/`). From left to right: the Business name, or a selector if there are several; Live Assist (Estio only); the bell; usage; the profile; the theme. The app logo is in the sidebar. Team and General live under Settings.
7. **Substo CRM is default-deny.** Property-only modules (listings, imports, prospecting, viewings, print designer, match campaigns) are blocked on the server. Unfinished modules show as *Setup pending*.
8. **No GoHighLevel** on either app. The app is clean and self-hosted.
9. **Everything live while developing.** Both apps are public for testing, and unfinished parts are allowed. Every committed change gets deployed, so the live app shows what works. There are no real users yet, so no backups for now.
10. **All paid usage counts.** Every paid API call, AI or not, from CRM or Studio, is recorded against the Business. The header shows one daily and monthly total per Business. This is built up over time.

## Data and hosting

- **Business database** (Prisma/Postgres): accounts, Businesses, teams, and all CRM data for both apps.
- **Studio database** (Supabase): all Studio content per Business. Its membership rows are only a mirror of the Business team, so the database rules still apply.
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
  - Business creation from Studio;
  - workspace IDs in URLs;
  - a separate Substo website editor;
  - separate CRM and Studio headers.

  All of them were later removed or merged. Each came from guessing at an unclear point instead of asking.
- **Same thing, same name.** The confusion between location, brand, workspace, company and tenant came from having several names for one thing. The fix is one name, used everywhere, including in the backend.
- **What was worth it:** separate logins on one shared database. It is done, and doesn't need more work.
- **Keep docs short.** Long progress logs hid the current state. Update this page when a rule changes, and keep a one-line entry in the progress log.

## Status (2026-10-26)

**Working on both apps:**
- separate sign-in;
- the auto-created Business;
- team invites and roles;
- the Business selector;
- the shared shell and header;
- the CRM's reviewed modules and the shared website editor;
- Studio's library, pipeline, knowledge, uploads and transcription.

**Next:**
1. Rename to **Business** everywhere and remove the Studio workspace (staged).
2. **First Studio workflow: onboarding chat**, planned in `onboarding-chat-plan.md`. A guided AI chat with web browsing, built on the existing assistant pieces. It asks about the person and the Business, connects their socials, and saves a Business persona that Studio uses for content.
3. **Scheduled runs**, once the user has connected YouTube at `/account/connections`. No credentials were imported from the old local app.

**Later, decided:**
- One usage total per Business (rule 10).
- CRM integrations for Substo, one by one.
- Custom fields per niche.
- Custom domains for Substo Business websites.
- The Mac network proxy.
- Billing.

**Open ops item:** the Android device gateway keeps restarting because its test-access (canary) period expired. No Business has a device connected. A fix is being researched.

## Older docs (history and evidence)

- `substo-crm-design.md`: original decisions and slices.
- `crm-realm-identity-rollout.md`: identity migration runbook.
- `crm-studio-tenant-context-plan.md`: tenant context research; its routing and logo advice is superseded.
- `shared-website-parity.md`: website reuse audit.
- `studio-implementation-progress.md`: per-slice log.
- `studio-audit-continuation-handoff.md`: original Studio audit.
