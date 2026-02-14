# Phase 3: Searcher & Recommender

**Duration**: Weeks 5–6  
**Priority**: 🟡 High  
**Dependencies**: Phase 0 (pgvector, MCP), Phase 2 (BuyerProfile)

---

## Objective

Build a **Semantic Property Search & Recommendation Engine** that goes beyond simple database filters to understand natural language queries, match lifestyle preferences, and suggest properties the client didn't know they wanted.

---

## 1. The Search Problem

### Current State

```typescript
// Current: filter-based SQL query
searchProperties({ district: "Paphos", maxPrice: 200000, bedrooms: 2 })
```

This works for explicit criteria but fails for:
- *"Something modern with a sea view"* — "Modern" and "sea view" aren't dropdown fields.
- *"A quiet area good for families"* — Requires semantic understanding.
- *"Similar to the villa we saw last week"* — Requires contextual memory.

### Target State

```typescript
// Target: semantic + structured hybrid search
searchProperties({
  structured: { district: "Paphos", maxPrice: 200000 },
  semantic: "modern design, sea view, quiet, family-friendly",
  excludeIds: ["prop_123"], // Already rejected
  similarTo: "prop_456",    // "More like this one"
})
```

---

## 2. Property Embeddings

### 2.1 What Gets Embedded

Every property should have a rich text representation that captures all searchable attributes:

```typescript
// lib/ai/search/property-embeddings.ts

/**
 * Generate a rich text description for a property that captures
 * all semantically searchable attributes.
 */
export function generatePropertyText(property: Property): string {
  const parts = [
    property.title,
    property.description,
    `${property.propertyType} in ${property.district}, ${property.city}`,
    `${property.bedrooms} bedrooms, ${property.bathrooms} bathrooms`,
    `${property.area} sqm, ${property.plotArea ? property.plotArea + ' sqm plot' : ''}`,
    `Price: €${property.price?.toLocaleString()}`,
    property.features?.join(", "),  // "Pool, Garden, Parking, Sea View"
    property.condition,              // "New Build", "Resale", "Under Construction"
    property.energyRating,
    // Include nearby amenities if available
    property.nearbyAmenities?.join(", "),
  ].filter(Boolean);

  return parts.join(". ");
}
```

### 2.2 Embedding Pipeline

```typescript
// scripts/embed-properties.ts

import { db } from "@/lib/db";
import { generateEmbedding } from "@/lib/ai/embeddings";
import { generatePropertyText } from "@/lib/ai/search/property-embeddings";

/**
 * One-time bulk embedding of all properties.
 * Run after initial setup, then incrementally on property create/update.
 */
async function embedAllProperties() {
  const properties = await db.property.findMany({
    include: { features: true },
  });

  console.log(`Embedding ${properties.length} properties...`);

  for (const property of properties) {
    const text = generatePropertyText(property);
    const embedding = await generateEmbedding(text);

    await db.$executeRaw`
      UPDATE properties SET embedding = ${embedding}::vector
      WHERE id = ${property.id}
    `;
  }

  console.log("Done!");
}
```

### 2.3 Incremental Updates

```typescript
// lib/ai/search/property-embeddings.ts (continued)

/**
 * Update embedding when a property is created or modified.
 * Called from the property create/update server actions.
 */
export async function updatePropertyEmbedding(propertyId: string) {
  const property = await db.property.findUnique({
    where: { id: propertyId },
    include: { features: true },
  });

  if (!property) return;

  const text = generatePropertyText(property);
  const embedding = await generateEmbedding(text);

  await db.$executeRaw`
    UPDATE properties SET embedding = ${embedding}::vector
    WHERE id = ${propertyId}
  `;
}
```

---

## 3. Hybrid Search Engine

### 3.1 Architecture

The search engine combines three strategies:

```
┌─────────────────────────────────────────────────────────┐
│                    Hybrid Search Engine                  │
│                                                         │
│  ┌───────────────┐  ┌───────────────┐  ┌─────────────┐ │
│  │ Structured    │  │ Semantic      │  │ Collaborative│ │
│  │ Filter        │  │ Vector Search │  │ Filtering    │ │
│  │ (SQL WHERE)   │  │ (pgvector)    │  │ (Similar     │ │
│  │               │  │               │  │  Clients)    │ │
│  └───────┬───────┘  └───────┬───────┘  └──────┬──────┘ │
│          │                  │                  │        │
│          └──────────┬───────┘──────────────────┘        │
│                     ▼                                   │
│            ┌────────────────┐                            │
│            │ Result Ranker  │                            │
│            │ (RRF Fusion)   │                            │
│            └────────────────┘                            │
│                     │                                    │
│                     ▼                                    │
│            ┌────────────────┐                            │
│            │ Explainability │                            │
│            │ ("Why this?")  │                            │
│            └────────────────┘                            │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Hybrid Search Implementation

```typescript
// lib/ai/search/hybrid-search.ts

