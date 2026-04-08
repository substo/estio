# AI Property Image Enhancement (Admin)

**Last Updated:** 2026-04-08

## Overview

This document describes the admin-only AI image enhancement flow for property listings.

The feature now has two editing modes inside the **Property Form -> Media** tab:

1. **Polish**
   - Analyze the selected listing photo and return structured, selectable fixes.
   - Generate a polished variant image based on selected fixes, aggression level, and step-specific model selection.
2. **Precision Remove**
   - Let the operator paint or box-mask an exact area.
   - Remove the masked object with Gemini image editing (mask-conditioned), then blend the masked edit back over the original image.

Outputs remain in **Cloudflare Images** and are added as a new `PropertyMedia` variant (original image is preserved).

## Recent Fixes

The latest updates in this implementation cycle focused on the following practical issues discovered during real usage:

1. **Analyzer miss fallback**
   - Previously, if analysis returned no useful fixes, the operator had no good way to tell the model what to remove or improve.
   - The modal now supports **freeform override instructions** that are passed into both analysis and generation.
   - Example: "Remove the people near the pool and preserve the pool shape exactly as-is."

2. **Consistency across similar room shots**
   - Previously, each image enhancement run started too independently, which could make adjacent photos from the same room drift stylistically.
   - The flow now produces a bounded `reusablePrompt` context after generation.
   - Prompt memory is now **property-scoped and room-type scoped** (for example: Kitchen, Living Room, Kids Bedroom, Garage) and reused through **Use Saved Room Profile Prompt** in both analyze and generate steps.

3. **Prompt transparency**
   - The generation step now shows the **Final Prompt Used** so operators can understand how the image was instructed and debug unexpected output.

4. **Step-specific model selection**
   - The old hardcoded `Nano Banana / Pro` toggle has been removed from the polish flow.
   - Analysis and generation now each use their own dropdown backed by the shared Google model catalog.
   - The server validates those selections against capability-aware filters so analysis does not accidentally hit an image model that rejects JSON mode.
   - Defaults now come from the location AI settings already used elsewhere in the product:
     - analysis prefers `googleAiModelExtraction`
     - generation prefers `googleAiModelDesign`, with a hard fallback to `gemini-2.5-flash-image` (Nano Banana 2) when no design model is configured

5. **Precision Remove mode**
   - Added a separate admin-only mode for exact object removal using manual masks.
   - The UI supports `Brush` and `Box` tools, erase mode, undo/redo, clear mask, and optional replacement guidance.
   - Removal uses Gemini image editing with an explicit user-provided mask plus blending, instead of relying only on prompt interpretation.

6. **Compare-first review**
   - Both modes now review results in a shared before/after compare viewer.
   - The generated image is no longer shown in a separate preview block below the editor.
   - Desktop uses a draggable compare handle; mobile also exposes a one-tap "Show Original" toggle.

7. **Editable and custom Suggested Fixes**
   - After analysis, operators can now **rename any Suggested Fix chip** inline by hovering over it and clicking the pencil icon.
   - Renaming a chip updates both its display label and the `promptInstruction` sent to the generation model, so the Live Final Prompt reflects the edit immediately.
   - A dashed **+ Add Fix** button appears after the chip list, allowing operators to insert an entirely new custom fix chip that is auto-selected and fed into the prompt.
   - Edited and custom fixes flow through the existing `reusablePrompt` pipeline so they are saved per room type and reused on the next photo of the same room.

8. **Full State Persistence for Reusable Prompts**
   - The system now reliably stores the entire `ImageEnhancementAnalysis` JSON object inside the PostgreSQL database tracking prompt profiles.
   - Tricking the **Use Saved Room Profile Prompt** switch immediately hydrates the component state—meaning "Suggested Fixes", active selections, and context are automatically restored instantly.
   - Users are bypassed around the "Step 1 Analyze" API call completely without losing context and feature chips.
   - If an operator prefers to re-analyze, the system explicitly merges previously saved (legacy) fix chips with newly discovered elements so no metadata is lost.

