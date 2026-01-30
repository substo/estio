# Navigation Menu System Architecture

## Overview
The Navigation Menu system allows Tenants (Agencies) to customize the links in their public website's header, footer, and legal sections. It supports two types of links:
1.  **System Pages**: Links to internal content pages (e.g., About Us, Properties).
2.  **Custom Links**: External URLs or hardcoded paths.

The system features a **Drag-and-Drop** interface for intuitive reordering.

## Data Model
Menus are stored as JSON arrays within the `SiteConfig` model in the PostgreSQL database. This allows for flexibility without complex relational tables for simple lists.

### Schema (`prisma/schema.prisma`)
```prisma
model SiteConfig {
  // ...
  navLinks       Json?  // Main Header Menu
  footerLinks    Json?  // Footer Menu
  socialLinks    Json?  // Social Media Icons
  legalLinks     Json?  // Bottom Legal Menu
  // ...
}
```

### JSON Structure
The stored JSON structure is clean and minimal. We do **not** store unique IDs in the database to keep the data portable and simple.
```json
[
  { "label": "Home", "href": "/", "type": "custom" },
  { "label": "Search", "href": "/properties/search", "type": "custom" },
  { "label": "About Us", "href": "/about-us", "type": "page" }
]
```

### Public Site Filtering
The public site layout (`app/(public-site)/[domain]/layout.tsx`) automatically filters out any navigation links that are labeled "**Home**" or point to the root path `"/"`.
-   **Reasoning**: The site logo already acts as a home link, making a dedicated "Home" menu item redundant.
-   **Reasoning**: The site logo already acts as a home link, making a dedicated "Home" menu item redundant.
-   **Implementation**: This filtering happens at runtime in the layout component before passing links to the header.

### 4. Hardcoded Call-to-Actions (CTAs)
While the navigation menu is fully configurable, the Public Header includes two permanent, hardcoded buttons to drive core business goals:
1.  **Search Property**: A neutral/outline button providing immediate access to the listings search page (`/properties/search`).
2.  **List Your Property**: A primary-colored button focusing on seller acquisition.

These buttons appear to the right of the dynamic navigation links (or below them on mobile) and are **not** controlled by the Menu Builder.

## Frontend Architecture

### Component: `MenuBuilder`
Located at: `app/(main)/admin/site-settings/navigation/_components/menu-builder.tsx`

This shared component manages the UI for all menu types. It handles:
- **Adding/Removing Items**: Simple array manipulation.
- **Editing Items**: Inputs for Label and URL/Page Selection.
- **Type Toggling**: Switching between "Page Select" (SearchableSelect) and "Custom URL" (Input).
- **Reordering**: Drag-and-drop functionality.

### Drag-and-Drop Implementation (`@dnd-kit`)
We use `@dnd-kit` for its headless, accessible, and robust drag-and-drop primitives.

#### The ID Challenge
`@dnd-kit` requires every sortable item to have a stable, unique `id`. However, our database schema (JSON array) does not persist IDs.

#### The Solution: Hydration Strategy
1.  **On Mount**: The component receives the raw JSON array. It maps over this array and assigns a temporary client-side `id` (random string) to each item.
    ```typescript
    useEffect(() => {
        const linksWithIds = initialLinks.map(link => ({
            ...link,
            id: Math.random().toString(36).substr(2, 9)
        }));
        setLinks(linksWithIds);
    }, [initialLinks]);
    ```
2.  **During Drag**: The state (with IDs) is reordered using `arrayMove` from `@dnd-kit/sortable`.
3.  **On Save**: The IDs are stripped from the payload before sending it to the server.
    ```typescript
    const cleanLinks = links.map(({ id, ...rest }) => rest);
    await saveNavigation(type, cleanLinks);
    ```

## Backend Architecture

### Server Action: `saveNavigation`
Located at: `app/(main)/admin/site-settings/navigation/actions.ts`

1.  **Authentication**: Verifies the current user and resolves their `locationId`.
2.  **Validation**: Ensures the user belongs to the location they are trying to update.
3.  **Update**: Performs a `db.siteConfig.update` with the cleaned JSON array.
4.  **Revalidation**: Crucially, it calls `revalidatePath("/admin/site-settings/navigation")` to ensure the UI updates immediately.

### Forms & Persistence
- **Site Settings Form**: For the main settings page (`/admin/site-settings`), which also includes a menu editor, we manually serialize the links to a hidden JSON input (`navLinksJson`) to pass them through the standard `FormData` submission flow.
- **Navigation Page**: For the dedicated navigation page (`/admin/site-settings/navigation`), we use direct client-side calls to the `saveNavigation` server action for a smoother experience.

### Menu Style Configuration
The system allows admins to choose the animation style for the mobile/tablet navigation menu.
- **Side Drawer (Default)**: Vertical list sliding in from the right.
- **Top Dropdown**: Horizontal navbar sliding down from the top, featuring dropdowns for sub-categories.

**Implementation**:
- **Selector**: `MenuStyleSelector` component in `app/(main)/admin/site-settings/navigation/_components/menu-style-selector.tsx`.
- **Storage**: `SiteConfig.theme.menuStyle` ("side" | "top").
- **Components**:
    - **Side**: Standard vertical list.
    - **Top**: Uses Shadcn `NavigationMenu` for horizontal layout with hover-triggered dropdowns.
- **Action**: `saveNavigationStyle` updates this specific field within the JSON object.

### Responsive Behavior (Mobile vs Desktop)

Updates to `configuration` now enforcing Mobile-First best practices:

1.  **Desktop**: Respects the "Header Menu Style" setting ("Side Drawer" or "Top Dropdown").
    -   *Note*: The hardcoded "Search" and "List Your Property" buttons are **hidden** inside the hamburger menu on Desktop to avoid redundancy with the main header.
2.  **Mobile (< 768px)**: **Always forces** the "Side Drawer" (Vertical List) style.
    -   The "Top Dropdown" style is disabled on mobile to prevent broken horizontal layouts.
    -   The "Search" and "List Your Property" buttons are **visible** inside the menu on Mobile (since they are hidden from the main header).
    -   "Log In" and "User Profile" links are integrated into the main navigation list for a unified scrollable view.

## usage
This system is used in:
- **Site Settings**: `/admin/site-settings` (Main Menu only)
- **Advanced Navigation**: `/admin/site-settings/navigation` (All Menus)
