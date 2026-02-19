# Troubleshooting Auth: Tenant → Location Refactor

**Issue**: "Internal Server Error" during authentication (SSO/OAuth).
**Root Cause Analysis**:
1.  **Database Drift**: The `Location` table was missing immediately after the code update (causing 500 errors).
2.  **Empty Database**: After reset, the database is empty. SSO requires a `Location` record to exist.
3.  **Environment Variables**: Missing `JWT_SECRET` or GHL credentials can cause signature verification to fail.

---

## Clerk 429 Prevention (Implemented)

The authentication path was optimized to reduce Clerk Backend API usage and prevent `429 Too Many Requests`.

### What changed

1. **DB-first location resolution** in `lib/auth/location-context.ts`
   - Uses `auth()` (JWT-local) + local DB lookup (`db.user` with `clerkId`) as the happy path.
   - Only falls back to `clerkClient()` for first-time users or missing local linkage.
   - Remaining Clerk calls are wrapped with `429` handling and graceful fallback.

2. **Dashboard layout no longer uses `currentUser()`**
   - `app/(main)/admin/layout.tsx` now uses `auth()` + local DB lookup.
   - If local user record is missing, redirects to sign-in.
   - Includes explicit 429 handling around auth lookup.

> [!IMPORTANT]
> `auth().userId` is a **Clerk ID**. Always query local users using `clerkId`, never the internal `id`.

### Why this fixes rate limiting

- `auth()` is JWT-local (no Clerk Backend API call).
- Most admin requests now avoid `clerkClient().users.getUser(...)`.
- Clerk API usage is limited to fallback/self-heal scenarios.

### Verification commands

After deployment and normal navigation in admin pages:

```bash
ssh root@138.199.214.117 "pm2 logs estio-app --lines 200 --nostream 2>&1 | grep -E '429|Too Many|Unauthorized'"
```

Expected result: no new auth-related 429 bursts.

Count-only check:

```bash
ssh root@138.199.214.117 "pm2 logs estio-app --lines 500 --nostream 2>&1 | grep -c '429'"
```

Expected result: `0` (or a significantly reduced count vs pre-fix baseline).

---

## Comprehensive Fix Plan

### Phase 1: Verify Environment

Ensure your `.env` file has all required variables. The refactor relies on these being correct.

- [ ] **JWT_SECRET**: Required for SSO token signing.
  - Generate one if missing: `openssl rand -base64 32`
- [ ] **GHL_CLIENT_ID** & **GHL_CLIENT_SECRET**: Required for OAuth.
- [ ] **APP_BASE_URL**: Should be `https://estio.co` (or `http://localhost:3000` for local).

### Phase 2: Populate Database (OAuth Flow)

Since the database was reset, it has **0 locations**. You cannot SSO into a location that doesn't exist.

1.  **Start OAuth Flow**:
    Navigate to:
    ```
    https://estio.co/api/oauth/start
    ```
    (Or `http://localhost:3000/api/oauth/start` if testing locally)

2.  **Select Sub-Account**:
    Choose the GoHighLevel sub-account you want to connect.

3.  **Verify Success**:
    You should see the "Setup Complete" page.
    This creates the `Location` record in the database.

### Phase 2.5: Fix Installation Loop

If you keep seeing the "One-Time Setup" page after authorizing:

1.  **Close the Success Tab**: Ensure you closed the tab that said "Setup Complete".
2.  **Refresh the CRM**: Go back to your GoHighLevel tab and **refresh the page**.
3.  **Check Cookies**: If it persists, clear your cookies for `estio.co`.

### Phase 3: Retry SSO

Once the location exists:

1.  **Go to GoHighLevel**: Open the Custom Menu Link for the IDX app.
2.  **Verify Redirect**: It should now find the location in the DB and redirect to the dashboard.
3.  **Check Cookies**: Ensure `crm_location_id` cookie is set.

### Phase 4: Update Widget Embeds

If the error comes from the widget:

1.  **Check Embed Code**:
    Ensure you are using `data-location="LOCATION_ID"` and NOT `data-tenant`.
2.  **Check Loader URL**:
    Ensure it points to the correct domain.

### Phase 5: Troubleshooting Access Denied (403)

If you see "Unauthorized: You do not have access to this location" when managing contacts:

1.  **Check User-Location Link**:
    The user must be linked to the Location in the database.
    ```bash
    npx tsx -e 'import db from "./lib/db"; db.user.findUnique({ where: { email: "USER_EMAIL" }, include: { locations: true } }).then(console.log)'
    ```
2.  **Fix Link**:
    If the locations array is empty, you may need to manually link them or re-run the `ensureUserExists` flow.

---

## Debugging Commands

**Check if Location exists in DB:**
```bash
npx tsx -e 'import db from "./lib/db"; db.location.findMany().then(console.log)'
```

**Check Logs:**
```bash
cat debug.log
```
