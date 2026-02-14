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
