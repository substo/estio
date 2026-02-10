# Google Contact Sync Specification

## Overview
The Google Contact Sync feature provides a **Manual synchronization** mechanism between Estio Contacts, Google Contacts, and GoHighLevel. Its primary goal is to **solve the "Caller ID" problem**—identifying leads instantly on incoming calls without cluttering the contact's actual Name field.

> [!IMPORTANT]
> **Manual Control Only**: Previous logic relied on automatic background synchronization. As of Feb 2026, **all automatic syncs are disabled**. Updates ONLY occur when a user explicitly clicks "Sync", "Link", or "Import" in the Google Sync Manager.

## The "Visual ID" Strategy

### Problem
Real estate agents need to know *exactly* who is calling (e.g., "Budget? Looking for Rent? Which Ref?") before picking up.
-   **Old Approach**: Saving contacts as "John Doe Rent 2bdr".
    -   *Issue*: Leads to messy data, unprofessional emails ("Hi John Doe Rent 2bdr..."), and duplication.
-   **Estio Approach**: Keep the Name clean ("John Doe") but use the **Company / Organization** field for the summary.

### Solution Mapping
| Platform | Field | Value | Visual Result (Incoming Call) |
| :--- | :--- | :--- | :--- |
| **Estio** | `firstName` | John | **John Doe** |
| | `lastName` | Doe | |
| | `dateOfBirth` | 1980-01-01 | |
| | `address` | Main St, New York | |
| | `companyRoles` | *Internal Relations* | |
| **Google Contacts** | `names.givenName` | John | **John Doe** |
| | `names.familyName` | Doe | |
| | `birthdays` | 1980-01-01 | |
| | `addresses` | Main St, New York | |
| | `organizations[0].name` | **Lead Rent DT1234 Paphos €750** | **Lead Rent DT1234 Paphos €750** |
| **GoHighLevel** | `firstName` | John | John Doe |
| | `lastName` | Doe | |
| | `dateOfBirth` | 1980-01-01 | |
| | `address1` | Main St | |
| | `city` | New York | |
| | `companyName` | **Lead Rent DT1234 Paphos €750** | **Lead Rent DT1234 Paphos €750** |

This guarantees that on iOS/Android, the incoming call screen shows the Name (big) and the "Company" (small, but visible), providing the context needed.

---

## Technical Architecture

### 1. Data Model Changes
-   **User Model**:
    -   `googleAccessToken`, `googleRefreshToken`: Stores OAuth credentials.
    -   `googleSyncEnabled`: Toggle for the feature.
    -   `googleSyncDirection`: **(New)** Defines the "Source of Truth".
        -   `ESTIO_TO_GOOGLE`: Sync pushes Estio data to Google (Overwrites Google).
        -   `GOOGLE_TO_ESTIO`: Sync pulls Google data to Estio (Overwrites Estio).
-   **Contact Model**:
    -   `googleContactId`: Maps 1:1 to a Google Person `resourceName`.
    -   `lastGoogleSync`: Timestamp of last successful manual sync.
    -   `googleContactUpdatedAt`: Timestamp from Google's metadata for comparison.

### 2. Manual Synchronization Logic

#### Sync Trigger Matrix (Updated Feb 2026)

| Trigger | GHL Sync | Google Sync | Notes |
| :--- | :---: | :---: | :--- |
| **Create Contact** | ✅ (Auto) | ❌ | Google Sync is NOT automatic. |
| **Update Contact** | ✅ (Auto) | ❌ | Google Sync is NOT automatic. |
| **New WhatsApp Message** | ✅ (Auto) | ❌ | No opportunistic sync. |
| **Contacts Changed on Mobile**| — | ❌ | No background polling. |
| **User Clicks "Link/Sync"** | — | ✅ | **The ONLY way to sync.** |

#### Use Case: Manual Sync vs. Automatic
We moved to manual sync to prevent data accidents where a WhatsApp message from a typo'd name overwrites a carefully curated contact in Google. Users now have full agency.

### 3. Google Sync Manager (The Control Center)
The **Google Sync Manager** is the unified UI for managing connections.

#### Features
1.  **Source of Truth Setting**:
    -   Configurable per-user in **Settings > Integrations > Google**.
    -   Determines whether "Sync" means "Push" or "Pull".
    
2.  **Comparison View**:
    -   Shows side-by-side data of **Estio (Local)** vs **Google Remote**.
    -   Highlights differences.

