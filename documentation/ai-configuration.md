# AI Configuration & Integration

**Last Updated:** 2026-04-04

Estio uses Google Gemini models across conversation drafting, selection actions, content generation, and import flows. This document reflects the current model-resolution logic used in production.

For canonical AI automation runtime architecture (policies, decisions, jobs, suggested response queue), use:
- `documentation/ai-skills-runtime-implementation.md`

## AI Settings Page

**Path:** `/admin/settings/ai`

The settings page now writes through `SettingsService`:

- Non-secret model configuration is stored in `settings_documents` under domain `location.ai`.
- The API key is stored in `settings_secrets` under secret key `google_ai_api_key` (encrypted at rest).
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

## Core Fields in `location.ai`

- `googleAiApiKey` (stored as encrypted secret in `settings_secrets`)
- `googleAiModel` (general / draft default)
- `googleAiModelExtraction` (stage 1 extraction)
- `googleAiModelDesign` (stage 2 design)
- `precisionRemoveEnabled` (per-location toggle for masked property photo removal)
- `brandVoice`
- `outreachConfig` (`enabled`, `visionIdPrompt`, `icebreakerPrompt`, `qualifierPrompt`)
- `automationConfig` (legacy compatibility payload; not the primary runtime control plane)

## Model Catalog Source

Model options come from two sources:

1. Dynamic fetch from Google Models API (`v1beta/models`, paginated).
2. Curated fallback/alias list in `lib/ai/models.ts`.

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

For exact conversations workspace/polling/search behavior, use `documentation/conversation-management.md` as the canonical reference.
