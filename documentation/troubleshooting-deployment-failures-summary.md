# Deployment Issue Resolution Summary
**Date:** November 26, 2025
**Status:** ✅ ALL ISSUES RESOLVED

## 1. GHL API Permissions ("Internal Server Error")
**Issue:** The app was crashing with `TypeError: Cannot read properties of undefined (reading 'toLowerCase')` because `ghlUser.role` was undefined.
**Root Cause:** The GoHighLevel API returns `role`, `type`, and `locationIds` nested inside a `roles` object (e.g., `ghlUser.roles.role`), not at the top level as previously assumed.
**Fix:** 
- Updated `GHLUser` interface in `lib/ghl-api.ts` to reflect the nested structure.
- Updated `app/sso/validate/route.ts` and `lib/clerk-sync.ts` to access `ghlUser.roles.role` with fallback to legacy fields.

## 2. Database Connection ("Prepared statement already exists")
**Issue:** Prisma queries failed with `Error [PrismaClientUnknownRequestError]: ... message: "prepared statement \"s0\" already exists"`.
**Root Cause:** The application connects to Supabase via the **Transaction Pooler** (port 6543). Prisma uses prepared statements by default, which are incompatible with transaction poolers.
**Complication:** A stale `.env.production` file on the server was overriding the updated `.env` file, preventing the fix from being applied.
**Fix:**
- Deleted the stale `.env.production` file on the server.
- Updated `deploy-direct.sh` to append `?pgbouncer=true` to both `DATABASE_URL` and `DIRECT_URL`.
- Updated `deploy-direct.sh` to automatically remove `.env.production` during deployment.

## 3. Redirect Loop / Connection Refused
**Issue:** Users saw "localhost refused to connect" when accessing the app via the custom menu link.
**Root Cause:** The app was using `request.url` to construct the redirect URL for Clerk authentication. Behind the Nginx proxy, `request.url` resolved to `http://localhost:3001/...`.
**Fix:**
- Updated `app/sso/validate/route.ts` to use the `APP_BASE_URL` environment variable (set to `https://estio.co`) for constructing redirect URLs.

## Verification
- **SSO Flow:** Successfully authenticates GHL users with "ACCOUNT-ADMIN" role.
- **Database:** All queries execute successfully via the transaction pooler.
- **Redirects:** Users are correctly redirected to the public domain (`https://estio.co`).
- **Permissions:** Configurable via `ALLOWED_GHL_ROLES` environment variable.

## Key Configuration Requirements
- **Environment Variables:**
  - `ALLOWED_GHL_ROLES=admin,user` (or as needed)
  - `APP_BASE_URL=https://estio.co`
  - `DATABASE_URL` must end with `?pgbouncer=true` if using Supabase Transaction Pooler (port 6543).
