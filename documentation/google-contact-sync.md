# Google Contact Sync Specification

## Overview
The Google Contact Sync feature provides a **3-way synchronization** between Estio Contacts, Google Contacts, and GoHighLevel. Its primary goal is to **solve the "Caller ID" problem**—identifying leads instantly on incoming calls without cluttering the contact's actual Name field.

When a contact is created or updated in Estio (via the admin page or WhatsApp), it automatically syncs to both **Google Contacts** and **GoHighLevel (GHL)**, ensuring the "Visual ID" (Caller ID string) is consistent across all platforms.

## The "Visual ID" Strategy

### Problem
Real estate agents need to know *exactly* who is calling (e.g., "Budget? Looking for Rent? Which Ref?") before picking up.
-   **Old Approach**: Saving contacts as "John Doe Rent 2bdr".
    -   *Issue*: Leads to messy data, unprofessional emails ("Hi John Doe Rent 2bdr..."), and duplication.
-   **Estio Approach**: Keep the Name clean ("John Doe") but use the **Company / Organization** field for the summary.

### Solution Mapping
| Platform | Field | Value | Visual Result (Incoming Call) |
| :--- | :--- | :--- | :--- |
| **Estio** | `name` | John Doe | **John Doe** |
| | `companyRoles` | *Internal Relations* | |
| **Google Contacts** | `names.givenName` | John Doe | **John Doe** |
| | `organizations[0].name` | **Lead Rent DT1234 Paphos €750** | **Lead Rent DT1234 Paphos €750** |
| **GoHighLevel** | `name` | John Doe | John Doe |
| | `companyName` | **Lead Rent DT1234 Paphos €750** | **Lead Rent DT1234 Paphos €750** |

This guarantees that on iOS/Android, the incoming call screen shows the Name (big) and the "Company" (small, but visible), providing the context needed.

---

## Technical Architecture

### 1. Data Model Changes
-   **User Model**:
    -   `googleAccessToken`, `googleRefreshToken`: Stores OAuth credentials.
    -   `googleSyncEnabled`: Toggle for the feature.
-   **Contact Model**:
    -   `googleContactId`: Maps 1:1 to a Google Person `resourceName`.
    -   `lastGoogleSync`: Timestamp of last successful push.
    -   `googleContactUpdatedAt`: Timestamp from Google's metadata for "last write wins" comparison.

### 2. Synchronization Logic (3-Way Sync)

#### Sync Trigger Matrix

| Trigger | GHL Sync | Google Sync | Code Location |
| :--- | :---: | :---: | :--- |
| **Create Contact** (via admin page) | ✅ | ✅ | `app/(main)/admin/contacts/actions.ts` → `createContact()` |
| **Update Contact** (via admin page) | ✅ | ✅ | `app/(main)/admin/contacts/actions.ts` → `updateContact()` |
| **New WhatsApp Message** (from unknown) | ✅ | ✅ | `lib/whatsapp/sync.ts` → `processNormalizedMessage()` |
| **New Email** (from unknown) | ✅ | ✅ | `lib/google/gmail-sync.ts` → `processMessage()` |
| **Contact Changed on Mobile** | — | ✅ (inbound) | `lib/google/people.ts` → `syncContactsFromGoogle()` |

#### A. Outbound (Estio → Google + GHL)
*   **Trigger**: Contact Creation or Update from any source.
*   **Google Logic**: `lib/google/people.ts` → `syncContactToGoogle(userId, contactId)`
*   **GHL Logic**: `lib/ghl/stakeholders.ts` → `syncContactToGHL(accessToken, contactData)`
*   **Authentication**: Uses `googleapis` with offline access (Refresh Token) to maintain connection indefinitely.

#### B. WhatsApp Integration (`lib/whatsapp/sync.ts`)
When a new message arrives:
1.  **Name Capture**: We capture the user's **Push Name** (Profile Name) from WhatsApp.
    -   *If available*: "Martin Green"
    -   *If missing*: "WhatsApp User +357..."
