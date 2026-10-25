# Substo edition: product switch and generic vocabulary (slice 4)

Implemented locally after `4408b7b7`, on `feature/crm-realm-identity`. No production data, Clerk configuration, migration, email delivery or deployment was changed.

## Product navigation

Both desktop/collapsed sidebars and mobile menus now show CRM | Studio on Substo. CRM → Studio submits the active brand to the existing same-realm membership check and opens/creates that brand's Studio workspace. Studio → CRM resolves the displayed workspace's current brand team, revalidates the brand membership, sets the active brand cookie and enters `/admin`. A stale cookie cannot send the user to a different brand, and revoked/foreign access never changes the cookie. The chooser uses `/admin`, whose entry resolves/creates the user's brand or requires selection.

The host/API/Server Action firewall from slice 3 is unchanged. Property workflows, GHL and other unreviewed integrations remain closed. Estio keeps its original actions and targets.

## Branding and vocabulary

- `lib/branding/app-identity.ts` owns app names, descriptions and icons. The CRM, Studio and sign-in shells share the existing Substo S wordmark through `AppLogo`; collapsed logos retain an accessible name. Substo metadata names the app and active product, without Estio marketing metadata. The local SVG mark is `/images/substo-mark.svg`.
- `lib/branding/crm-vocabulary.ts` owns edition wording: brand/location, team member/agent, item/property, meeting/viewing, contact categories and project company/developer. Client CRM surfaces read the server-provided realm; selection pages resolve it from the request host. This is a presentation layer, not a tenant authority mechanism.
- Contact types on Substo offer Lead, Professional, Partner, Associate, Company and Contact. Their existing persisted type/role values stay intact. Legacy property-specific types get generic labels and no property fields or requirements. Generic professional/partner/company contacts can link a company in their own brand through the existing relationship validation.
- The pipeline's saved `Viewing` value displays as Meeting; drag/drop still submits `Viewing`. New generic enquiries use the existing `Other` goal. Saved legacy goal values remain selectable so opening/saving a record does not rewrite them. No enum or database migration is needed.
- Projects use company and project wording, offer all companies in the active brand, and hide property counts, units, amenity controls and property filters. Saved hidden amenities are retained when editing. New Substo projects are attributed to Substo on the server. Estio retains its existing project UI.
- Brand selection, assignment filters, contact detail/cards, pipeline headings, AI usage headings, settings and the dashboard use the edition vocabulary. Public websites remain slice 5; provider and automated AI workflow adaptation remains later work.

## Authentication and invitation emails

Email delivery remains with **Substo's own Clerk application**. `substoClerk()` creates invitations with `notify: true` using only Substo keys. The Estio/GHL Clerk mail webhook stays blocked on Substo. The installed Clerk invitation API exposes template selection, not per-invitation sender or HTML branding; application-level email branding is external configuration.

These are the concrete settings/copy to review in the Substo Clerk application before release. They have **not** been applied to the live account:

| Surface | Substo copy/configuration |
| --- | --- |
| Application name | Substo |
| Logo | Shared Substo S mark/wordmark; retain a usable text fallback |
| Sender display name | Substo, using the application's existing verified delivery identity |
| Invitation subject | You're invited to Substo |
| Invitation introduction | You've been invited to join a team in Substo. Accept your invitation to access your brand's CRM and Studio. |
| Verification subject | Verify your email for Substo |
| Verification introduction | Verify your email to continue to Substo. |
| Recovery/security emails | Substo as the application name; preserve Clerk's generated codes, action URLs and security wording |

Preserve Clerk's existing template variables, verification codes and action URLs when applying this copy. Preview verification, invitation and recovery emails from the **Substo** application, including mobile and text versions. Confirm links use the Substo sign-in/sign-up flow, and that equal-email Estio users remain separate. Estio's Clerk application and delivery settings are unchanged. Real email previews/delivery are a release acceptance step, not covered by local render tests.

## Verification

- `npx tsx --test lib/branding/*.test.*`: 10 tests cover actual switch actions, both product menus, collapsed CRM switches, revoked/foreign access, stale selection, logo rendering and preservation of saved goal/stage values.
- Focused auth/brand/contact-access/product-switch/edition suite: 148/148 pass, including the slice 3 route/action isolation tests.
- Studio/team checks: 103/104 pass; the previously documented assignment-recovery contract test still fails.
- Changed-file compiler comparison against `4408b7b7`: no new diagnostics in 39 files; six pre-existing diagnostics remain (down from nine). The touched contact view also gained its missing Badge import.
- `git diff --check` passes. `npm run build` exits 0 with 129/129 pages, using a clean environment, an unreachable dummy Business database and no provider credentials.
- Local logs: `/tmp/crm-slice4-focused.log`, `/tmp/crm-slice4-edition-tests.log`, `/tmp/crm-slice4-studio-tests.log`, `/tmp/crm-slice4-types-base.log`, `/tmp/crm-slice4-types-final.log`, `/tmp/crm-slice4-build.log`.
- No signed-in browser session or real Clerk email was exercised.

## Rollout and rollback

No migration is added. Follow release A → release B in [the realm rollout runbook](crm-realm-identity-rollout.md), using `deploy-local-build.sh` under separate authorization. Slice 4 can also follow an already deployed slice 3 as a code-only release. Verify both directions of the switch for single-brand, multiple-brand and revoked-member users; test a displayed Studio workspace whose brand differs from the stale active cookie. Repeat Estio's switch and contact/project flows. Confirm forbidden routes/actions still reject Substo, and preview Substo's Clerk email branding separately.

Rollback the code to `4408b7b7` to hide Substo's product switch and restore the previous presentation while retaining slice 3's CRM firewall. Saved IDs, enums, memberships and content remain compatible; do not reverse or delete data. External Clerk email-branding changes, if later applied, have their own account configuration history and do not require a database reversal.

Remaining: signed-in two-app acceptance, Clerk branding preview/delivery and authorized rollout; [slice 5 public brand websites](substo-public-websites.md) are implemented locally; slice 6+ integrations, automated workflow adaptation, custom domains, custom fields/objects and billing.
