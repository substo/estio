# Theming & Branding

Estio allows agencies (Tenants) to fully customize the look and feel of their public site and dashboard. This configuration is stored in the `SiteConfig` model under the `theme` JSON field.

## 1. Logo System (Dual Logo Support)

To support both **Light Mode** (White backgrounds) and **Dark Mode** (Dark backgrounds), as well as transparent headers, the system requires two distinct logo variations.

### Configuration Fields
The `theme.logo` object contains the following fields:

*   **`url` (Main Logo)**:
    *   **Usage**: Used on **Light Backgrounds**.
    *   **Contexts**: Light Mode Admin Dashboard, Scrolled Public Header (White), Printed Documents.
    *   **Visual Style**: Should have **Dark Text** (e.g., Black or Dark Blue) and a transparent background.
    *   **Format**: Transparent PNG or SVG.

*   **`lightUrl` (Alternative / Dark Mode Logo)**:
    *   **Usage**: Used on **Dark Backgrounds**.
    *   **Contexts**: Dark Mode Admin Dashboard, Transparent Public Header (over Hero Images), Dark Mode Public Site.
    *   **Visual Style**: Should have **White Text** and a transparent background.
    *   **Format**: Transparent PNG or SVG.

### Implementation Logic
The application automatically switches between these two URLs based on the context:

1.  **Public Header (`PublicHeader.tsx`)**:
    *   **Transparent State** (Top of page): Uses `lightUrl` (White Text) to contrast against the dark overlay of the hero image.
    *   **Scrolled State** (White Background): Uses `url` (Dark Text).
    *   **Dark Mode**: Uses `lightUrl` (White Text).

2.  **Admin Sidebar (`DashboardSideBar.tsx`)**:
    *   **Light Mode**: Uses `url` (Dark Text).
    *   **Dark Mode**: Uses `lightUrl` (White Text).

3.  **Main Marketing Site (`NavBar.tsx`)**:
    *   Follows the same logic as the Admin Sidebar.

> **Note**: Both logos are rendered with `height: 48px` (Size: Large) to ensure visual consistency across the platform.

### Brand Icon / Favicon (`iconUrl`)
In addition to the main logo, the system supports a square **Brand Icon**.
*   **Usage**:
    *   **Browser Favicon**: Used as the site's tab icon (`/favicon.ico`).
    *   **Public Site Fallback**: Displayed in the Header and Footer alongside the "Brand Name" text if **NO** main logo image is provided.
    *   **Visual Style**: Should be a recognizable square symbol or monogram.

### Footer Branding
The Footer follows a prioritization logic similar to the Header:
1.  **Image Logo**: If a `lightUrl` (or `url`) is present, it is displayed. The system prefers `lightUrl` for contrast against colored footer backgrounds.
2.  **Icon + Text Fallback**: If no logo image is found, the system displays the **Brand Icon** (without background wrapper) alongside the **Brand Name** and **Tagline** text.

### Footer Bio
The text appearing below the logo in the footer is customizable via **Admin > Site Settings > Navigation**.
*   **Field**: `footerBio` (SiteConfig).
*   **Default**: "Your trusted partner in real estate. We bring professionalism and local expertise to every transaction."
*   **Style**: Renders with `whitespace-pre-wrap` to preserve line breaks.

## 2. Cloudflare Image Integration

All logos are hosted on **Cloudflare Images** for performance and optimization.

*   **Upload Process**: When a user uploads a logo via the Admin Panel (`/admin/site-settings`), the file is sent directly to Cloudflare via the API.
*   **Storage**: We store the optimized Cloudflare URL (e.g., `https://imagedelivery.net/.../public`) in the database.
*   **Transparency**: Cloudflare preserves PNG transparency, which is critical for the header overlay effects.

## 3. Header Styling

The system supports configurable header styles, allowing agencies to choose how the navigation bar interacts with the page content.

### Global Configuration
Configured in **Admin > Site Settings > Header Configuration**, stored in `SiteConfig.theme.headerStyle`.

*   **Transparent (Overlay)**:
    *   **Default Behavior**: The header background is transparent, overlaying the hero image or top content.
    *   **Scroll Behavior**: Becomes solid (White/Dark) when the user scrolls down.
    *   **Best For**: Sites with high-quality hero images.

*   **Solid (Background)**:
    *   **Default Behavior**: The header has a solid background color (White/Dark) at all times.
    *   **Best For**: Minimalist designs or pages without hero images to avoid text contrast issues.

