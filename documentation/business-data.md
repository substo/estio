# Shared business data contract (Phase 1)

Inventory of source at `648a9311a22cc9f036086a507ae6051cc0845042`. Applies to both editions, CRM, Studio and public sites. This is a source-code inventory, not a production-data scan. Arbitrary historical JSON keys cannot be enumerated without data access. Undeclared keys are not silently promoted to facts.

Future home: a `SettingsDocument` with `scopeType=LOCATION`, `scopeId=Location.id`, `domain=location.business`, `payload.schemaVersion=1`. Business name and time zone remain exclusively in `Location.name` and `Location.timeZone`; they are not duplicated in this profile. Other future paths below are relative to that payload. `lib/business-profile/schema.ts` is the executable contract; `completeness.ts` owns essentials. This assignment only registers validation: no document creation, migration, consumer switch, new dual writes, parity change or existing-schema change. `Location` identifiers, app ownership and authorisation stay where they are.

## Storage and code references

For compactness, these labels identify exact files (reader/writer labels in the tables refer to these paths):

| Label | File and role |
| --- | --- |
| General W | `app/(main)/admin/site-settings/actions.ts`, general site save |
| General R | `app/(main)/admin/site-settings/page.tsx`, settings editor; `site-settings-form.tsx` in the same directory supplies inputs |
| Navigation W/R | `app/(main)/admin/site-settings/navigation/actions.ts` / `page.tsx` |
| Substo W/R | `lib/substo-sites/service.ts`, `saveWebsiteSettings`, `saveWebsiteDesign` / `getPublishedWebsite`; sanitisation in `lib/substo-sites/policy.ts` |
| Hosted R | `lib/website/config.ts` (`hostedWebsiteConfig`); substitutions in `lib/website/hosted-content.ts` |
| Estio R | `lib/public-data.ts` (`getSiteConfig`); `app/(public-site)/[domain]/layout.tsx`, `page.tsx`, `_components/public-header.tsx`, `_components/public-footer.tsx`; `app/(public-site)/_components/public-block-renderer.tsx` |
| Print R | `lib/properties/print-preview.ts`, `lib/properties/print-ai.ts` |
| Market R | `lib/locations/market-context.ts` |
| AI W/R | `app/(main)/admin/settings/ai/actions.ts` / `page.tsx`; `lib/ai/coordinator.ts`, `lib/ai/orchestrator.ts`, `lib/ai/skills/loader.ts` |
| Profile W/R | `lib/brand-profile/service.ts`, API `app/api/studio/brand-profile/route.ts`; reads in `app/(main)/studio/(tenant)/page.tsx`, `onboarding/page.tsx`, editor `onboarding/profile-editor.tsx` |
| Registry | `lib/settings/constants.ts`, `lib/settings/schemas.ts`, `lib/settings/service.ts` |
| Historical copier | `scripts/settings/backfill.ts` (inspected only, not executed) |

`SiteConfig` is Prisma's model for physical table `SearchConfig` (`prisma/schema.prisma`). Settings storage paths below mean `SettingsDocument.payload` for the named domain and Location scope, not a nested field on Location. Existing settings schemas use passthrough JSON. The new business schema rejects unrecognised keys to avoid accidental credentials or presentation data.

## Business facts and their duplicates

`[]` means repeated entries; `.value` fact wrappers are omitted from future paths for readability. Each path resolves through wrappers in the executable schema.

