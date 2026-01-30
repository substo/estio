# Analysis of 'Pull from Old CRM' Flow

## Overview
The "Pull from Old CRM" feature allows admins to import property details directly from a legacy CRM into the IDX system. This is an on-demand process triggered from the "Edit Property" page, designed to populate the form with data (text, prices, specs) and link related entities (Owners, Projects) automatically.

## Flow Breakdown

### 1. Frontend Trigger
**File:** `app/(main)/admin/properties/_components/property-form.tsx`

*   **Trigger:** A button labeled "Pull from Old CRM" initiates the process via `handlePullFromCrm`.
*   **Input:** The user pastes the URL of the property from the old CRM into a prompt (or it uses a pre-configured ID).
*   **Action:** Calls the server action `pullFromOldCrm(url)`.
*   **Optimistic UI:** Upon success, the form fields are updated immediately without a full page reload, and related entities (projects, owners) are injected into the local state.

### 2. Server Action
**File:** `app/(main)/admin/properties/actions.ts`

*   **Function:** `pullFromOldCrm(url)`
*   **Auth:** Verifies `currentUser` exists.
*   **Delegation:** Calls `pullPropertyFromCrm(url, user)` located in `@/lib/crm/crm-puller`.

### 3. CRM Puller Logic
**File:** `lib/crm/crm-puller.ts`
The core scrapping logic uses Puppeteer to navigate the legacy CRM and extract data.

#### A. Setup & Auth
*   **Credentials:** Uses the same credentials as the Pusher (stored in User settings).
*   **Navigation:** Logs in (if needed) and navigates to the target property URL.

#### B. Scraping & Data Extraction
*   **Selectors:** Uses `CRM_FIELD_MAPPING` (from `field-mapping.ts`) to locate DOM elements.
*   **Traversal:**
    *   **Text Fields:** Extracts `value` or `innerText`.
    *   **Selects/Checkbox:** Maps internal codes (e.g., "0", "1") to human-readable values (e.g., "No", "Yes") using `valueMap`.
    *   **Images:**
        *   Extracts high-resolution image URLs from the gallery tab (`#tab_images`), replacing `_thumb` with `_full`.
        *   **Automatic Cloudflare Upload:** Iterates through these URLs and uploads them server-side to Cloudflare Images.
        *   **Robust Download:** Uses `fetch` with a `User-Agent` header to bypass anti-bot protection on source sites.
        *   **Error Handling:** Failed uploads are gracefully handled - the original URL is preserved as fallback, and a warning is collected.
        *   Returns an array of image objects containing the `cloudflareImageId` and the original `url`.

#### C. Entity Linking (Find or Create)
The system effectively handles related data to ensure integrity and reduce duplicates.

**1. Owners (Contacts)**
*   **Strategy:** "Find or Create" based on hierarchy:
    1.  **Email Match:** Search by extracted Owner Email.
    2.  **Phone Match:** Search by normalized Owner Phone/Mobile.
    3.  **Name Match:** Fallback to exact Name match.
*   **Enrichment:**
    *   If a contact is found, missing details (email, phone, company, notes) are enriched.
    *   **Normalization:** Phone numbers are normalized (spaces/dashes removed) before comparison and saving to ensure consistent matching in the future.
*   **Result:** Returns `ownerContactId` to the frontend.

**2. Projects**
*   **Strategy:** "Find or Create" based on Project Name.
*   **Action:**
    *   **Found:** Links the property to the existing Project ID.
    *   **Not Found:** Creates a new Project (populating Developer if available) and links it.
*   **Result:** Returns `projectId` and the full `project` object to the frontend.

### 4. UI Synchronization (Frontend)
**File:** `property-form.tsx` -> `handlePull`

The frontend receives the scraped data and performs instant updates:

*   **Form Fields:** `setSelectedCategory`, `setSelectedType`, `setDescription`, etc., are updated directly.
*   **Lists:**
    *   **Owners:** The pulled Owner is added to the local `contacts` state (or updated if they exist), ensuring the dropdown displays the new phone number/email immediately.
    *   **Projects:** The pulled Project is added to the `projects` state if new, and automatically selected.

## Key Enhancements

### 1. Robust Phone Normalization
**File:** `lib/crm/crm-puller.ts` & `field-mapping.ts`
*   A `normalizePhone` helper removes all non-numeric characters (except leading `+`).
*   This fixes issues where "123 456" in the CRM wouldn't match "123456" in the DB.

### 2. Generic Value Mapping
**File:** `field-mapping.ts`
*   Introduced `valueMap` to the field mapping configuration.
*   Allows transforming data during the pull, e.g., mapping CRM value `1` to `Yes` for "Viewing Notification".

