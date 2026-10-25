# Substo CRM: design direction

Live-test scope confirmed and deployed 2026-10-25: both apps share the CRM/Studio implementation; the Substo CRM may remain incomplete, with pending capabilities visible. Detailed CRM/provider parity and app-specific optimization are deferred while Studio work continues. Release `d4700a6c` is live after the staged realm migration; see [the rollout result](studio-implementation-progress.md).


Implementation correction (2026-10-25): develop generic features once using shared Estio components and services. Do not build separate Substo editors/renderers/workflows. See [the corrective parity audit](shared-website-parity.md) for verified reuse and outstanding acceptance.


Status: direction approved by the user on 2026-10-24. Slices 0–5 are implemented locally (Clerk email branding remains an external acceptance step) on `feature/crm-realm-identity`; nothing is deployed. See [the rollout runbook](crm-realm-identity-rollout.md). This changes one boundary of the approved brief in [the Studio audit handoff](studio-audit-continuation-handoff.md): there, Substo was "Studio only" with standalone workspace memberships.

## Decisions (user, 2026-10-24)

1. **Two apps, one codebase, the same features.** Estio is the real-estate edition; Substo is the generic edition for anyone. Both have the CRM (conversations, pipeline, contacts, tasks, website…) and Studio (content creation, competitor and virality tracking).
2. **Same Business database** (Prisma) for both.
3. **Separate logins.** Estio and Substo accounts never merge, even with the same email.
4. **One team system per app.** People are invited to a brand in Estio or in Substo, never to Studio separately. Studio's own memberships and invite links are retired.
5. **No GoHighLevel** on either app. The goal is a clean, self-hosted app; GHL is hidden on Substo and is not extended anywhere.
6. **Website is in the first version**, for brand management and posting.
7. **Scope:** start as a mirror of Estio, then make it generic feature by feature. Custom fields and custom objects per niche come later.
8. **Billing:** none yet. Studio is included with access to the software.
9. **Rollout:** public from the start. There are no users yet, and being live shows what to change.
10. **A brand is created automatically** at a user's first Substo sign-in (see below).

## Glossary (use these words everywhere)

| Term | Meaning | Where it lives | Do not confuse with |
| --- | --- | --- | --- |
| **App** | Estio or Substo: the domain, Clerk login and product edition. | Existing code calls this `brand` / `HostBrand` (for example, the `brand` column on Studio tables), and `authRealm` for identity. Not renamed; new code and docs say *app* (or *realm* for identity). | *Brand* below |
| **Brand** | The business or creator a team works on. It is the tenant: it owns contacts, conversations, pipeline, website and Studio content. Every company is a brand; not every brand is a company. | Prisma `Location`, a legacy table name kept to avoid a risky rename. `Location` in code = brand in the product. | *App*; the CRM's **Companies** module, which holds the companies of your *contacts*. |
| **Team member** | A user with a role in one brand. | `UserLocationRole` | Studio workspace membership (retired) |
| **Invitation** | An invite to join one brand in one app. | CRM team page | Studio invite links (retired) |
| **User / account** | One person's login in one app. The same email in the other app is a different user. | Prisma `User` with `authRealm` | |
| **Workspace** | Studio's internal storage container, exactly one per brand. Never shown to users as a separate thing. | Supabase `studio_workspaces` | Brand |

**UI wording:** Substo says **Brand**. Estio keeps its current real-estate wording ("location"/agency) for now. Both come from the vocabulary layer in slice 4, so each app (and later each niche) can choose its word for the same concept.

## The brand works the same in both apps

| | Today | Target (both apps) |
| --- | --- | --- |
| Estio | The brand is a Prisma `Location`; team on the CRM team page; Studio workspace mapped 1:1 with inherited roles. | unchanged |
| Substo | There is no brand in Prisma; only a Studio workspace with its own memberships and invite links. | Same as Estio: the brand is a `Location` marked as Substo, the team is managed on the CRM team page, and the Studio workspace is attached 1:1 with inherited roles. |

Consequences:

- Existing Substo workspaces each get a brand, and their members become brand team members. With no real users yet, this is a small one-off migration.
- Studio's access check for Substo switches from Supabase workspace membership to the brand's team, using the code path Estio already uses.
- Every brand records its app. A Substo user can only join a Substo brand, and an Estio user only an Estio brand.

### Automatic brand at first sign-in (Substo)

- On a Substo sign-in, a user who is in no brand and has no pending invitation gets a brand created automatically and becomes its admin. It is named after them (for example "Martin's brand") and can be renamed in settings.
- A user who signs up through an invitation joins that brand instead, and no extra brand is created.
- Creation is idempotent: a double click, retry or two tabs never make two brands.
- Estio is unchanged: Estio users still join through invitations or the existing onboarding.

## First version on Substo

- **Shown:** dashboard, contacts, companies, conversations/inbox, deals/pipeline, tasks, projects, website (pages, blog, posting), team, settings, AI features and Studio.
- **Hidden:** property-only modules (properties/listings, listing import and scraping, prospecting, viewings and live viewing assist, property print designer, property match campaigns) and GHL. They are blocked on the server, not only removed from the menu.
- **Wording:** real-estate terms get generic ones on Substo: location/agency → brand, property/listing → item, viewing → meeting, buyer/seller lead types → lead.
- **Other integrations** (WhatsApp, the SIM relay, Google/Microsoft sync) are reviewed one by one in slice 5+.

## Slices in order

| # | Slice | Outcome |
| --- | --- | --- |
| 0 | **Separate identities** (done locally, commit `9e2d34ad`) | Equal emails in Estio and Substo are always different users. Ship the additive release first, then the contract step. |
| 1 | **Brands on Substo** | `Location` records its app; automatic brand at first Substo sign-in; CRM team page and invitations per app; the Clerk webhook opened for Substo with its own secret. |
| 2 | **Studio on top of the brand** | A Substo Studio workspace attaches 1:1 to its brand with inherited roles. Existing Substo workspaces are migrated, and Studio memberships and invite links are retired. The Substo Studio chooser lists brands, not workspaces. |
| 3 | **Open the CRM on Substo** (implemented locally) | `/admin` opens on substo.com for the shown modules only, with server-side blocking of hidden ones. An isolation test proves, for every opened route, that a Substo user cannot reach Estio data. |
| 4 | **Look generic** (implemented locally) | CRM option in the product switch, Substo branding (logo, emails, titles) and the vocabulary layer with the generic terms. |
| 5 | **Website on Substo** (implemented locally) | Pages, blog and posting for a brand on a substo.com address. |
| 6+ | **Feature by feature** | Integrations one at a time; custom domains for brand websites (needs Substo sign-in on those domains); custom fields/objects per niche; billing. |

Each slice is a separate local branch and release, with additive migrations that stay compatible with the previous release.

## CRM now, or Studio first?

**Do slices 0–2 next, then alternate.**

- Studio's go-live blockers are done, and Studio is live on both domains. What remains for Studio (scheduled runs, hosted text AI, parity items, backups before real customers) works the same in both apps and does not depend on the CRM.
- Slices 1–2 replace how Substo Studio teams and invitations work, so pause any further Substo-only workspace membership or invite work until then.
- After slice 2, CRM slices 3–5 and Studio feature work can be done in any order.