| Current exact storage paths | Reader / writer references | Duplication, fallback and future canonical path |
| --- | --- | --- |
| `Location.name`; `location.public_site.locationName`; `SiteConfig.theme.logo.textTop`; `SiteConfig.substoSiteConfig.title` | General R/W, Hosted R, Estio R, Profile R; `lib/locations/location-service.ts` (`renameLocation`), `lib/locations/substo-locations.ts`, `app/(main)/brand/actions.ts` | Distinct tenant name and website display copies. General save updates Location as well as document. Hosted name uses textTop, then legacy title, then Location name/“Our brand”; empty string is retained by its `text` helper. Canonical business name remains `Location.name`. Website display-name copies (`theme.logo.textTop`, Substo site title) map to `Location.name` in any future consolidation. A deliberately different website title remains a website layout setting, not a business fact. Legal name remains separately `identity.legalName`; do not infer it from the business name. |
| `Location.timeZone`; `location.public_site.locationTimeZone` | General R/W; `lib/locations/market-context.ts` reads Location name; scheduling consumers use Location timezone | General save validates IANA timezone and syncs Location; canonical business and opening-hours time zone remains `Location.timeZone`. No time-zone field is added to the profile; opening-hours consumers must use Location.timeZone. The settings-document copy is an existing duplicate, not a future canonical home. |
| `Location.domain`; `SiteConfig.domain`; `location.public_site.domain`; `PublicSiteDomain.hostname` | General R/W, Estio R; `lib/public-site-domains/service.ts`, `provisioning.ts`; `lib/properties/public-url.ts` | General save prefers ACTIVE canonical domain then SiteConfig; syncs Location. Estio lookup first SiteConfig.domain then managed domain resolution. Future advertised URL `onlinePresence.website`; domain verification/routing remains operational. |
| `SiteConfig.contactInfo.address`; `location.public_site.contactInfo.address` | General R/W, Substo W, Hosted R, Estio R, Print R | Current unstructured string. Future `contact.address` with formatted/line1/line2/city/region/postalCode/countryCode; retain source string in formatted during a future reviewed mapping, never guess components. |
| `SiteConfig.contactInfo.mobile`, `.landline`, undeclared legacy `.phone`; corresponding `location.public_site.contactInfo.mobile`, `.landline` (passthrough may retain `.phone`) | General R/W, Hosted R, Substo W, Estio footer R, Print R, historical copier | Form, footer and copier fall back mobile → phone; Hosted R reads mobile only. Future `contact.phones[].number`, `.label`, `.extension`; preserve distinction and validate E.164 only after owner clarification. |
| `SiteConfig.contactInfo.email`; `location.public_site.contactInfo.email`; `SiteConfig.substoSiteConfig.email` | General R/W, Substo W/R, Hosted R, Estio R, Print R | Hosted email uses contactInfo if string (including empty) else legacy email. Future `contact.email`. |
| `SiteConfig.contactInfo.mapsLink`, `.mapsLinkTitle`; `location.public_site.contactInfo.mapsLink`, `.mapsLinkTitle` | General R/W, Substo W, Hosted R, Estio footer R | Title is a map label, not address evidence. Future `contact.maps[].url`, `.title`. Hosted links may be relative; future business map URLs require HTTP(S), so review rather than invent a URL. |
| `SiteConfig.socialLinks[].platform`, `.url`; `location.navigation.socialLinks[]`; `location.public_site.socialLinks[]` | Navigation W/R, General R/W, Hosted R, Estio footer R | Navigation writer mirrors to public_site and optionally legacy. Future business-owned accounts `onlinePresence.profiles[].platform`, `.url`, `.handle`; navigation placement remains presentation. |
| `SiteConfig.theme.logo.textBottom`; `location.public_site.theme.logo.textBottom` | General R/W, Substo W, Hosted R, Estio header/footer R | Future `identity.tagline`; textTop maps to `Location.name` as described above; a distinct website title stays in website layout settings. Branding copy can differ from a business fact; require review. |
| `SiteConfig.footerBio`; `location.navigation.footerBio`; `location.public_site.footerBio`; `SiteConfig.substoSiteConfig.description` | Navigation W/R, General R/W, Substo W/R, Hosted R, Estio footer R | Hosted uses footerBio string then legacy description. Future factual summary `identity.summary`; retain footer copy as website presentation, do not assume all marketing claims are confirmed. |
| `SiteConfig.theme.logo.url`, `.lightUrl`, `.iconUrl`, `.faviconUrl`; same paths in `location.public_site.theme`; `SiteConfig.substoSiteConfig.logoUrl` | General R/W, Substo W, Hosted R, Estio header/layout R, Print R | Hosted primary uses safe shared URL then legacy logoUrl. Future `visualIdentity.logos[]` with variant primary/light/icon/favicon and URL. Preserve media URLs/keys; never move/delete media. |
| `SiteConfig.theme.primaryColor`, `.secondaryColor`, `.accentColor`; `SiteConfig.primaryColor`, `.secondaryColor`, `.accentColor`; matching `location.public_site.theme.*`; `SiteConfig.substoSiteConfig.accent` | General R/W, Substo W/R, Hosted R, Estio R, Print R; historical copier | General save dual-writes theme and scalar colours. Copier prefers theme then scalars. Hosted primary falls back legacy accent; other colours default. Future actual brand palette `visualIdentity.colours[].role`, `.hex`; theme palette application stays presentation. |
| `location.public_site.marketProfile.countryCode`, `.countryName`, `.locale`, `.currencyCode`, `.supportedLanguages[]` | Registry, General R/W inputs, Market R | Future `audienceMarket` with matching names. No Prisma SiteConfig.marketProfile column. **Observed mismatch:** General W parses marketProfile and includes it in legacy updateData, but omits it from document payload/create. Existing save behaviour is preserved here; schema registration alone does not repair it. |
| `location.public_site.marketProfile.serviceAreas[].id`, `.label`, `.aliases[]`, `.parentId`, `.kind` | Registry, General R/W, Market R | Future `audienceMarket.serviceAreas[]` with same leaf names. IDs/parent IDs describe geography; they are not Location IDs. |
| `SiteConfig.defaultCity`, `.defaultRegion`; `Property.country`, `.currency`, `.city`, `.propertyLocation`, `.propertyArea`; `location.ai.defaultReplyLanguage` | Market R; site search uses SiteConfig defaults; property writers own listing data | Market R appends inferred areas from defaults and up to 500 recent properties; country/currency use most-common inventory fallback, language includes reply language. These are inferences, never owner confirmation. Future reviewed business service areas/country/currency/languages in `audienceMarket`; listings stay outside business profile. |
| `SiteConfig.brandVoice`; `location.ai.brandVoice` | AI W/R, Profile W/R, Print R | Profile save renders structured profile into brandVoice, writes document and SiteConfig in one transaction independently of generic dual-write flag. Print AI prefers document then legacy. AI orchestrator still reads SiteConfig. Future `brandVoice.instructions`; structured profile mapping below. |

