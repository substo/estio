# Property Management Guide

This guide covers the management of properties within the IDX application, including the Property Form interface and developer tools for seeding data.

## Property Form

The Property Form is the primary interface for creating and editing properties. It is organized into tabs to categorize information logically.

### Tabs Overview

1.  **Details**: Core property information.
    *   **Title**: The main listing title.
    *   **Status**: Transactional status (Active, Reserved, Sold, etc.).
    *   **Goal**: Sale or Rent.
    *   **Publication Status**: Visibility (Published, Pending, Draft, Unlisted).
    *   **Category/Type**: Property classification (e.g., Residential -> Apartment).
    *   **Condition**: New or Resale.
    *   **Source**: Origin of the property (e.g., IDX, Agent Name).
    *   **Features**: Multi-select checkboxes grouped by category (e.g., Indoor, Outdoor).
    *   **Sort Order**: Controls display order in lists.
    *   **Featured**: Toggles "Promoted" status.
    *   **Description**: Rich text editor for detailed property descriptions (supports bold, italic, lists, links, etc.).

2.  **Pricing**: Financial details.
    *   **Price**: Listing price.
    *   **Currency**: EUR, USD, GBP.
    *   **Price Type**: For rentals (e.g., /month).
    *   **Communal Fees**: Monthly fees if applicable.

3.  **Location**: Geographic details.
    *   **Address**: Street address.
    *   **District/Region**: Broad area (e.g., Paphos).
    *   **Area/Village**: Specific location (e.g., Peyia).
    *   **Coordinates**: Latitude/Longitude for map placement.

4.  **Specs**: Physical characteristics.
    *   **Bedrooms/Bathrooms**: Counts.
    *   **Covered Area**: Internal size in sqm.
    *   **Plot Area**: Land size in sqm.
    *   **Build Year**: Year of construction.
    *   **Floor**: Floor number (for apartments/offices).

5.  **SEO**: Search engine optimization.
    *   **Slug**: URL path (auto-generated if empty).
    *   **Meta Tags**: Title, Keywords, Description.

6.  **Media**: Images, videos, and documents.
    *   **Images**: Direct upload to Cloudflare. Click "Upload Image" to select files. Optimization is automatic.
    *   **Videos**: One URL per line.
    *   **Documents**: One URL per line.
    *   **Notes**: Internal and administrative details.
        *   **Internal Property Notes**: Private notes.
        *   **Developer / Agent Ref. No URL**: Reference number and URL for the property on external sites (e.g., Bazaraki).
        *   **Roles**: Manage Owner, Agent, and Developer relationships. Select existing Contacts/Companies using searchable dropdowns.
        *   **Project Details**: Project name, unit number.
        *   **Management Company**: Select an existing Management Company from the searchable dropdown or add a new one using the "+" button.
            *   **Filtering**: The dropdown only shows companies with `type="Management"`.
            *   **Quick Add**: Allows creating a new Management Company (Name, Email, Phone, Website) directly from the form.
        *   **Key Holder/Viewings**: Key holder info, occupancy, viewing contact/notes/directions.
        *   **Legal/Financial**: Lawyer, loan details, purchase price, valuation.

### Publication Statuses

*   **Published**: Visible on the public website.
*   **Pending**: Awaiting review (e.g., imported from XML feed).
*   **Draft**: Work in progress, not visible.
*   **Unlisted**: Manually hidden/archived.

---

## GHL Synchronization

The application maintains a two-way relationship with GoHighLevel (GHL) to ensure data consistency, although the primary "Source of Truth" for property data structure is the IDX App.

### Architecture

1.  **App -> GHL (Write)**:
    *   When a property is **Created** or **Updated** in the IDX App, the system automatically pushes these changes to the GHL Custom Object (`custom_object.property`).
    *   This ensures that GHL workflows and automations always have access to the latest property data.
    *   If the sync fails (e.g., API outage), the local change is still saved, and an error is logged.

2.  **GHL -> App (Read/Sync)**:
    *   Currently, the app does **not** automatically pull changes made directly in the GHL UI (unless a webhook is configured, which is future work).
    *   Users should primarily edit properties within the IDX App to ensure data integrity.

3.  **Schema Synchronization**:
    *   As the application evolves, the database schema (Prisma) may change.
    *   A dedicated script (`scripts/sync-ghl-schema.ts`) is available to update the GHL Custom Object definition to match the App's schema.
    *   This ensures that new fields added to the App are available in GHL for use in emails, SMS, and automations.

---

## Developer Tools

### Seeding Mock Data

To populate the database with test properties, use the seeding script. This is useful for testing filters, pagination, and UI layouts.

**Command:**
```bash
npx ts-node scripts/seed-mock-properties.ts
```

**What it does:**
1.  Connects to the database (handles Supabase connection pooling).
2.  Finds an existing `Location` to attach properties to.
3.  Creates 5 varied properties:
    *   Luxury Villa (Peyia)
    *   Modern Apartment (Kato Paphos)
    *   Traditional Bungalow (Chloraka)
    *   Commercial Office (Paphos Town)
    *   Residential Plot (Tala)
4.  Logs the creation status to the console.

### Scraping Test Property

To test real-world data ingestion, you can use the scraping script to fetch a property from an external site.

**Command:**
```bash
npx ts-node scripts/scrape-test-property.ts
```

**What it does:**
1.  Fetches a specific property page from `downtowncyprus.com`.
2.  Parses the HTML using `cheerio`.
3.  Maps the external data to our `Property` schema.
4.  Inserts the property into the database with `source: SCRAPED_TEST`.
