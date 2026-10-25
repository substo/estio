# Shared website implementation: corrective audit, 2026-10-25

The requirement is one product implementation, developed once for both brands. Estio adds real-estate capabilities and vocabulary; Substo uses the generic edition. Matching features should use the same components, interactions and services. Copying an Estio feature into a separate Substo implementation is not parity.

Commit `6532c232` departed from that requirement: it added a simplified Substo page form, public block renderer, header/footer and blog UI. Those forks have now been removed or replaced locally. Its publication/address and isolation work is retained. No production changes or deployments were made.

## Current website parity

| Feature | Shared implementation after correction | Edition boundary / remaining verification |
| --- | --- | --- |
| Page creation and editing | The same `PageForm`, `BlockEditor` and `upsertPage` for both apps | Same section layouts, style controls, media chooser, SEO, publication, AI import/refinement and live preview. Signed-in browser acceptance remains pending. |
| Page presentation | `WebsitePageView` and the existing `PublicBlockRenderer` | Substo prepares untrusted HTML/URLs before passing the original block schema. Layout/theme/animation fields are retained. Property widgets are excluded. |
| Typography and website shell | Shared fonts, `WebsiteShell`, `PublicHeader`, `PublicFooter`, theme and header-style providers | Estio's property search/listing/account actions are capabilities of its edition. Generic sites use the same responsive menu and footer, without property copy or fictitious contact details. |
| Theme, logos, colours and public contact details | Existing `SiteSettingsForm` and guarded `updateSiteSettings` | Substo's save adapter projects public fields and rechecks connected brand admin authority. Domain registry, property-market and provider settings stay Estio-only. |
| Menus and footer | Existing navigation builder, menu-style selector, footer bio/disclaimer and social editors, with their shared actions | Request-realm identity lookup and active-brand checks. Property listing toggle remains Estio-only. |
| Blog authoring | Existing `PostForm`, rich-text/media controls and post actions | Shared already; not rebuilt. |
| Blog index and article | `WebsiteBlogIndex` and `WebsiteBlogPost`, extracted from Estio's original markup | URL base supplied by the route adapter. Hosted posts still require publication and reject future dates. |
| Website address/publication | Substo-specific address/publish form only | `/sites/<address>` and explicit opt-in publication are hosting differences. Theme/content controls are no longer duplicated here. Custom domains remain pending. |
| Homepage | Existing `HomePageForm`, `BlockEditor`, guarded `updateHomeConfig` and shared section-to-block mapping | Both editions use the existing hero/homeSections storage and editor. Substo omits property section choices and rejects forged property sections server-side. A legacy published `home` page remains a fallback until home sections are saved. |
| Forms and newsletter | Same existing website form block/footer appearance | The existing block is not wired to a submission backend; newsletter prevents submission. This correction does not claim lead capture works in either edition. Hosted public writes remain disabled. |
| AI design | Same importer, redesign, section generation and refinement actions | One design prompt with an audience substitution. All six entry points reject a supplied foreign brand ID before config/provider access. Actual AI/provider acceptance remains pending. |

## Architecture and isolation

Host/realm and address resolution belong to the route/data adapters. They do not own a second UI implementation. Estio keeps its current domain resolver and authentication/contact/analytics behavior at its layout edge. Hosted Substo sites remain anonymous without account creation or onboarding side effects.

`lib/website/config.ts` selects and projects explicit public design fields. Credentials and whole Location/SiteConfig records are not sent to the hosted renderer or page editor. `lib/website/hosted-content.ts` removes scripts, executable URLs, event attributes and embeds before data reaches the existing client renderer. It retains the supported block schema, styles, layouts, animations, formatting and safe links; root links are based inside the website. Arbitrary tenant JavaScript is not a website feature. The hosted CSP now admits Next's own scripts so the shared responsive menu and animations can hydrate, while denying framing, embeds and public form submission.

Every public content query still requires the Substo realm, selected Location, published site and published content. Every website save checks current connected admin authority. The existing default-deny API/action policy stays in place; only audited theme/navigation routes/actions were added. Property/public-listing, domain operations and provider integration actions remain closed.

## Wider feature audit and remaining work

The CRM shell, dashboard, contacts/pipeline, companies, projects, conversations, content CRUD, notifications and product switching reuse existing code with edition vocabulary/capability switches. Brand/team and realm adapters are required for separate identity and tenancy. This is a code-path audit, not evidence of complete end-to-end parity across every feature.

Before treating Substo as an accepted generic edition:

1. Run signed-in desktop/mobile acceptance through both brands: create/edit/preview/publish a page; media; AI import/redesign; theme; nested menus; blog; brand/team and product switching. Use equal-email accounts and two Substo brands to verify isolation. No real provider calls were made in the local correction.
2. Review remaining generic contact/project/inbox controls with the same code-path and interaction-parity approach. Homepage, theme, menus, page creation and blog now use the existing shared flows; signed-in acceptance remains required.
3. Enable shared integrations individually after auditing tenant/provider authority: messaging, Google/Microsoft, SIM relay and automated AI workflows. The current firewall still limits these; general business features must not become permanently absent merely because Estio used them first.
4. Reuse the existing domain lifecycle for generic websites when custom-domain work is authorized. Add functional lead capture once, for both editions. Address larger-site pagination/search in shared components.
5. Complete Clerk branding/email previews, custom fields/objects/niche vocabulary and billing. Perform separately authorized staged rollout and production acceptance.

## Validation and rollout

No new migration is introduced by this correction. The earlier realm/brands/website rollout order and compatibility constraints remain in [the rollout runbook](crm-realm-identity-rollout.md). Public sites stay off by default. Existing slice-5 public names/contact/colour/logo values remain fallback inputs until saved with the shared design form; no data rewrite is needed.

Deploy only after separate authorization using `deploy-local-build.sh` and `PRISMA_SCHEMA_SYNC_MODE=migrate-only`. Verify the queries in [the website runbook](substo-public-websites.md), plus same-content rendering and authenticated cross-brand save/preview rejection. To withdraw hosted websites using the previous local firewall, roll code back to `481b10cc`, retaining additive columns/data. Rolling back only to `6532c232` restores the rejected fork and is not the recommended product rollback.

Validation results for the correction are recorded at the top of [the progress log](studio-implementation-progress.md). Tests include identical rendered markup for equivalent generic blocks and blog cards, content sanitization, foreign-brand rejection for all shared website AI actions, navigation realm authority, shared homepage action/storage and real disposable-PostgreSQL design/publication isolation. These checks do not replace signed-in acceptance or real media/provider delivery tests.