Source code contains demonstrative Estio defaults: footer address/phone/email, “Down Town Cyprus” page name, footer biography, logo text and palette defaults. They are presentation fallbacks, **not known business facts** and must never populate the future profile. Opening hours, legal identity/registration and structured addresses have no dedicated owner-business storage in the inspected contracts; their future paths are new, not reconstructed from defaults.

## Existing Studio brand profile: exhaustive mapping

Current home is `location.ai.brandProfile`, validated by `lib/brand-profile/schema.ts`. Profile W/R above owns persistence. Generation uses `lib/studio/worker/brand-profile.ts` and `lib/studio/worker/openai-text.ts`; onboarding question definitions are `lib/studio/brand-onboarding-script.ts`. Generated prose and source retrieval are not owner confirmation.

| Exact current suffix | Future path / treatment |
| --- | --- |
| `answers` (record of arbitrary question IDs to strings) | `brandProfileCapture.answers` with a fact per answer; preserve keys and text. `name` asks a person's name/role, not business legal identity. `work`, `offer`, `audience`, `tone`, `words`, `competitors`, `goals` are current IDs; don't drop future or older IDs. Optional reviewed extractions go to corresponding semantic sections, never automatically treat prose as confirmed. |
| `sources[].url`, `.fetchedAt`, optional `.platform` | URL source `url`, `retrievedAt`; preserve platform in the optional source platform field. No `confirmedAt` is derived from fetchedAt. |
| `profile.summary` | `identity.summary` |
| `profile.audience` | `audienceMarket.audience` |
| `profile.offer` | `offer.description` |
| `profile.tone` | `brandVoice.tone` |
| `profile.useWords[]`, `.avoidWords[]`, `.pillars[]` | `brandVoice.preferredWords[]`, `.avoidedWords[]`, `.contentPillars[]`, each entry independently evidenced |
| `scriptVersion`, `updatedAt`, `updatedBy` | `brandProfileCapture.scriptVersion`, `.updatedAt`, `.updatedBy`: capture audit, not confirmation. Preserve original values. |
| rendered `location.ai.brandVoice` and `SiteConfig.brandVoice` | `brandVoice.instructions`; keep historical rendered text if distinct from structured values; no reader/writer changes now |

`answers.competitors` is free text, not a structured competitor list. Future reviewed competitors live in `competitors[]` (name, website, profiles, notes). Studio Library/Discovery channels and videos represent research sources, not necessarily competitors of the customer's business. Knowledge documents, content, briefs, job snapshots/results and onboarding source excerpts are evidence/content artifacts; preserve their ownership and provenance, do not move them into business facts or turn every channel into a competitor.

## Boundaries: fields that do not become business facts

