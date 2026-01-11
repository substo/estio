# Data Model Analysis: Local IDX App vs GoHighLevel

## 1. High Level Summary
The local IDX application is currently **property-centric** with a "flat" data model. `Property` is a first-class entity. **Owners, Developers, and Agents** are now managed as **Contacts** or **Companies** linked via **Roles** (`ContactPropertyRole`, `CompanyPropertyRole`). **Projects** are currently implemented as simple string fields on the Property record.

In contrast, GoHighLevel offers a relational model with distinct **Contacts** (people), **Companies** (organizations), and **Custom Objects**. To achieve a robust integration, the local app will likely need to evolve from "strings on a property" to referencing GHL entities (e.g., storing a `ghlOwnerContactId` or `ghlDeveloperCompanyId` instead of just `ownerName`).

## 2. Local Model

### Local Model - Entities

| Entity | Type | Definition Location | Storage | Key Fields | Role/Type Fields | Relationships |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Property** | Core | `prisma/schema.prisma` | DB: `Property` | `id`, `slug`, `title`, `locationId` | `status`, `goal`, `category`, `type` | Belongs to `Location`. Has many `Contacts`. |
| **Contact** | Core | `prisma/schema.prisma` | DB: `Contact` | `id`, `ghlContactId`, `email` | `name`, `phone`, `status` | Belongs to `Location`. Linked to `Property` (interest). |
| **Owner** | Role | `prisma/schema.prisma` | `ContactPropertyRole` | Linked `Contact` | `role="Owner"` | Linked to `Property` and `Contact`. |
| **Developer** | Role | `prisma/schema.prisma` | `CompanyPropertyRole` | Linked `Company` | `role="Developer"` | Linked to `Property` and `Company`. |
| **Agent** | Role | `prisma/schema.prisma` | `ContactPropertyRole` | Linked `Contact` | `role="Agent"` | Linked to `Property` and `Contact`. |
| **Project** | Implicit | `prisma/schema.prisma` | Field on `Property` | `projectName` (String) | N/A | N/A (Just a string) |

**Key Findings:**
*   **Contact Table**: We now have a central `Contact` table for storing people (Contacts, etc.) with GHL integration (`ghlContactId`).
*   **Role-based Relationships**: Relationships to Owners, Developers, and Agents are now managed via `ContactPropertyRole` and `CompanyPropertyRole` tables, replacing the previous string-based fields.
*   **Contact History**: The `Contact` table stores the *latest* state of a person. Historical interactions are currently implied by the `updatedAt` timestamp or would need a separate `Interaction` table if full history is required.

### Local Model - Relationships

**Narrative:**
The local model is essentially a list of Properties belonging to a Location. Each Property contains all its related data (owner name, developer name, project name) as flat text fields. Contacts are incoming inquiries that are associated with a specific Property and Location, but they do not exist as independent entities in the local system before or after the inquiry event.

**Structured Graph:**
*   **Location**
    *   Has many **Properties**
    *   Has many **Contacts**
    *   Has many **Users**
*   **Property**
    *   Belongs to **Location**
    *   Has many **Contacts** (Contacts interested in this property)
    *   Has many **Roles** (Owners, Agents via `ContactPropertyRole`)
    *   Has many **Company Roles** (Developers via `CompanyPropertyRole`)
    *   *Implicitly* has one Project (via `projectName` string)
*   **Contact**
    *   Belongs to **Location**
    *   References **Property** (Last interested property)
    *   Stores `ghlContactId` (External Reference)
*   **User** (Admin users, not CRM contacts)
    *   Belongs to **Location** (many-to-many via `_LocationToUser`)
    *   Stores `ghlUserId` (External Reference to GHL User)
    *   Stores `firstName`, `lastName`, `phone` (aligned with GHL User API)

## 3. GHL Model

### GHL Model - Users (Admin/Team)

