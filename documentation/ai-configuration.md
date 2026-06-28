# AI Configuration & Integration

**Last Updated:** 2026-06-28

Estio uses Google Gemini models across conversation drafting, selection actions, content generation, import flows, and audio transcription. OpenAI can be configured as a text-generation alternative, but live/audio transcript paths remain Google-specific until a dedicated quality and latency evaluation proves otherwise.

Estio also has an experimental ChatGPT subscription text provider based on the OpenClaw/Codex auth design. It is intentionally separate from the OpenAI Platform API-key provider because ChatGPT subscription auth is not a general `/v1/responses` API credential.

For canonical AI automation runtime architecture (policies, decisions, jobs, suggested response queue), use:
- `documentation/ai-skills-runtime-implementation.md`

## AI Settings Page

**Path:** `/admin/settings/ai`

The AI settings page manages Google Gemini model/runtime settings, brand voice, transcription, automation, and skill runtime configuration. It now keeps OpenAI-specific connection controls out of this page.

Google AI settings write through `SettingsService`:

- Non-secret model configuration is stored in `settings_documents` under domain `location.ai`.
- API keys are stored in `settings_secrets` and encrypted at rest:
  - Google: `google_ai_api_key`
- During migration windows, legacy `SiteConfig` dual-write may still be enabled via feature flags.

For storage architecture, migration flags, and encryption/key rotation procedures, see [site-settings-platform.md](/Users/martingreen/Projects/IDX/documentation/site-settings-platform.md).

### Skill Runtime Hub (Admin)

The AI settings page includes a **Skill Runtime Hub** section that manages:
- per-skill `AiSkillPolicy` configuration,
- runtime simulation (`simulateSkillDecision`),
- runtime execution trigger (`runAiRuntimeNow`),
- runtime health summaries (policies, pending/dead jobs, pending suggestions).

UI source:
- `app/(main)/admin/settings/ai/skill-runtime-settings.tsx`

## OpenAI Integration Page

**Path:** `/admin/settings/integrations/openai`

This is the canonical UI for all OpenAI-related setup:

- ChatGPT subscription provider sign-in/connect flow.
- Optional per-user ChatGPT/Codex access token.
- Personal OpenAI Platform API key and personal default text model.
- Location/admin OpenAI Platform API key and organization default text model.

Underlying storage remains:

- Location/admin OpenAI API key: `LOCATION` / `location.ai` / `openai_api_key`
- Location/admin OpenAI model: `LOCATION` / `location.ai` / `openAiTextModel`
- Personal OpenAI API key: `USER` / `user.integrations.openai` / `openai_api_key`
- Personal OpenAI preferences: `USER` / `user.integrations.openai` with `enabled` and `defaultTextModel`
- Personal ChatGPT subscription preferences: `USER` / `user.integrations.chatgpt_subscription` with `enabled` and `defaultTextModel`
- ChatGPT subscription access token: `USER` / `user.integrations.chatgpt_subscription` / `chatgpt_codex_access_token`

## Core Fields in `location.ai`

- `googleAiApiKey` (stored as encrypted secret in `settings_secrets`)
- `googleAiModel` (general / draft default)
- `googleAiModelExtraction` (stage 1 extraction)
- `googleAiModelDesign` (stage 2 design)
- `openAiTextModel` (OpenAI text-generation alternative; stored with `openai:` prefix)
- `precisionRemoveEnabled` (per-location toggle for masked property photo removal)
- `brandVoice`
- `outreachConfig` (`enabled`, `visionIdPrompt`, `icebreakerPrompt`, `qualifierPrompt`)
- `automationConfig` (legacy compatibility payload; not the primary runtime control plane)

## Model Catalog Source

Model options come from two sources:

1. Dynamic fetch from Google Models API (`v1beta/models`, paginated).
2. Curated fallback/alias list in `lib/ai/models.ts`.

OpenAI text model options are fetched separately from OpenAI’s `/v1/models` endpoint using the location OpenAI API key. The app caches that list for 24 hours via `unstable_cache` and filters it to text-generation candidates. If the API key is missing or the endpoint fails, the UI falls back to a small curated OpenAI text-model list so saved settings remain editable.

