# AI Configuration & Integration

**Last Updated:** 2026-03-07

Estio uses Google Gemini models across conversation drafting, selection actions, content generation, and import flows. This document reflects the current model-resolution logic used in production.

## AI Settings Page

**Path:** `/admin/settings/ai`

The settings page stores model and API configuration in `SiteConfig`.

## Core Fields in `SiteConfig`

- `googleAiApiKey`
- `googleAiModel` (general / draft default)
- `googleAiModelExtraction` (stage 1 extraction)
- `googleAiModelDesign` (stage 2 design)
- `brandVoice`
- `outreachConfig` (`enabled`, `visionIdPrompt`, `icebreakerPrompt`, `qualifierPrompt`)

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

For exact conversations workspace/polling/search behavior, use `documentation/conversation-management.md` as the canonical reference.
