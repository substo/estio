# Business onboarding

One onboarding for both apps (Estio and Substo) and both products (CRM and Studio). It fills the Business profile
(`location.business`, see [business data](business-data.md)) plus the Location's name and time zone, by researching the
business and asking the owner to confirm, instead of asking them to type everything. Owner decisions are in Build's
product memory (2026-11-04/05).

## How it works

1. **Gate.** Research uses only the Location's own AI. Without a ready connection (`getAiConnections(locationId).available`,
   `lib/ai/connections.ts`) the screen opens locked on a "connect an AI" step; nothing is paid for by the platform.
2. **Start.** The owner gives the business name and/or website. `startResearch` (`lib/onboarding/service.ts`) begins a
   research batch and queues an `onboarding.fetch` job.
3. **Background research** runs on the Studio job queue (durable, leased, retried; the hosted Studio worker,
   `scripts/studio-worker.ts`):
   - `onboarding.fetch` reads the website's home, about and contact pages with the safe page fetcher
     (`lib/web/fetch-public-page.ts`), no AI, then queues one `onboarding.research` job per topic.
   - Each `onboarding.research` job asks the Location's AI one structured question for its topic
     (`lib/onboarding/research-contract.ts`), validates every value per field kind, and stores what it found as
     **unconfirmed facts with URL sources** in the Business profile. A confirmed fact is never replaced. A found business
     name or time zone waits in the onboarding state, because those live on Location.
   - Topics run in parallel up to the worker's concurrency (2 by default). Every paid call is recorded against the
     Location (`featureArea: business_onboarding`).
4. **Chat and timeline.** Topics are the timeline (`lib/onboarding/topics.ts`): Your business, Contact details, Online
   presence, What you offer, Customers and market, Brand voice, Brand look, Competitors, and Real estate (Estio only).
   Each shows its fields with status empty / suggested / confirmed. The agent's next message
   (`nextPrompt`, `lib/onboarding/view.ts`) presents what was found for the first open topic, or asks its question. The
   owner confirms (a field or a whole topic), edits (saved as confirmed, sourced to the owner), skips, or types an answer:
   one small extraction call maps a typed answer onto the topic's fields.
5. **Finish and reopen.** Finish marks onboarding done; Reopen returns to it to update details. Until done, the app opens
   it automatically for admins (`onboardingOpenMode`, `lib/onboarding/state.ts`).

## Data

- Business facts: only the Business profile (`location.business`) and `Location.name` / `Location.timeZone`.
- `location.onboarding` settings document (`onboardingStateSchema`): status, started/completed times, skipped topics,
  the start input, the current research batch with its runs (queued/running/done/failed, provider, error, applied
  fields, sources), up to 4 fetched page excerpts for the topic jobs, the transcript (last 200 messages), and pending name
  and time-zone suggestions. Parallel topic jobs write it with version checks and retries.

## Research providers

| Connection | Used for research | Web search |
| --- | --- | --- |
| ChatGPT subscription (Location) | Yes, first choice | Yes: Codex `web_search="live"`, enabled only for these calls |
| OpenAI API key | Yes | Yes: Responses API `web_search` tool |
| Gemini API key | Yes, last | No: reads the fetched pages only; Google Search grounding is deliberately not used |
| Paired Mac (Codex / Claude on a subscription) | Not yet | Needs a companion handler for `onboarding.research` shipped with the Mac app; the companion currently runs only its own job kinds with web search disabled. Until then a ready Mac still opens the gate, and research uses the server connections above. |

No Google scraping and no browser automation.

## API

`/api/onboarding` (same-origin JSON with `X-Studio-Tenant`, like other Location commands). `GET` returns `{ view }`
(`OnboardingView`: topics with field values, statuses, sources and suggestions; research progress; transcript; AI
connections; `openMode`; `nextPrompt`; completeness). `POST` actions, each returning the updated `view`: `start`
`{name?, website?}`, `confirm {topic, field}`, `confirm-topic {topic}`, `edit {topic, field, value}`, `skip {topic}`,
`say {text, topic?}`, `finish`, `reopen`. Members can read; changes need an admin signed in as themselves.

## Next steps

- The onboarding screen (timeline beside chat), auto-open for admins and the Settings entry in both apps, replacing
  Studio's old brand wizard.
- Mac companion research handler (with web search enabled only for this job kind), shipped with the Studio Mac app.

## The screen (2026-11-05)

One shared client component, `components/onboarding/onboarding-screen.tsx`, rendered by `components/onboarding/onboarding-page.tsx` inside each product's shell:
- **CRM:** `/admin/onboarding` (both apps; allowed on Substo by `lib/auth/substo-crm-policy.ts`, as is `/api/onboarding`).
- **Studio:** `/studio/onboarding`, which replaces Studio's former 4-step brand wizard (`profile-editor.tsx` and `lib/studio/brand-onboarding-script.ts` are removed; `/studio/brand-profile` still re-exports the page). The Studio home's "Set up your brand" link opens it.

Layout: the profile **timeline** (topics in order, each with a status icon: not started, researching, suggestions to confirm, done, skipped) beside the **chat**. Topics open as they fill; every value shows its status and source links, with inline Confirm and Edit (one editor for all kinds: lists one per line, structured entries as `a | b` columns, see `lib/onboarding/field-text.ts`; Escape cancels and returns focus). The chat shows the transcript, then one card at a time:
- **Locked** (no AI connection): a "Connect an AI" card linking to that app's connection screens (`connectLinks` in `lib/onboarding/entry.ts`: Estio CRM ChatGPT subscription and OpenAI key; Substo Studio AI settings; both a paired Mac). The answer box is disabled.
- **Start:** business name (pre-filled with the Location's name) and website, then research starts in the background.
- **Topic:** research findings for the current topic ("Is this right?") with Confirm all, Edit, Skip; or the topic's question with "Fill in directly" and Skip. Research progress and failures show under it.
- **Summary:** everything that will be saved and what's still missing, then Finish (and Research again).
Free answers go through the `say` command for the current topic. The view is polled every 3 seconds while research runs. Below the `lg` breakpoint (phones, portrait iPad) the two panes become Chat / Profile tabs; choosing Edit from the chat switches to the profile.

Entry points:
- **Automatic:** the CRM home (`/admin`) and Studio home (`/studio`) redirect an admin to onboarding while it isn't done (`lib/onboarding/auto-open.ts`), unless they pressed **Later**, which sets a session cookie for that Location (`onboarding_later`). Members, impersonators and finished profiles are never redirected; a failure in this check never blocks the home screen.
- **Manual:** Settings → Business profile (`/admin/onboarding?update=1`, both apps) and Substo's Brand settings (`/studio/onboarding?update=1`). A finished profile stays fully editable; reopening it doesn't make it auto-open again.

Verified with a local harness (mocked view, Tailwind) at 1280 and 820 px wide for the locked, start, researching, mostly confirmed and summary states. Not verified: the real app shell, live research and keyboard behaviour in a real browser session.
