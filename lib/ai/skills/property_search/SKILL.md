---
name: property_search
description: Use this skill when the intent is to find properties, check inventory, or recommend listings to a lead.
tools:
  - search_properties
  - log_activity
---

# Skill: Property Search

## Purpose
Match the lead's requirements with available properties in the database.

## Instructions
1.  **Check Requirements**:
    - Ensure you have a clear Budget and District.
    - If not, *stop* and suggest switching to `lead_qualification`.

2.  **Search**:
    - Call `search_properties`.
    - Use strict filters for Price (always respect max budget).
    - Use fuzzy matching for Location if specific district returns 0 results.

3.  **Present Results**:
    - If properties are found, summarize them (Title, Price, Location).
    - **Critical**: Always include the internal `id` or `reference` so the user can take action (like booking a viewing).

## Tools
- `search_properties(district?, minPrice?, maxPrice?, bedrooms?, status?)`