At runtime, OpenAI text calls resolve credentials in this order:

1. Current authenticated user’s enabled personal OpenAI key.
2. Location/admin OpenAI key.
3. `OPENAI_API_KEY` environment variable.

Personal keys, the user’s preferred OpenAI text model, location/admin keys, the location OpenAI text model, and ChatGPT subscription settings are configured from `/admin/settings/integrations/openai`.

OpenAI server API calls use bearer API keys or short-lived access tokens; consumer ChatGPT login is not an API authentication mechanism for this app. See OpenAI’s API authentication and model-list references:
- https://developers.openai.com/api/reference/overview#authentication
- https://developers.openai.com/api/reference/resources/models/methods/list

### Experimental ChatGPT Subscription Provider

The ChatGPT subscription provider uses model IDs with the `chatgpt_subscription:` prefix, for example:

- `chatgpt_subscription:gpt-5.5`
- `chatgpt_subscription:gpt-5.4`
- `chatgpt_subscription:gpt-5.4-mini`

This provider follows the OpenClaw-style pattern: authenticated Codex/ChatGPT subscription access drives text-agent turns through a Codex CLI transport instead of OpenAI Platform API keys. OpenAI documents ChatGPT sign-in for Codex CLI, app, and IDE sessions; it does not document a general hosted OAuth callback that third-party web apps can use as a drop-in replacement for the OpenAI Platform API.

The current Estio transport is deliberately opt-in:

- `CHATGPT_SUBSCRIPTION_TRANSPORT=codex_cli`
- optional `CODEX_CLI_PATH=/absolute/path/to/codex`
- optional `CHATGPT_SUBSCRIPTION_CODEX_CWD=/private/tmp`
- optional `CHATGPT_SUBSCRIPTION_CODEX_TIMEOUT_MS=120000`
- optional deployment fallback `CODEX_ACCESS_TOKEN`

Per-user tokens can be configured from `/admin/settings/integrations/openai`, but they are optional when the trusted runner has an authenticated Codex login cache from `codex login --device-auth`. Codex access tokens are supported for ChatGPT Business and Enterprise workspaces and are intended for trusted automation. This is appropriate only for trusted servers/runners. Do not use browser session cookies, scraped ChatGPT tokens, or shared personal credentials in a multi-user deployment.

The Codex transport is locked down with `codex exec --ephemeral --ignore-rules --skip-git-repo-check --sandbox read-only --ask-for-approval never` and writes the final answer through `--output-last-message`. It is slower and less deterministic than the API-key path, so it should be limited to human-triggered text drafting/selection workflows. Live transcript, realtime voice, audio transcription, and image generation remain outside this provider.

The OpenAI integration page shows whether the server transport flag is enabled and includes a **Sign in with ChatGPT** / reconnect action. That action runs the same provider path with a tiny prompt, using the saved per-user token, deployment `CODEX_ACCESS_TOKEN`, or the trusted runner's Codex device-auth cache, so it validates real Codex CLI readiness instead of only checking that a token exists. When validation succeeds, Estio enables the ChatGPT subscription model preference for the current user.

This is intentionally a guided setup rather than a hosted OAuth callback. Codex device-auth produces local Codex credentials for the trusted runner, and the Estio transport can use that cache directly when no explicit token is configured. Estio should not capture browser session cookies or attempt to impersonate a normal OpenAI API OAuth provider.

Because Codex subscription usage does not expose normal per-call token pricing, runtime cost metadata uses `provider_pricing_unavailable` with estimated token counts derived from prompt/output text length.

OpenAI pricing is not returned by `/v1/models`; do not treat model discovery as pricing discovery. The app can refresh official OpenAI organization cost telemetry from the Admin Costs API when `OPENAI_ADMIN_API_KEY` or `OPENAI_API_KEY` has the required organization access:

- https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage

