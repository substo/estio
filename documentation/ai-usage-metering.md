# Unified AI Usage Metering

**Last Updated:** 2026-04-05

## Overview

Estio records every AI operation as an `AiUsage` row in a unified metering table. This provides per-location cost visibility, per-property usage detail, and the data foundation for billing location users based on actual AI consumption.

The system currently instruments **property image enhancement** (all four API routes) and is designed to support any future AI feature (viewing sessions, smart replies, contact classification) by setting a different `resourceType` and `featureArea`.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  API Route (analyze / generate / precision-      │
│  remove / room-type predict)                     │
│                                                  │
│  1. Execute AI operation                         │
│  2. void securelyRecordAiUsage({...})            │
│     ↓ (non-blocking, fire-and-forget)            │
└──────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│  lib/ai/usage-metering.ts                        │
│  ┌──────────────────────────────────────────┐    │
│  │ securelyRecordAiUsage()                  │    │
│  │  → calculateAiCost() from pricing-engine │    │
│  │  → db.aiUsage.create()                   │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│  AiUsage table (Prisma / PostgreSQL)             │
│  Polymorphic: resourceType + resourceId          │
└──────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│  Admin UI                                        │
│  • /admin dashboard → GlobalAiUsageWidget        │
│  • /admin/properties/[id]/view → PropertyAi-     │
│    UsageBadge                                     │
└──────────────────────────────────────────────────┘
```

## Data Model

### `AiUsage` (Prisma)

Located in `prisma/schema.prisma`.

| Field | Type | Purpose |
|---|---|---|
| `id` | String (cuid) | Primary key |
| `createdAt` | DateTime | Row insertion time |
| `recordedAt` | DateTime | Time the AI operation completed |
| `locationId` | String | FK → Location. Enables location-wide billing rollups. |
| `userId` | String? | FK → User. The admin who triggered the operation. |
| `resourceType` | String | Polymorphic type: `"property"`, `"viewing_session"`, `"conversation"`, `"system"` |
| `resourceId` | String? | The specific resource ID (e.g., `property.id`) |
| `featureArea` | String | Logical grouping: `"property_image_enhancement"`, `"viewing_translation"`, etc. |
| `action` | String | Specific step: `"analyze"`, `"generate"`, `"precision_remove"`, `"room_type_predict"` |
| `provider` | String | AI provider key: `"google_gemini"`, `"vertex_imagen"` |
| `model` | String | Exact model identifier used (e.g., `"gemini-2.5-flash"`) |
| `inputTokens` | Int? | Prompt/input tokens (from Gemini `usageMetadata`). Null for non-token providers. |
| `outputTokens` | Int? | Completion/output tokens. Null for non-token providers. |
| `totalTokens` | Int? | Sum of input + output tokens. |
| `estimatedCostUsd` | Float | Calculated billing cost (see Pricing Engine below). |
| `metadata` | Json? | Feature-specific audit data (image IDs, aggression level, room type, etc.) |

### Indexes

- `[locationId, recordedAt DESC]` — location-wide monthly queries
- `[resourceType, resourceId, recordedAt DESC]` — per-property queries
- `[locationId, featureArea, recordedAt DESC]` — feature breakdown queries

### Relations

- `Location.aiUsages` — reverse relation for location-scoped queries
- `User.aiUsages` — reverse relation for user attribution

## Pricing Engine

**File:** `lib/ai/pricing-engine.ts`

Centralizes cost calculation so pricing changes are applied in one place.

### Token-Based Models (Gemini)

Costs are calculated per 1 million tokens using published Google pricing:

| Model | Input (per 1M) | Output (per 1M) |
|---|---|---|
| `gemini-1.5-flash` (and variants) | $0.075 | $0.30 |
| `gemini-1.5-pro` (and variants) | $1.25 | $5.00 |
| `gemini-1.0-pro` | $0.50 | $1.50 |

The function `normalizeModelName()` handles version suffixes (e.g., `gemini-1.5-flash-001` → `gemini-1.5-flash`). Unknown Gemini models fall back to Flash pricing.

### Flat-Rate Models (Vertex Imagen)

| Model | Cost per Image |
|---|---|
| `imagen-3.0-capability-001` | $0.03 |
| `imagen-3.0-generate-001` | $0.03 |

For Imagen, the caller passes `quantity: 1` instead of token counts.

### Updating Prices

To update pricing when Google changes rates:

1. Edit the `GEMINI_PRICING` or `IMAGEN_PRICING` maps in `lib/ai/pricing-engine.ts`.
2. Changes apply to all new `AiUsage` records going forward.
3. Existing records retain their original `estimatedCostUsd` (historical accuracy).

## Usage Recording Service

**File:** `lib/ai/usage-metering.ts`

### `securelyRecordAiUsage(input)`

Single entry point for all AI telemetry. Key behaviors:

- **Never throws** — wrapped in try/catch so telemetry failures don't disrupt the user's request
- **Calculates cost** — calls `calculateAiCost()` internally
- **Validates** — warns on missing required fields instead of writing incomplete records

```typescript
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";

