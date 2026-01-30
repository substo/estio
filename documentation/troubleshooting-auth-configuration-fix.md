# GHL Auth Logic & Documentation Summary

## 1. Documentation Analysis
You asked if the re-installation requirement was mentioned previously.
**Yes, it is documented in multiple places:**

*   **`documentation/ghl-reinstallation-guide.md`** (Section: "When Reinstallation IS Required"):
    > "1. OAuth Scope Changes: If you modify the scopes/permissions... **Reinstall required.**"
*   **`documentation/ghl-calendar-sync.md`** (Section: "Setup & Configuration"):
    > "User Action Required: After deployment, the admin must 'Sign In with GHL' to regenerate tokens with these new permissions."

## 2. Token Automation Analysis
You asked to specificially "automate the logic in every case we need a new token".

### Existing Automation (Expiry)
**Status: ✅ Already Implemented**
The script `lib/ghl/token.ts` (lines 33-35 & 131-146) already fully automates the refresh of *expired* tokens. It checks identifying `expiresAt` timestamps and will automatically request a new access token using the refresh token if needed.

### Scope Expansion (The Current Issue)
**Status: ❌ Cannot be Automated (Security Restriction)**
When you add *new* scopes (like `calendar.readonly`), the existing Refresh Token in your database is cryptographically bound to the *old* list of scopes. It is technically impossible to use it to request *new* privileges.
**Action Required**: The user MUST click "Authorize" again to grant the new permissions. This is a fundamental security feature of OAuth 2.0.

## 3. Improvements Implemented
To prevent confusion in the future, I have upgraded `lib/ghl/token.ts`.
Instead of failing with a generic 401 error, it now specifically detects "Scope Authorization" failures and logs:
> `[GHL Auth CRITICAL] Token lacks required scopes for [endpoint]. User must re-authenticate.`

This will make it immediately obvious when a manual re-connection is required versus a standard error.