3.  **Navigation**:
    -   **Next/Previous Buttons**: Rapidly move through the contact list without closing the modal.
    -   **Keyboard Shortcuts**: Arrow keys (`←`, `→`) supported.
    -   **Counter**: "Contact X of Y".

4.  **Smart Linking**:
    -   **Strict Search**: By Phone (digits) or Email. Includes automatic fallback for phone queries (see [Search Logic](#c-search-logic-strategy-strict-vs-broad)).
    -   **Fuzzy Search**: Uses Google's API to find matches by name.
    -   **Link Only**: Joins distinct records without overwriting data.

#### C. WhatsApp Integration (`lib/whatsapp/sync.ts`)
When a new message arrives:
1.  **Name Capture**: We capture the user's **Push Name** (Profile Name) from WhatsApp.
    -   *If available*: "Martin Green"
    -   *If missing*: "WhatsApp User +357..."
2.  **Contact Creation**: Created locally in Estio.
3.  **Auto-Sync Disabled**: We **DO NOT** automatically push this to Google Contacts. This prevents "Martin Green" in your phone from being overwritten by a casual "Martin" WhatsApp profile. Sync only happens when you manually click "Sync" in the manager.

#### C. GoHighLevel Sync (`lib/ghl/stakeholders.ts`)
*   When syncing to GHL, we inject the generated Visual ID into the GHL `companyName` field.
*   Sync is triggered on both contact creation and update.

#### D. User-Specific Google Connection
-   Each user/agent has their **own** Google connection (`googleSyncEnabled`, `googleRefreshToken`).
-   Google Sync features only work when the **current logged-in user** has connected their Google account.
-   **No Delegation**: The system does **not** borrow another user's Google connection. This prevents privacy issues (syncing to another agent's phone).
-   **Not Connected State**: If a user tries to use Google Sync features without being connected, they see an orange banner: "Google Not Connected - Connect in Integrations".
-   **Offboarding**: When a user is removed from a team, their Google Sync credentials (`googleAccessToken`, `googleRefreshToken`) are immediately revoked/cleared.

### 3. Visual ID Generation (`lib/google/utils.ts`)
The string is dynamically generated based on the Contact's latest data to ensure it is always up to date.

**Format**: `Lead [Goal] [Ref] [District] [Price]`

**Logic**:
1.  **Prefix**: 
    -   If `status == "New"`, Prefix = "Lead New"
    -   Else, "Lead Rent" or "Lead Sale" based on `leadGoal`.
2.  **Ref**: First property ref from `propertyRoles` (Interested/Viewing). Falls back to the property from the most recent **Viewing** if no explicit role exists.
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

### Session Expired (Re-Authentication)
If your Google OAuth token expires (e.g., after 6 months or password change) or is revoked:
-   **Old Behavior**: Sync would silently fail or show "No results found".
-   **New Behavior**: The Google Sync Manager displays a **Red Alert** ("Google Session Expired").
-   **Fix**: Click the **Reconnect Account** link in the alert to re-authorize the application.

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

### 3. Deprecated Features (Removed Feb 2026)

#### A. Inbound Sync (Google → Estio)
**Status**: **Disabled**.
Previously, a cron job pulled changes from Google Contacts every 5 minutes. This was disabled to prevent unwanted overwrites of Estio data. Users must now manually "Pull" data in the Sync Manager if they want to update Estio.

#### B. Auto-Create from Gmail
**Status**: **Disabled**.
Emails from unknown senders no longer auto-create contacts to clear up CRM noise.

#### C. "Last Write Wins" Logic
**Status**: **Removed**.
Since sync is now manual, we no longer need complex timestamp comparisons to determine the winner. The user is the winner.

---

### 4. Conflict Resolution & Self-Healing
**Implemented**: January 2026

To prevent "Sync Death Loops" where a deleted contact in Google causes perpetual errors in Estio, we implemented a robust Self-Healing and Conflict Resolution strategy.

#### A. Deletion Strategy (New Feb 2026)
Deleting a contact in Estio does **not** automatically delete it from Google Contacts by default, to prevent accidental data loss.
-   **Local Deletion**: Removes the contact from Estio database.
-   **Smart Deletion Options**: When deleting a contact, the administrator is presented with checkboxes to optionally delete the contact from:
    -   **Google Contacts**: If linked.
    -   **GoHighLevel**: If linked.
-   **Persistence**: The user's preference (e.g., "Always delete from Google") is remembered via local storage for convenience.

#### B. The "Self-Healing" Strategy (Feb 2026)
When the system encounters a **404 Not Found** (Stale ID) error during an outbound sync:
1.  **Search & Recover**: The system immediately searches Google Contacts by **Phone Number** and **Email**.
2.  **Re-Link**: If a match is found, it automatically updates the `googleContactId` to the correct ID and pushes the update. This is seamless to the user.
3.  **Fallback**: ONLY if no matching contact is found does it flag the error ("Google Link Broken") for manual resolution.

#### E. On-View Healing (Feb 2026)
To further ensure data integrity, the **Contact View Page** (`/admin/contacts/[id]/view`) now includes passive self-healing:
1.  When a user opens a contact that has a "Link Broken" error.
2.  The system triggers the Self-Healing logic **immediately** in the background.
3.  The connection is repaired before the user even takes an action, eliminating the need to manually "Sync" or "Save".

#### B. Google Sync Manager (UI)
We replaced the simple "Conflict Modal" with a comprehensive **Google Sync Manager** accessible from:
-   **Contact List**: Status Icon (🟢 Linked, ⚪ Unlinked, ⚠️ Error).
-   **Contact Profile**: "Manage Sync" button in the header.

**Capabilities:**
-   **Healthy State**: View live side-by-side comparison of Estio vs Google data.
    -   Actions: *Push Local -> Google*, *Pull Google -> Local*, *Unlink*.
-   **Unlinked State**: 
    -   **Auto-Search**: Automatically searches Google by phone number when opened. If `searchContacts` returns no results for a phone query, automatically falls back to `connections.list` with local filtering.
    -   **Smart Actions**: "Find Match" button auto-populates search.
    -   **Options**: Link to existing or Create New.
-   **Broken Link (Linked-but-Gone)**:
    -   **Smart Recovery**: If the linked Google contact is deleted (404), the Manager automatically switches to Search Mode, pre-fills the phone number, and executes a search to find the correct contact immediately.
-   **Conflict State**: Resolve data mismatches or broken links.
-   **Session Expired**: If the Google OAuth token is invalid (revoked/expired), the manager displays a "Session Expired" alert with a one-click "Reconnect" link.

#### C. Search Logic Strategy (Strict vs. Broad)
To balance safety with usability, we use two different search strategies:
1.  **Strict Matching (Automated Healing)**: When the system performs *background* self-healing (e.g., during a sync), it uses strict matching on Phone Number (digits) or Email. This prevents accidentally linking the wrong person automatically.
2.  **Broad/Fuzzy Matching (Manual Search)**: When a user searches manually in the Sync Manager, we use Google's "Smart Search" which supports partial names, email prefixes, and global directory lookup. This allows users to find contacts easily even with partial information.

> [!IMPORTANT]
> **Phone Search Fallback**: Google People API `searchContacts` has a known bug where phone number queries return empty results. To work around this, both `searchGoogleContacts` (UI) and `findMatchingGoogleContact` (sync) detect phone-like queries and, if `searchContacts` returns nothing, fall back to `people.connections.list` with local digit-based filtering. This is transparent to the user — the Sync Manager simply finds the contact via the fallback path. See `lib/google/people.ts`: `searchByPhoneFallback()`.

#### C. Manual "Link Only"
The Sync Manager supports a **"Link Only"** action. This connects an Estio Contact to a Google Contact **without overwriting data** on either side. This is useful when you know they are the same person but want to preserve distinct data on each platform (e.g., maintaining a specific "Visual ID" company name in Google while keeping role data in Estio).

#### D. "Out of Sync" Indicator (Feb 2026)
The Contact List now displays an **orange refresh icon** 🔄 when a contact has local changes that are newer than the last Google sync.
*   **Race Condition Buffer**: Includes a 2-second tolerance buffer to prevents false positives where `updatedAt` is only milliseconds ahead of the sync timestamp.

**Icon States:**
| Icon | Color | Meaning |
| :---: | :--- | :--- |
| ➕ | Gray (Faded) | Not Linked (Available to Add) |
| 🔗 | Green | Linked to Google |
| 🔄 | Orange | Out of Sync (local changes pending) |
| ⚠️ | Yellow | Sync Error |

---

## Future Improvements
-   **AI Extraction**: Currently, `Visual ID` is rule-based. We plan to add an AI step to extract intent/budget from the *first* WhatsApp message to populate the fields immediately, making the Visual ID rich from the very first second.