9. **Nano Banana 2 default for generation**
   - The generation model dropdown now defaults to `gemini-2.5-flash-image` (labelled **Nano Banana 2**) when no explicit preference has been set.
   - The fallback logic in `model-capabilities.ts` now explicitly prefers this model before falling back to the first available option.
   - This eliminates the need to manually select the model each time the enhancement dialog opens.

10. **Kids Bedroom room type**
   - Added `kids_bedroom` with the label **Kids Bedroom** to the preset room type list.
   - It appears between Bedroom and Bathroom in the dropdown and is available for room-scoped prompt memory.

## Scope

- Enabled only in admin property editor.
- Not enabled in public submission flows.
- Works only for images that already belong to the current property/location.

## User Flow

1. User opens an existing property in `/admin/properties/[id]`.
2. In **Media -> Images**, user clicks **Enhance** on an existing image.
3. Modal opens in the **Edit** stage.
4. User selects one of two modes:
   - `Polish`
   - `Precision Remove` when enabled for the current location
5. In **Polish** mode:
   - User adds optional shared guidance:
     - freeform override instructions
     - room type selection (`preset + custom`)
     - optional use of the saved prompt profile for the selected room type
   - User chooses an **Analysis Model** from a dropdown that only shows structured analysis candidates.
   - User runs **Analyze Photo**.
   - AI returns:
     - `sceneSummary`
     - `sceneContext`
     - `detectedElements[]`
     - `suggestedFixes[]` (chip-style toggles)
     - `actionLogDraft`
   - User chooses:
     - Fix chips (on/off)
     - Detected elements to remove (on/off)
     - Aggression: `conservative | balanced | aggressive` (default `balanced`)
     - a **Generation Model** from a dropdown that only shows image-editing candidates
     - review the **Live Final Prompt**, which updates whenever chips, removals, aggression, override instructions, or prompt reuse change
   - User runs **Generate Enhanced Image**.
6. In **Precision Remove** mode:
   - User masks the object with `Brush` or `Box`.
   - User may erase parts of the mask, undo, redo, or clear the mask.
   - User may optionally add short replacement guidance such as "continue the lawn texture naturally".
   - User runs **Remove Selected Area**.
7. Modal moves to the shared **Review** stage:
   - Compare viewer shows before/after in the main image area.
   - Action log is shown in the side rail.
   - User chooses one gallery apply mode:
     - `Replace original`
     - `Add before original`
     - `Add as primary`
   - User can go back to edit, regenerate, or keep the result.
8. User applies the result to the property gallery.
9. User saves property form to persist.

## Current UX Behavior

- The modal can still generate even when `suggestedFixes[]` is empty, as long as analysis has completed.
- Override instructions are intentionally operator-first and do not depend on the analyzer successfully detecting a target object.
- Prompt reuse is now **property-scoped by room type**.
  - The room profile prompt can influence both analyze and generate when enabled.
  - Room profile updates are staged in form state on `Keep Result` and persisted on `Save Property`.
- Generated output is first applied to unsaved property form state using an explicit gallery mode:
  - `Replace original` hides the source image from the visible gallery and keeps a revert path.
  - `Add before original` keeps both images visible.
  - `Add as primary` prepends the AI result.
- AI-generated images are marked in the admin gallery, and replace-mode results expose `Revert`.
- `Precision Remove` is intentionally a separate mode and does not auto-chain into `Polish` in the same run.
- The review stage uses one consistent compare viewer for both modes to keep the modal smaller and easier to scan.
- In `Polish`, the rail is progressive:
  - Step 1 shows only the analysis-model selector.
  - After analysis completes, Step 2 shows the generation-model selector.
  - This keeps both model controls available without showing both at once.
- The analyze route can now fail fast with a compatibility error when an incompatible model is submitted, rather than forwarding a bad request to Gemini and surfacing a lower-level provider error later.

## API Endpoints

