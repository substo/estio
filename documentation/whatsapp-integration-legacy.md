# WhatsApp Integration Documentation (Legacy: Twilio/Direct)
**Archived on:** 2026-01-11
**Superseded by:** Shadow API Integration

## Overview

This document outlines the previous architecture for WhatsApp Business integration in Estio, which focused on Twilio "Coexistence" (BYON) and direct Meta Cloud API connections.

---

## 1. Architecture

### Native Integration
- **Direct Connection**: Connects directly to Meta Graph API (Cloud API)
- **Multi-tenant**: Each `Location` stores its own WABA credentials
- **Cross-Domain Bridge**: Uses bridge page on `estio.co` for OAuth with custom tenant domains

### Data Model
```prisma
model Location {
  // ... existing fields
  whatsappBusinessAccountId String?
  whatsappPhoneNumberId     String?
  whatsappAccessToken       String? @db.Text // Encrypted with cryptr
  whatsappWebhookSecret     String?
}
```

---

## 2. Components

| Component | Path | Purpose |
|-----------|------|---------|
| Settings UI | `app/(main)/admin/settings/integrations/whatsapp/page.tsx` | Embedded Signup + Manual config |
| Server Actions | `app/(main)/admin/settings/integrations/whatsapp/actions.ts` | Token exchange, WABA fetch |
| Bridge Page | `app/whatsapp-bridge/page.tsx` | Cross-domain OAuth handler |
| Webhooks | `app/api/webhooks/whatsapp/route.ts` | Message reception |
| Client Library | `lib/whatsapp/client.ts` | Message sending |

---

## 3. Implementation Challenges & Solutions

### Challenge 1: OAuth `redirect_uri` Mismatch
**Error:** `Error validating verification code. Please make sure your redirect_uri is identical`

**Root Cause:** Facebook JS SDK internally sets a redirect_uri that we couldn't control.

**Solution:** For "User access token" configurations (vs System User Access Token), removed `response_type: 'code'` override to let FB return the token directly instead of a code that requires exchange.

```typescript
// Before (broken)
FB.login(callback, {
  config_id: configId,
  response_type: "code",           // Requires server exchange
  override_default_response_type: true,
});

// After (working)
FB.login(callback, {
  config_id: configId,
  // Let FB return token directly for User access token configs
});
```

### Challenge 2: WABA Fetch with User Access Token
**Error:** `Tried accessing nonexisting field (whatsapp_business_accounts) on node type (User)`

**Root Cause:** The endpoint `/me/whatsapp_business_accounts` only works with System User Access Tokens.

**Solution:** Implemented fallback strategy:
1. Try `/me/businesses` → `/{business_id}/owned_whatsapp_business_accounts`
2. Fall back to `debug_token` API to get granted scope target IDs

```typescript
// Working approach for User access tokens
const debugResponse = await axios.get('https://graph.facebook.com/v21.0/debug_token', {
  params: { input_token: accessToken, access_token: accessToken }
});
const granularScopes = debugResponse.data.data?.granular_scopes || [];
// Extract WABA IDs from whatsapp_business_management scope target_ids
```

### Challenge 3: User Access Token vs System User Access Token
**Issue:** SUAT option greyed out in Meta configuration.

**Root Cause:** SUAT requires Business Verification and Advanced Access permissions.

**Solution:** Updated code to handle both token types:
- If FB returns `code` → Exchange for token (SUAT flow)
- If FB returns `accessToken` → Use directly (User token flow)

### Challenge 4: Domain Configuration
**Error:** `Can't load URL: The domain of this URL isn't included in the app's domains`

**Solution:** Added to Meta App Settings:
- App Domains: `estio.co`
- Valid OAuth Redirect URIs: `https://estio.co/admin/settings/integrations/whatsapp`
- Allowed Domains for JS SDK: `https://estio.co/`

---

## 4. Phone Number Limitations & "Coexistence"

### The Core Problem (Historical)
Historically, the WhatsApp Business API had a strict "One or the Other" rule:
| Product | Description | Limitation |
|---------|-------------|------------|
| **WhatsApp Business App** | Mobile App | ❌ Cannot use with API |
| **WhatsApp Business Platform** | API (Estio) | ❌ Cannot use with Mobile App |

