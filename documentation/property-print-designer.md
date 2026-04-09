# Property Print Designer

**Last Updated:** 2026-04-09

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

The dialog is organized into three tabs:

1. `Setup`
   - draft name
   - template
   - paper size
   - orientation
   - language selection
   - AI tone instructions
   - section visibility toggles
   - accent color override
2. `Content`
   - brochure title/subtitle
   - feature bullets
   - footer note
   - contact CTA
   - per-language editable text blocks
3. `Media & Layout`
   - selected image list
   - image reorder via `dnd-kit`
   - add/remove property photos for the draft

The dialog uses the existing admin component stack:

- shadcn/Radix inputs, tabs, dialog, badges, scroll areas
- `dnd-kit` for image ordering
- existing property media and Cloudflare image helpers

## AI Generation

AI generation service:

- `lib/properties/print-ai.ts`

Draft actions:

- `app/(main)/admin/properties/print-actions.ts`

Generation behavior:

- resolves the location Google AI key using the existing shared key lookup
- resolves the design model from the location AI settings path
- uses property facts as deterministic input
- asks Gemini for strict JSON brochure output
- supports one or two brochure languages in a single request

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
- `generate_pdf`

Resource mapping:

- `resourceType: "property"`
- `resourceId: property.id`

UI surfacing:

- existing property AI usage badge now includes print-related action labels

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

## Shared Utilities

Core print-domain helpers:

- `lib/properties/print-designer.ts`

Responsibilities:

- template metadata
- default draft values
- schema normalization
- language normalization
- image slot rules
- paper size helpers
- property fact formatting

Preview-data assembly:

- `lib/properties/print-preview.ts`

## Verification

Focused test added:

- `lib/properties/print-designer.test.ts`

Verified during implementation:

- `npx prisma generate`
- `npx tsx --test lib/properties/print-designer.test.ts`

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
