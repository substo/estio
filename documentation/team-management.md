# Team Management

This document describes the team management functionality in IDX, including user roles, invitations, onboarding, and GHL calendar assignments.

## Overview

The Team Management page (`/admin/team`) provides a unified interface for:
- Viewing all users with access to the current location
- Inviting new users with specific roles
- Assigning GHL calendars for viewing synchronization
- Removing user access

## User Roles

IDX uses a location-based role system stored in the `UserLocationRole` table.

| Role | Permissions |
|------|-------------|
| **ADMIN** | Full access. Can invite users, change roles, remove users, and manage all settings. |
| **MEMBER** | Standard access. Can use the application but cannot manage team members. |

### How Roles Are Assigned

1. **Auto-Admin on OAuth**: When a user authorizes a GHL location via the SSO flow, they automatically receive the `ADMIN` role for that location.
2. **Admin Invites**: Admins can invite new users and assign either `ADMIN` or `MEMBER` role.

## User Model

The User model aligns with GoHighLevel's User API structure:

```prisma
model User {
  id            String     @id @default(cuid())
  email         String     @unique
  name          String?    // Legacy - kept for backward compatibility
  firstName     String?    // GHL API field
  lastName      String?    // GHL API field
  phone         String?    // GHL API field
  clerkId       String?    @unique
  ghlUserId     String?    // Maps to GHL User ID
  ghlCalendarId String?
  // ... other fields
}
```

## Features

### Invite Users

Admins can invite new users to their specific location. The process uses Clerk's official Invitation system to ensure secure onboarding.

**Process:**
1. Admin enters email and selects role (ADMIN/MEMBER) in the Team Dashboard.
2. System checks if user already exists (Local DB & Clerk):
    - **Existing Active User:** Immediately added to the team.
    - **"Zombie" User (Local DB but deleted from Clerk):** Treated as a new user; a new invitation is sent.
    - **New User:** A Clerk Invitation is created and emailed to the user.
3. The invitation email redirects the user to `https://<tenant-domain>/sign-up?email_address=<email>`.
4. Upon acceptance, the system automatically links the new user to the correct Location and Role via Webhooks.

**Pending Invitations:**
Admins can view a list of "Pending Invitations" on the team page. These can be **Revoked** at any time if sent in error.

**Technical Metadata:**
Invitations carry `public_metadata` to track context:
- `locationId`: The ID of the team they are joining.
- `ghlLocationId`: Same as locationId (Internal ID), sent for compatibility with context resolution.
- `role`: The access level granted.
- `source`: "team_invite" (to differentiate from public sign-ups).
- `sourceUrl`: The application URL for proper routing.

### User Types & Access Hierarchy

To understand the system, it's crucial to distinguish between the two main types of "people" in the database:

| Type | Definition | Data Model | Access Scope | Onboarding |
|------|------------|------------|--------------|------------|
| **Team Member** | Verified employee/agent managing the business. | `User` + `UserLocationRole` | `/admin/*`, Public Dashboard Link | **Mandatory** (Gate) |
| **Public Contact** | A lead or website visitor. | `Contact` | `/favorites`, Public Site | None (CRM Profile) |

### Post-Signup Onboarding (The Gate)

To ensure data integrity and prevent application errors, we enforce a strict **Onboarding Gate** for all Team Members.

**Problem:** User invited via email has no `firstName` or `lastName`. Deep-linking to complex pages (e.g., `/admin/properties`) might crash if they expect a display name.

**Solution:**
1. **Detection:** The Admin Layout (`layout.tsx`) checks every request for `firstName`.
2. **The Gate:** If data is missing:
   - The requested page content (`children`) is **suppressed/hidden**.
   - A placeholder "Welcome" screen is shown.
   - The `OnboardingModal` is forced open.
3. **Completion:** Once submitted, the modal closes, the page refreshes, and full access is granted.

