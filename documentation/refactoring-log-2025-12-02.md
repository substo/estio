# Server Side Refactoring Log - 2025-12-02

## Overview
This document details the refactoring of the server-side logic to support the new role-based data model (`ContactPropertyRole`, `CompanyPropertyRole`) and the standardization of the "Contact" terminology.

## Key Changes

### 1. Property Management (`actions.ts`)
**Goal**: Stop using legacy text fields (`ownerName`, `agentName`, `developerName`) on the `Property` model and instead use the relational tables.

**Changes**:
-   **`upsertProperty`**:
    -   Now extracts Owner, Agent, and Developer information from the form data.
    -   **Owner/Agent**: Upserts a `Contact` record and creates a `ContactPropertyRole` (Role: 'Owner' or 'Agent').
    -   **Developer**: Upserts a `Company` record and creates a `CompanyPropertyRole` (Role: 'Developer').
    -   Legacy fields are no longer written to the `Property` table.

### 2. Public Lead Submission (`route.ts`)
**Goal**: Standardize on "Contact" terminology and improve GHL integration.

**Changes**:
-   **Endpoint Renamed**: `app/api/widget/leads` -> `app/api/widget/contacts`.
    -   This aligns the API route with the domain model (`Contact`).
    -   Frontend components (`contact-form.tsx`) have been updated to use the new endpoint.
-   **Logic Updates**:
    -   Removed logic writing to the deprecated `Contact.propertyId` field.
    -   **GHL Association**: Added logic to associate the GHL Contact with the GHL Property Custom Object using a new helper `associateGHLContactToProperty`.
    -   **Role Creation**: Explicitly creates a `ContactPropertyRole` with role 'LEAD' for every submission.

### 3. GHL Integration (`stakeholders.ts`)
**Changes**:
-   Added `associateGHLContactToProperty(accessToken, contactId, propertyId)` helper function.
-   This function manages the link between the person and the property in GoHighLevel, ensuring the CRM reflects the user's interest.

## Migration Notes
-   **Database**: No schema changes were required for this specific step (tables were added previously).
-   **Frontend**: The `ContactForm` component was updated. Any other custom consumers of the `leads` endpoint must be updated to `contacts`.