**Users (Platform Access)**
*   **Purpose**: Represents individuals with access to the GHL platform (agency staff, sub-account admins).
*   **API Endpoint**: `/users` (requires `users.readonly` scope)
*   **Standard Fields**: `id`, `firstName`, `lastName`, `email`, `phone`, `role`, `type`, `locationIds`.
*   **Distinction**: Users are NOT Contacts. Users have platform access; Contacts are CRM records.

### GHL Model - Contacts and Companies

**Contacts (Person-like)**
*   **Purpose**: Represents individuals (Leads, Clients, maybe individual Owners/Agents).
*   **Standard Fields**: `name`, `email`, `phone`, `address`, `city`, `state`, `postalCode`, `country`, `dateOfBirth`.
*   **Custom Fields**: Highly flexible. Can store `property_interest_id`, `budget`, `role` (e.g., "Buyer", "Seller").
*   **Tags**: Critical for segmentation (e.g., `#lead`, `#owner`, `#agent`).

**Companies (Organization-like)**
*   **Purpose**: Represents business entities (Agencies, Developers, Management Companies, Corporate Owners).
*   **Standard Fields**: `name`, `phone`, `email`, `website`, `address`, `city`, `state`, `postalCode`.
*   **Relationships**:
    *   Can be associated with **Contacts** (e.g., employees of the company).
*   **Custom Fields**: Supported (via `objects/business` API).

**Custom Objects**
*   **Purpose**: For entities that don't fit Contact/Company.
*   **Current Usage**: The app already uses `custom_object.property` to sync Properties.
*   **Potential Usage**: Could be used for **Projects/Developments** if they have rich metadata (start date, total units, amenities) that doesn't fit on a Company record.

## 4. Local to GHL Mapping Preparation

| Local Entity | Type | Primary Fields | Current GHL Ref | Proposed GHL Target | Confidence | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **User** | Admin | `firstName`, `lastName`, `email`, `phone` | `User.ghlUserId` | **User** | **Done** | Admin users map to GHL Users. Synced via SSO/OAuth. |
| **Contact** | Person | `name`, `email`, `phone` | `Contact.ghlContactId` | **Contact** | **Done** | Implemented as `Contact` model. Maps 1:1 with GHL Contact. |
| **Owner** | Person or Org | Linked Contact/Company | None | **Contact** or **Company** | **Done** | Now implemented via `ContactPropertyRole` (for persons) or `CompanyPropertyRole` (for orgs). |
| **Developer** | Org | Linked Company | None | **Company** | **Done** | Now implemented via `CompanyPropertyRole`. |
| **Agent** | Person | Linked Contact | None | **Contact** (or User) | **Done** | Now implemented via `ContactPropertyRole`. |
| **Project** | Concept | `projectName` | None | **Custom Object** or **Company** | **Medium** | If a Project is just a name, it can remain a field. If it represents a "Development" with its own brochure/data, it should be a **Custom Object** (`custom_object.project`) linked to the Developer (Company). |
| **Property** | Asset | `title`, `price`, `slug` | `custom_object.property` | **Custom Object** | **High** | Already implemented. Continue using `custom_object.property`. |

### Strategic Recommendations
1.  **Elevate Owners & Developers**: To map to GHL effectively, the local app needs to capture more than just a name. You cannot reliably create a GHL Contact/Company with just a name (duplicates will abound).
    *   *Action*: Add `OwnerEmail` / `OwnerPhone` to the local Property form if you intend to sync them to GHL.
2.  **Explicit Project Entity**: If "Projects" are important (e.g., "Limassol Marina"), consider making them a dropdown/entity in GHL (Custom Object) so multiple properties can be linked to the same Project record, rather than typing the string "Limassol Marina" 50 times.
3.  **Contact Association**: Ensure the GHL Contact created for a Contact is explicitly linked to the GHL Custom Object (Property) they inquired about. Currently, it seems to be done via a Custom Field (`property_id`). Using GHL's native **Associations** API (Contact <-> Custom Object) would be more robust.
