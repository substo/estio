# Analysis of 'Push to Old CRM' Flow

## Overview
The "Push to Old CRM" feature allows admins to push property data from the IDX system to an external legacy CRM. The process acts as a one-way sync triggered manually from the "Edit Property" page.

## Flow Breakdown

### 1. Frontend Trigger
**File:** `app/(main)/admin/properties/_components/property-form.tsx`

*   **Trigger:** A button labeled "Push to Old CRM" calls the `handlePushToCrm` function.
*   **Pre-requisites:** The property must be saved first (has a valid database ID).
*   **Action:** Calls the server action `pushToOldCrm(property.id)`.
*   **Note:** The client-side `confirm()` dialog was removed to prevent browser blocking issues.

### 2. Server Action
**File:** `app/(main)/admin/properties/actions.ts`

*   **Function:** `pushToOldCrm(propertyId)`
*   **Auth:** Verifies `currentUser` exists.
*   **Delegation:** Calls `pushPropertyToCrm(propertyId, user.id)` located in `@/lib/crm/crm-pusher`.

### 3. CRM Pusher Logic
**File:** `lib/crm/crm-pusher.ts`
The core logic resides here and uses Puppeteer to automate the external CRM interface.

#### A. Setup & Auth
*   **Data Fetching:** Fetches the property (including media) and the user record from the database.
*   **Credentials:** Extracts CRM credentials (`crmUrl`, `crmUsername`, `crmPassword`) from the user record.
*   **Login:** Initializes Puppeteer (via `PuppeteerService`), navigates to the CRM login page, and logs in.

#### B. Navigation & Field Filling
*   **Create Page:** Auto-detects the "Add Property" / "Create" link or constructs the URL.
*   **Mapping:** Iterates through `CRM_FIELD_MAPPING` (defined in `field-mapping.ts`) to map IDX fields to CRM form selectors.
    *   Handles basic inputs (text, select, textarea).
    *   Handles specific component logic (TinyMCE editor for description).
    *   Handles complex widgets (Chosen.js selects, Checkbox groups for features).
    *   **Safe Mode:** Explicitly skips the `#tab_publish` tab to prevent automatic publishing, leaving the property in a draft state for manual review.
*   **Optimization:** Skips fields that are `undefined`, `null`, or empty strings to keep the form clean.

#### C. Image Upload Process
This area was significantly enhanced for robustness.

*   **Tab Switch:** Clicks the "Images" tab (`a[href="#tab_images"]`).
*   **Filtering:** Selects property media items where `kind === 'IMAGE'`.
*   **Download:**
    *   Iterates through each image URL.
    *   Downloads the image stream to a unique temporary local directory (`os.tmpdir() + '/idx_crm_{random}'`).
    *   **Naming convention:** `prop_{propertyId}_{imageId}.jpg`.
*   **Upload (Simulated User Interaction):**
    *   **Interception:** Sets up a `waitForFileChooser` listener to catch the OS file dialog.
    *   **Trigger:** Simulates a user click on the dropzone area (targets `#mydropzone`, `.dz-message`, or `.dropzone`).
    *   **Selection:** Automatically inputs the downloaded file paths into the intercepted chooser.
    *   **Cleanup:** A `finally` block ensures the temporary directory and images are deleted after the attempt.

## Recent Enhancements & Fixes
The following improvements were implemented to stabilize the flow:

### 1. Robust Puppeteer Singleton
**File:** `lib/crm/puppeteer-service.ts`
*   Modified the Singleton pattern to check `browser.isConnected()`.
*   If the browser was closed manually or crashed, the service now detects the disconnection and launches a fresh instance automatically, preventing "Browser doesn't start" errors.

### 2. Comprehensive Payload Logging
**File:** `lib/crm/crm-pusher.ts`
*   Added a "CRM PUSH DATASHEET" log block.
*   Outputs a pure JSON representation of the final data payload (after all transforms) before interacting with the page.
*   Allows debugging of data issues without watching the browser execution.

### 3. Image Conversion
*   Logic is in place to convert images to JPEG format (currently using standard download, customizable to use `sharp` if needed).

## Key Files
*   `app/(main)/admin/properties/_components/property-form.tsx` (UI)
*   `app/(main)/admin/properties/actions.ts` (Server Entry)
*   `lib/crm/crm-pusher.ts` (Core Logic)
*   `lib/crm/field-mapping.ts` (Field Definitions)
*   `lib/crm/puppeteer-service.ts` (Browser Control)