### `POST /api/images/enhance/analyze`

Validates auth + location access + property media ownership, downloads source image, runs Gemini analysis, returns normalized structured JSON.

Supports:

- `analysisModel`
- optional `userInstructions`
- optional `priorPrompt`

This route now also validates that the submitted model belongs to the server-derived `analysisModels` catalog for the location.

### `POST /api/images/enhance/generate`

Validates auth + access + ownership, runs generation with selected options, uploads generated image to Cloudflare, and returns:

- `generatedImageId`
- `generatedImageUrl`
- `actionLog`
- `finalPrompt`
- `reusablePrompt` (bounded context for the next similar image)

Supports:

- `generationModel`
- `aggression`
- `selectedFixIds`
- `removedDetectedElementIds`
- optional `userInstructions`
- optional `priorPrompt`

This route now also validates that the submitted model belongs to the server-derived `generationModels` catalog for the location.

### `POST /api/images/enhance/precision-remove`

Validates auth + access + property media ownership, downloads the source image, applies a manual or automatic mask mode, calls Gemini image editing for object removal, blends the result for manual masks, uploads the generated image to Cloudflare, and returns:

- `generatedImageId`
- `generatedImageUrl`
- `actionLog`
- `model`
- `maskCoverage`

### `POST /api/images/enhance/room-type/predict`

Validates auth + location access + property media ownership, downloads source image, runs Gemini room-type classification, and returns:

- `suggestedRoomType` (`key`, `label`, `confidence`)
- `candidates[]` (ranked alternatives)
- `model`

## Data Contracts

Shared contracts live in:

- `lib/ai/property-image-enhancement-types.ts`

Key types:

- `EnhancementAggression = "conservative" | "balanced" | "aggressive"`
- `EnhancementMode = "polish" | "precision_remove"`
- `ImageEnhancementAnalysisRequest/Response`
- `ImageEnhancementGenerateRequest/Response`
- `ImagePrecisionRemoveRequest/Response`
- `ImageEnhancementGeneratedResult`

Notable request fields for `Polish`:

- `analysisModel?: string`
- `generationModel?: string`
- `removedDetectedElementIds: string[]`

## Model Routing

Property image model options now come from the shared model catalog in `lib/ai/fetch-models.ts`.

- The app fetches available Google models from `v1beta/models` and merges them with curated aliases in `lib/ai/models.ts`.
- `buildPropertyImageModelCatalog()` in `lib/ai/model-capabilities.ts` derives two filtered lists:
  - `analysisModels`
  - `generationModels`
- Capability filtering is heuristic and centralized:
  - image-preview / `-image` / `imagen` style ids are treated as generation candidates
  - non-image Gemini content models are treated as structured analysis candidates
  - utility families such as embeddings/robotics are excluded
- The modal consumes those filtered lists through a dedicated hook and lets the operator choose a model for each polish step.
- The analyze and generate API routes validate the selected model against the same filtered server-side catalog before calling Gemini.
- Default selections are derived from existing location AI settings:
  - analysis prefers `googleAiModelExtraction`, then `googleAiModel`
  - generation prefers `googleAiModelDesign`, then `googleAiModel`

AI key resolution uses `resolveLocationGoogleAiApiKey(locationId)`.

Precision Remove model routing is defined in `lib/ai/property-image-precision-remove.ts`:

- `gemini-2.5-flash-image` (non-deprecation path)

Precision Remove now uses the same location-level Google AI API key resolution as other image enhancement routes:

- `resolveLocationGoogleAiApiKey(locationId)`

Per-location feature availability is controlled in:

- `/admin/settings/ai` -> `Enable Precision Remove`

## Security and Guardrails

- Requires authenticated user.
- Requires `verifyUserHasAccessToLocation`.
- Rejects media that is not owned by the target property + location.
- Prompts enforce photorealism and discourage misleading structural edits.
- Manual override instructions are treated as guidance, but prompts still explicitly preserve architecture, layout, materials, and room truthfulness.
- Precision Remove is controlled by location AI settings and remains visible when enabled there.
- Precision Remove blends only the masked region back over the original image so non-selected areas stay as close as possible to the source photo.

