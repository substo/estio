# Brand onboarding chat: plan

Status: plan only, written 2026-10-26. Nothing below is built yet. Read `how-the-app-works.md` first. Rule 1 applies: build once, share it.

## 1. Goal

Make onboarding Studio's first workflow, on both apps. A scripted chat asks the Business admin about themselves and the brand. It looks up their website and public social profiles, and links to the existing profile connections (YouTube today). It then drafts a **brand profile** (persona). The admin reviews it and saves it. The profile is saved once per Business and is read by Studio's text jobs (idea review, script brief) and by the CRM's AI drafts, which already read `brandVoice`. All paid AI calls go through Studio's existing budget and usage ledger, so they count toward the Business's spending (rule 10).

The plan adds no new chat system, ledger, key store or profile table.

## 2. What already exists and what we reuse

| Piece | Where | Reuse? |
| --- | --- | --- |
| Studio hosted text-AI jobs (idea review, script brief, knowledge extraction): snapshot, then job, then durable paid attempt, then human review | `lib/studio/worker/text-run.ts`, `openai-text.ts`, `handlers.ts`; `studio_idea_reviews.workflow` (`knowledge_extract` was added the same way in `studio/supabase/migrations/20261024080000_studio_knowledge_extraction.sql`) | **Yes, the AI engine.** Add one workflow, `brand_profile`. |
| Studio OpenAI key (still stored per `studio_workspaces` row, mapped 1:1 to the Business), monthly cap, `studio_ai_usage` reserve/settle ledger | `lib/studio/ai-settings.ts`, `/studio/settings/ai` | **Yes, this pays.** Works on both apps. The planned combined usage total will include it. |
| Business AI settings document with `brandVoice` (mirrored to `SiteConfig.brandVoice`) | `lib/settings/schemas.ts` (`location.ai`), `app/(main)/admin/settings/ai/*`; read by `lib/ai/coordinator.ts`, `lib/ai/orchestrator.ts`, `lib/ai/skills/loader.ts`, `app/(main)/admin/content/ai-actions.ts` | **Yes, where the profile is stored** (see §4). |
| Business public social links | `location.public_site.socialLinks` (`lib/settings/schemas.ts`), edited at `/admin/site-settings` (allowed on Substo) | **Yes.** Onboarding fills it. |
| Profile-owned Google/YouTube OAuth | `/account/connections`, `documentation/profile-google-youtube-discovery.md` | **Yes.** Onboarding links to it and shows its status. No new OAuth. |
| Public page fetch with a basic private-host block | `fetch_url_summary` in `lib/ai/mcp/server.ts` | **Yes.** Extract it into one shared helper (task 1). |
| Crawl4AI / deep scraper | `lib/crm/crawl4ai-service.ts`, `lib/scraping/deep-scraper.ts` | Not now. They are built for property prospecting and are heavier than needed. |
| Web *search* | none (only YouTube public search in Studio) | Gap. See open question 3. |
| Live Assist "Ask AI" chat | `app/api/viewings/sessions/[id]/assistant/route.ts`, `.../quick-field-assist.tsx`; session kind `quick_translate` on `ViewingSession` | **No.** It is tied to viewing sessions, uses a real-estate prompt and CRM location keys, and is Estio-only (`/admin/live-assist` and `/api/viewings/*` are blocked on Substo). |
| CRM skills runtime: SKILL.md, tool registry, orchestrator, `AiSuggestedResponse` | `lib/ai/skills/*`, `lib/ai/mcp/*`, `lib/ai/orchestrator.ts`, `documentation/ai-skills-runtime-implementation.md` | **No, not for v1.** It is built around contacts and conversations. Putting a skill in `lib/ai/skills/` would also add it to the CRM skill registry. Its tool registry is the place for later free-form tool use (phase 2). |
| CRM AI usage (`AiUsage`, `securelyRecordAiUsage`) | `lib/ai/usage-metering.ts`, `components/ai-cost-badge.tsx` | Not used by onboarding. It is the CRM half of the combined total. |

