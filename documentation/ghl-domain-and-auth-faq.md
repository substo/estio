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