| Existing paths / category | Owner and references; disposition |
| --- | --- |
| `SiteConfig.theme.backgroundColor`, `.textColor`, `.headerStyle`, `.menuStyle`; matching public_site theme; `location.navigation.menuStyle` | General/Substo/Navigation W, Hosted/Estio R. Website contrast/layout choices. Only explicitly owner-designated palette colours belong in visualIdentity. |
| `SiteConfig.navLinks`, `footerLinks`, `legalLinks` (entries label/href/type/id/children recursively); matching public_site/navigation arrays | Navigation W/R, General W/R, Hosted/Estio R. Menu placement and link text, not business online accounts. |
| `SiteConfig.footerDisclaimer`; public_site/navigation footerDisclaimer | Navigation W/R, Estio footer R. Website legal copy; credentials asserted within it may be reviewed into `realEstate.credentials[]`, not blindly extracted. |
| `SiteConfig.heroContent`, `homeSections`, `favoritesConfig`, `searchConfig`, `submissionsConfig`; `location.content` counterparts; content-page/blog copy and blocks | `lib/website/home-sections.ts`, `lib/website/editor-config.ts`, `lib/website/hosted-content.ts`, `app/(main)/admin/content/actions.ts`. Presentation: titles, images, CTA links, visibility, ordering, search/empty states. May contain business prose, but remain authored content rather than a second canonical profile. |
| `SiteConfig.minPrice`, `maxPrice`, `allowedTypes`, `defaultCity`, `defaultRegion`; `publicListingEnabled`; Substo slug/published | Search defaults, feature flags and publishing/routing in `lib/public-data.ts`, site settings, Substo service. min/max are not business price segments; allowedTypes are not evidence of specialisms. |
| `SiteConfig.substoSiteConfig` nested `title`, `description`, `email`, `accent`, `logoUrl` | Exactly the five fields normalised by `websiteSettings`; mapped above. Other arbitrary JSON keys are not read by this contract. Slug and publish flag remain operational. |
| AI models, presets, automation/outreach prompts, reply-language preference, transcript retention/visibility/disclosure, CRM URLs/schema/lead-email routing, integration IDs | Existing settings domains and SiteConfig/Location operational columns; Registry, AI W/R, `app/(main)/admin/settings/crm/actions.ts`, `integrations/whatsapp/actions.ts`. These configure execution; do not migrate to business facts. Reply language may inform a future owner-confirmed language but is not itself market evidence. |
| Provider keys/tokens/passwords/cookies, webhook secrets, Location GHL installation identifiers/tokens | `lib/settings/crypto.ts`, settings secret registry/service; integration actions. Credentials never enter business profile or public inventory values. |
| `Location.id`, `.authRealm`, `.studioWorkspaceId`, `.autoCreatedForUserId`, timestamps, account/team/invitation records; domain verification tokens and provisioning health | Tenant authority, recovery map, onboarding idempotency, lifecycle/audit. Preserve in place. studioWorkspaceId is recovery metadata only. |
| CRM `Company`, `Contact`, `User` addresses/phones/email; `Property` and development/project records | Other entities, team members and individual listings. Not the Location's own business identity. Never copy a contact/company record merely because its name matches. |

Generic settings transition behaviour is controlled by `SETTINGS_READ_FROM_NEW` (default false), `SETTINGS_DUAL_WRITE_LEGACY` (default true), `SETTINGS_ENABLE_PARITY_CHECKS` (default true). General/AI/navigation actions and `lib/settings/service.ts` implement existing writes/parity; individual readers differ as listed. Navigation saves update navigation and public_site plus optional legacy; Substo design writes shared SiteConfig directly and legacy website settings write substoSiteConfig. No new business domain is added to backfill or runtime reading. These duplicates cannot be removed safely by merely registering a schema.

## Schema, provenance and completeness policy

A fact is `{status:'known', value, sources:[], confirmedAt:null}`, `{status:'unknown', sources:[], confirmedAt:null}` or `{status:'not_applicable', reason, sources:[], confirmedAt:null}`. Omission means not collected. Known empty strings are rejected; an empty list means a collected empty set, not an invented value. Not applicable requires an explanation. Every nested leaf and every repeated scalar has its own fact wrapper; collection and object fact wrappers can additionally describe whole-collection evidence. Container confirmation never confirms nested facts.

Sources are URL (`kind:'url', url, retrievedAt:null|ISO timestamp`, optional platform) or owner (`kind:'owner', ownerId, suppliedAt:null|ISO timestamp`). HTTP(S) URLs without embedded credentials only. All timestamp fields validate ISO date-times; offsets are accepted. Source retrieval/supply and capture audit are distinct from nullable owner `confirmedAt`. Empty sources are permitted for an unresearched assertion; unknown values never acquire defaults. This schema validates shape, not whether the claimed owner or website is trustworthy. A later authenticated writer must enforce who may confirm and source-fetch safety; no fetch occurs here.

Real estate is applicable only to Estio consumers; shared storage can preserve it without Substo using it. It supports multiple business types (e.g. agency and developer), services, property categories, transaction/development focus and specialisms through repeated `{code, otherDescription?}` facts. Codes remain open vocabulary; code `other` requires a known description. Price segments have label, nonnegative min/max and ISO-style uppercase three-letter currency; numeric bounds require known currency, min cannot exceed max. Credentials and differentiators are repeated facts. No listing, individual property or project inventory is embedded. Estio can explicitly mark the whole section not applicable with a reason.