## Cloudflare Hosting Strategy

Generated output is uploaded using existing `uploadToCloudflare` helpers.

No separate storage path is introduced.

Resulting image is stored as `PropertyMedia` with `cloudflareImageId`, public delivery URL, and AI lineage metadata.

`PropertyMedia.metadata.aiEnhancement` now tracks:

- whether the image is AI-generated
- the source/original image reference
- which apply mode was used
- whether an original image is hidden from the visible gallery because it was replaced

## Known Limitations

- Precision Remove supports manual masks (`Brush` and `Box`), one-click smart presets (`Remove People`, `Remove Background`), and server-assisted click-to-select object regions based on analyzer bounding boxes.
- Click-to-select currently uses bounding boxes, not pixel-accurate segmentation masks, so manual touch-up is still recommended for tight edges.
- If the analyzer misses an object in `Polish`, the current fallback is text guidance through override instructions rather than guaranteed automatic region selection.
- Precision Remove currently generates one result per request.
- Capability classification for image enhancement models is still heuristic because the Google models list used here does not expose a clean, app-ready “supports structured image analysis” vs “supports image editing output” split.

## Recommended Next Phase

For future improvements beyond the current server-assisted click-to-select implementation:

1. Upgrade from bounding boxes to true pixel-accurate segmentation masks.
2. Add low-latency hover previews for object boundaries (client-side SAM/ONNX or equivalent).
3. Add confidence-aware region ranking so the best click targets appear first for dense scenes.
4. Optionally chain a second polish pass after object removal for final artifact cleanup.

This builds on the current Precision Remove foundation without replacing existing manual controls.

## UI Integration Points

- `app/(main)/admin/properties/_components/property-form.tsx`
- `app/(main)/admin/properties/_components/property-image-enhance-dialog.tsx`
- `app/(main)/admin/properties/_components/property-image-compare-viewer.tsx`
- `app/(main)/admin/properties/_components/property-image-mask-editor.tsx`
- `components/ai/use-property-image-enhancement-model-catalog.ts`

The Enhance button appears only for persisted property images.

## Backend Files

- `lib/ai/property-image-enhancement.ts`
- `lib/ai/property-image-enhancement-types.ts`
- `lib/ai/model-capabilities.ts`
- `lib/ai/property-image-editor.ts`
- `lib/ai/property-image-precision-remove-config.ts`
- `lib/ai/property-image-precision-remove.ts`
- `app/api/images/enhance/analyze/route.ts`
- `app/api/images/enhance/generate/route.ts`
- `app/api/images/enhance/precision-remove/route.ts`
- `app/api/images/enhance/_helpers.ts`

## Tests

Unit coverage:

- `lib/ai/property-image-enhancement.test.ts`
- `lib/ai/property-image-precision-remove.test.ts`

Covered scenarios:

- malformed analysis output fallback
- generation prompt composition
- operator override instructions
- reusable prompt context generation
- property-image capability catalog separation (`analysisModels` vs `generationModels`)
- default fallback when a configured design model is not image-capable
- JSON extraction from model output
- editor dimension resolution
- empty-mask rejection
- mask coverage calculation
- guidance omission when blank
- masked blending preserves unselected pixels

## Operational Notes

- Lint in this repo may require interactive ESLint setup (`npx next lint`).
- Type-checking may need increased memory in this workspace:

```bash
NODE_OPTIONS='--max-old-space-size=8192' npx tsc --noEmit
```

## Related Docs

- `documentation/property-management-guide.md`
- `documentation/ai-configuration.md`
- `documentation/ai-usage-metering.md`
- `documentation/public-site-media-seo-implementation.md`
- `documentation/ai-property-import-prompts.md`

For location AI key setup used by `Precision Remove`, see:

- `documentation/ai-configuration.md#google-ai-api-key`