### The New "Coexistence" Feature (Beta)
Meta now supports **Coexistence**, allowing a single phone number to be active on **both** the Mobile App and the API (Estio).

- **Benefit**: Retain chat history on the phone, manual replies from the pocket, AND use Estio for AI/Team access.
- **Requirement**: Must use **Twilio Embedded Signup** to enable this.
- **Outbound Sync**: Messages sent from the Mobile App are now detected by Estio webhooks (as "Outbound") and synced to the CRM history.

### Verification of Eligibility (The "Golden Rule")
During the Embedded Signup flow, Meta performs a real-time eligibility check on the number:
1.  **Success Signal**: The screen says *"You can continue using this number on your mobile app"*.
2.  **Failure Signal**: The screen says *"This number is registered to an existing WhatsApp account. To use this number, **disconnect it from the existing account**."*

> [!CAUTION]
> If you see the **Failure Signal** (Disconnect Warning), **Coexistence is NOT available** for that number. Proceeding will immediately break the mobile app connection.

---

## 5. Primary Solution: Twilio Integration

We have pivoted to **Twilio** as the primary provider to support this Coexistence feature and simplify "Bring Your Own Number" (BYON).

### Twilio WhatsApp Architecture
```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   Estio     │<─────>│   Twilio    │<─────>│  WhatsApp   │<─────>│  Customer   │
│ (Web/Mobile)│       │   API       │       │  Cloud      │       │  Phone      │
└─────────────┘       └─────────────┘       └─────────────┘       └─────────────┘
       ▲                                              ▲
       │             (Coexistence Sync)               │
       └──────────────────────────────────────────────┘
                    Business Owner's Phone
```

### Implementation Details

#### 1. Schema Updates
Twilio credentials exist alongside Meta credentials in the `Location` model.
```prisma
model Location {
  // ...
  twilioAccountSid    String?
  twilioAuthToken     String? // Encrypted
  twilioWhatsAppFrom  String? // e.g. "whatsapp:+1..."
}
```

#### 2. Webhooks
- **Path**: `/api/webhooks/twilio`
- **Logic**: 
  - Handles **Inbound** messages (Customer -> Estio).
  - Handles **Outbound-from-App** messages (Owner Phone -> Customer) by detecting if `From == BusinessNumber`.
  - Normalizes payloads to `NormalizedMessage` format shared with Meta logic.

#### 3. Client Library (`lib/twilio/client.ts`)
- `sendTwilioMessage`: Used for outbound replies from Estio.
- Automatically handles `whatsapp:` prefixing.

### Configuration Steps (Twilio)
1.  **Twilio Console**: Go to **Messaging > Senders > WhatsApp Senders**.
2.  **Embedded Signup**: Use "Connect with Facebook" flow.
3.  **Select WABA**: Choose your Meta Business Account.
4.  **Verify Number**: Enter existing WhatsApp number. If eligible for Coexistence, Meta will approve it without disconnecting the app.
5.  **Get Credentials**: Get Account SID, Auth Token.
6.  **Configure Estio**: Enter these in **Admin > Settings > Integrations**.

---

## 6. Environment Variables

| Variable | Description |
|----------|-------------|
| `ENCRYPTION_KEY` | **Critical**: Used to encrypt/decrypt Twilio Auth Tokens in DB |
| `NEXT_PUBLIC_META_APP_ID` | (Legacy/Direct) Meta App ID |
| `META_APP_SECRET` | (Legacy/Direct) Meta App Secret |

---

## 7. Current Status

### ✅ Implemented
- **Twilio Backend**: Client, Webhooks, Schema.
- **Coexistence Logic**: Outbound sync from mobile app interactions.
- **UI**: Settings card for Twilio credentials.
- **Legacy Support**: Direct Meta Cloud API still supported in code but de-prioritized.

### 📋 TODO
- [ ] Media message support (images, videos) for Twilio
- [ ] Template Message management from Estio UI (Required for 24h window re-opening)

---

## 8. Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| **Mobile App Disconnected** | Number not eligible for Coexistence | Re-register app (API stops working) OR accept API-only mode. |
| **"Unverified" Status** | Meta Business Verification pending | Complete Business Verification in `business.facebook.com`. |
| **Messages not syncing** | Webhook URL missing in Twilio | Paste `https://[domain]/api/webhooks/twilio` into Twilio Sender settings. |
