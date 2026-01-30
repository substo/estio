# Estio: Agency Setup Guide

Hello! Here are the instructions to add **Estio** to your GoHighLevel agency.

This setup will automatically add the app to **all your sub-accounts** at once.

## Step 1: Add the Custom Menu Link

1.  Log in to your **Agency Admin** account (app.gohighlevel.com).
2.  Go to **Settings** (bottom left) -> **Custom Menu Links**.
3.  Click **"Create New"**.
4.  Fill in the details:
    *   **Icon**: Select a house or building icon.
    *   **Link Title**: `Estio`
    *   **URL** (Copy & Paste exactly):
        ```
        https://estio.co/sso/init?locationId={{location.id}}&userId={{user.id}}&userEmail={{user.email}}
        ```
    *   **Show link on**: Select **"All Accounts"** (or specific accounts if you prefer).
    *   **Open in**: `Current Window` (or `New Tab` if you prefer).
5.  Click **Save**.

## Step 2: How It Works for Your Users

That's it! The link will now appear in the sidebar of your sub-accounts.

**First-Time Access (One-Time Setup):**
*   When a user clicks the link for the first time, the app will **verify their permissions**.
*   **Admins** will be redirected to an authorization page to connect the location.
*   **Standard Users** will see an "Access Denied" message if the app hasn't been installed yet.
*   *Note: The authorization page opens a new tab where the web address will briefly change to `leadconnectorhq.com` for security.*
*   Once complete, they simply **close the tab and refresh** their dashboard.

**Daily Use:**
*   After the one-time setup, clicking the link will **automatically sign them in** to their Estio Dashboard.
*   No passwords required!

---
**Technical Note for Agency Owners:**
The URL uses "Merge Tags" (`{{location.id}}`). GoHighLevel automatically replaces these with the correct ID for each sub-account, so you don't need to create separate links for each client!
