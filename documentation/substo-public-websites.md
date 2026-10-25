# Substo public brand websites (slice 5)

Local implementation after `481b10cc`. No production data, migration, DNS/Caddy configuration, external publication or deployment was changed. Synthetic local PostgreSQL data was used for tests and browser checks.

## Customer flow

1. Open **CRM → Website** (or Settings → Brand website). The website starts hidden. Members can see its settings; a current connected brand admin is required to save or publish them.
2. Choose an address such as `https://substo.com/sites/my-brand`, a public name/description, optional public contact email and logo URL, and a brand colour. Saving without **Publish website** reserves the address without exposing the site. Changing an existing address requires confirmation because old links stop working.
3. Create/edit pages and posts in the existing Content modules. Substo pages have a rich-text editor that needs no AI provider. Existing section-based pages retain their sections. The **Preview saved page** link opens a private, brand-scoped preview, including drafts.
4. Publish individual pages/posts, then enable the website. A published page with the slug `home` becomes the homepage; otherwise the site shows the public name/description and latest posts. Published pages appear in navigation, and the blog has its own index and post addresses. The editors list live links only while the website is enabled.
5. Turn off **Publish website** to withdraw the whole site. This retains settings, content and addresses but makes homepage, pages, blog posts and sitemap return 404 on the next request.

Public routes are `/sites/<address>`, `/sites/<address>/<page>`, `/sites/<address>/blog`, `/sites/<address>/blog/<post>` and `/sites/<address>/sitemap.xml`. No new DNS, subdomain or custom-domain setup is needed. Custom domains and their login behavior remain a later integration slice.

## Authority and public data

- Middleware admits only these exact public path shapes on allowlisted Substo hosts. GET/HEAD bypass Clerk/Studio readiness; other methods return 405, so this public namespace cannot dispatch Server Actions. The same paths return 404 on Estio and tenant hosts before authentication routing.
- The public reader independently verifies the request host. Every database read requires a Substo `Location` and a website marked published. Every page/post query repeats that relation filter as well as location ID and publication status, including reads made with an old website reference after unpublishing. Future-dated posts remain hidden.
- Only explicitly selected public settings and article fields are returned. Full `Location`, `SiteConfig`, private contact details, credentials, team identities and draft/AI provenance are never serialized into the public pages. The site has its own root layout, without Clerk providers, CRM onboarding, Contact/User creation or Estio's property layout.
- There is no cross-request site-content cache. Public responses and the sitemap use `no-store`, so unpublishing does not depend on cache invalidation. Requests already in progress and copies readers previously saved cannot be recalled.
- Rich text is parsed into an allowlist of React elements, rather than injected as raw HTML. Event/style attributes, executable URLs, scripts, forms, embeds and SVG/MathML are discarded. Root-relative links are rebased inside the same brand website. Public pages additionally disable scripts and form submission with CSP; navigation works as ordinary server-rendered links.
- Section-based content renders generic static text, images, cards, statistics, pricing, FAQ and CTA links. It uses a common public layout rather than the Estio builder's animations/custom CSS. Forms/lead capture, property widgets and executable embeds are not public capabilities in this slice. The editor explains this for existing section pages.
- Navigation lists up to 100 published pages; blog indexes list the latest 50 posts (the homepage shows six). Older posts remain accessible at their published URLs. Larger-site pagination/search and richer website layout controls can be added separately.
- The slice 3 CRM/API/action firewall remains in place. Only website settings and saved-page preview are added to its authenticated page allowlist, plus the one guarded website-settings action. Substo image uploads keep the existing active-location authorization.

## Schema and rollout

`20261025010000_substo_public_sites_expand` adds three columns to the existing `SearchConfig` table (Prisma `SiteConfig`): unique nullable `substoSiteSlug`, `substoSitePublished NOT NULL DEFAULT false` and nullable `substoSiteConfig JSONB`. The JSON holds only this website's public presentation settings. Estio's `domain`, theme/integration settings and the domain registry are unchanged. A check constraint requires an address for publication and a normalized address shape. Previous releases/writers can omit all three columns; no site is enabled by backfill.

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

Remaining: production/Clerk email-branding acceptance and authorized rollout; integration-by-integration work (messaging, Google/Microsoft, SIM relay and automated AI workflows); public forms/lead capture, custom domains, larger-site pagination/search and richer layouts; custom fields/objects per niche and billing.
