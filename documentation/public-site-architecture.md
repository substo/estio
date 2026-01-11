
# Public Site Architecture

> **Reference**: See also [Cross-Domain SSO](./cross-domain-sso.md) for Admin White Label architecture.

## Overview
The IDX Public Site is a multi-tenant, server-side rendered (SSR) application built on Next.js App Router. It allows multiple agencies (Tenants) to host their own property listings on custom domains (e.g., `realestate.com`) or subdomains, all served from a single codebase.

**Key Architecture Change (Dec 2025):** The application relies on **Route Groups** to separate the Dashboard logic from the Public Site logic.
*   `app/(main)`: Contains the Dashboard, Admin, and Authentication logic (using GeistSans font).
*   `app/(public-site)`: Dedicated route group for public sites (using Montserrat/Inter fonts).

## Core Concepts

### 1. Dynamic Routing & Multi-Tenancy
The architecture rewrites incoming requests based on the `Host` header to map them to specific tenant configurations.

*   **Route:** `app/(public-site)/[domain]`
*   **Middleware:** Detects the hostname and rewrites the internal URL to include the `[domain]` parameter.
    *   *Note*: The middleware rewrite targets `/[domain]` which Next.js resolves to `app/(public-site)/[domain]` due to the route group.
*   **Data Isolation:** All data fetching (`getSiteConfig`, `getPublicProperties`) allows queries to be scoped strictly to the `locationId` associated with that domain.
    *   **Filtering:** `getPublicProperties` and related functions strictly filter by `publicationStatus: 'PUBLISHED'`.
*   **Independent Layout:** The public site uses its own `layout.tsx` which handles:
    *   **Theming:** Dynamically injects `--primary-brand` CSS variable from `SiteConfig`.
    *   **Typography:** Loads `Montserrat` (Headings) and `Inter` (Body) via `next/font/google`, independent of the main app.
    *   **Public Header:** Implements configurable header styles.
        *   **Global Default:** Set in Site Settings (Transparent/Solid).
        *   **Dynamic Override:** Individual pages can override this style via `HeaderContext`.
    *   **Public Header:** Implements configurable header styles.
        *   **Behaviors:** Transparent headers become solid on scroll.
        *   **Menu Animation:** Supports configurable "Side Drawer" (Vertical) or "Top Dropdown" (Horizontal) animation based on `theme.menuStyle`.
        *   **Standard CTAs:**
            *   **Search Property:** Neutral/Ghost style button for easy access to listings.
            *   **List Your Property:** Primary brand-colored button for lead generation.

### 2. Media Handling (Cloudflare Images)
We utilize Cloudflare Images for performant, resized, and optimized image delivery.

*   **Uploads:** Agents upload high-res images via the Dashboard. These are sent directly to Cloudflare.
*   **Storage:** We store the `cloudflareImageId` in the `PropertyMedia` table.
*   **Delivery:** The frontend requests images via `imagedelivery.net/<hash>/<id>/<variant>`.
    *   **Variants:**
        *   `public`: Standard display (optimized webP/avif).
        *   `social`: Open Graph optimization (1200x630).
        *   `thumbnail`: Small previews.

### 3. Lead Capture Flow
The public site serves as a primary lead generation tool.

1.  **User Inquiry:** Visitor fills out the "Schedule Viewing" form, now located in a **sticky sidebar** on the Property Details page.
2.  **Server Action:** `submitLeadInquiry` validates the input and resolves the Tenant context.
3.  **Deduplication:** The system checks for existing contacts by email *within that Location*.
4.  **Creation/Update:**
    *   **New Contact:** Created with `leadSource="Website Inquiry"`.
    *   **Existing Contact:** Only new info (e.g., phone) is added if missing.
5.  **Role Assignment:** The contact is assigned a **Property Role** ("Interested") for the specific property, logging their message in the notes.

### 4. SEO Infrastructure
The site is designed for automatic search engine indexing.

| Feature | Implementation | Purpose |
| :--- | :--- | :--- |
| **Sitemap** | `[domain]/sitemap.xml` | Lists all static pages and published Property detail URLs. Auto-updates. |
| **Robots.txt** | `[domain]/robots.txt` | Directs crawlers to the correct sitemap. |
| **JSON-LD** | `PropertyDetailPage` Script | Injects `RealEstateListing` schema for Google Rich Snippets (Price, Address, Image). |
| **Metadata** | `generateMetadata` | Dynamic Open Graph/Twitter cards with Cloudflare images. |