**What works on Substo.** These are allowed by `classifySubstoRoute` (`lib/auth/host-routing-policy.ts`): `/studio/*`, `/api/studio/*`, `/account/connections` and `/admin/site-settings`. These are blocked by default-deny (`lib/auth/substo-crm-policy.ts`): `/admin/settings/ai` (the only `brandVoice` editor today), `/admin/live-assist` and `/api/viewings/*`. So onboarding and the profile editor must live under `/studio`. That needs no change to the firewall.

## 3. Flow

The route is `/studio/onboarding`, inside the `(tenant)` group so it uses the active-Business cookie. Studio home shows a "Set up your brand" card until a profile is saved. Only a Business admin can run it; members see the saved profile read-only.

The chat looks like a chat, but in v1 the questions are a fixed script. Moving through them costs no AI. AI runs only at step 5, and the user confirms the paid run first.

1. **You.** Name, role, what you make, and who it is for. These are fixed questions with free-text answers.
2. **Brand.** What the brand offers, its audience, tone (with chips like "friendly / expert / playful"), words to use or avoid, competitors and goals.
3. **Look-up.** "What's your website?" and "Any public profiles?" The server fetches each URL with the shared helper and shows the title, description and an excerpt. The user ticks the ones that are right. Ticked profile URLs are saved to `socialLinks`.
4. **Connect.** This step shows the existing `/account/connections` status for YouTube, with a Connect button that returns here. Other platforms show as "Coming later". The step can be skipped.
5. **Draft profile.** The user confirms a paid run (the same `confirmPaid` pattern as idea review, showing the cost estimate and remaining budget). This enqueues a `brand_profile` text-run job. Its snapshot holds the answers and the ticked page excerpts. The page polls the job, the same way Jobs does.
6. **Review and save.** The draft is shown as editable fields. **Save** writes the Business brand profile (§4). The user can re-run onboarding at any time from the profile page. Re-running pre-fills the earlier answers.

## 4. Where data is stored

There is **one place: the Business's existing `location.ai` settings document** in Prisma, written through `settingsService`.

