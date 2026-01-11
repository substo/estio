# Refactor: Tenant → Location

**Date:** November 26, 2025
**Status:** Completed
**Type:** Major Refactor / Breaking Change

## 1. Context & Reasoning

### Why was this changed?
The application originally used the term `Tenant` to represent a GoHighLevel (GHL) organization. However, in the context of a Real Estate IDX application, the word "tenant" strongly implies a "renter" or "leaseholder," leading to significant domain confusion.

We renamed `Tenant` to `Location` to:
1.  **Align with GHL Terminology**: GoHighLevel uses "Location" to refer to sub-accounts/organizations.
2.  **Avoid Domain Confusion**: Clearly distinguish between the SaaS customer (Location) and a property renter (Tenant).

---

## 2. Database Schema Changes

The Prisma schema was updated to rename the model and all foreign key references.

| Old Name | New Name | Description |
| :--- | :--- | :--- |
| `model Tenant` | `model Location` | The main organization table |
| `Property.tenantId` | `Property.locationId` | FK linking property to location |
| `SearchConfig.tenantId` | `SearchConfig.locationId` | FK for widget configuration |
| `LeadLog.tenantId` | `LeadLog.locationId` | FK for lead tracking |
| `ghlTenantId` | `ghlLocationId` | (In Clerk Metadata) |

### Migration Strategy
- **Development**: `prisma migrate reset` (Drop and recreate)
- **Production**: `ALTER TABLE` statements were required to preserve data (see Migration History).

---

## 3. Key Code Changes

### Core Libraries
- **Created**: `lib/location.ts` (Replaces `lib/tenant.ts`)
  - `getLocationById(id)`
  - `getLocationByGhlContext(agencyId, locationId)`
  - `refreshGhlAccessToken(location)`
- **Deleted**: `lib/tenant.ts`
- **Updated**: `lib/clerk-sync.ts`
  - Now syncs `ghlLocationId` to Clerk public metadata.
  - **Backward Compatibility**: `getGHLContextFromClerk` checks both `ghlLocationId` and `ghlTenantId`.

### API Routes & Auth
- **SSO**: Cookies renamed from `crm_tenant_id` to `crm_location_id`.
- **OAuth**: Callback now upserts to `db.location`.
- **Widget**: Loader script and API now expect `locationId`.

---

## 4. Breaking Changes & Troubleshooting

If features stop working after this update, check these common issues:

### 🔴 Issue: "Internal Server Error" on Login
**Cause**: Old cookies or cached sessions using `tenantId`.
**Fix**: Clear browser cookies. Specifically look for `crm_tenant_id` and ensure `crm_location_id` is being set instead.

### 🔴 Issue: Widget not loading
**Cause**: Embed code still uses `data-tenant`.
**Fix**: Update the embed code to use `data-location`.
```html
<!-- OLD -->
<script src="..." data-tenant="123"></script>

<!-- NEW -->
<script src="..." data-location="123"></script>
```

### 🔴 Issue: "Property not found"
**Cause**: URL parameters in bookmarks/links might still use `?tenantId=...`.
**Fix**: Update links to use `?locationId=...`.

### 🔴 Issue: Build Errors
**Cause**: Old `lib/tenant.ts` file might still exist.
**Fix**: Delete `lib/tenant.ts` and run `npm run build` again.

---

## 5. Verification Checklist

When troubleshooting or verifying this feature in the future:

- [ ] **Database**: Does the `Location` table exist?
- [ ] **Env**: Are `DATABASE_URL` and `DIRECT_URL` correct?
- [ ] **Auth**: Does the `crm_location_id` cookie get set on SSO?
- [ ] **Clerk**: Do users have `ghlLocationId` in their metadata?
- [ ] **Widget**: Does the iframe load with `?location=...` src?