import { generateEmbedding } from "@/lib/ai/embeddings";

interface SearchParams {
  // Structured filters
  district?: string;
  city?: string;
  minPrice?: number;
  maxPrice?: number;
  bedrooms?: number;
  propertyType?: string;
  dealType?: "sale" | "rent";
  
  // Semantic search
  naturalLanguageQuery?: string;
  
  // Contextual
  excludePropertyIds?: string[];
  similarToPropertyId?: string;
  
  // Pagination
  limit?: number;
  offset?: number;
}

interface SearchResult {
  property: Property;
  score: number;
  matchReasons: string[];  // Explainability
  semanticSimilarity?: number;
}

/**
 * Hybrid search combining structured filters + semantic similarity.
 * Uses Reciprocal Rank Fusion (RRF) to merge results from both strategies.
 */
export async function hybridPropertySearch(
  params: SearchParams
): Promise<SearchResult[]> {
  const limit = params.limit ?? 10;

  // ── Strategy 1: Structured SQL Filter ──
  const structuredResults = await db.property.findMany({
    where: {
      ...(params.district && { district: params.district }),
      ...(params.city && { city: params.city }),
      ...(params.minPrice && { price: { gte: params.minPrice } }),
      ...(params.maxPrice && { price: { lte: params.maxPrice } }),
      ...(params.bedrooms && { bedrooms: params.bedrooms }),
      ...(params.propertyType && { propertyType: params.propertyType }),
      ...(params.dealType && { dealType: params.dealType }),
      ...(params.excludePropertyIds && { id: { notIn: params.excludePropertyIds } }),
      status: "active",
    },
    take: limit * 2, // Fetch extra for fusion
    orderBy: { createdAt: "desc" },
  });

  // ── Strategy 2: Semantic Vector Search ──
  let semanticResults: any[] = [];
  if (params.naturalLanguageQuery) {
    const queryEmbedding = await generateEmbedding(params.naturalLanguageQuery);
    
    semanticResults = await db.$queryRaw`
      SELECT id, title, district, price, bedrooms, 
             1 - (embedding <=> ${queryEmbedding}::vector) AS similarity
      FROM properties
      WHERE status = 'active'
        ${params.maxPrice ? Prisma.sql`AND price <= ${params.maxPrice}` : Prisma.empty}
        ${params.excludePropertyIds?.length ? Prisma.sql`AND id NOT IN (${Prisma.join(params.excludePropertyIds)})` : Prisma.empty}
      ORDER BY embedding <=> ${queryEmbedding}::vector
      LIMIT ${limit * 2}
    `;
  }

  // ── Strategy 3: "Similar To" Search ──
  let similarResults: any[] = [];
  if (params.similarToPropertyId) {
    similarResults = await db.$queryRaw`
      SELECT p.id, p.title, p.district, p.price, p.bedrooms,
             1 - (p.embedding <=> ref.embedding) AS similarity
      FROM properties p
      CROSS JOIN properties ref
      WHERE ref.id = ${params.similarToPropertyId}
        AND p.id != ${params.similarToPropertyId}
        AND p.status = 'active'
      ORDER BY p.embedding <=> ref.embedding
      LIMIT ${limit}
    `;
  }

  // ── Reciprocal Rank Fusion ──
  return fuseResults(structuredResults, semanticResults, similarResults, limit);
}

/**
 * Reciprocal Rank Fusion (RRF) — merges results from multiple search strategies.
 * Each result gets: score = Σ (1 / (k + rank_i)) across all strategies.
 */
