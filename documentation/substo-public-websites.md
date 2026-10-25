# Substo public brand websites (slice 5, corrected shared presentation)

Local implementation after `481b10cc`. No production data, migration, DNS/Caddy configuration, external publication or deployment was changed. Synthetic local PostgreSQL data was used for tests and browser checks.

## Customer flow

1. Open **CRM → Website** (or Settings → Brand website). The website starts hidden. Members can see its settings; a current connected brand admin is required to save or publish them.
2. Choose the first-party website address and use the shared **Theme and contact details** and **Navigation and footer** screens for presentation. Saving without **Publish website** reserves the address without exposing the site. Changing the address requires explicit confirmation.
3. Use **Edit homepage** for the existing homepage section editor, and the shared Content page/post editors for other content. Both brands use the same block editor, AI tools, media controls, SEO and live preview. Property-specific section choices are Estio capabilities. Use the navigation builder to choose and arrange links.
4. Publish individual pages/posts, then enable the website. Saved home sections define the homepage. A legacy published page with slug `home` remains a compatibility fallback; a shared hero block is used when neither exists. The editors list live links only while the website is enabled.
5. Turn off **Publish website** to withdraw the whole site. This retains settings, content and addresses but makes homepage, pages, blog posts and sitemap return 404 on the next request.

Public routes are `/sites/<address>`, `/sites/<address>/<page>`, `/sites/<address>/blog`, `/sites/<address>/blog/<post>` and `/sites/<address>/sitemap.xml`. No new DNS, subdomain or custom-domain setup is needed. Custom domains and their login behavior remain a later integration slice.

## Authority and public data

- Middleware admits only these exact public path shapes on allowlisted Substo hosts. GET/HEAD bypass Clerk/Studio readiness; other methods return 405, so this public namespace cannot dispatch Server Actions. The same paths return 404 on Estio and tenant hosts before authentication routing.
- The public reader independently verifies the request host. Every database read requires a Substo `Location` and a website marked published. Every page/post query repeats that relation filter as well as location ID and publication status, including reads made with an old website reference after unpublishing. Future-dated posts remain hidden.
- Only explicitly selected public settings and article fields are returned. Full `Location`, `SiteConfig`, private contact details, credentials, team identities and draft/AI provenance are never serialized into the public pages. The route root omits Clerk/onboarding side effects; its typography, theme, header/footer and page/blog presentation come from the shared website implementation.
- There is no cross-request site-content cache. Public responses and the sitemap use `no-store`, so unpublishing does not depend on cache invalidation. Requests already in progress and copies readers previously saved cannot be recalled.
- Content is sanitized at the hosted data boundary and then passed to the **same** `PublicBlockRenderer` and page/blog views used by Estio. Supported layouts, colours, animations, forms and formatting use that renderer. Arbitrary scripts, event attributes, embeds and executable URLs are removed; supported rich-text classes/alignment/colours remain. Root links stay inside the website. The CSP allows Next hydration and disables public form submission/embeds.
- The shared theme form and navigation builder are available on Substo, using guarded active-brand saves. Property-market, listing and custom-domain/provider actions remain closed. The address form handles only its edition-specific publication/address fields.
- Blog indexes currently return the latest 50 posts; older published URLs remain accessible. Shared larger-site pagination is pending.
- See [the parity audit](shared-website-parity.md) for the correction, shared files, tests and gaps. The existing form block and newsletter do not have a functional lead-capture backend; this is not claimed as completed.

## Schema and rollout

`20261025010000_substo_public_sites_expand` adds three columns to the existing `SearchConfig` table (Prisma `SiteConfig`): unique nullable `substoSiteSlug`, `substoSitePublished NOT NULL DEFAULT false` and nullable `substoSiteConfig JSONB`. The JSON retains the first slice's public presentation values as fallbacks. Both editions now use the existing theme/contact/navigation fields for website design. Estio's domain/integration lifecycle remains unchanged. A check constraint requires an address for publication and a normalized address shape. Previous releases/writers can omit all three columns; no site is enabled by backfill.