Essentials are deliberately a small useful content brief, not a publication permission: identity summary; contact email; onlinePresence website; offer description; audienceMarket audience/serviceAreas; brandVoice tone. Estio also requires realEstate businessTypes/services/propertyCategories/transactionFocus. Substo excludes real estate entirely. A confirmed not-applicable fact satisfies an essential. Unknown/omitted/empty essential values are missing; known or not-applicable values with null confirmation are unconfirmed. Required collections inspect each supplied nested fact independently, including all entries. Business name and time zone are outside this profile completeness function because their canonical values belong to Location. Optional profile fields do not create missing essentials. `getBusinessProfileCompleteness` returns `{complete, sections}` with exact dot paths and missing/unconfirmed reasons. Saving partial profiles is valid regardless of completeness.

Opening hours use day, closed, repeated opens/closes intervals and explicit closesNextDay for overnight periods, all fact-wrapped. Their time zone is exclusively `Location.timeZone`, not a profile field. An explicitly open day needs intervals; a closed day has none. Phones accept common written formats (digits, spaces, +, brackets, dashes, dots; see Decisions (phase 2)); email, two-letter country codes, map URLs and six-digit hex colours validate structurally. No assumption of Cyprus, EUR, agency type, address or opening times is made.

## Verification

Focused command: `tsx --test lib/business-profile/*.test.ts lib/settings/schemas.test.ts lib/brand-profile/schema.test.ts`. Tests cover partial/complete profiles, unknown/not applicable, independent nested/repeated evidence, invalid URLs and dates, structured contact/hours, real-estate choices/currency/applicability, and additive registry integration. No production access or provider calls. Changes remain limited to the eight assigned files; a future separately approved slice must design authenticated editing and reviewed mapping before any consumer switches or data moves.

Local result after owner feedback: 22/22 focused tests passed (new business schema/completeness, existing settings and existing brand-profile schema). Strict targeted TypeScript compilation of those source/test files and their schema imports passed; `git diff --check` passed. This worktree has no node_modules: the first npx test attempt failed to resolve zod before running tests. Successful verification used `NODE_PATH=/Users/martingreen/Projects/Estio/node_modules` and that checkout's existing tsx/tsc, with a temporary external tsconfig resolving dependencies there. No dependency files were changed. Whole-project typecheck/build was not run; this does not establish whole-project type health (current-status documents pre-existing compiler failures). Next step: Build reviews this eight-file diff; runtime editing, source import and consolidation require a separate approved assignment.

## Decisions (phase 2)

- `Location.name`, `Location.timeZone` and `Location.domain` remain the only home for name, time zone and domain; the profile never stores them. `businessView` takes them from the Location row.
- Logo text lines (`theme.logo.textTop`, `.textBottom`) are website layout, not business facts; they stay in website settings and are not copied.
- Footer bio is the business summary (`identity.summary`), one text. When a Studio brand profile exists its summary wins and the footer text is reported as skipped.
- Social links map to `onlinePresence.profiles`; `contactInfo` maps to `contact` (address kept as `formatted` only, never split into guessed parts; mobile, landline and legacy phone as labelled phones; email; maps link with its title); theme logo URLs map to `visualIdentity.logos` (url→primary, lightUrl→light, iconUrl→icon, faviconUrl→favicon); theme or legacy scalar primary/secondary/accent colours map to `visualIdentity.colours` (3-digit hex expanded); `marketProfile` maps to `audienceMarket`; the Studio brand profile maps to `identity.summary`, `offer.description`, `audienceMarket.audience`, `brandVoice` and `brandProfileCapture`; without one, the rendered brand voice text becomes `brandVoice.instructions`.
- Phone numbers use a lenient pattern (`^\+?[0-9][0-9 ()\-.]{5,24}$`) so existing written numbers survive; strict E.164 is not required.
- Copied facts are `known`, `confirmedAt: null`, with no sources: copying is not owner confirmation. Settings documents are preferred over `SiteConfig` columns. Relative URLs (logos, links) are skipped because profile URLs must be absolute.
- Demo placeholders skipped by the copy are only the made-up footer address and phone numbers. The footer's demo email is Down Town Cyprus's real, owner-saved email and is copied.
- `applyDetailsPatch` (pure) turns owner-entered flat values into owner-sourced facts confirmed now; unchanged values keep their existing facts; empty values remove the fact. `saveBusinessDetails` persists through the settings service with the document version as the expected version.
- The copy (`scripts/business-profile/copy.ts`) never overwrites an existing Business profile and skips Locations with nothing to copy. Dry run by default; `--apply` writes.


## Phase 3: readers and writers use the Business profile (2026-11-04)

