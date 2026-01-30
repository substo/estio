# Walkthrough - Popup Bridge for GHL Auth

I have implemented the **Popup Bridge** pattern to resolve the "Redirected too many times" error caused by third-party cookies in GoHighLevel iframes.

## Changes

### 1. New "Gatekeeper" UI (`/sso/init`)
Instead of immediately redirecting (which causes loops), the entry page now checks its environment.

**Logic Flow:**
1.  **Checks environment**: Are we in an iframe?
2.  **Checks capabilities**: Can we access storage (cookies)?
3.  **Action**:
    -   **If access is available**: Auto-redirects to login (Happy Path).
    -   **If access is blocked**: Displays a **"Connect Securely"** button.

### 2. The Popup Flow
When the user clicks "Connect Securely":
1.  Opens a popup window to `/api/sso/start`.
2.  The popup processes the login in a **First-Party Context** (no iframe restrictions).
3.  On success, redirects to `/sso/popup-callback`.
4.  The callback page messages the iframe: `postMessage('auth-success')`.
5.  The popup closes automatically.

### 3. The Iframe Reload
When the iframe receives `auth-success`, it reloads. Since the session was established in the popup (First-Party), the iframe *may* now have access via the session cookie (depending on browser specific partition rules), OR specifically, the `admin` page redirection logic will now work because `clerk` sees the user as logged in on the domain level.

## Verification

To verify this fix:
1.  **Deploy** the changes.
2.  **Open GoHighLevel**.
3.  **Click the Custom Menu Link**.
4.  **Expectation**:
    -   **Chrome (Standard)**: Should auto-login (if allowed).
    -   **Incognito / Safari**: Should see the "Connect Account" UI.
    -   **Click Button**: Popup should open -> verify -> close.
    -   **Result**: The iframe should load the Admin Dashboard.

## Files Created/Modified
-   `app/(main)/sso/init/page.tsx` (Gatekeeper UI)
-   `app/api/sso/start/route.ts` (API Logic)
-   `app/(main)/sso/popup-callback/page.tsx` (Callback Handler)
-   `app/(main)/sso/validate/route.ts` (Updated to handle redirect_url)
