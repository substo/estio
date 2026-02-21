# Contact Model Specification

## Overview
The `Contact` model represents a person in the Estio system. It serves as the primary entity for storing contact information and synchronizing with GoHighLevel (GHL) Contacts.

## Schema

```prisma
model Contact {
  id           String   @id @default(cuid())
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt @default(now())

  location     Location @relation(fields: [locationId], references: [id])
 
   // Person Details
   name         String?   // Full Name (Computed or entered)
   firstName    String?   // [NEW] Direct mapping to GHL/Google
   lastName     String?   // [NEW] Direct mapping to GHL/Google
   email        String?
   phone        String?
   message      String?
   dateOfBirth  DateTime? // [NEW] Enhanced Demographics
   tags         String[]  @default([]) // [NEW] GHL Tags

   // Address [NEW]
   address1     String?
   city         String?
   state        String?
   postalCode   String?
   country      String?
 
   // GHL Integration
   ghlContactId        String?  @unique
   ghlCompanyId        String?
   ghlPropertyObjectId String?
   ghlPropertyObjectId String?
   ghlOppId            String?
 
   // Authentication
   clerkUserId         String?  @unique // Links a public authenticated user to this contact record
 
   // Gamification / Qualification
   interestedCount Int @default(0)
   maybeCount      Int @default(0)
   notCount        Int @default(0)
   heatScore       Int @default(0)
 
   // Legacy / Audit
   payload      Json?
   status       String
   error        String?
 
   // Lead Details
   leadGoal            String?   // e.g., "To Buy", "To Rent", "To List"
   leadPriority        String    @default("Medium") // "Low", "Medium", "High"
   leadStage           String    @default("Unassigned")
   leadSource          String?   // e.g. "Website Inquiry", "Manual", "Referral"
   leadNextAction      String?
   leadFollowUpDate    DateTime?
   leadAssignedToAgent String?
 
   // Requirements
   requirementStatus            String   @default("For Sale") // "For Sale", "For Rent"
   requirementDistrict          String   @default("Any District")
   requirementBedrooms          String   @default("Any Bedrooms")
   requirementMinPrice          String   @default("Any")
   requirementMaxPrice          String   @default("Any")
   requirementCondition         String   @default("Any Condition")
   requirementPropertyTypes     String[] @default([]) // Array of types with prefixes, e.g. ["cat:house", "sub:villa"]
   requirementPropertyLocations String[] @default([]) // Array of locations
   requirementOtherDetails      String?  // Manual requirement notes

   // General Notes (AI Summaries)
   notes                        String?  @map("contact_other") // Mapped to `leadOtherDetails` in UI. Used for AI Daily Summaries.
 
   // Property Matching
   matchingPropertiesToMatch       String    @default("Updated and New")
   matchingEmailMatchedProperties  String    @default("Yes - Automatic")
   matchingNotificationFrequency   String    @default("Weekly")
   matchingLastMatchDate           DateTime?
 
   // Properties Tab (Manual Lists)
   propertiesInterested    String[] @default([])
   propertiesInspected     String[] @default([])
   propertiesEmailed       String[] @default([])
   propertiesMatched       String[] @default([])
 
   // Property Won Details
   propertyWonValue        Int?
   wonCommission           Int?
   propertyWonReference    String?
   propertyWonDate         DateTime?
 
   // Relationships
   companyRoles    ContactCompanyRole[]
   propertyRoles   ContactPropertyRole[]
   history         ContactHistory[]
   swipes          PropertySwipe[]
   swipeSessions   SwipeSession[]
 
   // Google Contact Sync (see google-contact-sync.md)
   googleContactId         String?   // Maps to Google Person resourceName (e.g., "people/c12345")
   lastGoogleSync          DateTime? // When we last pushed to Google
   googleContactUpdatedAt  DateTime? // Google's metadata.updateTime for "last write wins" comparison
 }
 
 model ContactHistory {
   id        String   @id @default(cuid())
   createdAt DateTime @default(now())
   contactId String
   userId    String? 
   action    String   // e.g., "CREATED", "UPDATED", "VIEWING_ADDED"
   changes   Json?    // e.g., [{ "field": "status", "old": "New", "new": "Contacted" }]
 
   contact   Contact  @relation(fields: [contactId], references: [id], onDelete: Cascade)
   user      User?    @relation(fields: [userId], references: [id])
 
   @@index([contactId])
   @@index([createdAt])
 }
 ```
 
 ## Unified Contact Model Logic
 
 > **Important**: The system uses a **Unified Contact Model**. This means `Lead`, `Owner`, `Agent`, and `Tenant` all share the exact same database table (`Contact`).
 
 ### Why do "Owner" contacts have Lead fields in the DB?
 Since all contacts share the table, every record has fields like `leadPriority`, `requirementDistrict`, etc.
 -   **Default Values**: Most fields have defaults (e.g., `requirementDistrict` defaults to "Any District").
 -   **Database Level**: In the database, an "Owner" technically has "Any District" as their requirement, but this is semantically irrelevant.
 
 ### UI & Logic Handling
 To prevent confusion, the system conditionally handles these fields based on the `contactType`:
 1.  **UI (Forms & Views)**: The `ContactForm` and `ContactView` components check `CONTACT_TYPE_CONFIG`. If a type (like Owner) is configured not to show lead fields (`showLeadFields: false`), those sections are hidden, even though the data exists in the background.
 2.  **AI Coordinator**: The AI prompt generation logic checks the contact type. It suppresses "Requirement" and "Lead" data for Owners/Agents/Partners to avoid confusing the AI with irrelevant default values.
 
 ## Key Features