That cost endpoint returns historical billed cost buckets, not a per-model token-rate table. Runtime OpenAI cost estimates therefore use `provider_pricing_unavailable`: token usage is recorded, but the numeric cost remains `0` with a low-confidence note rather than pretending OpenAI usage is free or applying Google/Gemini rates to OpenAI calls.

### Provider Catalog Refresh

OpenAI model discovery is cached for 24 hours. The cron route below invalidates and warms the OpenAI text-model cache for every location and enabled user with an encrypted OpenAI key. It also attempts to refresh OpenAI organization cost telemetry for the last day when a deployment-level OpenAI key is configured:

- `GET /api/cron/ai-provider-catalog`

This route intentionally does **not** scrape or invent OpenAI token-rate pricing. Its response includes `pricingRefresh` metadata showing whether official OpenAI cost telemetry was refreshed and the source URL used.

Deployment scheduling:

- Vercel: `vercel.json` runs `/api/cron/ai-provider-catalog` daily at `17 3 * * *`.
- Server crontab: `scripts/install-cron.sh` installs `scripts/cron-ai-provider-catalog.sh` on the same daily cadence.

Important aliases/constants:

- `gemini-flash-latest` (`GEMINI_FLASH_LATEST_ALIAS`)
- `gemini-2.5-flash` (`GEMINI_FLASH_STABLE_FALLBACK`)

For property image enhancement:

- `Polish` analysis uses the shared model catalog filtered down to structured image-analysis candidates.
- `Polish` generation uses the same shared catalog filtered down to image-editing/image-output candidates.
- Those filtered lists are built in `lib/ai/model-capabilities.ts` and returned server-side from `getPropertyImageEnhancementModelCatalog()`.

The UI list is deduped and sorted, and curated aliases remain available even if Google API omits them.

## Server-Resolved Default Logic

Defaults are resolved server-side in `lib/ai/fetch-models.ts`.

For a location:

- `general` and `draft` default -> `googleAiModel` if set
- `extraction` default -> `googleAiModelExtraction`, else `googleAiModel`
- `design` default -> `googleAiModelDesign`, else `googleAiModel`

If not configured:

1. Use `gemini-flash-latest` when available
2. Else use `gemini-2.5-flash`
3. Else use first available Flash model
4. Else final fallback `gemini-2.5-flash`

### UI Consumers

- `/admin/settings/ai` loads picker defaults from `getAiModelPickerDefaultsAction()`.
- The shared conversation composer (`conversation-composer.tsx`) uses `getAiDraftModelPickerStateAction()` for both chats mode and deal mode.
- Property photo enhancement uses `getPropertyImageEnhancementModelCatalogAction()` so the modal can show one dropdown for analysis models and a separate dropdown for generation models.
- Under `workspaceV2`, the selected thread still uses the same shared composer/model picker path, so the performance rollout does not introduce a second conversation-model source of truth.

This keeps picker defaults consistent across screens.

## Conversation AI Model Reuse

Inside chat, the selected model is reused by:

- AI Draft generation
- `Paste Lead` (selection)
- `Summarize` (selection -> CRM log)
- `Custom` (selection + user prompt)

This ensures the same model behavior across drafting and selection workflows.

## Cost & Usage Tracking

For selection actions using LLM:

- `Summarize` and `Custom` persist `AgentExecution` usage/cost metadata
- Conversation token/cost counters are incremented

For property image enhancement AI operations:

- All image enhancement routes (`analyze`, `generate`, `precision-remove`, `room-type/predict`) record usage in the unified `AiUsage` metering table.
- Cost is calculated centrally via `lib/ai/pricing-engine.ts`.
- See `documentation/ai-usage-metering.md` for full architecture.

`Find Contact` is non-AI and does not create model usage traces.

## Pricing Default Note

`lib/ai/pricing.ts` still exports `DEFAULT_MODEL = gemini-3-flash-preview` for generic fallback/cost contexts.

For user-facing pickers and chat defaults, the effective model is resolved through `fetch-models.ts` as described above.

## Key Files

