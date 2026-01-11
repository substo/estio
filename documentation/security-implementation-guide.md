# Security Implementation Guide

**Version:** 1.0
**Last Updated:** December 4, 2025

## Overview

This guide outlines the standard patterns for implementing secure data access and CRUD operations in the IDX application. All new features must adhere to these security practices to ensure data isolation and prevent unauthorized access.

## Core Principle: Location-Based Isolation

The application is multi-tenant by design, where a "Location" acts as the tenant boundary.
**Rule:** A User must *never* access data belonging to a Location they are not explicitly linked to in the database.

### The Authorization Helper

We use a centralized helper function to validate access.

**File:** `lib/auth/permissions.ts`

```typescript
import { verifyUserHasAccessToLocation } from '@/lib/auth/permissions';

// Usage
const hasAccess = await verifyUserHasAccessToLocation(userId, locationId);
if (!hasAccess) {
  throw new Error("Unauthorized");
}
```

---

## 1. Securing Server Actions (Mutations)

Server Actions are public API endpoints. You **must** validate authorization at the very beginning of every action.

### Pattern

1.  **Authenticate**: Get `userId` from Clerk.
2.  **Authorize Location**: Verify `userId` has access to the input `locationId`.
3.  **Authorize Resource (IDOR Check)**: If modifying an existing item (Update/Delete), verify that the item *actually belongs* to that `locationId`.

### Example: Create Operation

```typescript
export async function createItem(formData: FormData) {
  // 1. Authenticate
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized" };

  // 2. Authorize Location
  const locationId = formData.get("locationId");
  const hasAccess = await verifyUserHasAccessToLocation(userId, locationId);
  
  if (!hasAccess) {
    return { error: "Unauthorized: Access Denied" };
  }

  // 3. Perform Operation
  await db.item.create({ data: { ..., locationId } });
}
```

### Example: Update/Delete Operation (Preventing IDOR)

**Insecure Direct Object Reference (IDOR)** occurs when a user can manipulate an ID (e.g., `contactId`) to modify someone else's data.

```typescript
export async function updateItem(itemId: string, updates: any) {
  const { userId } = await auth();
  // ... check userId ...

  // 1. Fetch the item to know its Location
  const item = await db.item.findUnique({ 
    where: { id: itemId },
    select: { locationId: true } // Only fetch what's needed
  });

  if (!item) return { error: "Not Found" };

  // 2. Authorize against THAT location
  const hasAccess = await verifyUserHasAccessToLocation(userId, item.locationId);

  if (!hasAccess) {
    return { error: "Unauthorized" };
  }

  // 3. Safe to Update
  await db.item.update({ ... });
}
```

---

## 2. Securing Pages & Data Fetching (Queries)

Server Components must ensure users only see data they are allowed to see.

### Pattern

1.  **Resolve Location**: Determine the target `locationId` (from URL params or cookies).
2.  **Authorize**: Check if the current user has access to this `locationId`.
3.  **Handle Failure**:
    *   **Redirect**: If unauthorized, try to find a valid location for the user and redirect them there (Smart Redirect).
    *   **Block**: If no valid locations exist, show a 403 Unauthorized UI.

### Example: Page Component

```typescript
// app/(main)/admin/some-page/page.tsx

export default async function Page({ searchParams }) {
  const { userId } = await auth();
  const locationId = searchParams.locationId;

  // 1. Security Check
  const hasAccess = await verifyUserHasAccessToLocation(userId, locationId);

  if (!hasAccess) {
    // 2. Smart Redirect Logic
    const user = await db.user.findUnique({
      where: { id: userId },
      include: { locations: { take: 1 } }
    });

    if (user?.locations?.[0]) {
      redirect(`/admin/some-page?locationId=${user.locations[0].id}`);
    }

    // 3. Fallback UI
    return <div>Unauthorized</div>;
  }

  // 4. Safe Data Fetching (Always filter by locationId)
  const data = await db.item.findMany({
    where: { locationId } 
  });

  return <ClientComponent data={data} />;
}
```

---

## Checklist for New Features

- [ ] **Schema**: Does the new model have a `locationId` field? (It should).
- [ ] **Read**: Do `findMany` queries include `where: { locationId }`?
- [ ] **Write**: Do Server Actions call `verifyUserHasAccessToLocation`?
- [ ] **Update/Delete**: Do you verify the target item belongs to the authorized location?

---

## Troubleshooting

### Common Pitfalls

#### 1. Clerk ID vs. Internal User ID Mismatch

**Problem:**
The system fails to find a user record or denies access even when the user exists. This often happens if you query the database using the **Clerk ID** (e.g., `user_2p...`) against the internal **ID** field (e.g., `cm...`).

**Symptoms:**
-   `verifyUserHasAccessToLocation` returns `false`.
-   User receives "Unauthorized" errors despite valid login.
-   Logs show `foundUser: false`.

**Fix:**
Ensure you are querying the correct field. When you have a Clerk ID (from `auth().userId`), you **must** query against the `clerkId` column, NOT the `id` column.

**Incorrect:**
```typescript
db.user.findUnique({ where: { id: userId } }) // userId is "user_..."
```

**Correct:**
```typescript
db.user.findUnique({ where: { clerkId: userId } })
```

#### 2. Missing User-Location Link

**Problem:**
A user exists and has a valid session, but `verifyUserHasAccessToLocation` returns `false` because the database relation between the `User` and `Location` is missing. This often happens when creating new users or locations without explicitly connecting them.

**Symptoms:**
-   New users get "Unauthorized Access" immediately after sign-up.
-   `verifyUserHasAccessToLocation` returns `false`.
-   Logs show `foundUser: true` but `locationCount: 0`.

**Fix:**
Always ensure you connect the user to the location when creating either record.

**Example (Prisma):**
```typescript
// When creating a Location for a User
await db.location.create({
    data: {
        name: "New Location",
        users: { connect: { id: user.id } } // CRITICAL: Create the relation
    }
});
```