### 1. Identity & GHL Sync
-   **`ghlContactId`**: The canonical identifier for the person in GoHighLevel. This field is `@unique`, ensuring that we only have one record per GHL Contact.
-   **Upsert Logic**: When a contact is submitted via the widget:
    -   If a `ghlContactId` is returned from GHL (or already known), the system **updates** the existing `Contact` record.
    -   If no `ghlContactId` exists, a new `Contact` record is created.
-   **Masked Phone Numbers**:
    -   **Context**: Associates and external agents often register clients with masked numbers (e.g., `+35796***`) to protect their commission/intro fee.
    -   **Handling**: The system MUST preserve these masks (asterisks) and NOT strip them during normalization.
    -   **Client Registration**: Matching logic must account for masked numbers to prevent duplicate entries while acknowledging that a masked number is not a unique identifier on its own.

### 1.1 Google Contact Sync (Bidirectional)
Contacts sync bidirectionally with Google Contacts using a **"last write wins"** strategy:
-   **`googleContactId`**: Maps to Google Person `resourceName` (e.g., `people/c12345`).
-   **`googleContactUpdatedAt`**: Stores Google's metadata timestamp for conflict resolution.
-   **Outbound (Estio → Google)**: Manual via Google Sync Manager by default. Optional per-flow automation can be enabled in Google Integrations settings.
-   **Inbound (Google → Estio)**: Manual pull via Google Sync Manager by default.
-   **Visual ID**: The organization field in Google Contacts is populated with a summary (e.g., "Lead Rent DT4012 Paphos €750") for caller ID.

> See [Google Contact Sync](./google-contact-sync.md) for full implementation details, including the **Google Sync Manager** for manual conflict resolution.

### 2. Comprehensive Lead Tracking
The model now includes extensive fields locally to track the full lifecycle of a lead without solely relying on external CRM fields:
-   **Lead Details**: Priority, Stage, Goal, Source.
-   **Requirements**: Specific buying/renting criteria (Price, Bedrooms, Location) to facilitate property matching.
-   **Matching Preferences**: Automated matching settings (Email frequency, Criteria).
-   **History**: Manually tracked lists of properties the contact is interested in or has inspected.

### 2.2 Audit History
A robust audit trail (`ContactHistory`) tracks all significant changes to a contact record:
-   **Events Logged**: Creation, Updates, Viewing scheduling/updates.
-   **Data Captured**: Who made the change, when it happened, and a diff of what changed (Old Value -> New Value).
-   **AI Summaries**: Concise daily summaries of AI interactions are stored in the `notes` field (UI: "Other Details"), separate from the audit history.
-   **UI**: Exposed via a dedicated "History" tab in the Edit Contact dialog.

