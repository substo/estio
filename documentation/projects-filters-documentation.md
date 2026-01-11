# Projects Search & Filter Documentation

This document details the search and filtering capabilities implemented on the **Projects** page (`/admin/projects`).

## Overview
The "Projects" page allows users to filter development projects by name, location, developer, and relation status (linked properties). The implementation follows the URL-based Source of Truth architecture.

## Filter Types

### 1. Text Search (Global)
- **Type**: Input (Text)
- **Functionality**: Filters projects by searching for keywords in major text fields.
- **Fields Searched**:
    - `name` (Project Name)
    - `projectLocation` (Location string)
- **Logic**: 
    - Updates `q` URL parameter (e.g., `?q=Residences`).
    - Backend uses `OR` logic with case-insensitive `contains`.

### 2. Developer Search
- **Type**: Searchable Dropdown (Combobox)
- **Functionality**: Filters projects by selecting from a list of existing developers.
- **Source**: Merged list of:
    - Unique `developer` values from existing `Projects`.
    - `Company` names where type contains 'Developer'.
- **Logic**:
    - Updates `developer` URL parameter (e.g., `?developer=Cybarco`).
    - Backend uses case-insensitive `contains` (or exact match via selection).

### 3. Linked Properties (Relation)
- **Type**: Checkbox (Toggle)
- **Functionality**: Filters projects to show only those that have at least one Property linked to them.
- **Logic**:
    - Updates `hasProperties` URL parameter (e.g., `?hasProperties=true`).
    - Backend uses Prisma relation filter: `properties: { some: {} }`.
    - **Note**: Unchecking the box removes the filter (showing all projects), it does NOT filter for projects *without* properties.

## Database Schema Impact
The `Project` model in `prisma/schema.prisma` supports these filters:
- `name`: `String`
- `projectLocation`: `String?`
- `developer`: `String?`
- `properties`: Relation to `Property` model.

## Implementation Details
- **Page**: `app/(main)/admin/projects/page.tsx`
    - Parses `searchParams`.
    - Calls `listProjects`.
- **Component**: `app/(main)/admin/projects/_components/project-filters.tsx`
    - Client component handling user input.
    - Debounces text input (500ms) to prevent excessive URL updates.
- **Repository**: `lib/projects/repository.ts`
    - `listProjects(params)` builds the dynamic `where` clause.

### Developer Dropdown Technicals
The developer filter uses a `Popover` + `Command` (Combobox) pattern.
- **Data Source**: To ensure users can filter by all relevant developers, the list is populated by fetching:
    1.  All unique `developer` names currently assigned to **Projects**.
    2.  All `Company` records where the type includes "Developer".
    3.  These lists are merged, deduped, and sorted.
- **UI Interaction**: A known issue with `cmdk` inside `Popover` can cause items to appear "disabled" (greyed out) and unselectable. This is resolved by applying the CSS utility `data-[disabled]:pointer-events-auto` and `data-[disabled]:opacity-100` to the `CommandItem` components, ensuring they remain interactive.
