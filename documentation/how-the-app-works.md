# How Estio and Substo work

The short source of truth, written 2026-10-26 after the CRM went live on both apps. Read this first. The other docs listed at the end are history and evidence; where they disagree with this page, this page wins.

## The product in one paragraph

One Next.js codebase serves two apps, chosen by the domain. **Estio** (estio.co) is the real-estate edition. **Substo** (substo.com) is the generic edition for anyone. Each app has the same two products: the **CRM** (contacts, conversations, pipeline, tasks, website…) and **Studio** (content creation, research, competitor and virality tracking). A customer is a **tenant**: one business with a team. The tenant uses both products, and there is no billing yet.

## Words (use them everywhere)

| Word | Meaning | In code |
| --- | --- | --- |
| **App** | Estio or Substo: domain, login, edition. | `HostBrand`, `authRealm` (old name `brand` on Studio tables) |
| **Account** | One person's login in one app. The same email in the other app is a different account. | Prisma `User` + `authRealm` |
| **Tenant** | The business a team works for. Estio calls it a *Location*, Substo a *Brand*. It is the same thing. | Prisma `Location` |
| **Team member** | An account with a role (Admin/Member) in one tenant. | `UserLocationRole` |
| **Workspace** | Studio's storage for one tenant. Internal only, never shown or managed by users. | Supabase `studio_workspaces` |

The CRM's **Companies** module holds your *contacts'* companies. It is not a tenant.

## Rules

1. **Build once, share it.** Every feature is one implementation used by both apps and both products. App differences are configuration (menus, vocabulary, capabilities), never a copied page, editor or workflow.
2. **Separate logins.** There are two Clerk instances, and accounts never merge across apps. A tenant belongs to one app, and only that app's accounts can join it (enforced in the database).
3. **One tenant, both products.** Joining a tenant gives CRM and Studio access by role. Invites go to the tenant in the app, never to Studio separately.
4. **The active tenant is the only tenant input.** It's a cookie, checked against membership on every request. The header, CRM, Studio, Team and Settings all read it. URLs carry no tenant or workspace IDs; old UUID links redirect after an access check.
5. **First Substo sign-in creates the tenant** if the person has no tenant and no pending invite, and makes them its admin. An invite joins its tenant instead. Estio is unchanged (invites and onboarding).
6. **One shell, one header** (`components/app-shell/`). From left to right: the tenant name, or a selector if there are several; Live Assist (Estio only); the bell; AI usage; the profile; the theme. The app logo is in the sidebar. Team and General live under Settings.
7. **Substo CRM is default-deny.** Property-only modules (listings, imports, prospecting, viewings, print designer, match campaigns) are blocked on the server. Unfinished modules show as *Setup pending*.
8. **No GoHighLevel** on either app. The app is clean and self-hosted.
9. **Public from the start.** Both apps are live for testing, and unfinished parts are allowed.

## Data and hosting

- **Business database** (Prisma/Postgres): accounts, tenants, teams, and all CRM data for both apps.
- **Studio database** (Supabase): all Studio content, with one workspace per tenant. Studio's membership rows are only a mirror of the tenant team, kept in sync on access, so the database rules still apply.
- **Media** is in Cloudflare R2.
- **Hosting:** Hetzner + Caddy + Cloudflare. Deploy only with `deploy-local-build.sh`, which ships the **local working tree** and runs `prisma migrate deploy` first. Never Vercel.

## What we learned

- **Ask before building.** Early slices built parallel systems the product didn't want: standalone Studio workspaces with their own memberships and invite links; creating tenants from Studio; workspace UUIDs in URLs (and a plan for readable aliases); a separate Substo website editor; and separate CRM and Studio headers. All were later removed or merged. Each came from guessing at an unclear point instead of asking.
- **One concept, one place.** When two things look alike (tenant and workspace, Location and brand, CRM header and Studio header), make them one thing and hide the other as internal detail.
- **What was worth it:** realm-scoped identity, meaning the same database with separate logins. Without it, same-email accounts would merge across apps. It is done, and doesn't need more work.
- **Keep docs short.** Long progress logs hid the current state. Update this page when a rule changes, and keep a one-line entry in the progress log.

## Status (2026-10-26)

**Working on both apps:** separate sign-in, the auto-created tenant, team invites and roles, tenant selector, shared shell and header, the CRM's reviewed modules, the shared website editor, and Studio's library, pipeline, knowledge, uploads and transcription.

**Not done, decided:**
- The AI usage badge will show one total per tenant (CRM + Studio AI spend).
- CRM integrations (WhatsApp, Google/Microsoft sync, SIM relay) are to be reviewed one by one for Substo.
- Custom fields per niche.
- Custom domains for Substo tenant websites.
- Billing.

**Not done, Studio:** scheduled runs that execute on their own; live checks of Google/YouTube consent and R2 uploads; running jobs with the Mac off; backups before real customers.

## Older docs (history and evidence)

- `substo-crm-design.md`: original decisions and slices.
- `crm-realm-identity-rollout.md`: identity migration runbook.
- `crm-studio-tenant-context-plan.md`: tenant context research; its routing and logo advice is superseded.
- `shared-website-parity.md`: website reuse audit.
- `studio-implementation-progress.md`: per-slice log.
- `studio-audit-continuation-handoff.md`: original Studio audit.