**How readers switched.** Display code still receives the same website config row shape (SiteConfig). The loaders overlay business fields from the profile (`lib/business-profile/overlay.ts`, `withBusinessDetails` / `getBusinessViewIfAny` in `service.ts`). With a profile, contact info, social links, footer description (= `identity.summary`), brand colours (primary/secondary/accent, theme and scalar), logo URLs, the Substo legacy description/email/accent/logo and brand voice come only from the profile. Unknown values become empty and existing presentation defaults apply, so stale copies never show. Without a profile the row is unchanged. Logo text lines, background/text colours, header/menu style, links, disclaimer, hero and sections are untouched.

| Area | Moved |
| --- | --- |
| Estio public site and analytics, live-assist join | `lib/public-data.ts` `getSiteConfig` (overlay before secrets are stripped) |
| Widgets | `app/(main)/widget/{property/[slug],search,swipe}/page.tsx` |
| Hosted Substo sites | `lib/substo-sites/service.ts` `getPublishedWebsite` (profile read through the injected db, pure overlay); `lib/website/editor-config.ts` |
| Print | `lib/properties/print-preview.ts` (branding), `lib/properties/print-ai.ts` (brand voice) |
| AI | `lib/ai/coordinator.ts`, `lib/ai/orchestrator.ts` (skills get the profile voice), `app/(main)/admin/content/ai-actions.ts` (all six loaders) |
| Market | `lib/locations/market-context.ts` uses the profile market when any of it is set; otherwise the old website copy, then inference from listings |
| Studio | `lib/brand-profile/service.ts` `getBrandProfile` is a view of the profile (`lib/business-profile/brand.ts`); no profile falls back to the old copy |
| App shell logo, content editors | `components/app-shell/app-shell-data.ts`; `app/(main)/admin/content/{favorites,submissions,search}/page.tsx` |
| Settings screens | Site settings, navigation and AI settings pages show profile values |

**Writers.** Each now saves business fields with `saveBusinessDetails` only. A Location without a profile is seeded from its existing data on first save, so nothing is lost.
- Estio site settings general save: colours, logo URLs, contact and **market**. This fixes the old save, which tried to write `marketProfile` to a SiteConfig column that doesn't exist.
- Substo website design and website settings: description, email, accent and logo.
- Navigation: social links (empty rows are not accounts) and the footer description.
- Studio brand profile save: summary, audience, offer, tone, words, pillars, capture, and sources tagged with a platform → social links. Written brand-voice instructions are cleared because the structured profile defines the voice.
- AI settings brand voice editor: written instructions. Unchanged rendered text is not frozen into instructions.

None of these write business fields to SiteConfig or to the `location.public_site` / `location.navigation` / `location.ai` documents any more. Name and time zone are no longer copied into `location.public_site`.

**Equivalence** (`scripts/business-profile/equivalence.ts`, read-only on production 2026-11-04). For Down Town Cyprus - OLD, every business value is the same on the public site, hosted config, print, AI brand voice and market input. The one difference: the footer no longer renders five social icons whose links were empty (Instagram, LinkedIn, X, YouTube, TikTok). A Location without a profile (Estio) is identical everywhere.

**Still in SiteConfig and old documents, for phases 4–6:**
- Stale business copies, no longer read or written: `contactInfo`, `socialLinks`, `footerBio`, the `primaryColor`/`secondaryColor`/`accentColor` columns, `theme.primaryColor/secondaryColor/accentColor`, `theme.logo.url/lightUrl/iconUrl/faviconUrl`, `brandVoice`, `substoSiteConfig.description/email/accent/logoUrl`, plus the same keys in `location.public_site`, `location.navigation` and `location.ai`. Phase 6 drops them.
- The plaintext `googleAiApiKey` column and AI model columns (phase 4).
- Layout, search defaults, feature flags, viewing/transcript settings and Substo slug/publish; their consolidation into one website document is phase 5.
- Flag-driven dual writes and parity checks (`SETTINGS_*`) also remain until phase 5/6.

## Phase 4: AI connections and keys (2026-11-05)

- **One answer to "which AI can this Location use?"**: `getAiConnections(locationId)` in `lib/ai/connections.ts` (server-only; callers pass an already-authorised Location). It returns `{ available, sources[] }` with no secret values. Sources:
  - the Location Gemini and OpenAI keys (encrypted `SettingsSecret`, LOCATION scope, domain `location.ai`);
  - the Location's ChatGPT subscription (`location.integrations` document enabled and connected, plus its encrypted Codex token or auth cache);
  - each paired, non-revoked Mac companion whose Codex or Claude CLI is signed in with a subscription (ChatGPT / claude.ai, not an API key). Ready only when that Mac is online and not paused.

  `available` means at least one source is ready; it will gate the onboarding chat. The rules are the pure `assembleAiConnections` in the client-safe `lib/ai/connections-model.ts`.
