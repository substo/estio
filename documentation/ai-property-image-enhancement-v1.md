# AI Property Image Enhancement v1 (Admin)

**Last Updated:** 2026-04-04

## Overview

This document describes the admin-only AI image enhancement flow for property listings.

The feature adds a 2-step workflow in the **Property Form -> Media** tab:

1. **Analyze** the selected listing photo and return structured, selectable fixes.
2. **Generate** a polished variant image based on selected fixes, aggression level, and model tier.

Outputs remain in **Cloudflare Images** and are added as a new `PropertyMedia` variant (original image is preserved).

## Scope

- Enabled only in admin property editor.
- Not enabled in public submission flows.
- Works only for images that already belong to the current property/location.

## User Flow

1. User opens an existing property in `/admin/properties/[id]`.
2. In **Media -> Images**, user clicks **Enhance** on an existing image.
3. Modal opens and user runs **Analyze Photo**.
4. AI returns:
   - `sceneSummary`
   - `detectedElements[]`
   - `suggestedFixes[]` (chip-style toggles)
   - `promptPolish`
   - `actionLogDraft`
5. User chooses:
   - Fix chips (on/off)
   - Aggression: `conservative | balanced | aggressive` (default `balanced`)
   - Model tier: `nano_banana_2` (default) or `nano_banana_pro`
6. User runs **Generate Enhanced Image**.
7. Preview + action log shown.
8. User clicks **Add Variant To Property** (optional "set as primary on save").
9. User saves property form to persist.

## API Endpoints

### `POST /api/images/enhance/analyze`

Validates auth + location access + property media ownership, downloads source image, runs Gemini analysis, returns normalized structured JSON.

### `POST /api/images/enhance/generate`

Validates auth + access + ownership, runs generation with selected options, uploads generated image to Cloudflare, returns `generatedImageId` + URL + action log.

## Data Contracts

Shared contracts live in:

- `lib/ai/property-image-enhancement-types.ts`

Key types:

- `EnhancementAggression = "conservative" | "balanced" | "aggressive"`
- `EnhancementModelTier = "nano_banana_2" | "nano_banana_pro"`
- `ImageEnhancementAnalysisRequest/Response`
- `ImageEnhancementGenerateRequest/Response`

## Model Routing

Model routing is defined in `lib/ai/property-image-enhancement.ts`:

- `nano_banana_2` -> `gemini-3.1-flash-image-preview`
- `nano_banana_pro` -> `gemini-3-pro-image-preview`

AI key resolution uses `resolveLocationGoogleAiApiKey(locationId)`.

## Security and Guardrails

- Requires authenticated user.
- Requires `verifyUserHasAccessToLocation`.
- Rejects media that is not owned by the target property + location.
- Prompts enforce photorealism and discourage misleading structural edits.

## Cloudflare Hosting Strategy

Generated output is uploaded using existing `uploadToCloudflare` helpers.

No separate storage path is introduced.

Resulting image is appended as `PropertyMedia` entry with `cloudflareImageId` and public delivery URL.

## UI Integration Points

- `app/(main)/admin/properties/_components/property-form.tsx`
- `app/(main)/admin/properties/_components/property-image-enhance-dialog.tsx`

The Enhance button appears only for persisted property images.

## Backend Files

- `lib/ai/property-image-enhancement.ts`
- `lib/ai/property-image-enhancement-types.ts`
- `app/api/images/enhance/analyze/route.ts`
- `app/api/images/enhance/generate/route.ts`
- `app/api/images/enhance/_helpers.ts`

## Tests

Unit coverage:

- `lib/ai/property-image-enhancement.test.ts`

Covered scenarios:

- malformed analysis output fallback
- generation prompt composition
- tier -> model resolver
- JSON extraction from model output

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