- Add a `brandProfile` object next to `brandVoice` in `aiSchema`. It holds `answers` (keyed by script question ID), `sources` (ticked URLs with their fetch time), `profile` (structured fields: summary, audience, offer, tone, do/don't words, pillars), `scriptVersion`, `updatedAt` and `updatedBy`. This is a Zod schema change only, with no Prisma migration.
- **Save** also writes a short text rendering into `brandVoice`. The CRM AI drafts then use the new profile with no CRM change.
- Socials go in the existing `location.public_site.socialLinks`. OAuth grants stay profile-owned in the existing Studio Supabase tables.
- Studio stores only the job, the snapshot and the draft result in the existing `studio_idea_reviews` row (`workflow = 'brand_profile'`), plus usage in `studio_ai_usage`. There is no chat transcript table: the answers in `brandProfile.answers` are the record.

I chose this over Studio knowledge because knowledge holds evidence-backed insights from sources, each reviewed one by one, not a single Business profile. I chose it over a new table because `brandVoice` is already the Business's "who we are" input to every CRM prompt, and the profile is the same concept.

**Local Mac proxy (later).** Outbound page fetches go through the one helper from task 1. Platform sign-ins already happen in the user's browser through `/account/connections` redirects. A local proxy can later carry both without changing the flow. This plan does not design it.

## 5. Tasks (in order, one sub-agent each)

1. **Shared public-page fetch helper.** Move the `fetch_url_summary` logic into `lib/web/fetch-public-page.ts` and make the MCP tool call it. Harden it in the same change. Today it checks only the hostname string, so it misses DNS names that resolve to private addresses, `169.254.*` (cloud metadata), IPv6 ULA/link-local, and redirects to those. Add size and time limits and extract `og:` title, description and image.
   *Accept:* unit tests cover blocked literal IPs, a name that resolves to a private address, redirect-to-private and an oversize body. The existing CRM tool behaves as before.
2. **Brand profile schema and service.** Add `brandProfile` to `aiSchema` and create `lib/brand-profile/service.ts` (server-only) with `getBrandProfile(locationId)` and `saveBrandProfile(locationId, input, actor)`. Saving requires a Business admin and the user's own session (no impersonation), and derives `brandVoice` from the profile.
   *Accept:* schema tests pass. Saving updates `brandVoice` and its `SiteConfig` mirror. A member is rejected. Business A cannot write Business B's profile.
3. **`brand_profile` Studio workflow.** Add a Supabase migration that adds `brand_profile` to the `studio_idea_reviews` workflow check and to the attempt RPC output-token bounds, following the knowledge-extraction migration. Add the text-run spec (instructions, JSON schema, validator, prompt version), register the `studio.brand_profile` handler and label, and add an enqueue command on `/api/studio/brand-profile` that builds the snapshot (≤24 KB) and requires `confirmPaid`.
   *Accept:* worker tests pass with mocked provider calls. SQL assertions pass for reserve/settle/release, budget exhausted and another Business (`scripts/test-studio-schema.sh`). Usage appears in `studio_ai_usage` and in the Studio AI settings spend.
4. **Onboarding chat page.** Add `/studio/onboarding` with the script as data (`lib/studio/brand-onboarding-script.ts`), built with existing `components/ui` primitives. It covers steps 1 to 6, the look-up step through task 1, socials saved through the existing site-settings save path, the connections status from the existing profile connection, and the draft-and-save through tasks 2 and 3.
   *Accept:* an admin completes the flow on both apps locally. A member gets read-only access. Without an OpenAI key or budget, the page shows the existing "Add a key in AI settings" message, with no hidden fallback.
5. **Profile page and entry points.** Add a Studio "Brand profile" page (view, edit, re-run), a Studio home card shown while no profile exists, and a sidebar item through `components/app-shell/product-config.ts`. On Estio, the `brandVoice` field in `/admin/settings/ai` links to this page (open question 4).
   *Accept:* `app-shell.test.ts` passes. The card disappears after save. The links work on both apps.
6. **Studio jobs read the profile.** Include a bounded copy of the profile in the idea-review and script-brief snapshots, and bump their prompt versions.
   *Accept:* worker tests show the profile in the snapshot and still within the size bound. Old reviews keep their versions.
7. **Live check.** Deploy with `deploy-local-build.sh` once the user approves. Run onboarding once on estio.co and once on substo.com with a real key and a small budget.
   *Accept:* the profile is saved, the CRM draft prompt shows the new brand voice (Estio), Studio usage rises by the settled amount, and the progress log has a one-line entry. Update `how-the-app-works.md` status.

**Later (phase 2, not planned here):** free-form chat turns with tool calls (web search, more fetches) run on the same Studio key and ledger, using a per-turn paid attempt and the tool-registry pattern from `lib/ai/mcp/registry.ts`.

## 6. Open questions for the user

1. **Who pays:** should onboarding use Studio's OpenAI key and cap (recommended, since it works on both apps and has a budget cap), or the CRM's Business AI keys (Gemini/OpenAI/ChatGPT, Estio-only settings page, no cap)?
2. **Scripted or free chat in v1:** is a fixed script with one AI call at the end enough to start, or do you want the AI to ask follow-up questions on every turn from day one (this costs money per turn and needs phase 2 first)?
3. **Web search:** in v1, the chat fetches only the URLs the user gives. Do you want real web search ("find my profiles for me")? The cheapest option is OpenAI's built-in web search tool, billed per call on the same key.
4. **One editor for `brandVoice`:** should the Studio brand profile page become the only editor, with the Estio CRM AI settings field turning into a link to it?
5. **Which socials after YouTube:** which platforms should "Connect" support next (Instagram, TikTok, LinkedIn, X, Facebook)? Until they exist, those platforms are public profile links only.
6. **Who can run it:** Business admins only (proposed), or any team member?
7. **First sign-in:** should a new Substo Business land on `/studio/onboarding` automatically, or only see the home card?
