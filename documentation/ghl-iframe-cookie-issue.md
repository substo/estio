# Troubleshooting: Redirect Loop in GHL Iframe

## The Error
**Message**: `clerk.substo.com redirected you too many times.`
**Code**: `ERR_TOO_MANY_REDIRECTS`
**Where**: Inside the GoHighLevel (GHL) Custom Menu Link iframe.

## The Cause: Third-Party Cookie Blocking

This is a browser security feature, not a bug in the code.

1.  **Context**: The application (`estio.co`) is running inside an **Iframe** on `app.gohighlevel.com`.
2.  **The Check**: When the app loads, it tries to set/read a **Session Cookie** to know who you are.
3.  **The Block**: Browsers (especially **Safari**, **Chrome Incognito**, and increasingly standard Chrome) see `substo.com` as a "Third-Party" to `gohighlevel.com`.
4.  **The Loop**:
    *   **App**: "I don't see a cookie. Go to Clerk to log in." -> Redirects.
    *   **Clerk**: "You are already logged in!" -> Redirects back to App.
    *   **App**: "I *still* don't see a cookie (Browser blocked it)." -> Redirects to Clerk.
    *   **Result**: Infinite loop until the browser gives up.

---

## Solutions

### Solution 1: "Open in New Tab" (Recommended)
The simplest and most reliable fix is to break out of the iframe.

1.  Go to **GoHighLevel Settings** -> **Custom Menu Links**.
2.  Edit the "Real Estate IDX" link.
3.  Change **"Open in"** from `iFrame` to **`New Tab`**.
4.  Save.

**Why this works**: When opened in a new tab, `estio.co` becomes the "First-Party" site. Browsers always trust First-Party cookies.

### Solution 2: Browser Settings (For Devs Only)
If you must test in an iframe:
- **Chrome**: Go to Settings -> Privacy and security -> Third-party cookies -> Select "Allow third-party cookies".
- **Incognito**: verify that "Block third-party cookies" is OFF (it is ON by default).
- **Safari**: Uncheck "Prevent cross-site tracking" (Settings -> Privacy).

**Note**: You cannot ask all your clients to change these settings. This is why Solution 1 is preferred.

### Solution 3: The "Pop-up" Handshake (Advanced)
If you absolutely require an iframe experience, the architecture must change to a "Storage Access" flow:
1.  The iframe loads a "Click to Connect" button (no auto-redirect).
2.  User clicks -> Opens a specific **Popup Window**.
3.  The Popup is First-Party, so it can set the cookie.
4.  The Popup communicates back to the iframe (via `postMessage`) that the session is ready.
5.  Verification relies on the token, not just the cookie.

*This requires significant development work and is often flaky on mobile devices.*

---

## Verification
To confirm this is the issue:
1.  Copy the long Custom Menu Link URL (from the error page or settings).
2.  Paste it directly into a **New Browser Tab**.
3.  If it loads successfully, **Cookie Blocking is 100% the cause**.
