# AI Property Image Enhancement (Admin)

**Last Updated:** 2026-04-04

## Overview

This document describes the admin-only AI image enhancement flow for property listings.

The feature now has two editing modes inside the **Property Form -> Media** tab:

1. **Polish**
   - Analyze the selected listing photo and return structured, selectable fixes.
   - Generate a polished variant image based on selected fixes, aggression level, and model tier.
2. **Precision Remove**
   - Let the operator paint or box-mask an exact area.
   - Remove the masked object with Vertex AI Imagen inpainting, then blend the masked edit back over the original image.

Outputs remain in **Cloudflare Images** and are added as a new `PropertyMedia` variant (original image is preserved).

## Recent Fixes

The latest update focused on two practical issues discovered during real usage:

1. **Analyzer miss fallback**
   - Previously, if analysis returned no useful fixes, the operator had no good way to tell the model what to remove or improve.
   - The modal now supports **freeform override instructions** that are passed into both analysis and generation.
   - Example: "Remove the people near the pool and preserve the pool shape exactly as-is."

2. **Consistency across similar room shots**
   - Previously, each image enhancement run started too independently, which could make adjacent photos from the same room drift stylistically.
   - The flow now produces a bounded `reusablePrompt` context after generation.
   - That context can be reused for the next enhancement run in the same editing session through **Reuse Last Approved Prompt**.

3. **Prompt transparency**
   - The generation step now shows the **Final Prompt Used** so operators can understand how the image was instructed and debug unexpected output.

4. **Model routing correction**
   - `nano_banana_2` now resolves to `gemini-2.5-flash-image`, which is the current implementation default in code.

5. **Precision Remove mode**
   - Added a separate admin-only mode for exact object removal using manual masks.
   - The UI supports `Brush` and `Box` tools, erase mode, undo/redo, clear mask, and optional replacement guidance.
   - Removal uses Vertex AI Imagen with a user-provided mask instead of relying only on prompt interpretation.

6. **Compare-first review**
   - Both modes now review results in a shared before/after compare viewer.
   - The generated image is no longer shown in a separate preview block below the editor.
   - Desktop uses a draggable compare handle; mobile also exposes a one-tap "Show Original" toggle.

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
   - User runs **Analyze Photo**.
   - AI returns:
     - `sceneSummary`
     - `detectedElements[]`
     - `suggestedFixes[]` (chip-style toggles)
     - `promptPolish`
     - `actionLogDraft`
   - User chooses:
     - Fix chips (on/off)
     - Aggression: `conservative | balanced | aggressive` (default `balanced`)
     - Model tier: `nano_banana_2` (default) or `nano_banana_pro`
     - Optional freeform override instructions
     - Optional reuse of the last approved prompt context from the previous image in the current editing session
   - User runs **Generate Enhanced Image**.
6. In **Precision Remove** mode:
   - User masks the object with `Brush` or `Box`.
   - User may erase parts of the mask, undo, redo, or clear the mask.
   - User may optionally add short replacement guidance such as "continue the lawn texture naturally".
   - User runs **Remove Selected Area**.
7. Modal moves to the shared **Review** stage:
   - Compare viewer shows before/after in the main image area.
   - Action log is shown in the side rail.
   - User can go back to edit, regenerate, or keep the result.
8. User clicks **Add Variant To Property** (optional "set as primary on save").
9. User saves property form to persist.

## Current UX Behavior

- The modal can still generate even when `suggestedFixes[]` is empty, as long as analysis has completed.
- Override instructions are intentionally operator-first and do not depend on the analyzer successfully detecting a target object.
- Prompt reuse is **session-scoped in the property form UI**. It is not yet persisted in the database across browser refreshes or across users.
- Generated output is added as a new image variant in the unsaved property form state, then persisted when the operator saves the property.
- `Precision Remove` is intentionally a separate mode and does not auto-chain into `Polish` in the same run.
- The review stage uses one consistent compare viewer for both modes to keep the modal smaller and easier to scan.

## API Endpoints

### `POST /api/images/enhance/analyze`

Validates auth + location access + property media ownership, downloads source image, runs Gemini analysis, returns normalized structured JSON.

Supports optional `userInstructions` and `priorPrompt` so operators can steer analysis toward missed issues and keep similar room shots aligned.

### `POST /api/images/enhance/generate`

Validates auth + access + ownership, runs generation with selected options, uploads generated image to Cloudflare, and returns:

- `generatedImageId`
- `generatedImageUrl`
- `actionLog`
- `finalPrompt`
- `reusablePrompt` (bounded context for the next similar image)

### `POST /api/images/enhance/precision-remove`

Validates auth + access + property media ownership, downloads the source image, applies a user mask, calls Vertex AI Imagen object removal, blends the masked result back over the original, uploads the generated image to Cloudflare, and returns:

- `generatedImageId`
- `generatedImageUrl`
- `actionLog`
- `model`
- `maskCoverage`

## Data Contracts

Shared contracts live in:

- `lib/ai/property-image-enhancement-types.ts`

Key types:

- `EnhancementAggression = "conservative" | "balanced" | "aggressive"`
- `EnhancementModelTier = "nano_banana_2" | "nano_banana_pro"`
- `EnhancementMode = "polish" | "precision_remove"`
- `ImageEnhancementAnalysisRequest/Response`
- `ImageEnhancementGenerateRequest/Response`
- `ImagePrecisionRemoveRequest/Response`
- `ImageEnhancementGeneratedResult`

## Model Routing

Model routing is defined in `lib/ai/property-image-enhancement.ts`:

- `nano_banana_2` -> `gemini-2.5-flash-image`
- `nano_banana_pro` -> `gemini-3-pro-image-preview`

AI key resolution uses `resolveLocationGoogleAiApiKey(locationId)`.

Precision Remove model routing is defined in `lib/ai/property-image-precision-remove.ts`:

- `imagen-3.0-capability-001` with `EDIT_MODE_INPAINT_REMOVAL`

Vertex configuration is shared across the server:

- `GOOGLE_CLOUD_PROJECT_ID`
- `GOOGLE_CLOUD_LOCATION`
- `GOOGLE_APPLICATION_CREDENTIALS`

Per-location availability is controlled in:

- `/admin/settings/ai` -> `Enable Precision Remove`

## Security and Guardrails

- Requires authenticated user.
- Requires `verifyUserHasAccessToLocation`.
- Rejects media that is not owned by the target property + location.
- Prompts enforce photorealism and discourage misleading structural edits.
- Manual override instructions are treated as guidance, but prompts still explicitly preserve architecture, layout, materials, and room truthfulness.
- Precision Remove is hidden entirely when shared Google Cloud configuration is unavailable or the current location has not enabled it in AI Settings.
- Precision Remove blends only the masked region back over the original image so non-selected areas stay as close as possible to the source photo.

## Cloudflare Hosting Strategy

Generated output is uploaded using existing `uploadToCloudflare` helpers.

No separate storage path is introduced.

Resulting image is appended as `PropertyMedia` entry with `cloudflareImageId` and public delivery URL.

## Known Limitations

- Precision Remove currently uses only **manual** masks (`Brush` and `Box`).
- The editor does **not** yet support hover-highlight segmentation, semantic object detection, or click-to-select masks.
- If the analyzer misses an object in `Polish`, the current fallback is text guidance through override instructions rather than automatic region selection.
- Prompt reuse currently exists only in the active property-editing session; it is not yet stored per property, per room, or per scene cluster.
- The UI shows detected elements as badges only; they are not yet interactive hotspots on the image.
- Precision Remove currently generates one result per request.

## Recommended Next Phase

For future improvements beyond the current manual-mask implementation:

1. Add an image overlay with hover/click selection.
2. Use a segmentation model to produce masks for selected objects.
3. Feed the selected mask into the existing inpainting/removal backend.
4. Optionally run Nano Banana afterward as the polish/finalization pass.

This would build on the current Precision Remove foundation rather than replace it.

## UI Integration Points

- `app/(main)/admin/properties/_components/property-form.tsx`
- `app/(main)/admin/properties/_components/property-image-enhance-dialog.tsx`
- `app/(main)/admin/properties/_components/property-image-compare-viewer.tsx`
- `app/(main)/admin/properties/_components/property-image-mask-editor.tsx`

The Enhance button appears only for persisted property images.

## Backend Files

- `lib/ai/property-image-enhancement.ts`
- `lib/ai/property-image-enhancement-types.ts`
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
- tier -> model resolver
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
- `documentation/public-site-media-seo-implementation.md`
- `documentation/ai-property-import-prompts.md`

For Vertex env setup details used by `Precision Remove`, see:

- `documentation/ai-configuration.md#vertex-env-setup-for-precision-remove`