### Per-Page Overrides
Individual pages can override the global setting via the **Page Editor**. This is stored in `ContentPage.headerStyle`.

*   **Default**: Inherits the Global setting.
*   **Transparent**: Forces transparent overlay for this specific page.
*   **Solid**: Forces solid background for this specific page (useful for content-heavy pages like "Contact Us" or "Privacy Policy").

### Hero Background Image
When a page uses **Transparent** header style, a **Hero Background Image** is required for proper contrast.

*   **Configuration**: Available in Page Editor, Favorites Page Editor, and Search Page Editor.
*   **Selection**: Uses the `MediaGalleryDialog` component which allows users to:
    *   Browse previously uploaded images.
    *   Upload new images directly.
    *   See a thumbnail preview of the selected image.
*   **Storage**: Stored as a full Cloudflare Image URL in `ContentPage.heroImage` or `SiteConfig.favoritesConfig.heroImage` / `SiteConfig.searchConfig.heroImage`.

### Button Styling
The header buttons adapt to the header state to ensure contrast and hierarchy:
*   **Primary CTA ("List Your Property")**: Uses the Tenant's `primaryColor` (Solid background when scrolled; White background or Primary Text when transparent).
*   **Secondary CTA ("Search Properties")**: Uses Neutral/Outline styling (Gray border/text when scrolled; White border/text when transparent) to maintain visual hierarchy without clashing with custom brand colors.

## 4. Voice & Tone (Naming Conventions)

To ensure a congruent, professional, and consistent experience across usage contexts, we adhere to the following naming conventions for key UI elements:

### Action Buttons
*   **Search**: Use **"Search Properties"** (Plural). Avoid "Search Property" or "Search".
*   **Acquisition**: Use **"List Your Property"** (Personalized). This is a strong, direct Call to Action for potential sellers.

### User Menu Items
All user-specific sections should use the **"My [Item]"** convention to denote ownership and a personalized space.

*   **Favorites**: Use **"My Favorites"**. Avoid "View Favorites".
*   **Submissions**: Use **"My Submissions"**.
*   **Account**: Use **"My Account"**.

## 5. Color System

The system uses CSS Variables with HSL (Hue, Saturation, Lightness) values to support Tailwind's opacity modifiers and dynamic theming.

*   `primaryColor` (Hex): The main brand color. Converted to `--primary`, `--ring`, and `--input`.
*   `primaryColor` (Hex): The main brand color. Converted to `--primary`, `--ring`, and `--input`.
*   `secondaryColor` (Hex): Used for backgrounds, cards, and subtle elements.
*   `accentColor` (Hex): Used for large hero areas or decorative accents.
*   `backgroundColor` (Hex): Custom page background color.
*   `textColor` (Hex): Main text color.

### Dynamic Injection
The `layout.tsx` (for public sites) injects these variables into the `:root` scope at runtime:
```css
:root {
    --primary: [HSL Value];
    --primary-foreground: [Contrast Color];
    /* ... */
}
```
This ensures that all Shadcn UI components (Buttons, Inputs, Badges) automatically inherit the brand color without code changes.

## 6. Typography

*   **Headings**: `Montserrat` (Google Fonts).
*   **Body**: `Inter` (Google Fonts).
*   **Dashboard**: `GeistSans` (Vercel).

## 7. Google Authentication Branding

To comply with Google's OAuth Verification policies, the application's branding must be visually consistent across all surfaces.

### Requirements for "Verified" Status
If you receive the error *"Your branding is not being shown to users"*, it is likely due to a mismatch between:
1.  **The Consent Screen Logo**: The 120x120px square logo uploaded to Google Cloud Console.
2.  **The Application Homepage**: The logo displayed on the homepage header.
3.  **The Site Favicon**: The icon displayed in the browser tab.

### Solution
Ensuring consistency involves:
*   **Favicon**: The `app/favicon.ico` (or `app/icon.png`) MUST match the square logo uploaded to Google.
    *   *Note*: Estio uses Next.js `icon.png` convention for automatically generated favicons.
*   **Homepage Logo**: The logo in the `NavBar` (top left) should clearly match the brand name ("App Name") configured in Google Cloud.

> **Tip**: If verification fails, verify that your "App Name" in Google Cloud matches the text in your Homepage Title and Footer.
