# Custom Email Delivery System

This document outlines the architecture, setup, and troubleshooting for the custom email delivery system that routes Clerk authentication emails (like invitations) through GoHighLevel (GHL) SMTP configurations.

## Overview

By default, Clerk sends emails (invitations, magic links) via its own servers. However, we want emails to be sent from the Agency/Location's own verified domain (configured in GHL/AWS SES).

To achieve this, we implemented a system that:
1.  **Intercepts** Clerk's email generation via Webhooks.
2.  **Resolves** the correct GHL Location and Authentication Token.
3.  **Sends** the email programmatically using the GHL API (`/conversations/messages`).

## Architecture

### The Flow
1.  **Trigger**: Clerk generates an email event (e.g., `email.created` when an invitation is created).
2.  **Webhook**: Clerk sends this event to our endpoint: `/api/webhooks/clerk-mail`.
3.  **Processing** (`app/api/webhooks/clerk-mail/route.ts`):
    *   Verifies the Webhook Signature (Svix).
    *   Extracts email content (Subject, Body, Recipient).
    *   **Crucial Step**: Extracts `locationId` from `public_metadata` (for invitations) or Database Lookup (for other events).
4.  **Sending** (`lib/ghl/email.ts`):
    *   **Resolution**: Converts Internal Location ID -> GHL Location ID using `resolveToGHLId`.
    *   **Token Fetch**: Gets a valid Access Token for that GHL Location.
    *   **Dynamic Sender**: Looks up the Location's Custom Domain (`siteConfig.domain`) and constructs the `From` address (e.g., `info@downtowncyprus.site`).
    *   **Consistency**: This same logic is used in the Conversations UI (`ai-agentic-conversations-hub.md`) to resolve the "System Email" when displaying message history, ensuring the sender address is consistent across both sending and viewing.
    *   **API Call**: Sends the email via GHL V2 API (`/conversations/messages`), ensuring `locationId` is passed in both query and body to satisfy Validation Scopes.

### Key Components

*   **`middleware.ts`**:
    *   Updated to **exclude** `/api/webhooks` from Authentication and SSO Redirects.
    *   This ensures external services (Clerk) can reach the endpoint without being redirected to a login page.

*   **`app/api/webhooks/clerk-mail/route.ts`**:
    *   The entry point. Handles payload parsing and decides which email logic to run.

*   **`lib/ghl/email.ts`**:
    *   `checkGHLSMTPStatus(locationId)`: Checks if a location has a valid Email Service (Native, Mailgun, or SMTP).
    *   `sendGHLEmail(params)`: The core function. Handles:
        *   Contract Resolution (Find or Create Contact in GHL).
        *   Dynamic sender address generation.
        *   GHL API V2 compliance (Scopes, Location Context).

## Setup Guide

### Multi-Tenant Architecture

> **Key Insight**: A single webhook endpoint on the primary domain (`estio.co`) handles emails for **ALL** tenants. The `locationId` in invitation metadata determines which tenant's SMTP to use.

```
Admin invites user → Clerk sends email.created → estio.co/api/webhooks/clerk-mail
                                                          ↓
                                            Extract locationId from publicMetadata
                                                          ↓
                                            Lookup siteConfig.domain for tenant
                                                          ↓
                                            Send via GHL from info@{tenant-domain}
```

### 1. Clerk Configuration (One-Time)
1.  Go to **Clerk Dashboard > Webhooks**.
2.  Add Endpoint: `https://estio.co/api/webhooks/clerk-mail` (use your **primary** domain).
3.  Subscribe to: `email.created`.
4.  **Copy Signing Secret** → Add to `.env` as `CLERK_MAIL_WEBHOOK_SECRET`.
5.  Go to **Email > Customization**.
6.  **Disable "Delivered by Clerk"** for the templates you want to handle manually (e.g., Invitation).

### 2. Production Deployment
The `CLERK_MAIL_WEBHOOK_SECRET` must be included in `deploy-direct.sh`:
```bash
# In the .env block (around line 161)
CLERK_MAIL_WEBHOOK_SECRET=whsec_your_secret_here
```

### 3. GoHighLevel Configuration (Per Tenant)
1.  Ensure the connected App has `contacts.readonly` and `contacts.write` scopes.
2.  Each tenant Location must have an Email Service configured (Settings > Email Services).
    *   *If using LeadConnector (Default), it works out of the box.*
    *   *If using AWS SES/Mailgun, ensure the sending domain matches `siteConfig.domain`.*

### 4. Tenant Domain Setup
For emails to send from `info@tenant-domain.com`:
1.  Set `siteConfig.domain` in the database for the Location.
2.  Configure SPF/DKIM records for the tenant domain in their DNS.

### 5. Re-Authentication (If User sees 403 Forbidden)
If the logs show `403 Forbidden: The token does not have access to this location`, the OAuth Token is stale or missing scopes.
1.  Uninstall the App in GHL Location Settings.
2.  Go to `/setup` (e.g., `https://client-domain.com/setup`).
3.  Click the "Magic Link" to Re-Authorize.

## Troubleshooting

### Verbose Logging
The system logs heavily to the server console. Look for these tags:

*   `[Clerk-Mail]`: Webhook activity.
*   `[sendGHLEmail]`: Email sending execution.
*   `[GHL SMTP Check]`: Configuration validation.

### Common Errors

| Error | Cause | Fix |
| :--- | :--- | :--- |
| **Location not found** | Internal ID vs GHL ID mismatch | Fixed by `resolveToGHLId` helper. |
| **403 Forbidden** | Missing Scopes or Context | 1. Re-Authorize App.<br>2. Ensure `locationId` is in API params (Code fixed this). |
| **Contact not found (400)** | API V2 requires search query | Code updated to use `/contacts/?locationId=...&query=...`. |
| **Email not received** | SPAM Filters or DNS | 1. Check GHL "Conversations" tab (if it's there, we sent it).<br>2. Check Recipient SPAM.<br>3. Verify Domain SPF/DKIM records. |

## Feature: Resend Invitation
A "Resend" button was added to the Team Management page (`/admin/team`).
*   **Logic**: Revokes the old invitation (Clerk) -> Creates a new one (Clerk) -> Triggers Webhook -> Sends via GHL.

## Deliverability & DNS Troubleshooting

If logs say "SUCCESS" but emails are not arriving:

### 1. The Cloudflare Forwarding Issue
If you are sending **FROM** `info@yourdomain.com` **TO** `info@yourdomain.com`, and that email forwards to Gmail:
*   **The Problem**: Gmail sees an email claiming to be from `yourdomain.com` but coming from GHL's IP.
*   **The Fix**: You MUST have strict SPF/DKIM records set up for `yourdomain.com` that include GHL's sending provider.

### 2. SPF Records
Ensure your DNS TXT record for `@` includes your provider:
*   **Mailgun (Default)**: `v=spf1 include:mailgun.org include:_spf.google.com ~all`
*   **AWS SES**: `v=spf1 include:amazonses.com include:_spf.google.com ~all`
*   *(Note: `include:_spf.google.com` is only needed if you also send via Google Workspace)*.

### 3. Verification Test
To rule out the "Forwarding Loop" issue, try sending an invitation to a **different email address** (e.g., your personal Gmail directly, not the forwarded one).
*   If that arrives, the issue is purely with the Cloudflare Forwarding rules/strictness.