### 3. Duplicate Prevention & Overwrite
**File:** `app/(main)/admin/properties/actions.ts`
*   **Slug Check:** Before creating a new property, the system checks if a property with the same `slug` (from the CRM URL) already exists.
*   **Overwrite Strategy:** If a duplicate `slug` is found:
    *   The existing property is **updated** instead of creating a duplicate.
    *   **Data Preservation:** Critical manual data is preserved. Specifically, `originalCreatorEmail`, `originalCreatorName`, and the linked `createdById` are merged from the existing record into the new payload. This ensures that if you re-import a property, you don't lose the user linking you've already established.
    *   **Media Reset:** Existing media is wiped and replaced with the fresh import to ensure synchronization with the CRM.

### 4. User Linking & Creator Attribution
**File:** `app/(main)/admin/properties/actions.ts` (`upsertProperty`, `linkPropertyCreator`)
*   **Original Data Storage:** The `Property` model now stores `originalCreatorName`, `originalCreatorEmail`, `originalCreatedAt`, and `originalUpdatedAt` directly.
*   **Auto-Linking Flow:**
    1.  **On Save:** When the property is saved (either new or updated):
        *   The system checks if a `User` exists with the `originalCreatorEmail`.
        *   **If Found:** The property is linked to that user (`createdById`).
        *   **If Not Found:** A **placeholder User** is created using the Name and Email from the CRM (with no password/clerkId). This ensures the property is always linked. The real user can later "claim" this account by signing up with the same email.
*   **UI Controls (`property-form.tsx`):**
    *   **Read-Only Locking:** If a property is successfully linked to a user (`property.creator` exists), the "Original Name" and "Original Email" fields are **locked (disabled)**.
    *   **Editing:** These fields are only editable if the property is unlinked, allowing manual correction of the email to trigger the link on the next save.
    *   The "Save Email" button has been removed in favor of this seamless integration with the main "Save Property" action.

### 5. Improved Navigation
**File:** `property-table.tsx` & `property-edit-dialog.tsx`
*   **Direct Redirect:** Upon successfully saving a property from the "Add Property" dialog (List View), the system now captures the returned Property ID and **redirects the user directly to the View Page** (`/admin/properties/[id]/view`), rather than just closing the dialog or reloading the list.

## Key Files
*   `lib/crm/crm-puller.ts` (Scraping & Linking Logic)
*   `lib/crm/field-mapping.ts` (Selectors & Value Maps)
*   `app/(main)/admin/properties/_components/property-form.tsx` (Trigger & UI Update)
*   `app/(main)/admin/properties/actions.ts` (Upsert, Overwrite & Linking Logic)
*   `components/properties/property-edit-dialog.tsx` (Dialog & Redirect Handling)

## Recent Updates (2025-01)

### 6. Warnings Collection & Toast Notifications
**Files:** `lib/crm/crm-puller.ts`, `property-form.tsx`

*   **Warnings System:** The puller now collects warnings throughout the entire extraction process:
    *   **Field Mapping Failures:** If a property type, location, or condition cannot be mapped to a known value.
    *   **Image Upload Failures:** If an image fails to download or upload to Cloudflare.
*   **Toast Notifications:** Browser `alert()` dialogs are replaced with modern Sonner toast notifications:
    *   **Success:** Green toast with success message.
    *   **With Warnings:** Yellow/orange toast listing all issues encountered.
    *   **Error:** Red toast with error details.
*   **User Experience:** Users now receive actionable feedback about partial import issues without blocking the workflow.

### 7. Corrected Condition Mapping
**File:** `lib/crm/field-mapping.ts`

*   **Issue:** The `CONDITION_MAP` was using text labels as keys, but the old CRM returns numeric IDs.
*   **Fix:** Updated to use CRM numeric IDs as keys:
    ```typescript
    CONDITION_MAP = {
        '0': '',              // n/a
        '1': 'off-plan',      // Off-Plan
        '2': 'under-construction', // Under Development
        '3': 'new',           // New - Ready
        '4': 'resale',        // Resale
    };
    ```
*   **Bidirectional:** The pusher uses a reverse lookup to convert DB values back to CRM IDs.

### 8. Robust Image Upload to Cloudflare
**File:** `lib/crm/crm-puller.ts`

*   **Problem:** Cloudflare's URL-based upload (`uploadUrlToCloudflare`) was blocked by some source sites.
*   **Solution:** Images are now:
    1.  **Downloaded locally** using `fetch` with a browser-like `User-Agent` header.
    2.  **Uploaded as blobs** directly to Cloudflare Images API.
*   **Fallback:** If upload fails, the original URL is preserved, and a warning is collected (not a hard failure).

### 9. Environment Variables for Cloudflare
**Files:** `deploy-direct.sh`, `deploy.sh`, `documentation/deployment-scripts.md`

*   **Required Variables:** The following must be present in deployment scripts:
    ```bash
    CLOUDFLARE_ACCOUNT_ID=...
    CLOUDFLARE_IMAGES_API_TOKEN=...
    NEXT_PUBLIC_CLOUDFLARE_IMAGES_ACCOUNT_HASH=...
    ```
*   **Issue Pattern:** Deployment scripts overwrite server `.env` files. Missing variables would cause "Missing Cloudflare configuration" errors.
*   **Fix:** All Cloudflare variables are now hardcoded in both `deploy-direct.sh` and `deploy.sh`.
