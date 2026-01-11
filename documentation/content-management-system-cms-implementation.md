# Simple CMS Implementation (Implemented Phase 6)

## Overview
The application now includes a "Simple CMS" (Content Management System) that allows Tenants (Agencies) to create generic content pages and manage a blog. This transforms the app from a pure "Listing Engine" into a "Website Builder".

## Data Model

Two new models were added to `prisma/schema.prisma` to support this feature.

### 1. Content Pages
Used for static pages like "About Us", "Sellers Guide", "Privacy Policy".

*   `model ContentPage`
    *   `title`: Page Title.
    *   `slug`: URL identifier (e.g. `about-us`), **unique per Location**.
    *   `content`: Raw HTML string (from Tiptap editor).
    *   `blocks`: JSON structured content blocks.
    *   `headerStyle`: String ("transparent", "solid") override for this page.
    *   `heroImage`: Cloudflare Image URL for transparent header hero background.
    *   `metaTitle`: SEO title (overrides Page Title in browser tab).
    *   `metaDescription`: SEO description for search engine snippets.
    *   `published`: Boolean visibility toggle.

### 2. Home Page Configuration (New Phase 7)
The Home Page is a special "System Page" managed via the same Block Editor UI.
*   **Storage:** Instead of a `ContentPage` row, it updates `SiteConfig.homeSections` and `SiteConfig.heroContent`.
*   **Capabilities:**
    *   **Reorder Sections:** Drag & drop Hero, Featured Properties, Partners, etc.
    *   **Edit Content:** Customize Hero text/images directly.
    *   **System Blocks:** "Featured Properties" are treated as special blocks that inject the live property feed.

### 2. Blog Posts
Used for time-sensitive updates like "Market Analysis Q1" or "New Development Launch".

*   `model BlogPost`
    *   `title`: Post Title.
    *   `slug`: URL identifier.
    *   `excerpt`: Short summary for the index page.
    *   `content`: Raw HTML body.
    *   `coverImage`: Cloudflare Image ID.
    *   `publishedAt`: Date for sorting.
    *   `authorName`: Optional byline.

## Architecture & Implementation Details

### authentication & Multi-Tenancy
*   **Location Resolution**:
    *   We do not rely on Clerk's metadata for `locationId` due to synchronization latency.
    *   Instead, we resolve the `locationId` dynamically on every Server Action by querying the `User` model and including the `locations` relation:
        ```typescript
        const user = await db.user.findUnique({ where: { clerkId: userId }, include: { locations: true } });
        const orgId = user?.locations[0]?.id;
        ```
    *   This ensures actions are always performed against the user's active database location.

### Forms & Error Handling
*   **Hooks**: We use `useFormState` (from `react-dom`) to handle Server Action responses.
    *   *Note*: React 19 builds may warn about `useActionState`, but `useFormState` is the standard for now.
*   **Redirects**: Success actions strictly `redirect` to the list view (`/admin/content/...`) to ensure fresh data fetch and UX continuity.
*   **Validation**: Server Actions validate `userId` and `orgId` before processing.

### Public Site Rendering

*   **Priority Order**:
    1.  **Static Routes**: `/search`, `/property` (handled first).
    2.  **Blog Routes**: `/blog` and `/blog/[slug]` (dedicated namespace).
    3.  **Catch-all Pages**: `/[slug]` (handles `ContentPage` lookups).

*   **Link Generation (Localhost Support)**:
    *   The public site handles local development URLs gracefully by detecting `localhost` in the domain and appending port `3000`.
    *   Logic: `http://test.localhost:3000/...` vs `https://production.com/...`.

*   **Images (Cloudflare)**:
    *   We use the `public` variant for all images by default to ensure immediate availability without requiring custom Cloudflare variants (like `thumbnail`).
    *   URL Pattern: `https://imagedelivery.net/<ACCOUNT_HASH>/<IMAGE_ID>/public`.

### Site Settings (Navigation)
*   **Footer Links**: A new JSON field `footerLinks` was added to `SiteConfig` to manage footer menus independently of the header.
*   **Menu Builder (Drag & Drop)**:
    *   Implemented a drag-and-drop interface (`@dnd-kit`) for the Main Menu, Footer Menu, and Legal Menu.
    *   Supports reordering of both internal page links and custom external URLs.
    *   Robust ID management ensures smooth reordering state, tailored for the simplified JSON storage model.

## Usage Guide

### Creating Content (Admin Side)
1.  Navigate to **Content > Pages** or **Content > Posts**.
2.  Click **Create**.
3.  **Editor**: Write content using the Notion-style Tiptap editor.
4.  **Publish**: Toggle "Publish" to make it visible on the live site.
    *   *Note*: Saving a draft does not publish it.
5.  **View Live**: Once published, click the "External Link" icon in the list view to see the live page.

### Editing Home Page
1.  Navigate to **Content > Pages**.
2.  Click the **Edit** (Pencil) icon on the top "Home Page" row (marked with a *System* badge).
3.  **Blocks**: Add sections (Hero, Features, Text) or reorder the existing ones.
4.  **Save**: Updates are applied globally to the site root `/`.

### Viewing Content (Public Side)
*   **Generic Pages**: Access via `https://[domain]/[slug]` (e.g. `/about-us`).
*   **Blog**: Access via `https://[domain]/blog`.