- `lib/ai/models.ts`
- `lib/ai/fetch-models.ts`
- `lib/ai/property-image-enhancement.ts`
- `lib/ai/property-image-precision-remove-config.ts`
- `lib/ai/property-image-precision-remove.ts`
- `app/(main)/admin/settings/ai/actions.ts`
- `app/(main)/admin/settings/ai/ai-settings-form.tsx`
- `app/(main)/admin/conversations/actions.ts`
- `app/(main)/admin/conversations/_components/conversation-composer.tsx`
- `app/(main)/admin/conversations/_components/chat-window.tsx`
- `app/(main)/admin/conversations/_components/unified-timeline.tsx`

## Vertex Env Setup For Precision Remove

The `Precision Remove` image-editing mode uses **shared Vertex AI server credentials**.

Unlike the regular `Polish` flow, it does **not** use the per-location Google AI API key from AI Settings.

### Required Env Vars

Add these to the runtime environment used by the app:

```env
GOOGLE_CLOUD_PROJECT_ID=your-gcp-project-id
GOOGLE_CLOUD_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
```

### What Each Variable Does

- `GOOGLE_CLOUD_PROJECT_ID`
  - Your Google Cloud project ID where Vertex AI is enabled.
- `GOOGLE_CLOUD_LOCATION`
  - Vertex region used for Imagen requests.
  - Recommended default for this feature: `us-central1`.
- `GOOGLE_APPLICATION_CREDENTIALS`
  - Absolute filesystem path to the Google service account JSON file on the server.
  - This is read by Google auth and used to mint access tokens for Vertex.

### Where To Add Them

#### Local development

Add them to your local runtime env file:

- `.env.local` for normal local dev
- or `.env.production.local` if you are running a production-like local build

Example:

```env
GOOGLE_CLOUD_PROJECT_ID=estio-prod
GOOGLE_CLOUD_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=/Users/yourname/.config/gcp/estio-imagen-service-account.json
```

#### Production / deploy flow

This repo’s deploy flow copies runtime env from `.env.prod` onto the target server during deploy.

So for production, add the same variables to:

- `.env.prod`

And make sure the JSON file referenced by `GOOGLE_APPLICATION_CREDENTIALS` actually exists on the server at that exact path.

### Service Account Requirements

The service account behind `GOOGLE_APPLICATION_CREDENTIALS` should have:

- Vertex AI enabled in the target GCP project
- permission to call Vertex prediction endpoints

In practice, use a dedicated service account for image editing rather than reusing a broad owner credential.

### How The App Uses These Vars

The feature gate is evaluated in:

- `lib/ai/property-image-precision-remove-config.ts`

The mode is usable only when:

1. `GOOGLE_CLOUD_PROJECT_ID` is set
2. `GOOGLE_CLOUD_LOCATION` is set
3. `GOOGLE_APPLICATION_CREDENTIALS` is set
4. the current location has `Precision Remove` enabled in `/admin/settings/ai`

### Quick Verification Checklist

After setting env vars:

1. Restart the app server.
2. Open an existing property in admin.
3. Go to `Media`.
4. Click `Enhance` on a persisted image.
5. Confirm the modal shows both:
   - `Polish`
   - `Precision Remove`

If `Precision Remove` is missing, check:

1. the credentials file path is valid on that machine
2. `GOOGLE_CLOUD_PROJECT_ID` is set
3. `GOOGLE_CLOUD_LOCATION` is set
4. the server was restarted after the env change
5. `Precision Remove` is enabled for that location in AI Settings

### Important Distinction

- `Polish` mode:
  - Uses per-location Google AI configuration from Admin AI Settings
- `Precision Remove` mode:
  - Uses shared server-level Vertex credentials from env vars plus a per-location enable toggle in AI Settings

That split is intentional because masked Imagen editing is currently implemented through shared Vertex access, not the location-specific Gemini API-key flow.

## Related Docs

- `documentation/ai-draft-feature.md`
- `documentation/ai-agentic-conversations-hub.md`
- `documentation/conversation-management.md`
- `documentation/ai-property-image-enhancement-v1.md`
- `documentation/ai-usage-metering.md`

For exact conversations workspace/polling/search behavior, use `documentation/conversation-management.md` as the canonical reference.
