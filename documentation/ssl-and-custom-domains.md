# SSL & Custom Domain Implementation Guide

## The Problem
When you add a "Custom Domain" (like `downtowncyprus.substo.com`) in the Dashboard, the **application** knows how to handle it (via Next.js Middleware), but the **server infrastructure** (Nginx & SSL) does not.

Currently, your Nginx server is configured to only listen and provide a certificate for `estio.co`. When you visit `downtowncyprus.substo.com`:
1. DNS correctly points to the server IP.
2. Nginx receives the request but uses the default `estio.co` certificate.
3. Browser blocks the connection due to a **Certificate Name Mismatch**.

---

## updates: WWW Redirection (New)
The application now enforces a **Strict Non-WWW Policy** via `middleware.ts`.
- **Behavior**: Any request to `www.any-domain.com` is automatically 307 Redirected to `any-domain.com`.
- **Reasoning**: This standardizes all tenant sites to a single canonical URL for SEO and consistency.
- **Requirement**: Even though we redirect, your SSL Certificate **MUST** still cover the `www` subdomain (e.g., `-d www.client.com`) so the request can successfully reach the middleware to be redirected.

---

## Solution 1: Immediate Fix (Manual)
To fix `downtowncyprus.substo.com` immediately, you need to tell Nginx and Certbot about this new domain.

**Run this on your server:**
```bash
# 1. SSH into the server
ssh root@138.199.214.117

# 2. Update Nginx Config (Or just let Certbot do it)
# The easiest way is to run Certbot and add the domain to the existing certificate
certbot --nginx -d estio.co -d downtowncyprus.substo.com
```
*Select "Expand" if asked to keep the existing certificate structure.*

---

## Solution 2: Wildcard Certificate (Recommended for Subdomains)
If you plan to have many `*.substo.com` sites (e.g., `agency1.substo.com`, `agency2.substo.com`), manually running Certbot every time is inefficient.

**Implementation**:
1. Get a **Wildcard Certificate** (`*.substo.com`) from Let's Encrypt.
2. *Note*: This requires DNS-01 challenge (verifying ownership via DNS records), not just HTTP-01. You typically need to use the `--dns-cloudflare` (or other provider) plugin for Certbot.

**Advantages**:
- Any new subdomain works instantly without server changes.
**Disadvantages**:
- Does not work for completely different custom domains (e.g., `client-site.com`).

---

## Solution 3: On-Demand SSL (Scalable Architecture)
For a true "SaaS" experience where clients can point *any* custom domain (`client.com`) to your IP and have it work automatically, you need **On-Demand SSL**.

### Option A: OpenResty (Nginx + Lua)
Hard to configure. Requires scripting Nginx to ask Certbot dynamically.

### Option B: Caddy Server (Highly Recommended)
Replace Nginx with **Caddy**. Caddy has built-in "On-Demand TLS".
1. Client points A Record to your IP.
2. Caddy receives request.
3. Caddy automatically asks Let's Encrypt for a cert in real-time.
4. Site loads securely.

**Example Caddyfile:**
```caddy
{
    on_demand_tls {
        ask https://estio.co/api/verify-domain
    }
}

:443 {
    reverse_proxy localhost:3000
    tls {
        on_demand
    }
}
```

### Option C: Cloudflare for SaaS (External Proxy)
Use Cloudflare to handle the SSL.
1. Clients point generic CNAME to your Cloudflare domain.
2. Cloudflare provisions the SSL at the edge.
3. Your server just accepts traffic from Cloudflare.

**Recommendation**:
For now, use **Solution 1** to fix the immediate issue.
For the future, if supporting external client domains is a priority, migrate from Nginx to **Caddy** (Solution 3B) which simplifies this drastically.