### 5. Content Management System (CMS)
The site supports dynamic content pages, system pages, and a blog system.

*   **Generic Pages**: `/[slug]` (e.g. `/about-us`). Renders `ContentPage` models.
    *   **SEO Fields**: `metaTitle` and `metaDescription` allow SEO customization independent of page title.
    *   **Hero Image**: When using Transparent header style, a dedicated `heroImage` field provides the background.
*   **System Pages**: Pre-built pages like `/favorites` and `/properties/search` are configurable via `SiteConfig`.
    *   **Configuration**: `favoritesConfig` and `searchConfig` JSON fields store customization.
    *   **Features**: SEO settings, empty state text, header style, and hero image.
*   **Blog**: `/blog` and `/blog/[slug]`. Renders `BlogPost` models.
*   **Tech**: Content is stored as HTML (via Tiptap Editor) or JSON blocks and rendered using the `tailwindcss-typography` plugin.

### 6. Interactive Features (Client Components)
While the application is primarily Server-Side Rendered (SSR) for SEO and performance, we utilize React Client Components for rich interactivity where necessary.

*   **Property Gallery**: `property-gallery.tsx`
    *   **Purpose**: Replaces static image grids with a dynamic, immersive viewing experience.
    *   **Features/Interactions**: 
        *   **Carousel**: Interactive main image with Next/Prev navigation.
        *   **Thumbnails**: Interactive grid to jump to specific images.
        *   **Keyboard Support**: Arrow keys for navigation.
        *   **Lightbox Mode**: Full-screen overlay with high-res image viewing (`Escape` to close).
    *   **State Management**: Uses local React state (`useState`) for `currentIndex` and `isLightboxOpen`.
    
    *   **Survey Filter**: `survey-filter.tsx`
        *   **Purpose**: "Futuristic" home page search replacing the static bar.
        *   **Features**: Step-by-step wizard, glassmorphism UI, adaptive Framer Motion animations, real-time property counting.

    *   **Advanced Property Search**: `search-filters.tsx`
        *   **Purpose**: Professional filtering interface for the Search Results page (`/properties/search`).
        *   **Features**: Full parity with Admin filters (Locations, Types, Features, Prices), Clean "Site Settings" aesthetic, Collapsible UI, URL-synced state.


### 7. Property Page Layout Standards
To ensure a consistent and optimized user experience, the Property Details page follows a strict content hierarchy:
1.  **Header**: Breadcrumbs, Title, Address, Price, Actions (Save/Share).
2.  **Gallery**: Dynamic `PropertyGallery` component.
3.  **Main Content Column** (Left):
    *   **Key Specs**: Horizontal bar (Beds, Baths, Area, Parking).
    *   **Additional Details**: Vertical grid (Plot, Veranda, Year, Floor).
    *   **Financial & Terms**: Vertical grid (Fees, Deposit, Bills), congruent with Details.
    *   **Description**: Full text description + Key Features list.
    *   **Video**: Embedded video tour (if available).
4.  **Sticky Sidebar** (Right): Lead capture form (`LeadForm`) and value propositions.

## Configuration
The appearance and behavior of the public site are controlled by the `SiteConfig` model in the database, linked to the Location.

*   **Theme:** Colors (`primaryColor`, `secondaryColor`) and Logos (`url`, `lightUrl`, `iconUrl`), `headerStyle`. See [Theming & Branding](./theming-and-branding.md).
*   **Settings:** `minPrice`, `allowedTypes`.
*   **Content:** Hero section text, Navigation links (JSON), `footerBio` (Text), `footerDisclaimer` (Text).
*   **Home Page Structure:** `homeSections` (JSON) defines the order and visibility of sections (Hero, Featured Properties, Trusted Partners, etc.).

### 8. Home Page Rendering
The Home Page (`/`) is no longer static. It is dynamically constructed based on the `SiteConfig.homeSections` array.
*   **Dynamic Blocks:** The `PublicBlockRenderer` iterates through the configured sections.
*   **Hybrid Content:** 
    *   **Managed Blocks:** Hero, Text, CTA (Editable content).
    *   **System Blocks:** Featured Properties, Trusted Partners (Placeholders that trigger strict logic).

### 9. Admin Access on Tenant Domains
Tenant domains support accessing `/admin` for white-label admin functionality.

