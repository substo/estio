# Property Print Designer

**Last Updated:** 2026-04-09 (v1.1 — UX hardening + bug fixes)

## Overview

The Property Print Designer adds a brochure and print-preparation workflow to the admin property view page.

Primary goals:

- create reusable per-property print drafts
- support standard print sizes with **A4 as the main polished format**
- generate brochure copy in one or two languages using the existing Google Gemini integration
- let agents pick and reorder property photos
- support both **browser print** and **PDF export**
- track AI usage through the shared `AiUsage` metering system

Admin entry point:

- `/admin/properties/[id]/view`

Print preview routes:

- `/admin/properties/[id]/print/[draftId]`
- `/admin/properties/[id]/print/[draftId]/pdf`

## Current V1 Scope

V1 is intentionally **template-based**, not a freeform layout builder.

Supported templates:

- `a4-property-sheet`
- `a4-photo-heavy`
- `a3-poster-split`

Supported behaviors:

- create/save/delete property print drafts
- mark one draft as the default draft for a property
- choose paper size and orientation
- choose up to two brochure languages
- choose brochure images and reorder them
- edit generated brochure text manually after AI generation
- print from browser preview
- export a PDF version from the saved draft

## Data Model

Prisma model:

- `PropertyPrintDraft`

Relationship:

- `Property 1 -> many PropertyPrintDraft`

Stored fields:

- `name`
- `templateId`
- `paperSize`
- `orientation`
- `languages`
- `selectedMediaIds`
- `isDefault`
- `designSettings`
- `promptSettings`
- `generatedContent`
- `generationMetadata`

Important details:

- drafts are stored per property
- selected images are stored by `PropertyMedia.id`
- generated brochure copy is stored as a snapshot, so later reprints remain stable
- one property can have multiple drafts, but the UI treats one as the preferred default

Migration:

- `prisma/migrations/20260409193000_property_print_drafts/migration.sql`

## Admin UI

Main component:

- `app/(main)/admin/properties/_components/property-print-designer-dialog.tsx`

The property view now includes a `Print Designer` action beside the existing property actions.

### Modal layout

The dialog is viewport-bounded (`max-h-[calc(100vh-2rem)]`) with a flex layout:

- header and action bar are sticky (never scroll away)
- the draft rail scrolls independently on its own `ScrollArea`
- the editor pane scrolls independently within the remaining space
- no browser zoom-out required on small laptop screens

### Tab structure

Three controlled tabs (`value` / `onValueChange` for programmatic switching):

1. `Setup` — document settings, organized into grouped cards:
   - **Document**: draft name, template
   - **Layout**: paper size, orientation, inline layout preview thumbnail
   - **Languages**: language pills (max 2), helper text
   - **AI Copy**: shared AI model picker (`AiModelSelect` + `useAiModelCatalog`), tone instructions
   - **Visibility**: section checkboxes, accent color
2. `Content` — generated/manual brochure copy:
   - brochure title/subtitle
   - feature bullets
   - footer note
   - contact CTA
   - per-language editable text blocks
   - inline loading state with shimmer placeholders during generation
   - inline error banner on generation failure
3. `Media & Layout`
   - selected image list
   - image reorder via `dnd-kit`
   - add/remove property photos for the draft

### Action bar

Primary actions: `Save Draft`, `Generate Copy` (with spinner).
Secondary actions: `Preview`, `PDF`, `Default`, `Delete` (ghost/destructive).

### Draft rail

- stronger selection state with `ring-2 ring-primary/20`
- filled star icon for default draft badge
- compact layout with orientation/paper badge per draft

### Inline layout preview

A `PrintLayoutPreviewThumbnail` component renders in the Layout card of the Setup tab:

- proportional rectangle reflecting the actual page ratio from `getPaperDimensions`
- placeholder blocks for hero image, text columns, language sections, logo, footer
- updates live when template, paper size, orientation, language count, or section toggles change
- badge showing paper size and orientation

This is a pure CSS preview, not a second full print renderer.

Helper: `buildPrintLayoutPreviewDescriptor()` in `lib/properties/print-designer.ts`.

### Generation flow UX

When the user clicks `Generate Copy`:

1. the active tab switches to `Content` immediately
2. a loading banner and shimmer placeholders display while generation is in progress
3. on success, the Content tab stays focused with populated fields
4. on failure, an inline error banner appears in Content alongside a toast

The dialog uses the existing admin component stack:

- shadcn/Radix inputs, tabs, dialog, badges, scroll areas
- `dnd-kit` for image ordering
- `AiModelSelect` + `useAiModelCatalog` for model selection
- existing property media and Cloudflare image helpers

## AI Generation

AI generation service:

- `lib/properties/print-ai.ts`

Draft actions:

- `app/(main)/admin/properties/print-actions.ts`

Generation behavior:

- resolves the location Google AI key using the existing shared key lookup
- accepts an explicit `modelOverride` parameter that takes priority over location resolution
- falls back to the design model from the location AI settings path when no override is provided
- uses property facts as deterministic input
- asks Gemini for strict JSON brochure output
- supports one or two brochure languages in a single request

