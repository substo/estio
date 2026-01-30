# SaaS ID: Custom Domain Automation with Caddy

> **Status:** ✅ Implemented on Dec 7, 2025.
> **Server:** Caddy v2.8+ running on `138.199.214.117`.
> **Configuration:** `on_demand_tls` enabled with validation via `/api/verify-domain`.


To fully **automate** SSL for both subdomains (`location.estio.co`) and external custom domains (`properties.agency.com`) without manual server access, we must migrate from **Nginx** to **Caddy**.

## Why Automation Failed with Nginx
Nginx requires a reload and a specific configuration file for every new domain. Automating this essentially requires building a complex control plane that SSHs into the server—this is fragile and insecure.

## The Solution: Caddy (On-Demand TLS)
Caddy replaces Nginx. It has a feature called **On-Demand TLS**:
1.  A request comes in for `new-location.com`.
2.  Caddy pauses the request and calls your internal API: `GET http://localhost:3000/api/verify-domain?domain=new-location.com`.
3.  Your API checks the `SiteConfig` in the database.
    *   If found: Return `200 OK`.
    *   If not: Return `404` or `401`.
4.  If approved, Caddy **automatically** provisions an SSL certificate from Let's Encrypt in seconds and serves the page.
5.  All future requests are instant and secure.

---

## Phase 1: Application Changes

### 1. Create Verification Endpoint
We need an API route to tell Caddy which domains are allowed.

**File:** `app/api/verify-domain/route.ts`
```typescript
import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const domain = searchParams.get("domain");

  if (!domain) {
    return new NextResponse("Domain required", { status: 400 });
  }

  console.log(`[Caddy Verify] Checking domain: ${domain}`);
  
  // 1. System Domains - ALWAYS ALLOW
  // Centralized in lib/app-config.ts
  import { SYSTEM_DOMAINS } from "@/lib/app-config";
  
  if (SYSTEM_DOMAINS.includes(domain)) {
     return new NextResponse("Allowed (System)", { status: 200 });
  }

  try {
    // 2. Database Check
    const config = await db.siteConfig.findFirst({
      where: {
        domain: {
          equals: domain,
          mode: 'insensitive' // Ensure case-insensitive match
        }
      },
      select: { id: true }
    });

    if (config) {
      console.log(`[Caddy Verify] Domain authorized: ${domain}`);
      return new NextResponse("Allowed (Database)", { status: 200 });
    }

    console.warn(`[Caddy Verify] Domain REJECTED: ${domain}`);
    return new NextResponse("Unauthorized", { status: 401 });

  } catch (error) {
    console.error("[Caddy Verify] Database Error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
```

---

## Phase 1.5: Clerk Domain Whitelisting

> [!IMPORTANT]
> SSO/Authentication on custom domains requires **Clerk** to recognize the domain. This is a **separate requirement** from Caddy/SSL.

When a new domain is added, it must be whitelisted in **two** Clerk settings:
1. **`allowed_origins`**: For CORS (Clerk SDK to work on the domain)
2. **`redirect_urls`**: For SSO handshake `redirect_url` parameter validation

### Automation
This is handled automatically by `lib/auth/clerk-domains.ts` when a domain is saved in Site Settings.

### Manual Fix
If a domain was added before this automation existed, or the automation failed:
```bash
# Load production env and run whitelist script
export $(grep -v '^#' .env | xargs) && npx tsx scripts/manual-whitelist-domain.ts <domain>
```

---

## Phase 2: Infrastructure Migration

We will modify `deploy-direct.sh` to install Caddy instead of Nginx.

### New `Caddyfile`
```caddy
{
    # Global On-Demand TLS Configuration
    on_demand_tls {
        ask http://localhost:3000/api/verify-domain
    }
}

# 1. Main Dashboard/App Domain (Static)
estio.co {
    reverse_proxy localhost:3000
}

# 2. Wildcard for Custom Domains (Dynamic)
:443 {
    tls {
        on_demand
    }
    reverse_proxy localhost:3000
}

# 3. Catch-all for HTTP (Redirect to HTTPS)
:80 {
    redir https://{host}{uri} permanent
}
```

### Deployment Script Updates
1. Stop and Disable Nginx.
2. Install Caddy (if not present).
3. Upload `Caddyfile`.
4. Reload Caddy.

## Summary of Workflow
1.  Location Admin enters `downtowncyprus.estio.co` in Dashboard -> Saves to DB.
2.  (No Server Action Needed).
3.  User visits `https://downtowncyprus.estio.co`.
4.  Caddy asks API: "Is this domain valid?" -> API says "Yes (in DB)".
5.  Caddy generates Cert.
6.  Site loads Securely.