**Access Control Flow**:
| User State | Behavior |
|------------|----------|
| Signed Out | → Redirect to `/sign-in?redirect_url=/admin` |
| Signed In (Admin) | → Show admin dashboard |
| Signed In (Public User) | → Redirect to `/favorites` (Public Dashboard) |

*   **No SSO Handshake**: Admin access uses tenant sign-in, not cross-domain SSO.
*   **Role Check**: Admin pages verify `verifyUserHasAccessToLocation()` server-side.
*   **See Also**: [Cross-Domain SSO](./cross-domain-sso.md) for `/setup` and other system paths.

### 10. Public User Authentication & Features
*   **Provider**: Clerk is used for public user authentication (Sign In/Sign Up).
*   **UI Integration**: `PublicHeader` conditionally renders "Log In" or "User Button" based on auth state.
*   **Layout**: The public site layout (`app/(public-site)/[domain]/layout.tsx`) is wrapped in `<ClerkProvider>` to support auth components.
*   **Data Link**: Authenticated users are linked to `Contact` records via the `clerkUserId` field.

> [!IMPORTANT]
> **User Experience Requirement**:
> 1. **Direct Sign-In**: Users must sign in directly on the tenant domain (e.g., `downtowncyprus.site/sign-in`), not be redirected to the platform domain (`estio.co`).
> 2. **No Public Redirects**: Anonymous browsing must be seamless (no `isSatellite` redirect loops).
> 3. **Implementation**: Achieved via **"Lazy Satellite Mode"** (see [multi-tenant-auth-email.md](./multi-tenant-auth-email.md)).

#### 10.1 Favorited Properties
Public users can save properties they're interested in.

**Data Model:**
| Field | Model | Type | Purpose |
|-------|-------|------|---------|
| `propertiesInterested` | `Contact` | `String[]` | Array of favorited property IDs |

> **Note**: We do NOT use `ContactPropertyRole` for favorites - that model is for internal CRM relationships (owners, cleaners, etc).

**Implementation Files:**
| File | Purpose |
|------|---------|
| `app/actions/public-user.ts` | Server actions: `toggleFavorite`, `isFavorited`, `getFavorites`, `getFavoriteIds` |
| `app/(public-site)/[domain]/_components/favorite-button.tsx` | Heart button with optimistic UI |
| `app/(public-site)/[domain]/favorites/page.tsx` | Favorites listing page |

**UI Integration:**
- ❤️ Heart icon on property cards and detail pages
- ❤️ Heart icon in header → Links to `/favorites`
- Non-authenticated users redirected to sign-in when clicking

#### 10.2 Saved Searches
Users can save their search filters for quick access.

**Data Model (Contact.requirement* fields):**
| Search Param | Contact Field |
|--------------|---------------|
| `status` | `requirementStatus` ("For Sale", "For Rent") |
| `locations/areas` | `requirementPropertyLocations[]` |
| `types/categories` | `requirementPropertyTypes[]` |
| `bedrooms` | `requirementBedrooms` |
| `minPrice/maxPrice` | `requirementMinPrice`, `requirementMaxPrice` |
| `condition` | `requirementCondition` |
| `features` | `requirementOtherDetails` |

**Implementation Files:**
| File | Purpose |
|------|---------|
| `app/actions/public-user.ts` | `saveSearch`, `getSavedSearch` actions |
| `app/(public-site)/[domain]/properties/search/_components/search-filters.tsx` | "Save Search" button |
| `app/(public-site)/[domain]/properties/search/page.tsx` | `?saved=true` redirect handler |

**User Flow:**
1. User applies filters on search page
2. User clicks "Save Search" button (expanded filters area)
3. Filters stored in `Contact.requirement*` fields
4. User clicks 📑 Bookmark icon in header → Redirects to `/properties/search?saved=true`
5. Page detects `?saved=true`, fetches saved filters, redirects to full filter URL

#### 10.3 Team Member Utilities (Hybrid Mode)
For users who are both **Public Users** (browsing) and **Team Members** (managing), the interface adapts to provide quick access to the backend.

*   **Admin Dashboard Link**: 
    *   **Visibility**: Visible ONLY to users with a valid `UserLocationRole` for the current tenant.
    *   **Implementation**: `layout.tsx` performs a server-side DB check (`verifyUserHasAccessToLocation`) and passes an `isTeamMember` flag to the `PublicHeader`.
    *   **UI**: Displays a "Dashboard" link (LayoutDashboard icon) in the header actions area.
    *   **Purpose**: Allows smooth transition from browsing the public site to managing it.