Under separately authorized deployment, complete release A (realm expand) and release B's existing brands/contract sequence from [the realm rollout runbook](crm-realm-identity-rollout.md). The website expand migration follows the contract step in migration order. If slices 0–4 are already live, this slice requires only the new additive migration and code. Use `deploy-local-build.sh` with `PRISMA_SCHEMA_SYNC_MODE=migrate-only`. No Studio SQL, worker, cron or DNS change is required for this slice.

Read-only verification after migration, before customers publish:

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'SearchConfig' AND column_name LIKE 'substoSite%';

-- Before any intentional website publication this should be zero.
SELECT count(*) FROM "SearchConfig" WHERE "substoSitePublished";

-- Must always be zero: invalid/cross-app public websites.
SELECT count(*) FROM "SearchConfig" s JOIN "Location" l ON l.id = s."locationId"
WHERE s."substoSitePublished" AND (l."authRealm" <> 'substo' OR s."substoSiteSlug" IS NULL);
```

Then perform signed-in admin/member acceptance using a designated test brand: save settings, edit a rich-text page, preview a draft, publish a homepage/page/post, verify all public routes signed out, and disable the website. Verify another Substo brand and equal-email Estio account cannot change its settings or preview its drafts. Repeat representative Estio website/editor flows. Real customer/production publication is not part of this local task.

Rollback code to `481b10cc` to close the public website namespace again. Keep the additive columns, settings and content; do not reverse or delete data. An older writer still omits the new columns safely. Previously published sites remain recorded but inaccessible through the older host firewall until the slice is restored. Older Estio domain behavior is unaffected.

## Verification

- Focused auth/branding/contact-access/public-site suite: 158/158 pass, including public-route methods/host checks, safe rendering and an independent reader-host test.
- Disposable PostgreSQL: the full migration sequence and schema drift checks pass, plus 15/15 brand/push/public-website integration tests. Previous-release `SearchConfig` inserts still default to private websites.
- Compiler check: zero diagnostics in 30 changed/new TypeScript files (`/tmp/crm-slice5-types-final.log`).
- Production build: exit 0, 130/130 pages (`/tmp/crm-slice5-build-final.log`).
- Studio/team: 103/104 pass, with the previously documented assignment-recovery contract failure (`/tmp/crm-slice5-studio-tests.log`).
- Local HTTP smoke checks pass for all public routes, sitemap, foreign/draft data rejection, POST rejection and Estio-host rejection. All four tested public surfaces return 404 after disabling the website. Public browsing creates zero `User` or `Contact` rows.
- Logs: `/tmp/crm-slice5-focused.log`, `/tmp/crm-slice5-db.log`, `/tmp/crm-slice5-http.log`, `/tmp/crm-slice5-unpublish.log`. Whitespace and shell syntax checks pass.

 The disposable harness runs the full previous-release → realm expand → brands → contract → website expand sequence and compares schema drift. It also tests same-slug isolation, secret projection, unpublished/future/draft content, revoked/member/foreign publication attempts, address-change confirmation, concurrent address claims and previous-release inserts.

Browser acceptance uses a synthetic **North Star Studio** site on localhost, with no Clerk credentials or real account. The T3 preview rendered the page but its screenshot timed out twice; Chrome fallback verified the homepage, published page and post visually and through navigation. Local HTTP checks cover publication, drafts, Estio data, sitemap, methods, host isolation and withdrawing all public surfaces. Signed-in CMS acceptance and real media delivery remain pending.

Historical slice-5 validation above predates the corrective shared implementation; see the progress log for current results.

Remaining: production/Clerk email-branding acceptance and authorized rollout; integration-by-integration work (messaging, Google/Microsoft, SIM relay and automated AI workflows); shared functional lead capture, custom domains and larger-site pagination/search; custom fields/objects per niche and billing.
