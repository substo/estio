# Clerk Proxy Debugging Log

## Objective
Enable Clerk Authentication (Sign-Up/Sign-In) on dynamic tenant domains (e.g., `downtowncyprus.site`) using a single Clerk Application (Instance) hosted on `estio.co`.

## Chronological Progress

### 1. 404 Not Found (Initial State)
-   **Issue**: Requests to `/api/__clerk/...` were returning 404.
-   **Cause**: Next.js treats folders starting with `_` as private (internal) folders, so `app/api/__clerk` was ignored by the router.
-   **Fix**: Renamed route to `app/api/auth-proxy`. Updated `middleware.ts` and `ClerkProvider` proxy URL.
-   **Status**: ✅ Resolved.

### 2. 400 Bad Request ("Unable to attribute")
-   **Issue**: Clerk rejected requests saying it couldn't attribute them to an instance.
-   **Cause**: The proxy was forwarding the tenant's `Host` header (`downtowncyprus.site`), which Clerk didn't recognize as a satellite or instance.
-   **Fix**: Modified proxy to force `Host` and `X-Forwarded-Host` headers to `clerk.estio.co` (the FAPI instance).
-   **Status**: ✅ Resolved.

### 3. ERR_CONTENT_DECODING_FAILED
-   **Issue**: Browser failed to load script chunks.
-   **Cause**: Proxy was forwarding `content-encoding: gzip` from Clerk, but Next.js/Fetch automatically decompressed the body. The browser received uncompressed data with a `gzip` header.
-   **Fix**: Stripped `content-encoding` and `content-length` headers from the proxy response.
-   **Status**: ✅ Resolved.

### 4. 500 Internal Server Error (POST Requests)
-   **Issue**: Sign-Up submissions failed with 500.
-   **Cause**: Node.js `fetch` requires `duplex: 'half'` when passing a streaming request body (like the incoming request body).
-   **Fix**: Added `duplex: 'half'` to the `fetch` options in `route.ts`.
-   **Status**: ✅ Resolved.

### 5. 400 Bad Request (Security/Bot Detection)
-   **Issue**: Sign-Up failed with "Security validation failed" or Captcha errors.
-   **Cause**: The proxy was stripping `Origin` and `Referer` headers to avoid CORS errors. Clerk requires these headers to validatethe request source.
-   **Fix**: Preserved `Origin` and `Referer` headers.
-   **Prerequisite**: The tenant domain (`downtowncyprus.site`) MUST be in Clerk's **Allowed Origins**.
-   **Status**: ✅ Resolved.

### 6. 422 Unprocessable Content (Domain Mismatch)
-   **Issue**: Sign-Up fails at the Verification preparation step.
-   **Error**: `{"code": "redirect_url_domain_mismatch", "message": "Redirect url does not belong to your domain"}`.
-   **Root Cause**: The custom proxy mocks `clerk.estio.co`, but Clerk's backend still sees a `redirect_url` pointing to `downtowncyprus.site`. Clerk rejects this because it doesn't recognize the tenant domain as part of the instance.
-   **Fix**: Switched to **Native Satellite Mode**.
    1.  **Register Domain via API**: Used `scripts/register-domain.ts` with **Clerk Test Keys** to call `POST /v1/domains` and register `downtowncyprus.site` as a satellite.
    2.  **Configure ClerkProvider**: In `app/(public-site)/[domain]/layout.tsx`, set `isSatellite={true}` and `domain` pointing to the Clerk FAPI.
    3.  **Use Test Keys**: Enabled the `app:domains` API feature (free in Dev Mode) by switching to `pk_test` and `sk_test` keys.
-   **Status**: ✅ **RESOLVED (December 29, 2025)**.

---

## Final Working Configuration (Development Mode)

| Setting | Value |
|---------|-------|
| **Clerk Keys** | `pk_test_...` / `sk_test_...` (Dev Mode) |
| **ClerkProvider (Tenant Layout)** | `isSatellite={true}`, `domain="magnetic-squirrel-16.clerk.accounts.dev"`, `signInUrl`/`signUpUrl` point to `estio.co` |
| **Domain Registration** | `downtowncyprus.site` registered via `scripts/register-domain.ts` using Test Keys |

> [!IMPORTANT]
> **Production Switch**: When upgrading to Clerk Pro, replace Test Keys with Production (`pk_live`, `sk_live`) in deployment scripts. The `domain` prop should point to `clerk.estio.co`.

---

## Key Learnings

1.  **Custom Proxy is Insufficient**: The proxy can handle CORS and cookie scoping, but cannot solve Clerk's backend validation of `redirect_url` ownership.
2.  **Satellite Mode Requires Registration**: Clerk must "know" the domain. Use `POST /v1/domains` API.
3.  **Dev Mode is Free**: Clerk's Pro features (`app:domains`, Satellite Mode) are available for free in Development Mode, allowing full architectural validation before paying.
