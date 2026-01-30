# Company Filters Documentation

This document details the company filtering capabilities implemented in the IDX application's dashboard.

## Overview
The "Companies" page (`/admin/companies`) allows users to filter companies based on general search terms, company type, and relationship status (roles). This enables efficient management of developers, management companies, and other partners.

## Filter Types

### 1. General Search (Text)
- **Type**: Input Field (Debounced)
- **Functionality**: Searches across multiple text fields for a partial match (case-insensitive).
- **Target Fields**:
    - `name`
    - `email`
    - `phone`
    - `website`
- **Logic**: Updates `q` URL parameter. Backend uses `OR` logic with `contains`.

### 2. Company Type
- **Type**: Dropdown (Select)
- **Functionality**: Filters companies by their categorization.
- **Options**:
    - **All Types**: Shows all companies.
    - **Management**: Companies responsible for property management.
    - **Developer**: Property developers.
    - **Agency**: Real estate agencies.
    - **Other**: Miscellaneous partners.
- **Logic**: Updates `type` URL parameter. Backend uses exact match.

### 3. Role Status (Relations)
- **Type**: Dropdown (Select)
- **Functionality**: Filters companies based on their active relationships with other entities (Properties, Contacts).
- **Options**:
    - **All Roles**: Shows all companies.
    - **Has Properties**: Companies that have at least one active role (`CompanyPropertyRole`) linked to a Property.
    - **Has Contacts**: Companies that have at least one active role (`ContactCompanyRole`) linked to a Contact.
- **Logic**: Updates `hasRole` URL parameter.
    - `has-properties` -> `where: { propertyRoles: { some: {} } }`
    - `has-contacts` -> `where: { contactRoles: { some: {} } }`

## Database Schema Impact
The following fields in the `Company` model support these filters:
- `name`: `String`
- `email`: `String?`
- `phone`: `String?`
- `website`: `String?`
- `type`: `String?`
- `propertyRoles`: Relation (`CompanyPropertyRole[]`)
- `contactRoles`: Relation (`ContactCompanyRole[]`)

## Technical Implementation
- **Source of Truth**: URL Search Params.
- **Repository**: `lib/companies/repository.ts` (`listCompanies` function).
- **Component**: `app/(main)/admin/companies/_components/company-filters.tsx`.