function fuseResults(
  structured: any[],
  semantic: any[],
  similar: any[],
  limit: number,
  k: number = 60 // RRF constant
): SearchResult[] {
  const scoreMap = new Map<string, { score: number; reasons: string[]; similarity?: number }>();

  // Score structured results
  structured.forEach((p, i) => {
    const existing = scoreMap.get(p.id) ?? { score: 0, reasons: [] };
    existing.score += 1 / (k + i);
    existing.reasons.push("Matches your criteria");
    scoreMap.set(p.id, existing);
  });

  // Score semantic results
  semantic.forEach((p, i) => {
    const existing = scoreMap.get(p.id) ?? { score: 0, reasons: [] };
    existing.score += 1 / (k + i);
    existing.reasons.push("Matches your description");
    existing.similarity = p.similarity;
    scoreMap.set(p.id, existing);
  });

  // Score similar results
  similar.forEach((p, i) => {
    const existing = scoreMap.get(p.id) ?? { score: 0, reasons: [] };
    existing.score += 1 / (k + i);
    existing.reasons.push("Similar to a property you liked");
    scoreMap.set(p.id, existing);
  });

  // Sort by fused score and take top N
  return Array.from(scoreMap.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([id, data]) => ({
      property: { id } as Property, // Will be hydrated
      score: data.score,
      matchReasons: data.reasons,
      semanticSimilarity: data.similarity,
    }));
}
```

---

## 4. Searcher Skill Definition

```yaml
# lib/ai/skills/searcher/SKILL.md
---
name: searching-properties
description: >
  Searches for properties using hybrid (structured + semantic) matching.
  Triggers when intent is PROPERTY_QUESTION, REQUEST_INFO, or when
  the buyer profile indicates readiness for property recommendations.
tools:
  - search_properties
  - semantic_search
  - recommend_similar
  - store_insight
  - draft_reply
---

# Searching & Recommending Properties

## When to Use
- Client asks about specific property types, areas, or features
- Qualification is complete and lead is ready for recommendations
- Client rejects a property and needs alternatives
- New listing matches a saved search

## Strategy: Smart Recommendations

### Step 1: Understand the Real Need
Before searching, extract the implicit requirements:
- "Something modern" → style: modern, condition: new build or renovated
- "Good for families" → near schools, safe area, garden
- "Investment property" → high rental yield, appreciating area

### Step 2: Execute Hybrid Search
Use BOTH structured and semantic search:
- `search_properties`: Hard filters (price, bedrooms, district)
- `semantic_search`: Soft preferences (style, lifestyle, vibe)

### Step 3: Present with Context
Don't just list properties. For each result, explain WHY it matches:
- "This matches because it has the modern kitchen you mentioned"
- "This is in a particularly quiet street, which you said you prefer"
- "Slightly above budget but has 15% more space — worth a look?"

### Step 4: Learn from Reactions
If the client rejects a property:
1. ASK what they didn't like
2. Store that as a "dealBreaker" insight
3. Exclude similar properties from future searches
4. Use `recommend_similar` to find alternatives that avoid the issue

## Rules
1. ALWAYS show 3-5 properties (not 1, not 20)
2. Include a "wildcard" — one property that breaks their stated criteria but might surprise them
3. For each property, state the match reason
4. If no results found, suggest broadening criteria with specific suggestions
5. Track viewed/rejected properties to avoid showing them again

## Output Format
{
  "thought_summary": "...",
  "search_strategy": {
    "structured_filters": { "district": "Paphos", "maxPrice": 200000 },
    "semantic_query": "modern style, sea view, quiet neighborhood",
    "exclude_ids": ["prop_123"]
  },
  "tool_calls": [
    { "name": "search_properties", "arguments": { ... } },
    { "name": "semantic_search", "arguments": { "query": "modern sea view quiet" } }
  ],
  "recommendations": [
    {
      "propertyId": "prop_456",
      "matchScore": 0.92,
      "reasons": ["Modern design", "Sea view from balcony", "Quiet dead-end street"],
      "isWildcard": false
    }
  ],
  "final_response": "Based on your preferences, here are 4 properties I think you'll love..."
}
```

---

## 5. Recommendation Engine

### 5.1 Collaborative Filtering

```typescript
// lib/ai/search/recommendations.ts

/**
 * "Clients like you also liked" recommendations.
 * Based on viewing history and saved searches of similar buyer profiles.
 */
