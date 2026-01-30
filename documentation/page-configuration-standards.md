# Page Configuration & Customization Guide

This document serves as a comprehensive guide for all page types within the application. It outlines **Universal Standards** that apply to every page for consistency, as well as specific configuration options for System Pages and Custom Content.

## Universal Page Standards

To ensure a cohesive user experience and proper SEO, the following elements should be considered for **every** page type, whether it is a system page, a custom content page, or a blog post.

### 1. Identity & Routing
- **Page Title**: The internal or public-facing heading (e.g., "About Us", "My Favorites").
- **Slug**: The URL path segment (e.g., `/about-us`). *Must be unique.*

### 2. Header & Visuals
All pages support two header styles to match the content design:
- **Solid Style** (Default):
    - Opaque background (White/Dark).
    - Best for functional pages or text-heavy content.
- **Transparent Style**:
    - Overlays the content.
    - **CRITICAL**: Must be paired with a **Hero Image** or dark top section to ensure navigation visibility.

### 3. Hero Image (Universal)
> [!IMPORTANT]
> The **Hero Image** is a **universal option** and should be configurable on **all page types** when the Header Style is set to "Transparent."

- **Purpose**: Provides a visual background for the page header area.
- **Dependency**: Required when `Header Style = Transparent`. Without it, the navigation links may be invisible against the page content.
- **Implementation**: Stored as a Cloudflare Image ID or a full URL.

---

## Page Types & Customization Options

### 1. System Pages (Core Features)
These are built-in application pages that cannot be deleted. They are managed via `Admin > Content > Pages`.

| Page | Configurable Elements | unique Features |
| :--- | :--- | :--- |
| **Home** | Sections, Hero Content | Block-based reordering (Hero, Featured, Partners). |
| **Search** | Header, Hero, SEO, Empty State | Custom "No Results" text. |
| **Favorites**| Header, Hero, SEO, Empty State | Custom "No Favorites" text. |

**Specific Fields**:
- **SEO Settings**: Dedicated `Meta Title` and `Meta Description` fields to override defaults.
- **Empty State**: Custom text (`Title`, `Body`) displayed when lists are empty.

### 2. Custom Content Pages (Static Pages)
Created by admins for informational content (e.g., "About Us", "Contact", "Sellers Guide").
- **Management**: `Admin > Content > Pages`.
- **Content Mode**: Currently uses a rich-text HTML editor or Block interactions.
- **Header Style**: Configurable (Solid/Transparent).
- **SEO**: Currently uses the `Page Title` for the `<title>` tag. *Future: Add dedicated meta fields.*

### 3. Blog Posts
News and updates.
- **Management**: `Admin > Content > Posts`.
- **Visuals**: Requires a **Cover Image** (Cloudflare ID or URL) which acts as the Hero image.
- **Header**: Automatically handled based on the post layout (typically transparent over cover image).
- **Metadata**: Published Date and Author.

---

## Configuration Reference Matrix

| Feature | System Pages | Content Pages | Blog Posts |
| :--- | :--- | :--- | :--- |
| **Page Title** | ✅ | ✅ | ✅ |
| **URL Slug** | ❌ (Fixed) | ✅ | ✅ |
| **Header Style** | ✅ (Solid/Transparent) | ✅ | 🔄 (Auto) |
| **Hero Image** | ✅ | ✅ | ✅ (Cover) |
| **Meta Title** | ✅ | ✅ | ❌ (Uses Title) |
| **Meta Desc** | ✅ | ✅ | ❌ (Excerpt) |
| **Empty State** | ✅ | N/A | N/A |