void securelyRecordAiUsage({
    locationId: "loc_abc",
    userId: "user_xyz",
    resourceType: "property",
    resourceId: "prop_123",
    featureArea: "property_image_enhancement",
    action: "analyze",
    provider: "google_gemini",
    model: "gemini-2.5-flash",
    inputTokens: 1200,
    outputTokens: 350,
    metadata: { sourceCloudflareImageId: "cf_img_abc" },
});
```

### Non-Blocking Pattern

All API routes use `void securelyRecordAiUsage(...)` — the `void` operator discards the promise so the HTTP response returns immediately without waiting for the DB write. The internal try/catch ensures unhandled-rejection warnings are suppressed.

## Instrumented API Routes

| Route | Provider | Token Source | Cost Method | Metadata Recorded |
|---|---|---|---|---|
| `/api/images/enhance/analyze` | `google_gemini` | `usageMetadata` from Gemini response | Per-token | `sourceCloudflareImageId` |
| `/api/images/enhance/generate` | `google_gemini` | `usageMetadata` from Gemini response | Per-token | `sourceCloudflareImageId`, `resultCloudflareImageId`, `aggression` |
| `/api/images/enhance/precision-remove` | `vertex_imagen` | N/A (no tokens) | Flat $0.03/image | `sourceCloudflareImageId`, `resultCloudflareImageId`, `maskCoverage` |
| `/api/images/enhance/room-type/predict` | `google_gemini` | `usageMetadata` from Gemini response | Per-token | `sourceCloudflareImageId`, `suggestedRoomType` |

### Token Extraction

The Gemini REST API returns `usageMetadata` in every response:

```json
{
  "candidates": [...],
  "usageMetadata": {
    "promptTokenCount": 1234,
    "candidatesTokenCount": 567,
    "totalTokenCount": 1801
  }
}
```

This was previously discarded. The `GeminiGenerateContentResponse` types in both `property-image-enhancement.ts` and `property-image-room-type.ts` now include `usageMetadata`, and the public functions (`analyzeImageForEnhancement`, `generateEnhancedImage`, `predictPropertyImageRoomType`) propagate it to callers.

## Admin Dashboard UI

### Global AI Usage Widget

**File:** `app/(main)/admin/_components/global-ai-usage-widget.tsx`
**Location:** Main admin dashboard (`/admin`)

Shows current-month aggregated metrics:

- **Total AI Calls** — count of all `AiUsage` records this month
- **Total Tokens** — summed `totalTokens`
- **Estimated Cost** — summed `estimatedCostUsd`
- **Breakdown by Feature** — e.g., "Image Enhancement: 47 calls, $1.41"
- **Breakdown by Model** — e.g., "gemini-2.5-flash (Gemini): 35 calls, $0.26"

Data is fetched via `getLocationAiUsageSummary()` server action.

### Property AI Usage Badge

**File:** `app/(main)/admin/properties/_components/property-ai-usage-badge.tsx`
**Location:** Property view page (between header and content card)

Collapsible widget per property:

- **Collapsed:** Shows total calls, tokens, and cost in a single bar
- **Expanded:** Shows breakdown by action type + last 10 AI operations with model, tokens, cost, and relative timestamp
- **Auto-hides** when no AI usage exists for the property

Data is fetched via `getPropertyAiUsageSummary(propertyId)` server action.

### Server Actions

**File:** `app/(main)/admin/_actions/ai-usage.ts`

| Function | Purpose |
|---|---|
| `getPropertyAiUsageSummary(propertyId)` | Returns totals, per-action breakdown, and recent records for one property |
| `getLocationAiUsageSummary(locationId?)` | Returns current-month totals, per-feature breakdown, and per-model breakdown for a location |

## Extending to New AI Features

To add tracking for a new AI feature (e.g., viewing session translation):

1. **Identify the provider call.** Find where the AI API is called.
2. **Extract tokens.** If the provider returns usage metadata, propagate it.
3. **Record usage.** After the successful call:

```typescript
void securelyRecordAiUsage({
    locationId,
    userId,
    resourceType: "viewing_session",       // ← new resource type
    resourceId: sessionId,
    featureArea: "viewing_translation",    // ← new feature area
    action: "translate_segment",           // ← specific action
    provider: "google_gemini",
    model: translationModel,
    inputTokens: usageMetadata?.promptTokenCount,
    outputTokens: usageMetadata?.candidatesTokenCount,
});
```

4. **Update pricing.** If the model isn't already in `GEMINI_PRICING`/`IMAGEN_PRICING`, add it.
5. **Add UI labels.** Add the new `featureArea` to `FEATURE_LABELS` in the dashboard widget.

No schema changes are needed — the polymorphic `resourceType`/`featureArea` fields handle new features without migration.

## Key Files

### Core

- `prisma/schema.prisma` — `AiUsage` model definition
- `lib/ai/pricing-engine.ts` — Cost calculation engine
- `lib/ai/usage-metering.ts` — `securelyRecordAiUsage()` entry point

### Instrumented Routes

- `app/api/images/enhance/analyze/route.ts`
- `app/api/images/enhance/generate/route.ts`
- `app/api/images/enhance/precision-remove/route.ts`
- `app/api/images/enhance/room-type/predict/route.ts`

### UI

- `app/(main)/admin/_actions/ai-usage.ts` — server actions
- `app/(main)/admin/_components/global-ai-usage-widget.tsx` — dashboard widget
- `app/(main)/admin/properties/_components/property-ai-usage-badge.tsx` — property badge
- `app/(main)/admin/page.tsx` — dashboard page
- `app/(main)/admin/properties/_components/property-view.tsx` — property view page

### Modified AI Libraries

- `lib/ai/property-image-enhancement.ts` — `usageMetadata` extraction
- `lib/ai/property-image-room-type.ts` — `usageMetadata` extraction

## Related Docs

- `documentation/ai-property-image-enhancement-v1.md` — property image enhancement flow (routes instrumented here)
- `documentation/ai-configuration.md` — AI model configuration, API keys, cost tracking context
- `documentation/viewing-intelligence-live-copilot-implementation-tracking.md` — viewing session AI (future candidate for unified metering)
- `documentation/ai-agentic-conversations-hub.md` — conversation AI (future candidate for unified metering)