Model resolution order:

1. explicit `modelOverride` parameter (from dialog model picker)
2. `promptSettings.modelOverride` saved in the draft
3. location AI settings (`googleAiModelDesign` / `googleAiModel`)
4. `SiteConfig` legacy fallback
5. `resolveAiModelDefault(locationId, "design")`

The AI model picker in the dialog uses the shared `AiModelSelect` + `useAiModelCatalog` system (same as conversations and image enhance). The selected model is persisted in the draft's `promptSettings.modelOverride` field.

The AI is responsible for:

- brochure-friendly title and subtitle
- feature bullets
- footer note
- contact CTA
- per-language brochure body copy

The AI is **not** the source of truth for:

- price
- reference
- bedroom/bathroom counts
- covered/plot area
- contact details
- property/public URL

Those remain deterministic from property and location data.

## AI Usage Tracking

The feature uses the shared `AiUsage` metering table.

Feature area:

- `property_printing`

Current actions:

- `generate_print_copy`
- `generate_pdf` (only recorded on successful PDF generation)

Resource mapping:

- `resourceType: "property"`
- `resourceId: property.id`

UI surfacing:

- existing property AI usage badge now includes print-related action labels

Note: the PDF route only records usage on success. Failed PDF generation does not create a metering entry.

## Branding and Content Sources

Branding resolver:

- `lib/properties/print-preview.ts`

The print output pulls branding from location public-site settings, with legacy `SiteConfig` fallback where needed.

Branding inputs:

- logo
- primary color
- contact phone/email/address
- public domain
- location name

The property public URL is generated from:

- location domain
- property slug

## Print Preview and PDF Export

Preview route:

- `app/(main)/admin/properties/[id]/print/[draftId]/page.tsx`

Preview renderer:

- `app/(main)/admin/properties/_components/property-print-preview.tsx`

Preview helper:

- `app/(main)/admin/properties/_components/property-print-preview-actions.tsx`

PDF generation:

- `app/(main)/admin/properties/[id]/print/[draftId]/pdf/route.ts`
- `lib/properties/print-pdf.ts`

Rendering strategy:

- browser preview is the primary fidelity target
- preview applies print CSS and `@page` sizing
- PDF export reuses the same saved draft data model, but is a close-match brochure export rather than a pixel-perfect mirror of the HTML preview

### Paper dimensions

Base dimensions are portrait-first:

- A4: 210 × 297 mm
- A3: 297 × 420 mm

The `getPaperDimensions()` helper swaps width/height only when orientation is `landscape`. Both the browser preview and PDF generation consume this helper.

### PDF image handling

The PDF generator uses a `safeEmbedImage` helper that:

- directly embeds JPEG and PNG images
- gracefully skips unsupported formats (WebP, AVIF, SVG, etc.) with a console warning instead of crashing
- wraps all embedding in try/catch so corrupted image data also does not crash the route

The PDF route itself:

- wraps generation in try/catch and returns a controlled `500` response on failure
- logs errors server-side without leaking sensitive data
- only records AI usage metering on successful generation

## Shared Utilities

Core print-domain helpers:

- `lib/properties/print-designer.ts`

Responsibilities:

- template metadata
- default draft values
- schema normalization (including `modelOverride` in prompt settings)
- language normalization
- image slot rules
- paper size helpers (portrait-first base dimensions)
- property fact formatting
- `PrintLayoutPreviewDescriptor` type and `buildPrintLayoutPreviewDescriptor()` builder for the inline setup-tab thumbnail

Preview-data assembly:

- `lib/properties/print-preview.ts`

## Verification

Focused test file:

- `lib/properties/print-designer.test.ts`

Verified during implementation:

- `npx prisma generate`
- `npx tsx --test lib/properties/print-designer.test.ts`

Current test coverage (11 tests):

- default draft template and orientation
- language normalization with dedup and cap
- preview data assembly with selected media and generated content
- paper dimensions: A4 portrait, A4 landscape, A3 portrait, A3 landscape
- inline preview descriptor updates with orientation and template changes
- prompt settings `modelOverride` round-trip preservation
- prompt settings `modelOverride` defaults to null
- landscape orientation preservation in preview descriptor

Repo-wide note:

- full `npx tsc --noEmit` still reports unrelated pre-existing nullability errors in viewing and AI follow-up areas outside this feature

## Rollout Notes

To use the feature in a real environment:

1. apply the Prisma migration
2. deploy the updated server/client code
3. ensure the location has a valid Google AI API key if brochure generation is required
4. verify public-site branding/domain settings if QR links and contact branding should be correct

## Future Enhancements

Likely next steps:

- regenerate a single language block without replacing others
- richer template library
- stronger PDF/HTML parity
- QR generation without external remote image dependency
- persisted per-template layout presets beyond current safe-slot configuration
- background job/offline PDF generation if agents need batch exports