**Flow:**
1. User clicks email link → Signs up (Email/Pass).
2. Tries to visit `/admin/properties`.
3. System detects missing name → **BLOCKS** access to Properties.
4. Shows Onboarding Modal.
5. User enters "John Doe".
6. System saves → Unblocks access → User sees Properties.

**Key Files:**
| File | Purpose |
|------|---------|
| `components/onboarding-modal.tsx` | Modal UI for collecting profile data |
| `components/onboarding-wrapper.tsx` | Client wrapper for hydration handling |
| `app/(main)/admin/profile-actions.ts` | Server actions for saving profile |
| `app/(main)/admin/layout.tsx` | Implements the **Gate Logic** |

**Note:** Users created via GHL SSO typically have their names pre-populated, so they bypass the gate.

### Edit Team Profiles & Roles

Admins can edit the profile details and **roles** of other team members to ensure data accuracy and appropriate access levels.

**Process:**
1. Navigate to the Team Management page.
2. Click the **Edit** (pencil) icon on a team member's card for profile details.
3. Use the **Role Dropdown** on the card to change permissions (Admin/Member).
4. Changes are immediately synced to:
   - Local Database
   - Clerk (Authentication Profile & Metadata)
   - GoHighLevel (Contact/User Record & Permissions)

### Owner Protection
The user who originally connected the location via OAuth (GoHighLevel Marketplace) is designated as the **Owner**.
- **Visual Indicator**: Marked with a "👑 Owner" badge.
- **Protection**: 
  - Cannot be removed from the team.
  - Cannot have their role changed (permanently Admin).
  - This prevents accidental lockouts where the integration owner loses access.

> [!NOTE]
> **Self-Healing Sync:** If a user is missing their `ghlUserId` link locally, the system will automatically search GoHighLevel for a user with a matching email address upon edit/update. If found, it links the records and proceeds with the update.

### GHL Calendar Assignment

Each user can be assigned a GHL Calendar for viewing synchronization:
- Select from existing calendars in the dropdown
- Create a new calendar using the "+" button
- When viewings are created, they sync to the assigned calendar

### Remove Users

Admins can remove users from a location by clicking the trash icon. This performs a **Secure Offboarding**:

1.  **GHL Offboarding**: Removes the user from the connected GoHighLevel sub-account (`DELETE /users/{ghlUserId}`), revoking CRM access.
2.  **Google Sync Revocation**: Clears `googleAccessToken`, `googleRefreshToken`, and disables `googleSyncEnabled` to stop background contact syncing.
3.  **Local Access Revocation**:
    *   Removes their `UserLocationRole` record.
    *   Disconnects them from the `Location`.
    *   Clears `ghlUserId` from the User record (to enable clean restoration on re-invite).
    *   **Note**: The User record itself is *not* deleted to preserve the audit trail (e.g., "Created By" history on properties).

### Re-Invite Users (Self-Healing Flow)

When a previously removed user is re-invited, the system automatically restores their access and integrations:

**Invitation Conflict Handling:**
- Before sending a new Clerk invitation, the system checks for any **pending invitations** for that email.
- If found, the old invitation is **automatically revoked** to prevent 422 "already invited" errors.
- A fresh invitation is then created with updated metadata.

**Smart User Detection:**
The system uses a multi-step check to determine user status:
1. **Check local DB** for existing user record.
2. **Check Clerk by stored ID** (may fail if user was deleted from Clerk).
3. **Fallback: Check Clerk by email** — catches users who re-registered with a new Clerk account.
4. If found by email, the user's `clerkId` is **auto-updated** in the database.

**GHL Integration Restoration:**
When re-inviting a user who exists in both DB and Clerk but is missing their GHL User ID:
1. System detects `ghlUserId` is null (was cleared during offboarding).
2. Automatically creates a new user in GHL via `POST /users/` with:
   - `companyId`: Dynamically fetched from GHL Location API.
   - `type: 'account'` (required by GHL API).
   - `locationIds`: The target location.
3. Saves the new `ghlUserId` to the database.

