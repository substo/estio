# GHL Projects Custom Object Integration

## Overview
This document details the complete integration of the **"Projects"** Custom Object between GoHighLevel (GHL) and the IDX Application. It covers the object structure, database schema, scripts for setup and maintenance, and the robust two-way synchronization architecture.

## 1. Architecture: Two-Way Synchronization

We implemented a **Two-Way Sync** mechanism to ensure data consistency between the local application and GHL.

### A. Outbound Sync (App -> GHL)
- **Trigger**: When a Project is created or updated in the IDX App.
- **Logic**: The `upsertProject` function in `lib/projects/repository.ts` saves the change to the local database and immediately calls `syncProjectToGHL` to push the data to GHL via API.
- **Loop Prevention**: If the update originated from a GHL Webhook (source=`GHL_WEBHOOK`), the outbound sync is skipped.

### B. Inbound Sync (GHL -> App)
- **Trigger**: When a Project is created or updated in the GoHighLevel UI.
- **Mechanism**: GHL Webhooks (`CustomObjectCreated`, `CustomObjectUpdated`).
- **Handler**: `app/api/webhooks/ghl/route.ts` receives the payload, verifies the signature (optional but recommended), and updates the local database.
- **Loop Prevention**: The handler explicitly sets the `source` field to `GHL_WEBHOOK` when saving to the DB, which prevents the Outbound Sync from firing back.

---

## 2. GHL Custom Object Structure

### Object Definition
- **Name**: Projects
- **API Key**: `custom_objects.project`
- **Description**: Real estate development projects.

### Custom Fields
| Field Label | Field Key (Suffix) | Data Type | Description |
| :--- | :--- | :--- | :--- |
| **Name** | `name` | TEXT | Primary Display Property. |
| **Description** | `description` | LARGE_TEXT | Project details. |
| **Developer** | `developer` | TEXT | Developer name. |
| **Completion Date** | `completion_date` | DATE | Completion date. |
| **Total Units** | `total_units` | NUMERICAL | Number of units. |
| **Features** | `features` | MULTIPLE_OPTIONS | Amenities (Pool, Gym, etc.). |
| **Location** | `location` | TEXT | Area/Location name. |
| **Website** | `website` | TEXT | Project URL. |
| **Brochure** | `brochure` | FILE_UPLOAD | PDF Brochure. |

> **Note**: Full keys are `custom_objects.project.<suffix>`.

---

## 3. Database Schema (Prisma)

### Project Model
```prisma
model Project {
  id              String    @id @default(cuid())
  // ... timestamps
  locationId      String
  
  // Mapped Fields
  name            String
  description     String?
  developer       String?
  completionDate  DateTime?
  totalUnits      Int?
  features        String[]  @default([])
  projectLocation String?
  website         String?
  brochure        String?
  
  // Sync Control
  source          String    @default("IDX") // IDX, GHL, GHL_WEBHOOK
  ghlProjectId    String?   @unique

  // Relations
  location        Location  @relation(fields: [locationId], references: [id])
  properties      Property[]
}
```

---

## 4. Scripts & Tools

### A. Setup Script: `scripts/create-ghl-project-object.ts`
**Purpose**: Idempotent script to initialize the Custom Object and its fields in GHL.
**Usage**:
```bash
npx tsx scripts/create-ghl-project-object.ts
```
**What it does**:
1. Checks if `custom_objects.project` exists.
2. Creates it if missing.
3. Iterates through defined fields and creates any that are missing.

### B. Bulk Sync Script: `scripts/sync-ghl-projects.ts`
**Purpose**: Manual or scheduled bulk fetch of all projects from GHL to the local DB. Useful for initial population or reconciliation.
**Usage**:
```bash
npx tsx scripts/sync-ghl-projects.ts
```
**What it does**:
1. Uses the **Search Endpoint** (`POST /objects/custom_objects.project/records/search`) to fetch all records.
2. Maps GHL properties to Prisma fields.
3. Upserts records into the local DB.

---

## 5. Implementation Guide (How to Replicate)

To implement this integration from scratch or deploy to a new environment:

### Step 1: Initialize GHL Object
Run the creation script to ensure the object structure exists in GHL.
```bash
npx tsx scripts/create-ghl-project-object.ts
```

### Step 2: Configure Webhooks
1.  Go to **GoHighLevel Automation > Workflows**.
2.  Create a new Workflow.
3.  **Trigger**: "Custom Object Created" (Select "Projects").
4.  **Action**: "Webhook" -> POST to `https://<YOUR_DOMAIN>/api/webhooks/ghl`.
5.  Repeat for "Custom Object Updated".

### Step 3: Initial Data Sync
If data already exists in GHL, pull it into the app.
```bash
npx tsx scripts/sync-ghl-projects.ts
```

### Step 4: Verify Two-Way Sync
1.  **App -> GHL**: Create a project in the App. Check GHL to see it appear.
2.  **GHL -> App**: Edit the project in GHL. Refresh the App to see the change.

---

## 6. Code Reference

- **Repository (Outbound)**: `lib/projects/repository.ts`
- **Webhook Handler (Inbound)**: `app/api/webhooks/ghl/route.ts`
- **Prisma Schema**: `prisma/schema.prisma`

---

## 7. Frontend Interface (Dashboard)

A full UI has been implemented in the Dashboard to manage projects.

### Page Location
-   **URL**: `/admin/projects`
-   **Navigation**: Sidebar -> Projects (Building Icon)

### Features
1.  **List View**: Displays all projects for the current location, showing name, developer, units, and Linked Property count.
2.  **Add/Edit Modal**: A comprehensive modal dialog (`AddProjectDialog`, `EditProjectDialog`) with:
    -   **Details Tab**: Basic info (Name, Location, Website, Description).
    -   **Specs Tab**: Technical details (Completion Date, Features Multi-select).
    -   **Stakeholders Tab**:
        -   **Developer Selection**: A searchable dropdown to link a "Developer" Company.
        -   **Quick Add**: Using `AddCompanyDialog`, users can create a new Developer Company directly from the form.
3.  **Security**:
    -   The page and all actions (`upsertProjectAction`) are secured using `verifyUserHasAccessToLocation`.
    -   Standard server-side validation is enforced.

## 8. Property Integration

Projects can be linked to Properties directly from the Property Add/Edit Form.

### Usage
-   **Location**: Property Form -> **Notes** Tab -> **Project / Development Details** section.
-   **Field**: "Project Name" (Searchable Dropdown).
-   **Behavior**:
    -   Users can search and select an existing Project.
    -   Selecting a project links the Property to the Project ID (`projectId`) and populates the legacy `projectName` text field.
    -   **Quick Add**: Users can click the `(+)` button next to the dropdown to open the `AddProjectDialog` and create a new project on the fly without leaving the form.
    -   **Data Sync**: When a project is selected or created, the relationship is saved locally and synced to GHL properties (if applicable).
