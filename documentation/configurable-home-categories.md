# Configurable Home Categories Implementation

## Overview
This document details the implementation of the configurable "Categories" section ("What are you looking for?") on the public home page. This feature allows administrators to customize the category tiles via the Admin UI, replacing the previously hardcoded structure.

## Technical Implementation

### 1. Data Model (`SiteConfig`)
No schema changes were required. The configuration is stored within the existing `homeSections` JSON field in the `SiteConfig` model.
- **Block Type**: `categories`
- **Structure**:
  ```json
  {
    "type": "categories",
    "title": "What are you looking for?",
    "items": [
      {
        "title": "New Build Villas",
        "image": "https://...",
        "filter": { "type": "villa", "condition": "New Build", "status": "sale" }
      }
    ]
  }
  ```

### 2. Admin Interface
**File**: `app/(main)/admin/content/pages/_components/block-editor.tsx`

A new block editor component was added for the `categories` type.
- **Load Defaults Button**: A convenience feature that populates the editor with the standard 7 categories if the list is empty. This ensures users have a good starting point (New Villas, Resale Villas, etc.) without manually configuring each one.
- **Form Submission Fix**: Buttons causing state updates (Add/Remove items) are explicitly set to `type="button"` to prevent accidental form submission.

### 3. Data Layer
**File**: `lib/public-data.ts`

The `getCategoryCounts` function was refactored to support dynamic configuration:
- **Input**: Accepts an optional `CategoryBlockConfig`.
- **Logic**:
  - If a configuration is present, it iterates through the `items` and fetches counts based on the configured `filter` (Type, Condition, Status).
  - It supports compound type matching for legacy categories:
    - **Commercial**: Matches 'Office', 'Shop', 'Commercial', 'Warehouse'.
    - **Land**: Matches 'Land', 'Plot', 'Field'.
  - **Fallback**: If no configuration is provided, it defaults to the original hardcoded 7 items for backward compatibility.

### 4. Public Site Rendering
**File**: `app/(public-site)/_components/categories-section.tsx`

The component handles the rendering of the category grid using a **Creative Dynamic Layout**.

#### Layout Logic (Strict 2/3 Constraint)
To effectively display variable numbers of tiles while maintaining a premium aesthetic, we implemented a custom Flexbox layout logic that strictly adheres to a "maximum 3 items per row" constraint.

- **7 Items (Default)**: Uses a creative **2-3-2** pattern for visual interest:
  - **Row 1**: 2 Items [40% width] - [60% width]
  - **Row 2**: 3 Items [25% width] - [50% width] - [25% width]
  - **Row 3**: 2 Items [60% width] - [40% width]
- **4, 8 Items**: Renders as homogeneous rows of 2 (50% each) to avoid "orphan" tiles.
- **3, 6 Items**: Renders as uniform rows of 3 (33% each).
- **1, 2 Items**: Centered with appropriate max-widths.

## Usage Guide
1.  Navigate to **Admin > Content > Home Page**.
2.  Add a **Categories** block (if not present).
3.  Click **"Load Defaults"** to populate the standard tiles.
4.  Edit titles, images, or filters for individual tiles.
5.  Reorder tiles using the Up/Down arrows.
6.  Save changes.
