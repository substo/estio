# Homepage & Marketing Implementation

**Last Updated:** December 26, 2025

## Overview

This document describes the marketing homepage structure, components, and Google OAuth verification considerations for the Estio platform.

## Homepage Structure

The main homepage (`app/(main)/page.tsx`) consists of:

1. **HeroSection** (`components/homepage/hero-section.tsx`)
   - Headline: "Your Property Business, Fully Automated"
   - Subheadline: "Sync listings, capture leads, and manage contacts—seamlessly integrated with GoHighLevel."
   - CTA Buttons: "Get Started" → `/admin`, "Agency Installation" → `/setup`

2. **FeaturesSection** (`components/marketing/features-section.tsx`)
   - 4-column grid showcasing core features:
     - Native GHL Integration
     - MLS & XML Feed Engine
     - White-Label Public Sites
     - High Performance

3. **AboutSection** (`components/marketing/about-section.tsx`)
   - Detailed description of the platform
   - Inline Privacy Policy and Terms of Service links

## Navigation Components

### NavBar (`components/wrapper/navbar.tsx`)
- Fixed position header with logo
- Features dropdown menu with links to:
  - Property Management (`/admin/properties`)
  - Contact CRM (`/admin/contacts`)
  - Site Settings (`/admin/site-settings`)
- Uses `ClerkLoaded` wrapper to prevent hydration mismatch
- Implements `mounted` state pattern to avoid Radix UI random ID issues

### Footer (`components/wrapper/footer.tsx`)
- Newsletter signup form ("Stay Updated")
- Social links
- Legal links (Terms of Service, Privacy Policy)

## Google OAuth Verification Notes

### Known Issue: RSC Streaming
Next.js 16+ with Turbopack uses React Server Components (RSC) streaming. This means page content is delivered as serialized JSON inside `<script>` tags, not as traditional HTML.

**Impact**: Google's verification crawler may not execute JavaScript, so it may not see:
- Privacy Policy links
- App description content
- Feature descriptions

### Mitigations Implemented
1. **`<noscript>` Fallback**: Plain HTML content including Privacy Policy link in `app/(main)/page.tsx`
2. **JSON-LD Structured Data**: `SoftwareApplication` schema in `app/(main)/layout.tsx`
3. **Manual Verification**: If automated verification fails, request manual review from Google

### Verification Checklist
- [ ] Privacy Policy accessible at `/privacy-policy`
- [ ] Terms of Service accessible at `/terms-of-service`
- [ ] Both pages are server-rendered and crawlable
- [ ] `sitemap.xml` includes legal pages
- [ ] `robots.txt` allows crawling

## File Structure

```
app/(main)/
├── page.tsx              # Homepage
├── layout.tsx            # Main layout with JSON-LD
├── privacy-policy/page.tsx
├── terms-of-service/page.tsx
└── ...

components/
├── homepage/
│   └── hero-section.tsx
├── marketing/
│   ├── features-section.tsx
│   └── about-section.tsx
└── wrapper/
    ├── navbar.tsx
    ├── footer.tsx
    └── page-wrapper.tsx
```

## Deployment

Use `./deploy-update.sh` for quick marketing content updates. This script:
1. Syncs code changes
2. Rebuilds the Next.js application
3. Zero-downtime reloads via PM2
