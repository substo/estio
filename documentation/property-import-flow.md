# Property Import Flow Documentation

This document outlines the technical flow for importing properties from Notion into the IDX system and subsequently pushing them to the legacy CRM.

## Overview

The import process is a multi-stage workflow designed to:
1.  **Scrape** property data from a public Notion page.
2.  **Extract** structured data using AI (Gemini Vision).
3.  **Persist** images to Cloudflare Images.
4.  **Create** a draft property record in the database.
5.  **Sync** the property to the legacy CRM via browser automation.

## Tech Stack Compatibility

-   **Admin Editor**: Uses **TipTap** with `@tailwindcss/typography`. Does not support Markdown syntax (e.g., `**bold**`, `- list`) natively for rendering, so valid HTML is required.
-   **Legacy CRM**: Uses **TinyMCE**. Supports HTML input via `setContent()`.
-   **Solution**: The AI Prompt is strictly instructed to return an HTML-formatted description string, ensuring it renders correctly in both systems without conversion layers.

## Architecture

The flow is built using:
-   **Frontend**: Next.js Client Component (`admin/properties/import/page.tsx`) with real-time feedback.
-   **Streaming API**: `app/api/import-stream/route.ts` pushes status updates to the client via Server-Sent Events (SSE) pattern.
-   **Workflow Engine**: Generator-based logic in `lib/crm/import-workflow.ts`.
-   **Puppeteer**: Headless browser for scraping Notion and automating the legacy CRM. Configured with `headless: true` and `--no-sandbox` for stable server execution.
-   **Gemini AI**: Multimodal model (Vision) to parse screenshots and text content into structured JSON.
-   **Cloudflare Images**: Storage and CDN delivery for property media. Images are uploaded via the Images API and served via `imagedelivery.net`.

## Step-by-Step Flow

### 1. User Input (Frontend)
-   **Location**: `/admin/properties/import`
-   **Component**: `ImportPropertyPage`
-   **Actions**: User provides a Notion URL and selects an AI model (e.g., Gemini 1.5 Pro).
-   **Trigger**: Clicking "Scrape & Preview" initiates a fetch request to the streaming API endpoint.

### 2. Streaming Import (Server)
-   **Endpoint**: `/api/import-stream`
-   **Logic**: `runImportWorkflow` generator (in `lib/crm/import-workflow.ts`).

The server yields JSON-formatted status events for each step, which the client consumes to update a progress stepper:

1.  **Scraping Notion**:
    -   Puppeteer visits the Notion URL.
    -   Expands content toggles and scrolls to trigger lazy loading.
    -   Extracts map coordinates (iframe or URL analysis).
    -   **Map Handling**:
        -   **Strict Resolution**: Map URLs are **only** generated if map data is explicitly found on the page (Iframe, Direct URL, or Coordinates).
        -   **Coordinate Extraction**: The AI explicitly extracts `latitude` and `longitude` from text descriptions (e.g. "GPS Coordinates: ...") if no map element is found.
        -   **Coordinate-to-Map**: If only coordinates are found, the system constructs a valid Google Maps URL (`maps.google.com?q=lat,long`) to ensure a short link can be generated.
        -   **Shortening**: Uses Puppeteer to interact with the Google Maps "Share" modal to get a native short link.
        -   Automatically handles Google Consent Screen (clicks "Accept all").
    -   Captures a full-page screenshot and image URLs.
3.  **Map Resolution** (Strict):
    -   **No Fallback Search**: The system **does NOT** perform generic searches (e.g. using the Title) if map data is missing. This prevents "made up" locations.
    -   If no map/coords are found, the Map URL remains "Pending" in the internal notes.
4.  **Image Processing**:
    -   Downloads images from the scraped URLs.
    -   Uploads them to Cloudflare Images for persistence.
5.  **Saving Draft**:
    -   Creates a `Property` record in the database with status `ACTIVE` / `DRAFT`.
    -   Maps all extracted fields and media to the database schema.

### 3. Review & Manual Adjustment (Frontend)
-   The UI updates in real-time as the stream progresses.
-   Upon completion, it displays a comparison of mapped fields vs. raw output.
-   **Edit Property**: The user can click to open the full editor.
    -   **Media Management**: The "Media" tab supports **Drag-and-Drop Image Reordering**. Users can visually rearrange images, and the new order is automatically persisted to the database upon saving.
-   The user is shown a link to the `Draft Property` in the admin editor for manual adjustments.

### 4. Push to Legacy CRM (Optional Step)
-   **Trigger**: User clicks "Upload to CRM".
-   **Function**: `uploadToCrm` (in `actions.ts`)