- **Studio uses the Location's OpenAI key.** The Studio AI settings page reads, saves and removes the same encrypted key the CRM uses (`lib/studio/ai-settings.ts`). Text runs and transcription load it through an injected `loadKey` (`loadLocationOpenAiKey` in `lib/studio/worker/text-run.ts`, imported lazily). Studio budgets stay in `studio.studio_location_ai_settings`. Migration `20261105100000_studio_ai_key_from_settings` makes `studio.studio_reserve_ai_spend` check that key instead of `studio_location_ai_credentials`, which is no longer read or written (0 rows in production; dropped in phase 6).
- **The plaintext Gemini key is retired.** Every reader now uses `resolveLocationGoogleAiApiKey`, with no column fallback:
  - feed analysis;
  - property import scraping;
  - the AI orchestrator;
  - the provider catalog refresh;
  - the Gemini and AI settings pages;
  - maintenance scripts, via `findAnyLocationGoogleAiApiKey`.

  Removing a Gemini connection no longer touches the column. `scripts/ai/move-plaintext-keys.ts` copies any plaintext key into the encrypted secret when none exists, then clears the column. Production dry run, 2026-11-05:
  ```
  DRY RUN: 1 Location(s) with a plaintext Gemini key
  - cmingx6b10008rdycg7hwesyn: already has secret; would clear column
  ```
  Still naming the column, until phase 6 drops it: the public-site loader (which blanks it), the retirement script and its plan (`lib/ai/plaintext-key-move.ts`). A contract test enforces this list.

## Phase 5: one website document, no transition flags (2026-11-05)