2.  **Contact Creation**: Created locally in Estio.
3.  **Opportunistic Sync**: The system checks if any Agent in the current Location has `googleSyncEnabled`. If yes, it immediately pushes this new lead to their Google Contacts AND syncs to GHL.
    -   **Result**: Even unsolicited WhatsApp messages result in a saved contact on the agent's phone and in GHL.

#### C. GoHighLevel Sync (`lib/ghl/stakeholders.ts`)
*   When syncing to GHL, we inject the generated Visual ID into the GHL `companyName` field.
*   Sync is triggered on both contact creation and update.

#### D. User-Location Relationship
*   The sync queries users via the many-to-many relation: `locations: { some: { id: locationId } }`
*   This ensures the correct user with `googleSyncEnabled` is found for each location.
*   **Offboarding**: When a user is removed from a team, their Google Sync credentials (`googleAccessToken`, `googleRefreshToken`) are immediately revoked/cleared to prevent unauthorized syncing.

### 3. Visual ID Generation (`lib/google/utils.ts`)
The string is dynamically generated based on the Contact's latest data to ensure it is always up to date.

**Format**: `Lead [Goal] [Ref] [District] [Price]`

**Logic**:
1.  **Prefix**: 
    -   If `status == "New"`, Prefix = "Lead New"
    -   Else, "Lead Rent" or "Lead Sale" based on `leadGoal`.
2.  **Ref**: First property ref from `propertyRoles` (Interested/Viewing).
3.  **District**: From `requirementDistrict`.
4.  **Price**: From `requirementMaxPrice`.

*Example*: `Lead Rent DT4012 Paphos €750`

---

## Google Cloud Setup Guide

To enable this feature, you must configure a project in the Google Cloud Console.

