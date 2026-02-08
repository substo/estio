# Microsoft Outlook Sync - Configuration Guide

This guide walks you through setting up the Microsoft Entra ID (formerly Azure AD) app registration required for the Outlook Sync feature.

## Prerequisites

- An Azure account with access to Microsoft Entra ID
- Admin rights to create app registrations (or request from your IT admin)
- Your application's public URL (e.g., `https://your-domain.com`)

---

## Step 1: Create App Registration

1. Navigate to the [Azure Portal](https://portal.azure.com)
2. Search for **"Microsoft Entra ID"** and select it
3. In the left sidebar, click **App registrations**
4. Click **+ New registration**

### Registration Settings

| Field | Value |
|-------|-------|
| **Name** | `Estio Outlook Sync` (or your preferred name) |
| **Supported account types** | Select **"Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts"** |
| **Redirect URI** | Platform: **Web** <br> URI: `https://your-domain.com/api/microsoft/callback` |

5. Click **Register**

> [!IMPORTANT]
> The "Multitenant + personal accounts" option is critical for supporting both Office 365 business accounts and personal Outlook.com/Hotmail accounts.

---

## Step 2: Note Your Application IDs

After registration, you'll be taken to the app's **Overview** page. Copy these values:

| Value | Where to Find | Environment Variable |
|-------|---------------|---------------------|
| **Application (client) ID** | Overview page | `MICROSOFT_CLIENT_ID` |
| **Directory (tenant) ID** | Overview page (for reference only) | N/A |

---

## Step 3: Create Client Secret

1. In your app registration, go to **Certificates & secrets**
2. Under **Client secrets**, click **+ New client secret**
3. Set a description (e.g., "Production Secret")
4. Choose an expiration (recommended: 24 months)
5. Click **Add**

> [!CAUTION]
> **Copy the secret value immediately!** It will only be shown once. Store it securely.

| Value | Environment Variable |
|-------|---------------------|
| Client Secret **Value** (not ID) | `MICROSOFT_CLIENT_SECRET` |

---

## Step 4: Configure API Permissions

1. Go to **API permissions** in the left sidebar
2. Click **+ Add a permission**
3. Select **Microsoft Graph**
4. Choose **Delegated permissions**
5. Add the following permissions:

### Required Permissions

| Permission | Purpose |
|------------|---------|
| `offline_access` | Allows refresh tokens for long-term access |
| `User.Read` | Read user profile to get email address |
| `Mail.ReadWrite` | Read and sync emails (Inbox/Sent) |
| `Mail.Send` | Send emails on behalf of user |
| `Contacts.ReadWrite` | Sync contacts bidirectionally |

6. After adding all permissions, your list should look like:

```
Microsoft Graph (5)
├── Contacts.ReadWrite    Delegated
├── Mail.ReadWrite        Delegated  
├── Mail.Send             Delegated
├── offline_access        Delegated
└── User.Read             Delegated
```

> [!NOTE]
> These are **Delegated** permissions, meaning the app acts on behalf of the signed-in user. No admin consent is required for users to connect their own accounts.

---

## Step 5: Configure Authentication Settings

1. Go to **Authentication** in the left sidebar
2. Under **Platform configurations**, verify your redirect URI is listed:
   - `https://your-domain.com/api/microsoft/callback`
3. Add additional redirect URIs if needed:
   - Development: `http://localhost:3000/api/microsoft/callback`

4. Under **Implicit grant and hybrid flows**:
   - Leave both checkboxes **unchecked** (we use authorization code flow)

5. Under **Advanced settings**:
   - **Allow public client flows**: `No`

6. Click **Save**

---

## Step 6: Set Environment Variables

Add these to your `.env` or `.env.local` file:

```env
# Microsoft / Outlook Integration
MICROSOFT_CLIENT_ID=your-application-client-id-here
MICROSOFT_CLIENT_SECRET=your-client-secret-value-here
```

Also ensure you have:

```env
# Required for OAuth callbacks
APP_BASE_URL=https://your-domain.com
# or
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

---

## Step 7: Verify Configuration

1. Restart your application to load new environment variables
2. Navigate to `/admin/settings/integrations/microsoft`
3. Click **"Connect Microsoft Account"**
4. You should be redirected to Microsoft's login page
5. After signing in, you'll be asked to consent to the permissions
6. Upon success, you'll be redirected back to your app
7. **New:** You should now see the **Sync Health Dashboard** displaying your "Last Inbox Sync" and "Session Status".

---

## Troubleshooting

### "AADSTS50011: The reply URL does not match"

**Cause**: The redirect URI in your app registration doesn't match what your app is sending.

**Solution**: 
- Verify the exact URL in Azure matches your `APP_BASE_URL` + `/api/microsoft/callback`
- Check for trailing slashes (they must match exactly)
- Ensure HTTPS is used in production

### "AADSTS700016: Application not found in directory"

**Cause**: Using wrong Client ID or the app was deleted.

**Solution**: 
- Verify `MICROSOFT_CLIENT_ID` is correct
- Check you're looking at the right Azure subscription

### "invalid_client: The client secret is incorrect"

**Cause**: Client secret is wrong or expired.

**Solution**:
- Verify you copied the **Value**, not the **Secret ID**
- Check if the secret has expired (create a new one if so)

### Personal accounts get "AADSTS50020: User account does not exist"

**Cause**: App is not configured as multi-tenant with personal accounts.

**Solution**:
- Go to **Authentication** > **Supported account types**
- Ensure it's set to: "Accounts in any organizational directory and personal Microsoft accounts"

---

## Webhook Configuration (Optional)

For real-time notifications, Microsoft requires your webhook endpoint to be publicly accessible:

1. Ensure `/api/webhooks/outlook` is reachable from the internet
2. The endpoint must respond to validation requests with the `validationToken`
3. Webhooks are automatically created when a user connects their account

### Webhook Renewal

Outlook webhooks expire after ~3 days. The cron job at `/api/cron/outlook-sync` handles automatic renewal.

---

## Security Best Practices

1. **Rotate client secrets** before they expire
2. **Use environment variables**, never commit secrets to code
3. **Monitor API usage** in Azure Portal > App registrations > Usage & insights
4. **Review connected users** periodically in your database

---

## Quick Reference

| Item | Value |
|------|-------|
| Auth Endpoint | `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` |
| Token Endpoint | `https://login.microsoftonline.com/common/oauth2/v2.0/token` |
| Graph API Base | `https://graph.microsoft.com/v1.0` |
| Callback URL | `/api/microsoft/callback` |
| Webhook URL | `/api/webhooks/outlook` |
| Cron URL | `/api/cron/outlook-sync` |

---

## Puppeteer Sync (Alternative to Graph API)

For accounts that cannot use the standard Graph API (e.g., some personal Outlook accounts with strict security policies), we support a fallback using **Puppeteer**.

### How it works
1.  **Authentication**: User logs in via a controlled browser instance. Session cookies are encrypted and stored.
2.  **Sync process**:
    - The cron job launches a headless browser.
    - Reuses stored cookies to access Outlook Web Access (OWA).
    - Syncs **Inbox**, **Sent Items**, and **Archive** folders.
    - Uses a robust "Hybrid" extraction:
        - **Smart Wait**: Waits for skeleton loaders to vanish.
        - **Attribute Scan**: Finds emails hidden in `aria-label` or `title`.
        - **Hover Fallback**: Auto-hovers to reveal Persona Cards for internal users.
    - **Incremental**: Automatically stops when it finds emails older than the last sync time.
3.  **GHL Integration**:
    - Scraped emails are saved to the local database.
    - New messages are automatically pushed to GoHighLevel (GHL) using the `createInboundMessage` utility, ensuring feature parity with the Graph API sync.
4.  **Email Direction Detection**:
    - Direction is determined by comparing the sender's email against the user's `outlookEmail` stored during login.
    - If sender matches user email → `outbound`, otherwise → `inbound`.
    - Fallback: If sender email extraction fails (e.g., internal users behind Persona Cards), folder is used (`inbox` → `inbound`, `sentitems` → `outbound`).

### Limitations
- Slower than Graph API (requires browser launch), though mitigated by incremental sync.
- Depends on OWA UI structure (more brittle, but hardened with multiple fallback strategies).
- Requires occasional re-authentication if session expires (approx. every 7 days).

### Debugging & Development
To visually debug the sync process (e.g., to see the browser actions, solve CATCHAs, or develop new scraping features):
1.  Open `lib/microsoft/outlook-puppeteer.ts`
2.  Set `headless: false` in the `puppeteer.launch()` configuration.
3.  The browser window will now appear during sync operations.
