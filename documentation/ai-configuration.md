# AI Configuration & Integration

**Last Updated:** 2026-03-13

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
- `app/(main)/admin/settings/ai/actions.ts`
- `app/(main)/admin/settings/ai/ai-settings-form.tsx`
- `app/(main)/admin/conversations/actions.ts`
- `app/(main)/admin/conversations/_components/conversation-composer.tsx`
- `app/(main)/admin/conversations/_components/chat-window.tsx`
- `app/(main)/admin/conversations/_components/unified-timeline.tsx`

## Related Docs

- `documentation/ai-draft-feature.md`
- `documentation/ai-agentic-conversations-hub.md`
- `documentation/conversation-management.md`
- `documentation/ai-property-image-enhancement-v1.md`

For exact conversations workspace/polling/search behavior, use `documentation/conversation-management.md` as the canonical reference.