> [!NOTE]
> **Fully Self-Healing**: The re-invite button effectively acts as a "Full Restore" button, reconnecting all integrations automatically.

> [!IMPORTANT]
> **GHL Role Mapping**: When creating users in GHL, the system maps IDX roles to GHL roles:
> - IDX `ADMIN` → GHL `admin` (full CRM access)
> - IDX `MEMBER` → GHL `user` (standard access)

**Technical Flow:**
```
Re-Invite Clicked
    ├─▶ Check for pending Clerk invitations → Revoke if found
    ├─▶ Check if user exists in Clerk (ID then Email fallback)
    │       └─▶ If found by email → Auto-update clerkId in DB
    ├─▶ Reconnect user to Location in DB
    ├─▶ Check if ghlUserId is missing
    │       └─▶ Fetch companyId from GHL Location API
    │       └─▶ Create user in GHL (type: 'account')
    │       └─▶ Save new ghlUserId to DB
    └─▶ Upsert UserLocationRole with new role
```

## Technical Details

### Key Files

| File | Purpose |
|------|---------|
| `app/(main)/admin/team/page.tsx` | Main team page component |
| `app/(main)/admin/team/_components/pending-invitations-list.tsx` | Displays pending invites with Revoke option |
| `app/(main)/admin/team/actions.ts` | Server actions (`inviteUserToLocation`, `revokeInvitation`) |
| `app/api/webhooks/clerk/route.ts` | Handles `user.created` to link accepted invites to locations |
| `app/(main)/admin/team/_components/team-member-card.tsx` | User card with calendar assignment |
| `app/(main)/admin/team/_components/edit-team-member-dialog.tsx` | Modal for admin editing of team member profiles |
| `lib/ghl/users.ts` | GHL User API functions (`createGHLUser`, `removeGHLUserFromLocation`) |
| `lib/auth/sync-user.ts` | Syncs Clerk user data to local DB, includes helper functions |

### Database Tables

```prisma
enum UserRole {
  ADMIN
  MEMBER
}

model UserLocationRole {
  id          String   @id @default(cuid())
  userId      String
  locationId  String
  role        UserRole @default(MEMBER)
  invitedById String?
  invitedAt   DateTime?
  
  @@unique([userId, locationId])
}
```

### Automation Logic (Webhook)
When a user accepts an invitation:
1. Clerk triggers `user.created` webhook.
2. We check `evt.data.public_metadata` for `locationId` and `source: 'team_invite'`.
3. If present, we automatically create the `UserLocationRole` record in the database.
4. **CRITICAL**: We update the user's Clerk `publicMetadata.ghlRole` to `'admin'` or `'user'` (lowercase).
   - This is required because the Settings page UI (`/admin/settings`) checks this field to show/hide the "Team Management" card.
   - Without this step, invited admins would not see the Team Management option.
5. This removes the need for manual "accept" clicks inside the app; it's seamless.

### User Context Resolution & Self-Healing

The application uses a robust strategy to determine a user's active location, ensuring they are not routed to a blank "Standalone" dashboard.

**Logic (`lib/auth/location-context.ts`):**
1. **Metadata Check:** Checks Clerk metadata for `ghlLocationId` (internal standard) OR `locationId` (invitation standard).
2. **Database Fallback (Self-Healing):** If metadata is missing or mismatched, the system checks the local database (`db.user.locations`).
    - If the user is already linked to a location in the DB, that location is used.
    - **Auto-Fix:** The system automatically updates the user's Clerk metadata to match the DB location, fixing future logins.
3. **Standalone Creation:** Only if NO location comes from metadata AND no location exists in the DB, a new "Standalone" business location is created.

### Related Documentation

- [Database Setup](./database-setup.md) - Schema details and migration commands
- [GHL Calendar Sync](./ghl-calendar-sync.md) - Calendar integration details
- [GHL SSO Technical Flow](./ghl-sso-technical-flow.md) - How auto-admin assignment works
- [Custom Email Delivery System](./custom-email-delivery-system.md) - How invitation emails are routed via GHL
