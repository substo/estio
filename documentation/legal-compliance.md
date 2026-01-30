# Legal & Compliance Implementation Guide

**Last Updated:** December 26, 2025

## Overview
This document details the implementation of legal pages and compliance requirements for the IDX application, specifically focusing on Google Cloud OAuth verification and General Data Protection.

## 1. Legal Pages

Two core legal pages have been implemented to satisfy SaaS requirements and Google's OAuth verification policy.

### Privacy Policy
*   **URL:** `/privacy-policy`
*   **File:** `app/(main)/privacy-policy/page.tsx`
*   **Key Clauses:**
    *   **Google User Data:** Explicit declaration of accessing Google Profile data (email, name, picture) solely for authentication.
    *   **Limited Use Policy:** Explicit statement adhering to [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy).
    *   **Third-Party Sharing:** Disclosures for Clerk (Auth), GoHighLevel (CRM), and Cloudflare (Media).

### Terms of Service
*   **URL:** `/terms-of-service`
*   **File:** `app/(main)/terms-of-service/page.tsx`
*   **Key Clauses:**
    *   **Service Description:** Real Estate Marketplace with GHL integration.
    *   **Google Auth:** User responsibility for Google Account security.
    *   **GHL Disclaimer:** Disclaiming liability for the third-party CRM platform.

## 2. Google Cloud OAuth Verification

To pass the "Brand Verification" for the Google OAuth Consent Screen, the following requirements must be met:

1.  **Verified Domain:** `estio.co` is verified in Google Search Console.
2.  **Visible Links:** Privacy Policy and ToS are linked in the application footer and AboutSection.
3.  **Content Compliance:** The specific "Limited Use" disclosure is present in the Privacy Policy.

### Troubleshooting Verification Failures

**Issue: "Homepage does not include privacy policy link"**

*Root Cause*: Next.js 16+ with Turbopack uses RSC streaming. Page content is delivered as serialized JSON inside `<script>` tags, not as traditional HTML. Google's crawler may not execute JavaScript.

*Mitigations*:
1. `<noscript>` block in `app/(main)/page.tsx` with plain HTML privacy link
2. JSON-LD structured data in `app/(main)/layout.tsx`
3. Request **manual verification** from Google if automated fails

**Issue: "Homepage is behind a login"**

*Resolution*: The homepage route `/` is explicitly in `isPublicRoute` in `middleware.ts`. No login is required. This error typically indicates Google's crawler couldn't load the page properly (see RSC issue above).

## 3. Maintenance

*   **Updates:** Both pages are static React components (`page.tsx`) and can be updated directly in the codebase.
*   **Deployment:** Use `deploy-update.sh` to quickly push text changes to these pages without a full dependency reinstall.

