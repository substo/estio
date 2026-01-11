# Public Site Media, Lead Capture & SEO Implementation

**Focus:** Public Site Media Optimization, Lead Capture, and SEO Automation.

## Summary of Changes

This update introduces a robust public-facing infrastructure powered by Next.js App Router, Cloudflare Images, and automated SEO.

### 1. Cloudflare Images Integration (Phase 4)
We replaced the legacy "Image URL string" approach with a direct-upload integration for Cloudflare Images.

*   **Direct Uploads:**
    *   Implemented `CloudflareImageUploader` component that requests a secure one-time upload URL (`/api/images/direct-upload`).
    *   Files upload directly from the browser to Cloudflare (bypassing our server).
*   **Schema Update:**
    *   Added `cloudflareImageId` to the `PropertyMedia` model.
*   **Optimization:**
    *   Created `CloudflareImage` component to render optimized, resized images (`webP`, `avif`) via `imagedelivery.net`.
    *   Updated `getImageDeliveryUrl` helper to use `NEXT_PUBLIC_CLOUDFLARE_IMAGES_ACCOUNT_HASH`.

### 2. Lead Capture & Media Optimization (Phase 5)
Enhancements to the public property details page to capture leads and serve optimized media.

*   **Lead Capture:**
    *   **Form:** Created `LeadForm` client component embedded in the **sticky sidebar**.
    *   **Action:** Created `submitLeadInquiry` server action.
    *   **Data Flow:** Submissions create/update a `Contact` record with:
        *   `leadSource`: "Website Inquiry"
        *   `status`: "New"
        *   `role`: "Interested" linked to the specific Property.
*   **Public Field Exposure:**
    *   **Expanded Specs**: Added Plot Area, Covered/Uncovered Veranda, Basement, Build Year, and Floor.
    *   **Financial Details**: Exposed Communal Fees, Deposit Terms, and Bill Transferability status.
    *   **Layout**: Reordered content to prioritize Specs & Financials above the text description.
*   **Media Display:**
    *   Updated `getPublicPropertyBySlug` to return full media objects.
    *   **Property Gallery:** Enhanced with client-side interactivity (`PropertyGallery` component), featuring:
        *   **Carousel:** Navigation via buttons and keyboard.
        *   **Lightbox Mode:** Full-screen immersive viewing with keyboard support.
        *   **Layout:** Large "Main Image" with interactive thumbnails.
    *   **Priority:** Components prioritize `cloudflareImageId` for fast loading, falling back to legacy URLs if needed.
    *   **Security:** `getPublicPropertyBySlug` and `getPublicProperties` now enforce strict `publicationStatus: 'PUBLISHED'` filtering to prevent access to Draft/Pending listings.

### 3. SEO Automation (Phase 6)
Implemented a "Zero-Touch" SEO infrastructure that updates automatically as properties are published.

*   **Dynamic Sitemap:**
    *   Created `app/(public-site)/[domain]/sitemap.ts`.
    *   Automatically lists the Home page, Search page, and all `PUBLISHED` properties for the specific tenant domain.
*   **Dynamic Robots.txt:**
    *   Created `app/(public-site)/[domain]/robots.ts` to point crawlers to the correct sitemap.
*   **Structured Data (JSON-LD):**
    *   Injected `RealEstateListing` schema.org object into the Property Details page head.
    *   Google can now index price, address, and images as rich results.
*   **Open Graph Tags:**
    *   Updated `generateMetadata` to use Cloudflare-hosted social cards for Facebook/WhatsApp sharing.

## Key Files Created/Modified

*   `app/(public-site)/actions.ts` (Lead Capture)
*   `app/(public-site)/[domain]/sitemap.ts` (SEO)
*   `lib/cloudflareImages.ts` (Media)
*   `components/media/CloudflareImageUploader.tsx` (Uploads)
*   `prisma/schema.prisma` (Schema)