### 2.3 Intelligent History Logging
To ensure the audit trail is human-readable and meaningful, the system implements specific logic handling:
-   **ID Resolution**: Raw IDs (e.g., for Properties or Agents) are automatically resolved to their corresponding Names or Reference Numbers before being logged.
-   **Smart Diffing**: The system performs a strict diff that ignores "noise" (e.g., `null` vs `undefined` or empty arrays vs `null`) to prevent "Empty to Empty" log entries.

### 2.1 Public User Integration
Several Contact fields serve dual purposes for both CRM agents and authenticated public users:

| Field | CRM Use | Public User Use |
|-------|---------|-----------------|
| `clerkUserId` | — | Links Clerk auth to Contact |
| `propertiesInterested[]` | Manual interest list | **Favorites** (via ❤️ button) |
| `requirement*` fields | Lead requirements | **Saved Search** (via 📑 button) |

> **Implementation**: See [Public Site Architecture - Section 10](./public-site-architecture.md#10-public-user-authentication--features) for server actions and UI components.

### 3. Property Interest (Roles)
-   **`ContactPropertyRole`**: The primary method for rich property associations (Owner, Buyer, Tenant, Agent).
-   **`ContactPropertyRole`**: All property associations are now handled via this join table.
    -   **Roles**: "buyer", "tenant", "owner", "agent", "viewer".
    -   **Metadata**: Stores `stage`, `source`, and gamification metrics per property.

### 4. Gamification
-   **`heatScore`**: A calculated score representing the lead's engagement level.
-   **`interestedCount`**: Incremented each time the user expresses interest in a property.
-   **Raw Data**: Detailed interaction data is stored in `SwipeSession` and `PropertySwipe` tables. See [Gamification Model Spec](./gamification-model-spec.md) for details.

### 5. Roles & Relationships
The system supports explicit role definitions via join tables:
-   **`ContactPropertyRole`**: Defines a contact's role on a specific property.
-   **`ContactCompanyRole`**: Defines a contact's role within a company (e.g., "agent", "director").

## Integration Flow

1.  **Widget Submission**: User submits form on Property page (via `/api/widget/contacts`).
2.  **GHL API Call**: Backend calls GHL `contacts` API to create/update contact.
3.  **Local Sync**:
    -   GHL returns `contact.id`.
    -   Backend performs `db.contact.upsert({ where: { ghlContactId: ... } })`.
    -   Updates `name`, `email`, `phone`.
    -   **Role Creation**: Creates or updates a `ContactPropertyRole` linking the contact to the property with role "buyer" (or similar).

## Search & Filtering

The CRM contact list (`/admin/contacts`) features a powerful, compact search and filter system designed for density and efficiency.

### 1. One-Row Compact Toolbar
The primary filter interface is designed to fit on a single row for desktop users, maximizing vertical screen real estate for the contact list itself.
-   **Search Bar**: Fixed-width input for searching Name, Email, or Phone.
-   **View Mode (Category)**: A dropdown selector to switch between context modes:
    -   **Real Estate** (Default): Shows Leads, Contacts, and Tenants. Enables "Priority" filtering.
    -   **Business**: Shows Agents, Partners, Owners, and Associates.
    -   **All Contacts**: Shows merged list of all contact types.
-   **Type**: Filters by specific sub-type relevant to the selected Category (or all types if "All Contacts" is selected).
-   **Priority**: Filters by Lead Priority (Low, Medium, High).
-   **Sort**: Dropdown for sorting by Updated Date or Created Date.

### 2. Advanced Filters (Slide-Down Panel)
Additional filters are hidden by default in a collapsible panel that slides down from under the main toolbar. This keeps the UI clean while offering deep filtering capabilities:
-   **Quick Filters**: Presets like "Needs Follow Up", "Created Last 7 Days", "Has Manual Matches".
-   **Source**: Filter by dynamic Lead Source.
-   **Assigned Agent**: Filter by team member.
-   **Goal / Stage**: Filter by Lead Goal or Pipeline Stage.
-   **District**: Filter by requirement district.
-   **Property Ref**: Search contacts associated with a specific property reference (Interested or Emailed).
-   **Date Ranges**: Presets for Created Date (e.g., Today, Last 7 Days).

### 3. URL State Management
All filter states are persisted in the URL query parameters (e.g., `?category=real_estate&type=Lead&priority=High`). This ensures that:
-   Filtered views are shareable via link.
-   Browser back/forward navigation works as expected.
-   Refreshing the page restores the exact filter context.

## Manual Management (Dashboard)

In addition to automated widget submissions, contacts can be managed manually via the Dashboard. The Add/Edit interfaces have been significantly enhanced to support the expanded data model.

### 1. Add/Edit Contact Dialogs
-   **Dynamic Interface**: The form adapts based on the **Contact Type**. Tabs and fields are conditionally shown (e.g., "Properties" tab is hidden for Owners/Agents).
-   **Tabbed Interface**: Organized into up to four tabs (depending on configuration):
    1.  **Lead Details**: Basic info (**Full Name, First/Last Name, Email, Phone, DOB, Tags, Address**) plus Goal, Priority, Stage, Source, Next Action, Assigned Agent.
    2.  **Requirements**: Detailed criteria including Price Range, Bedrooms, District, and **Property Types**.
        -   **Property Types**: Implemented as a multi-select dropdown supporting both Categories (e.g., "House") and specific Subtypes (e.g., "Villa"). 
        -   **Storage**: Selections are stored with prefixes (`cat:` for categories, `sub:` for subtypes) to prevent ambiguity between identically named categories and subtypes.
    3.  **Property Matching**: Settings for automated matching (Frequency, Criteria).
    4.  **Properties** (Visible for Leads, Tenants, Contacts):
        -   **Lists**: Manage lists of Interested, Inspected, and Matched properties.
        -   **Enhanced Inputs**: All lists (Interested, Inspected, Emailed, Matched) use **Multi-Select Property Pickers** for easy searching and selection.
        -   **Property Won**: Record details of a closed deal (Value, Commission, Date).
        -   **Role Assignment**: Assign the contact to specific Properties or Companies (e.g., as Owner or Agent).

-   **Role Assignment**:
    -   **Property Role**: Select a property and role (e.g., Owner, Buyer, Tenant). **Includes search functionality**.
        -   **Multi-Property Assignment**: "Owner" contacts can be assigned to multiple properties simultaneously via a multi-select interface.
    -   **Company Role**: Select a company and role (e.g., Agent, Director). **Includes search functionality**.

    -   Prevents duplicate emails within the same Location.
    -   Parses array inputs (Property Types, Locations) from both JSON and comma-separated strings for flexibility.
    -   **Graceful Handling**: Optional fields (like `message` or `phone`) are handled gracefully by server actions even if missing from the form payload.

    **Unified Interface**: Both Add and Edit dialogs now use a shared `ContactForm` component, ensuring consistent UI and validation logic across both operations.

    **Special Features**:
    -   **Viewings Tab** (Edit Only): Allows scheduling and managing property viewings. **Conditionally shown** only for contacts that have the "Properties" tab enabled (Leads, Tenants).
    -   **History Tab** (Edit Only): Displays a chronological log of all changes made to the contact, including field updates and viewing activities.
    -   **Current Roles** (Edit Only): Displays active role assignments with the ability to delete them. Deletion refreshes the data without closing the dialog.
    -   **Smart Deletion**: Integrated destructive action with confirmation. **New in Feb 2026**: Users can optionally delete the contact from connected platforms (Google Contacts and GoHighLevel) simultaneously. Preferences for these options are remembered via `localStorage`.


### 2. View Contacts
-   **Functionality**: View a paginated list of all contacts in the Location.
-   **Columns**:
    -   **Date**: When the contact was created.
    -   **Name**: Full name of the contact. **Clickable** to navigate to the detailed Contact View.
    -   **Contact**: Email address and phone number.
    -   **Roles & Properties**: Lists all properties the contact is associated with, including their specific role (e.g., "Owner: Villa 123", "Agent: Seaside Apt"). General inquiries are marked as such.
    -   **Score**: The contact's `heatScore`, color-coded (Red > 50, Orange > 20) to indicate engagement level.
    -   **Status**: The result of the last sync operation (e.g., "success", "error").
    -   **Actions**: "Edit" button to open the Edit Contact dialog.

### 3. Contact View Page
The system now includes a dedicated read-only view page for contacts (`/admin/contacts/[id]/view`), enabling a comprehensive overview of the contact's data without the risk of accidental edits.

-   **Key Details Display**: clearly shows Name, Contact Info, Type, Status, and Heat Score.
-   **Lead Tracking**: Displays Goal, Priority, Stage, Source, and Assigned Agent.
-   **Requirements Section**: Visualizes property requirements (Districts, Bedrooms, Price Range, Property Types).
-   **Interaction Lists**: Read-only lists of Properties Interested, Inspected, and Matched, with direct links to the respective property pages.
-   **Roles & Associations**: Clear listing of all property and company roles.
-   **Edit Access**: Includes an "Edit Contact" button that triggers the `EditContactDialog`.

## Data Integrity & Validation

To ensure high-quality data and prevent "magic strings", the system enforces strict validation on several fields using Zod schemas and TypeScript Enums.

### 1. Strict Enums & Dynamic Lists
The following fields are strictly validated against a defined set of allowed values.

-   **Lead Priority**: `Low`, `Medium`, `High`
-   **Lead Stage**: `Unassigned`, `New`, `Contacted`, `Viewing`, `Negotiation`, `Closed`, `Lost`
-   **Lead Source**: **Dynamic**. Managed via Admin Settings. Stored in `LeadSource` table (Location-specific).
-   **Requirement Status**: `For Sale`, `For Rent`
-   **Requirement Condition**: `Any Condition`, `New`, `Resale`, `Under Construction`, 'Renovation Project`

### 2. Input Normalization
Data is automatically normalized before being saved to the database:
-   **Phone Numbers**:
    -   Basic cleanup: Removes non-essential characters but **preserves** `+` prefix, `#` extension, and `*` mask.
    -   Example: `+357 99 123 456` -> `+35799123456`
    -   Masked Example: `+357 99 123 ***` -> `+35799123***`
-   **Arrays**: JSON strings or comma-separated lists are automatically parsed into string arrays.
-   **Dates**: String dates are converted to native `Date` objects.

### 3. Audit History & Viewing Integrity
-   **Viewing Logs**: Creating/Updating Viewings now properly logs to `ContactHistory`.
-   **User Resolution**: Internal User IDs are correctly resolved and stored for history and viewing records, preventing foreign key errors with external Auth IDs (Clerk).
-   **Readable Changes**: The history log enriches raw ID changes (e.g., Property ID changed) with human-readable names (e.g., Property Title changed) for better auditability.

## Security & Authorization

Access to Contact data is strictly controlled based on the User's relationship to a Location.

### 1. Location-Based Access Control
-   **Principle**: A user can only access contacts that belong to a Location they are explicitly authorized to access.
-   **Implementation**:
    -   **Read Access**: Pages and API endpoints filter queries by `locationId`.
    -   **Write Access**: Server actions (`createContact`, `updateContact`, `deleteContactRole`) perform a mandatory check using `verifyUserHasAccessToLocation(userId, locationId)` before executing any database operations.

    2.  Does the `contactId` actually belong to that `locationId`?
    If either check fails, the request is rejected.

### 3. Data Integrity & Cascading Deletes
-   The Prisma schema does NOT strictly enforce cascading deletes on all Contact relationships to prevent accidental data loss.
-   **Transactional Deletion**: The `deleteContact` server action implements a manual cascade within a database transaction:
    1.  **Remote Deletion (Optional)**: If requested by the user, the system first attempts to delete the contact from GoHighLevel and Google Contacts using their respective APIs.
    2.  Deletes all **ContactRoles** (Property and Company).
    3.  Deletes all **Viewings**.
    4.  Deletes all **PropertySwipes**.
    5.  Unlinks **SwipeSessions** (sets `contactId` to null).
    6.  Deletes the **Contact**.
    This approach ensures that deleting a contact never leaves orphaned records or violates foreign key constraints.