- **The settings switch is gone.** `SETTINGS_READ_FROM_NEW`, `SETTINGS_DUAL_WRITE_LEGACY` and `SETTINGS_ENABLE_PARITY_CHECKS` and their helpers are removed, as is `settingsService.checkDocumentParity` (old `PARITY_MISMATCH` audit rows stay). Settings documents are the read path everywhere; a Location without a document shows its stored row. `scripts/settings/backfill.ts` (the historical copier) is deleted.
- **One website document.** `location.public_site` now holds all website layout: theme layout (background/text colours, header and menu style, logo text lines), menus (nav, footer, legal), footer disclaimer, public-listing switch, hero, home sections and the favorites/search/submissions page settings. The `location.navigation` and `location.content` domains are removed from the registry. Helpers: `lib/website/settings.ts` (pure: layout keys, `websiteLayoutOnly`, `overlayWebsiteLayout`, `mergeWebsiteDocuments`) and `lib/website/settings-service.ts` (`getWebsiteSettings`, `saveWebsiteLayout`, which merges so one editor never drops another's keys).
- **Readers.** `withBusinessDetails` (public site, widgets, content editors, AI loaders) now lays the website document over the stored row, then the Business profile over that. The site-settings, navigation, website editor (`lib/website/editor-config.ts`) and Substo hosted site (`getPublishedWebsite`) read the same way.
- **Writers.** General site settings, navigation, home page content, favorites/search/submissions settings and the Substo design form save layout only to the website document (Substo via an injected `LayoutSaver`). The general save still writes `SiteConfig.domain`, which the public site is looked up by.
- **Business copies removed from documents.** The schema no longer declares `domain`, `locationName`, `locationTimeZone`, `contactInfo`, `socialLinks`, `footerBio`, `marketProfile`, theme brand colours or logo URLs on the website document, and `websiteLayoutOnly` strips them on every save.
- **One-time merge:** `scripts/settings/merge-website-documents.ts` (dry run by default, `--apply`; plan logic in `lib/website/merge-plan.ts`) folds navigation and content into the website document (on a differing key the newer document wins and it is reported), strips business copies from the website and AI documents after checking each value is in the Business profile (otherwise that Location is skipped), and deletes the old documents. Production dry run:
  ```
  DRY RUN: 4 Location(s)
  - Down Town Cyprus - OLD [estio] cmingx6b10008rdycg7hwesyn: website document with keys favoritesConfig, footerDisclaimer, footerLinks, heroContent, homeSections, legalLinks, menuStyle, navLinks, publicListingEnabled, searchConfig, submissionsConfig, theme; delete navigation; delete content; strip brand voice from AI settings
      (10 stripped business values, all present in the Business profile or on Location)
  - Down Town Cyprus, Estio, Substo: nothing to merge
  ```

**Still to retire in phase 6:**
- `SiteConfig` operational columns: `domain` (public-site lookup), Substo `substoSiteSlug`/`substoSitePublished`/`substoSiteConfig.title`, search defaults (`minPrice`, `maxPrice`, `defaultCity`, `defaultRegion`, `allowedTypes`).
- `SiteConfig` AI and transcript columns (`googleAiModel*`, WhatsApp transcript and viewing-session settings, `outreachConfig`): the AI settings save keeps them in step because they are read directly in `lib/ai/*` (orchestrator, coordinator, extraction, smart replies, property translation, model fetch, context builder, audio transcription and viewing-notes extraction, transcript maintenance), viewing sessions (service and API routes), conversations actions, CRM import, print AI and AI property extraction.
- Stale `SiteConfig` layout and business columns (navigation, hero/sections, theme, contact, social, footer, colours): no longer written; still the fallback for Locations without a website document. `app/(main)/page.tsx` and the `seed-about-us`/`seed-why-sell` admin routes read `SiteConfig.theme` directly.
- Location columns (`crmUrl`, URL patterns, `legacyCrmLeadEmail*`, `crmLeadSchema`) and User columns (`crmUsername`, plaintext `crmPassword`, Google/Outlook tokens and sync switches, WhatsApp settings): their settings saves still write them (now unconditionally) because many readers query them directly.
- The cleared `SiteConfig.googleAiApiKey` column and the unused `studio.studio_location_ai_credentials` table.
- `lib/substo-sites/service.db.test.ts` (needs its disposable database) still asserts pre-phase-3 storage of colours and email in `SiteConfig`; update it when that database is available.


## Phase 6: SiteConfig retired (2026-11-05)

The SiteConfig model (table `"SearchConfig"`) is gone. Every Location setting has one home:

| Setting | Home |
| --- | --- |
| Business name, time zone, canonical domain | `Location.name`, `Location.timeZone`, `Location.domain` (managed domains resolve through `PublicSiteDomain`) |
| Substo hosted site address and publish switch (`/sites/<slug>`) | `Location.websiteSlug` (unique) and `Location.websitePublished`; migration `20261105120000_location_website_address` copied existing values |
| Substo site display title | website document `siteTitle` |
| Website layout, search defaults (`minPrice`, `maxPrice`, `defaultCity`, `defaultRegion`, `allowedTypes`), public listing switch | website document (`location.public_site`) |
| AI models, WhatsApp transcript, viewing-session and outreach settings | AI settings document (`location.ai`) |
| Business details | Business profile (`location.business`) |

- **One reader:** `getLocationConfig(locationId)` in `lib/location-config/service.ts` assembles the same row shape the old table had (pure parts in `model.ts`), with the website layout and Business profile overlays applied. `getLocationConfigs` serves maintenance jobs; `saveLocationConfig` routes a patch to the right home and refuses business details.
- **Readers moved:** the public site loader (`lib/public-data.ts`, now finds the Location by `Location.domain` or a managed domain), Substo hosted sites (`lib/substo-sites/service.ts`), the website editor (realm check kept), content and site-settings pages and actions, widgets, AI (coordinator, orchestrator, smart replies, extraction, context builder, model fetch, property translation, audio transcription and viewing notes, transcript retention), viewing sessions and their API routes, CRM import, print, market context, team invites, GHL email, the marketing home page (platform Location's logo), and the seed routes.
- **Writers moved:** the AI settings save writes only its document; the site-settings save, domain promotion and release write only `Location.domain`; the Substo website settings save writes `Location.websiteSlug/websitePublished` and the title to the website document.
- **One-time copy:** `scripts/settings/retire-site-config.ts` (dry run by default, `--apply`) copies any value still only in the table, never overwriting a document value. Production dry run: nothing to copy; Down Town Cyprus - OLD keeps the website document's `publicListingEnabled: true` (the table had `false`; the site has shown `true` since phase 5).
- **Removed:** one-off scripts that read the table (`scripts/business-profile/{copy,equivalence}.ts`, `scripts/ai/move-plaintext-keys.ts` with `lib/ai/plaintext-key-move.ts`, `scripts/read-site-config.ts`, the four logo scripts, `scripts/register-all-domains.ts`). Their work is done.
- **Schema drop** (separate commit, deployed after the copy): the `"SearchConfig"` table and the unused `studio.studio_location_ai_credentials` table.
- `lib/substo-sites/service.db.test.ts` now writes through the disposable database with Location-based site addresses and document savers.

**Separate future cleanup (not business data, unchanged):** Location integration columns (`crmUrl`, `crmEditUrlPattern`, `crmLeadUrlPattern`, `legacyCrmLeadEmail*`, `crmSchema`, `crmLeadSchema`, `publicListingUrlMode`, `legacyPublicListingUrlPattern`) and User columns (`crmUsername`, Google/Outlook tokens and sync switches, WhatsApp settings). **Security:** `User.crmPassword` is still stored as plain text and should move to an encrypted secret.