### Phase 1: Create Project & Enable API
1.  Go to [Google Cloud Console](https://console.cloud.google.com/).
2.  Create a **New Project** (e.g., names "Estio CRM").
3.  In the Dashboard, search for **"Google People API"**.
4.  Click **Enable**.

### Phase 2: OAuth Consent Screen
1.  Go to **APIs & Services > OAuth consent screen**.
2.  **User Type**: Choose **External** (unless you have a Google Workspace organization and only want internal users).
3.  **App Information**:
    -   App Name: "Estio CRM"
    -   User Support Email: Your email.
    -   Developer Contact Info: Your email.
4.  **Scopes**:
    -   Click **Add or Remove Scopes**.
    -   Search for and select:
        -   `.../auth/contacts` (See, edit, download, and permanently delete your contacts)
        -   `.../auth/userinfo.email` (See your primary Google Account email address)
    -   Save.
5.  **Test Users** (Important for "External" app in "Testing" mode):
    -   Add the email addresses of the agents who will be using this sync feature.
    -   *Note*: Until you "Publish" the app, only these users can connect.

### Phase 3: Credentials (Client ID & Secret)
1.  Go to **APIs & Services > Credentials**.
2.  Click **Create Credentials** -> **OAuth client ID**.
3.  **Application Type**: **Web application**.
4.  **Name**: "Estio CRM Web".
5.  **Authorized JavaScript origins**:
    -   `https://estio.co`
    -   `http://localhost:3000` (for local dev)
6.  **Authorized redirect URIs** (CRITICAL):
    -   `https://estio.co/api/google/callback`
    -   `http://localhost:3000/api/google/callback` (for local dev)
7.  Click **Create**.
8.  **Copy** the `Client ID` and `Client Secret`.

### Phase 4: Env Config
Add these to your `.env` and `.env.local` (and Vercel/Server env):

```env
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here

# IMPORTANT: For local development with ngrok, set this to your ngrok URL.
# The OAuth callback uses this to construct the redirect URI.
APP_BASE_URL=https://your-ngrok-url.ngrok-free.app
```

> [!IMPORTANT]
> The `GOOGLE_CLIENT_SECRET` from the downloaded JSON file (e.g., `client_secret_*.json`) starts with `GOCSPX-`. Ensure you copy the **full** secret including the `G` prefix.

### Phase 5: Verification (Optional but Recommended)
If you plan to open this to the public (any Google user), you will need to submit the app for **Google Verification** because the `contacts` scope is considered "Sensitive".
-   If this is just for your internal team, you can keep the app in **Testing** mode and just add all agents as **Test Users**. No verification needed.

### 3. User Activation
1.  Go to `/admin/settings/integrations/google`.
2.  Click "Connect Account".
3.  Grant permissions.
4.  You will be redirected back to the integrations page with `?google_connected=true`.

Once connected, sync is automatic.

---

## Troubleshooting

### `invalid_client` Error
This error occurs during the OAuth callback when exchanging the authorization code for tokens.

**Common Causes:**
1.  **Incorrect Client Secret**: The secret was copied incorrectly. Ensure it starts with `GOCSPX-` (check for typos like missing the leading `G`).
2.  **Redirect URI Mismatch**: The `redirect_uri` sent to Google during token exchange doesn't match any URI registered in the Google Cloud Console.
    -   **Fix**: Ensure `APP_BASE_URL` in your `.env` / `.env.local` matches the ngrok URL (or production domain) *and* that this exact callback URL is added to **Authorized redirect URIs** in Google Cloud Console.
    -   Example: `https://your-ngrok-url.ngrok-free.app/api/google/callback`
3.  **`.env` vs `.env.local` Conflict**: `.env.local` overrides `.env`. Ensure credentials are consistent in both files.

### `URL is malformed "undefined/..."` Error
This occurs if `NEXT_PUBLIC_APP_URL` or `APP_BASE_URL` is not set.

**Fix**: Ensure `APP_BASE_URL` is defined in your environment. The callback route uses this for redirects.

### "Google hasn't verified this app" Warning
This is expected for apps in **Testing** mode. Click **Advanced > Go to [App Name] (unsafe)** to proceed. This warning won't appear once the app is published.

---

## Implementation & Hardening Guide (Reference)

This section documents the specific technical solutions implemented to harden the 3-way sync logic (Jan 2026).

### 1. GoHighLevel (GHL) Sync Hardening
Synchronization to GHL has been robustly engineered to handle API quirks and ensure data integrity ("Golden Record").

#### A. ID-Based Sync (Optimization)
**Strategy**: Always attempt to sync using the known `ghlContactId` first.
-   **Why**: Updating by ID is O(1) and guaranteed correct, whereas searching by phone/email is slower and prone to fuzzy matching errors.
-   **Method**: `syncContactToGHL` accepts an optional `currentGhlId`. It attempts a `PUT /contacts/{id}` immediately.
-   **Fallback**: If the ID update fails (e.g., 404 Not Found if deleted in GHL), the system gracefully falls back to the Search logic.

#### B. Handled API Errors
| Error | Cause | Fix Implemented |
| :--- | :--- | :--- |
| **401 Unauthorized** | Access Token expired. | **Auto-Refresh**: Switched to `ghlFetchWithAuth` wrapper. It catches 401s, uses the refresh token to get a new access token, updates the DB, and retries the request automatically. |
| **403 Forbidden** | Missing `locationId` in query. | **Mandatory Scope**: Added `locationId` to *all* search queries (e.g. `/contacts/?locationId=...&query=...`). GHL requires this context for all operations. |
| **422 Unprocessable** | Invalid Payload for Update. | **Payload Cleaning**: The `locationId` field is **REQUIRED** for `POST` (Create) but **FORBIDDEN** for `PUT` (Update) bodies. The code now physically removes `locationId` from the payload before sending a PUT request. |
| **400 Duplicate** | Contact exists but search missed it. | **Recovery**: If a `POST` fails with "Duplicate Contact", we catch the error, extract the *existing* ID from the error metadata, and immediately retry as a `PUT` (Update) to that ID. |

#### C. Search Logic (Deduplication)
If no ID is known, we perform a cascaded search to find the contact:
1.  **Search by Email** (Exact match)
2.  **Search by Clean Phone** (Digits only)
3.  **Search by Raw Phone** (As provided)

---

### 2. Google Contact Sync Hardening
Google's People API is strict about concurrency.

#### A. ETag Handling (The "400 Bad Request" Fix)
**Problem**: Google's `people.updateContact` API returns a 400 error if you try to update a contact without providing its current `etag`. This is to prevent "overwrite wars" between clients.
**Solution**:
1.  **Read**: First, perform a `people.get({ resourceName })` to fetch the current contact *just* to get its `etag`.
2.  **Write**: Include this `etag` in the `requestBody` of the update call.
**Code**: `lib/google/people.ts`

#### B. Field Masks
Updates must specify exactly which fields are being changed via the `updatePersonFields` query parameter (e.g., `names,organizations,phoneNumbers`).

---

### 3. Inbound Sync (Google → Estio) — "Last Write Wins"

**Implemented**: January 2026

Bidirectional sync ensures that contact edits made on mobile (Google Contacts app) are reflected in Estio, and vice versa. The newest change always wins.

#### A. Inbound Sync Logic (`lib/google/people.ts` → `syncContactsFromGoogle()`)
1.  Uses Google's `syncToken` for efficient delta sync (only changed contacts).
2.  For each changed contact:
    -   Compares `metadata.sources[].updateTime` from Google with local `Contact.updatedAt`.
    -   **If Google is newer**: Updates local contact with Google's Name/Email/Phone.
    -   **If Estio is newer**: Skips (outbound sync will handle it).
3.  Creates new contacts from Google Contacts if not in CRM (as "Lead").

#### B. "Last Write Wins" on Outbound
-   Before pushing to Google, `syncContactToGoogle()` checks if Google's version is newer.
-   If yes, it **skips the push** to avoid overwriting mobile edits.

#### C. Auto-Create Contacts from Gmail
When an email arrives from an unknown sender (`lib/google/gmail-sync.ts`):
1.  Extracts display name from email header (e.g., "John Doe" from "John Doe <john@example.com>").
2.  Looks up sender in Google Contacts for richer data.
3.  Creates new Lead contact automatically.

#### D. Scheduled Inbound Sync
-   `api/cron/gmail-sync` runs every 5 minutes.
-   After Gmail sync, it also runs `syncContactsFromGoogle()` for each user.
-   This ensures mobile edits are pulled within 5 minutes.

---

### 4. Conflict Resolution & Self-Healing
**Implemented**: January 2026

To prevent "Sync Death Loops" where a deleted contact in Google causes perpetual errors in Estio, we implemented a robust Self-Healing and Conflict Resolution strategy.

#### A. The "Invalidate & Flag" Strategy
When the system encounters a **404 Not Found** (Stale ID) error during an outbound sync:
1.  **Invalidate**: The `googleContactId` is immediately set to `null`.
2.  **Flag**: The `error` field is set to `\"Google Link Broken. Save to re-sync.\"`
3.  **Result**: The contact becomes "Unlinked" but with an error flag, alerting the user to take action.

#### B. Google Sync Manager (UI)
We replaced the simple "Conflict Modal" with a comprehensive **Google Sync Manager** accessible from:
-   **Contact List**: Status Icon (🟢 Linked, ⚪ Unlinked, ⚠️ Error).
-   **Contact Profile**: "Manage Sync" button in the header.

**Capabilities:**
-   **Healthy State**: View live side-by-side comparison of Estio vs Google data.
    -   Actions: *Push Local -> Google*, *Pull Google -> Local*, *Unlink*.
-   **Unlinked State**: Search Google Contacts to manually link to an existing record, or Create a new one.
-   **Conflict State**: Resolve data mismatches or broken links.

#### C. Manual "Link Only"
The Sync Manager supports a **"Link Only"** action. This connects an Estio Contact to a Google Contact **without overwriting data** on either side. This is useful when you know they are the same person but want to preserve distinct data on each platform (e.g., maintaining a specific "Visual ID" company name in Google while keeping role data in Estio).

---

## Future Improvements
-   **AI Extraction**: Currently, `Visual ID` is rule-based. We plan to add an AI step to extract intent/budget from the *first* WhatsApp message to populate the fields immediately, making the Visual ID rich from the very first second.
