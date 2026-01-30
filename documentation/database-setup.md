# Database Setup and Migration

This document explains how to manage the database schema and migrations for the IDX application.

## Prerequisites

Ensure you have the correct database connection strings. These can be found in `deploy-direct.sh` or your local `.env` file (if configured correctly).

## Running Schema Updates

To push schema changes to the database (e.g., after modifying `prisma/schema.prisma`), use the `npx prisma db push` command.

### Important Note on Connection Strings

The application uses Supabase with a connection pooler.
- **DATABASE_URL**: Port 6543 (Transaction Mode) - Used for the running application.
- **DIRECT_URL**: Port 5432 (Session Mode) - Used for migrations and direct schema changes.

If your local `.env` file is not configured correctly or you are encountering connection errors (e.g., `P1001`), you can run the command by explicitly passing the environment variables.

### Command

```bash
DIRECT_URL="postgresql://postgres.oxxkmbxfqswtomzernzu:ropCys-dewpif-didnu7@aws-1-eu-north-1.pooler.supabase.com:5432/postgres?pgbouncer=true" \
DATABASE_URL="postgresql://postgres.oxxkmbxfqswtomzernzu:ropCys-dewpif-didnu7@aws-1-eu-north-1.pooler.supabase.com:6543/postgres?pgbouncer=true" \
npx prisma db push
```

> [!TIP]
> You can copy the connection strings from `deploy-direct.sh` if they change.

## Generating Prisma Client

After pushing changes, always regenerate the Prisma Client:

```bash
npx prisma generate
```

## Schema Restructuring Plan (Step 1)

As of December 2025, we are restructuring the application to better mirror GoHighLevel's data model and improve role management.

### New Core Tables

1.  **Company**
    *   **Purpose**: Mirrors GHL Company entity. Replaces the abuse of `Stakeholder` for organizations.
    *   **Key Fields**: `name`, `email`, `phone`, `website`, `type` (developer, agency, etc.), `ghlCompanyId`.

2.  **ContactPropertyRole**
    *   **Purpose**: The primary "lead" table. Links a `Contact` to a `Property` with a specific role.
    *   **Roles**: `buyer`, `tenant`, `seller`, `owner`, `agent`, `viewer`.
    *   **Features**: Tracks `source`, `stage`, and engagement metrics (`interestedSwipes`, `propertyHeatScore`).

3.  **CompanyPropertyRole**
    *   **Purpose**: Links a `Company` to a `Property`.
    *   **Roles**: `developer`, `agency`, `landlord_company`.

4.  **ContactCompanyRole**
    *   **Purpose**: Links a `Contact` to a `Company` (e.g., an agent working for an agency).
    *   **Roles**: `agent`, `employee`, `director`, `owner`.

### Migration Strategy (Completed)

*   **Step 1**: Added new tables (`ContactPropertyRole`, etc.).
*   **Step 2**: Migrated data from `Stakeholder` to new tables.
*   **Step 3**: Removed `Stakeholder` table and legacy fields (Completed Dec 2025).

---

## User Roles & Permissions (Dec 2025)

A role-based access control system was added to manage user permissions per location.

### UserLocationRole Table

| Field | Type | Description |
|-------|------|-------------|
| `userId` | String | Reference to `User` |
| `locationId` | String | Reference to `Location` |
| `role` | Enum | `ADMIN` or `MEMBER` |
| `invitedById` | String? | User who sent the invite |
| `invitedAt` | DateTime? | When the invite was sent |

**Unique Constraint**: `userId + locationId` (one role per user per location)

### How Roles Are Assigned

1. **Auto-Admin on OAuth**: When a user authorizes a GHL location via SSO, they are automatically assigned the `ADMIN` role for that location.
2. **Admin Invites**: Admins can invite new users via `/admin/team` and assign them `ADMIN` or `MEMBER` roles.

### Migration Command

```bash
npx prisma migrate deploy
```

This will create the `UserLocationRole` table and `UserRole` enum.

## User Profile Updates (Jan 2026)

The `User` model was updated to align with GoHighLevel's user structure.

### User Table Updates
| Field | Type | Description |
|-------|------|-------------|
| `firstName` | String? | First Name (matches GHL) |
| `lastName` | String? | Last Name (matches GHL) |
| `phone` | String? | Phone Number (matches GHL) |
| `name` | String? | **Legacy**. Kept for backward compatibility but deprecated. |

### Migration Command
```bash
npx prisma db push
```
*(Note: We used `db push` instead of migrate to handle the schema evolution flexibly during this phase)*
