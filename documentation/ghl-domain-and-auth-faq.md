# GHL OAuth & Domain FAQ

## Q1: Why Does the Domain Switch During OAuth?

### The Issue
- Clients access via: `https://app.gohighlevel.com/v2/location/...`
- OAuth redirects to: `https://app.leadconnectorhq.com/v2/location/...`

### Why This Happens
GoHighLevel uses **leadconnectorhq.com** as the canonical OAuth domain for security and consistency. This is **normal behavior** and happens on all GHL plans.

### Can This Be Avoided on $97 Standard Plan?

**Short Answer: No, not completely.**

**Standard Plan ($97/month) Limitations:**
- ✅ Can create custom menu links
- ✅ OAuth works correctly
- ❌ **Cannot** white-label the OAuth domain
- ❌ **Cannot** customize the OAuth redirect URLs

**To Fix the Domain Switching:**
You would need to upgrade to:
- **Agency Pro Plan** ($297/month) - Allows white-label domains
- **Agency Unlimited Plan** ($497/month) - Full white-label control

### What Happens After OAuth?

1.  **Initial OAuth**: User sees `leadconnectorhq.com` during authorization
2.  **Setup Complete**: User sees a "Setup Complete" page instructing them to close the tab
3.  **Refresh**: User refreshes their original GHL tab and is auto-signed in via SSO

**Important**: The domain switch **only happens once per location** during initial OAuth setup. Regular SSO logins stay on your domain.

---

## Q2: What Happens When You Add New Users?

### OAuth is **Once Per Location**, SSO is **Per User**

| Action | Frequency | What Happens |
|--------|-----------|--------------|
| **OAuth Authorization** | Once per Location | Creates Location record with OAuth tokens |
| **SSO Login** | Every time any user clicks custom menu link | Uses existing OAuth tokens to auto-sign user in |

### Example Scenario:

**Initial Setup (First User - You):**
1. Click custom menu link -> See "One-Time Setup" page
2. Click "Open Authorization Page" (new tab)
3. Authorize app (domain switches to leadconnectorhq.com)
4. See "Setup Complete" page -> Close tab
5. Refresh GHL page -> Redirected to dashboard

**New User Added to Same Location:**
1. Click custom menu link
2. ✅ **Automatically signed in** (no OAuth!)
3. SSO uses existing Location's OAuth tokens
4. Redirected to dashboard
5. ✅ Stays on `estio.co` - no domain switch!

### Key Points:

✅ **OAuth is once per Location**
- Stores Location-level OAuth tokens
- Only the first user (or when tokens expire) sees OAuth

✅ **SSO is per User**
- Each user gets their own Clerk session
- Uses the Location's OAuth tokens to fetch user details
- No domain switching for SSO!

✅ **Adding 100 users? No problem!**
- All 100 users auto-sign in via SSO
- No repeated OAuth flow
- No domain switching after initial setup

---

## Workarounds for Domain Switching (Standard Plan)

Since you can't change the OAuth domain on the Standard plan, you can:

### Option 1: Educate Clients (Recommended)
Create a simple help doc:
> "During first-time setup, you'll be redirected to leadconnectorhq.com to authorize the app. This is a one-time step. All future logins will stay on estio.co."

### Option 2: Pre-authorize for Clients
If you're setting this up for clients:
1. You (as agency owner) complete OAuth setup
2. Add their users to the location
3. Their users only see SSO (no OAuth, no domain switch)

### Option 3: Upgrade to Agency Pro
If white-label branding is critical:
- Upgrade to Agency Pro ($297/mo)
- Configure custom domain
- OAuth will use your white-label domain

---

## Summary

| Question | Answer |
|----------|--------|
| Can I avoid domain switching on $97 plan? | No - requires Agency Pro ($297/mo) |
| Does every user go through OAuth? | No - OAuth is once per location |
| Do new users see the domain switch? | No - they auto-sign in via SSO |
| Is this behavior permanent? | Domain switch only happens during initial OAuth setup |
| How many times per location? | Once - when first user authorizes the app |

**Bottom Line**: The domain switch is a one-time inconvenience during setup. All subsequent logins (for all users) work seamlessly on your domain!

---

## Q3: Why Can't I Edit Redirect URLs in a Live Marketplace App?

### The Issue
When your GHL Marketplace app is **live/published**, the redirect URL settings become locked:
- ❌ Add button is not clickable
- ❌ Trash/delete icon is not clickable
- ❌ Cannot modify existing redirect URLs

### Why This Happens
GoHighLevel uses **"App Updates with Versioning"** which means:
- **Live versions are never edited directly**
- Redirect URLs are security-critical and get locked after approval
- This ensures stability for existing app installations

### How to Change Redirect URLs on a Live App

You must **create a new version** of your app:

1. Go to your app in the GHL Marketplace Developer dashboard
2. Click **"Create New Version"** or look for **"Draft Version"**
3. In the new draft version, modify the redirect URLs:
   - Add new URLs (e.g., new ngrok URL)
   - Remove old/unused URLs
4. Submit the new version for review
5. Once approved, it replaces the live version

### Do I Need to Update GHL Every Time My Ngrok URL Changes?

**Short Answer: No!** Creating a new app version every time ngrok restarts is impractical and not recommended.

### Industry Best Practices for OAuth + Local Development

#### ✅ Option 1: Ngrok Reserved Subdomain (RECOMMENDED)

**The Problem**: Free ngrok generates random URLs like `https://abc123.ngrok-free.app` that change on every restart, requiring constant OAuth provider updates.

**The Solution**: Pay for ngrok's **reserved subdomain** feature (~$8/month):

```bash
# Instead of random URL:
ngrok http 3000  # ❌ Gets random URL each time

# Use reserved subdomain:
ngrok http --subdomain=estio-dev 3000  # ✅ Always: https://estio-dev.ngrok.io
```

**Benefits**:
- URL never changes (`https://estio-dev.ngrok.io`)
- **One-time setup** in GHL marketplace app
- All developers can use the same reserved subdomain
- No more version updates for redirect URLs

#### ✅ Option 2: Production Callback Relay (FREE)

Since you already have `https://estio.co/api/oauth/callback` registered:

1. **Keep using the production redirect URL** in GHL
2. Your production server receives the OAuth callback
3. Tokens are stored in the shared database
4. Your local dev environment can use those tokens

**How it works**:
```
GHL → estio.co/api/oauth/callback → Saves tokens to DB → Local dev reads tokens
```

**This is what we currently use** - no ngrok URL needed in GHL at all!

#### ❌ Option 3: Update GHL Each Time (NOT RECOMMENDED)

Creating a new app version every time ngrok restarts:
- Requires GHL review process (can take hours/days)
- Creates version clutter in your app history
- Impractical for daily development
- **Only do this for permanent URL changes**

### Summary for Future Developers

| Strategy | Cost | Setup | Best For |
|----------|------|-------|----------|
| **Production Callback Relay** | Free | Already done | Most daily development |
| **Ngrok Reserved Subdomain** | ~$8/mo | One-time | Teams needing isolated local OAuth |
| **Update GHL Each Time** | Free | Repeated | Never - avoid this |

### Our Recommended Workflow

1. **For daily development**: Use the production callback (`estio.co`). OAuth tokens are shared via the database.
2. **For isolated OAuth testing**: Consider ngrok reserved subdomain.
3. **For permanent changes**: Create a new GHL app version with the new URL.

> **Note**: The ngrok URL in `.env.local` (`APP_BASE_URL`) is still useful for **webhooks** (WhatsApp, etc.) that need to reach your local machine directly - this is separate from OAuth redirect URLs.