export async function getCollaborativeRecommendations(
  contactId: string,
  limit: number = 5
): Promise<Property[]> {
  // Find contacts with similar buyer profiles
  const contact = await db.contact.findUnique({ where: { id: contactId } });
  if (!contact?.buyerProfile) return [];

  const profile = contact.buyerProfile as BuyerProfile;
  
  // Find contacts with overlapping criteria who viewed/liked properties
  const similarContacts = await db.contact.findMany({
    where: {
      id: { not: contactId },
      qualificationStage: { in: ["qualified", "highly_qualified"] },
      // Similar budget range (±30%)
      buyerProfile: {
        path: ["budgetRange", "max"],
        gte: profile.budgetRange.min * 0.7,
        lte: profile.budgetRange.max * 1.3,
      },
    },
    take: 20,
  });

  // Get properties those similar contacts viewed/saved
  const viewedPropertyIds = await db.viewing.findMany({
    where: {
      contactId: { in: similarContacts.map(c => c.id) },
    },
    select: { propertyId: true },
    distinct: ["propertyId"],
  });

  // Exclude properties already seen by this contact
  const alreadySeen = await db.viewing.findMany({
    where: { contactId },
    select: { propertyId: true },
  });
  const alreadySeenIds = new Set(alreadySeen.map(v => v.propertyId));

  const recommendedIds = viewedPropertyIds
    .map(v => v.propertyId)
    .filter(id => id && !alreadySeenIds.has(id));

  return db.property.findMany({
    where: { id: { in: recommendedIds.slice(0, limit) } },
  });
}
```

### 5.2 "More Like This" Feature

```typescript
// lib/ai/search/recommendations.ts (continued)

/**
 * Find properties similar to a reference property.
 * Uses vector similarity on property embeddings.
 */
export async function findSimilarProperties(
  propertyId: string,
  limit: number = 5,
  excludeIds: string[] = []
): Promise<{ property: Property; similarity: number }[]> {
  const excluded = [propertyId, ...excludeIds];

  const results = await db.$queryRaw`
    SELECT p.*, 
           1 - (p.embedding <=> ref.embedding) AS similarity
    FROM properties p
    CROSS JOIN properties ref
    WHERE ref.id = ${propertyId}
      AND p.id != ALL(${excluded})
      AND p.status = 'active'
    ORDER BY p.embedding <=> ref.embedding
    LIMIT ${limit}
  `;

  return results as any[];
}
```

---

## 6. Database Changes

```prisma
// prisma/schema.prisma — Add to Property model

model Property {
  // ... existing fields

  // Vector embedding (added via raw migration)
  // embedding vector(768)
}
```

```sql
-- Migration: Add embedding column to properties
ALTER TABLE properties ADD COLUMN IF NOT EXISTS embedding vector(768);
CREATE INDEX IF NOT EXISTS idx_properties_embedding 
  ON properties USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

---

## 7. Verification

### Automated Tests

```yaml
# tests/evals/searcher.yaml
- input: "I want a modern 2-bed apartment with sea view in Paphos under 200k"
  expected_skill: searcher
  expected_tools: [search_properties, semantic_search]
  assertions:
    - results_count: ">= 1"
    - all_results_max_price: 200000
    - match_reasons_include: "Modern", "Sea view"

- input: "Show me something similar to that villa we discussed"
  expected_skill: searcher
  expected_tools: [recommend_similar]

- input: "I didn't like that one, too noisy"
  expected_skill: searcher
  assertions:
    - insight_stored: { category: "dealBreaker", text: "noisy" }
    - excluded_from_next_search: true
```

### Manual Tests

- [ ] "Modern apartment" → Returns properties with "modern" in description even without that filter
- [ ] Rejected property → Not shown again in subsequent searches
- [ ] "Something like Property X" → Returns visually/descriptively similar properties
- [ ] No results → Suggests how to broaden criteria
- [ ] Each result has a "Why this matches" explanation

---

## Files Created / Modified

| Action | File | Purpose |
|:-------|:-----|:--------|
| **NEW** | `lib/ai/search/hybrid-search.ts` | Hybrid structured+semantic search engine |
| **NEW** | `lib/ai/search/property-embeddings.ts` | Property text generation + embedding updates |
| **NEW** | `lib/ai/search/recommendations.ts` | Collaborative filtering + "more like this" |
| **NEW** | `lib/ai/skills/searcher/SKILL.md` | Searcher skill definition |
| **NEW** | `scripts/embed-properties.ts` | Bulk embedding script |
| **MODIFY** | `prisma/schema.prisma` | Add embedding column to Property |
| **MODIFY** | Property create/update actions | Trigger `updatePropertyEmbedding()` |

---

## References

- [pgvector: Open-Source Vector Similarity Search](https://github.com/pgvector/pgvector)
- [Reciprocal Rank Fusion (RRF)](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf) — The algorithm for merging ranked results
- [Hybrid Search: Combining Dense & Sparse Retrieval](https://www.pinecone.io/learn/hybrid-search/)
- [Google text-embedding-005 Model](https://ai.google.dev/gemini-api/docs/models/gemini#text-embedding)
- [Collaborative Filtering for Recommendations](https://en.wikipedia.org/wiki/Collaborative_filtering)
- [Anthropic: RAG Best Practices](https://docs.anthropic.com/en/docs/build-with-claude/retrieval-augmented-generation)
