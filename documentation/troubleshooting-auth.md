# Troubleshooting Auth: Tenant → Location Refactor

**Issue**: "Internal Server Error" during authentication (SSO/OAuth).
**Root Cause Analysis**:
1.  **Database Drift**: The `Location` table was missing immediately after the code update (causing 500 errors).
2.  **Empty Database**: After reset, the database is empty. SSO requires a `Location` record to exist.
3.  **Environment Variables**: Missing `JWT_SECRET` or GHL credentials can cause signature verification to fail.

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
