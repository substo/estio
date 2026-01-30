# Agency Onboarding & Setup Walkthrough

## Overview
This document explains the complete onboarding flow for Real Estate Agencies installing the Estio app. It covers the user journey from the homepage to the final GoHighLevel installation.

## 1. The Entry Point: Homepage
**URL:** `https://estio.co`

We have split the homepage actions to serve two distinct audiences:

1.  **Regular Users (Agents/Buyers):**
    *   **Button:** "Get Started"
    *   **Action:** Redirects to `/admin` (triggers Clerk Login/Signup).
    *   **Purpose:** For users who already have an account or want to sign up directly.

2.  **Agency Owners (Your Clients):**
    *   **Button:** "Agency Installation"
    *   **Action:** Redirects to `/setup`.
    *   **Purpose:** For agencies who need to install the app into their GoHighLevel account.

## 2. The Public Setup Page
**URL:** `https://estio.co/setup`

This is a public, unauthenticated page designed to be shared directly with potential clients. You can send this link in emails, DMs, or on sales calls.

### Key Features:
*   **The "Magic Link"**: A pre-generated URL containing GoHighLevel Merge Tags.
    ```
    https://estio.co/sso/init?locationId={{location.id}}&userId={{user.id}}&userEmail={{user.email}}
    ```
*   **One-Click Copy**: A button to easily copy the link.
*   **Step-by-Step Guide**: Clear instructions on how to add this link to GHL Custom Menu Links.
*   **"Get Started / Login" Button**: Allows users to jump to the login screen if they are already set up.

## 3. The Installation Process (Client Side)

When an Agency Owner follows the instructions on the Setup page:

1.  **Copy Link**: They copy the Magic Link from `estio.co/setup`.
2.  **GHL Settings**: They go to their Agency Settings -> Custom Menu Links.
3.  **Create Link**: They paste the URL and set it to show on "All Accounts".
4.  **Done**: The "Real Estate IDX" link immediately appears in the sidebar of **all** their sub-accounts.

## 4. The User Experience (End User)

Once installed, here is what happens when a user (Agent) clicks the link in GHL:

1.  **GHL Injects IDs**: GoHighLevel replaces `{{location.id}}` with the actual Location ID (e.g., `ys9qMNT...`).
2.  **First Click (One-Time Setup)**:
    *   User sees the **"One-Time Setup"** page (Pre-Auth page).
    *   They click "Authorize".
    *   They are redirected to GHL (`leadconnectorhq.com`) to grant permissions.
    *   They are redirected back to the Dashboard.
3.  **Subsequent Clicks (SSO)**:
    *   User is **automatically logged in**.
    *   No setup page, no OAuth consent.
    *   Seamless access to the IDX Dashboard.

## 5. Why This Approach?
*   **Scalable**: You don't need to generate unique links for every client. One link works for everyone.
*   **Self-Service**: Clients can install it themselves without your help.
*   **Professional**: The `/setup` page looks polished and branded.
*   **Flexible**: Supports both direct signups and GHL-integrated users.