#### 4a. Automation
1.  **Auth**: Retrieves encrypted CRM credentials from the user profile.
2.  **Login**: Puppeteer logs into the legacy CRM dashboard.
3.  **Form Filling**: Navigates to the "Create Property" page and matches database fields to CRM form inputs (using name/id matching heuristics).
4.  **Media Sync**:
    -   Downloads images from Cloudflare to a temporary local directory.
    -   Uses Puppeteer's file uploader to attach images to the CRM form.
    -   Cleans up temporary files.
5.  **Notes Sync**:
    -   Maps the "Internal Notes" (which includes the original Notion URL and the converted Google Maps URL) to the CRM's "Property Notes" (`owner_notes`) field.
6.  **Status**:
    -   Forces the property status to "Pending" (Value: 2) in the CRM's "Active" dropdown to ensure it's reviewed before going live.

## Key Files
-   `app/(main)/admin/properties/import/page.tsx`: Main UI with progress stepper.
-   `app/api/import-stream/route.ts`: Streaming API endpoint.
-   `lib/crm/import-workflow.ts`: Core generator logic for the import process.
-   `app/(main)/admin/properties/import/actions.ts`: CRM Upload logic.
-   `lib/crm/notion-scraper.ts`: Specific logic for handling Notion's dynamic UI.
-   `lib/crm/crawl4ai-service.ts`: Integration with Python crawler for general sites.
-   `lib/crm/crawler/main.py`: Python script handling headless browser interactions.
-   `lib/crm/puppeteer-service.ts`: Singleton wrapper for browser management.
-   `ai-property-extraction.ts`: Prompt engineering and schema definition for Gemini.

## Advanced Features (New 2025)

### 1. Dynamic Schema Expansion
-   **Challenge**: Different property sites have unique fields (e.g. "Pool Depth", "Renovation Year") not in our standard schema.
-   **Solution**:
    -   **Discovery Mode**: The AI prompt now asks for `other_attributes` (key-value pairs) for any data not matching the core schema.
    -   **Storage**: These are saved into a JSONB `metadata` column on the `Property` model.
    -   **UI**: A "Rocket" section (🚀) in the review table highlights newly discovered fields in yellow.

### 2. Persisted Scrape Rules
-   **Challenge**: The AI might consistently miss a field on a specific site, or a site might require specific interaction.
-   **Solution**: Users can "Refine" an extraction with natural language instructions.
    -   **Save Rule**: If "Save as Rule" is checked, the instruction is saved to the `ScrapeRule` table, keyed by domain/pattern.
    -   **Auto-Apply**: Future scrapes to that domain automatically inject these instructions into the AI prompt ("System Prompt Injection").
    -   **Feedback**: The UI alerts users with a blue banner when persistent rules have been applied.

### 3. Interactive Gallery Scraping (Click & Scrape)
-   **Challenge**: Single Page Apps (like Quasar/Vue) often hide high-res gallery images behind a "View Photos" button or inside a modal dialog that doesn't exist in the initial HTML.
-   **Solution**:
    -   **Interaction Selector**: The `ScrapeRule` model includes an optional `interactionSelector` field (CSS selector).
    -   **Crawler Logic**: If present, the Python crawler (`main.py`) acts as a human:
        1.  Visits the page.
        2.  **Clicks** the specified element.
        3.  **Waits** for the DOM to update (dialog to open).
        4.  **Then** scrapes the HTML.
    -   **Result**: The AI "sees" the full gallery content that was previously hidden.

### 4. Post-Processing Resolution (Image Deduplication)
-   **Challenge**: Scrapers often find multiple variants of the same image (thumbnails, high-res, webp) leading to duplicates (e.g., "5 copies of each photo").
-   **Solution**:
    -   **Global Filter**: A post-processing step (`crawl4ai-service.ts`) runs after all scraping strategies (HTML regex, JSON metadata, Media Objects) have finished.
    -   **Smart Decoding**: Specifically for Cloudfront URLs (Altia), it decodes the Base64 JSON metadata in the URL to identify the unique image Key.
    -   **Dedup Logic**: It groups all variants by Key and retains only the single highest-resolution version.

### 5. Configurable Import Limits
-   **Challenge**: Large properties with 50+ images were creating timeouts or partial imports due to hardcoded safety limits.
-   **Solution**:
    -   **UI Control**: The "Import Property" page now includes a "Max Images" configuration (Default: 50).
    -   **Dynamic Slicing**: This parameter is passed through the streaming API to the workflow engine, allowing users to choose between speed (fewer images) or completeness (unlimited images).

### 6. Troubleshooting Scraper Issues
-   **Error Code 127 (Missing Libraries)**:
    -   If Puppeteer fails with `Code: 127` (loading shared libraries like `libnspr4.so`), it means the server is missing system dependencies.
    -   **Fix**: Run `scripts/fix-puppeteer.sh` on the server. This installs `google-chrome-stable` to pull all required dependencies.
