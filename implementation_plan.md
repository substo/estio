# IMPL-001: Popup Bridge for GHL Iframe Auth

## Goal
Resolve the "Redirected too many times" error in GoHighLevel iframes by implementing the **Popup Bridge** pattern. This allows the application to establish a First-Party session via a popup, then pass control back to the iframe.

## User Review Required
> [!IMPORTANT]
> This change modifies the entry point `/sso/init`.
> It converts it from an immediate-redirect API route to a **User Interface Page**.
> This is a non-breaking change for the URL, but changes the behavior (User sees a "Loading" or "Connect" screen instead of a blank redirect).

## Proposed Changes

### 1. New API Endpoint: `/api/sso/start`
**File**: `app/api/sso/start/route.ts` (New)
- **Content**: Logic moved from current `app/(main)/sso/init/route.ts`.
- **Change**: Accepts an optional `redirect_url` query param and passes it forward.

### 2. Update Validation Logic
**File**: `app/(main)/sso/validate/route.ts`
- **Change**: Read `redirect_url` from query params.
- **Change**: Pass `redirect_url` to the Clerk Sign-In endpoint.

### 3. New Callback Page
**File**: `app/(main)/sso/popup-callback/page.tsx` (New)
- **Content**: A simple "Success" page.
- **Logic**: Sends `window.opener.postMessage('auth-success')` and closes itself.

### 4. Convert Entry Point
**File**: `app/(main)/sso/init/route.ts` -> DELETE
**File**: `app/(main)/sso/init/page.tsx` -> CREATE
- **Content**: The "Gatekeeper" UI.
- **Logic**:
    - Detects Iframe.
    - Checks `document.hasStorageAccess()`.
    - **Happy Path**: Redirects to `/api/sso/start` (if access exists).
    - **Fallback**: Shows "Connect Account" button -> Opens Popup to `/api/sso/start?redirect_url=/sso/popup-callback`.
    - Listens for "auth-success" message -> Reloads page (now authenticated).

## Verification Plan

### Automated Tests
- None (Hard to test Iframe/Storage Access automatically).

### Manual Verification
1.  **Direct Visit**: Visit `/sso/init?userId=...` in a new tab. Should redirect to Admin (Happy Path).
2.  **Iframe Simulation**:
    - Create a local HTML file with an `<iframe src="http://localhost:3000/sso/init...">`.
    - Open in Incognito/Safari.
    - Verify "Connect" button appears.
    - Verify Popup opens, logs in, closes.
    - Verify Iframe reloads and shows Admin.
