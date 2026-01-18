import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const isProtectedRoute = createRouteMatcher(["/admin(.*)"]);
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/oauth(.*)",
  "/api/clerk(.*)",
  "/api/auth-proxy(.*)",
  "/sso(.*)",
  "/setup(.*)",
  "/(public-site)(.*)",
  "/v1/oauth_callback(.*)", // Add explicit exclusion for Clerk's OAuth callback if it hits this server
  "/api/webhooks(.*)"
]);

// Define your system domains (Dashboard/Admin access)
// Include 127.0.0.1 for when Caddy proxies to local Next.js (without port in Host header)
const SYSTEM_DOMAINS = ["localhost:3000", "localhost", "127.0.0.1", "estio.co"];

export default clerkMiddleware(async (auth, req: NextRequest) => {
  let hostname = req.headers.get("host");

  // Remove port if present (for localhost testing)
  hostname = hostname ? hostname.replace(":3000", "") : "";
  const url = req.nextUrl;

  // LOOP PROTECTION: Check for the special query param we signal on internal rewrites
  if (url.searchParams.has("_internal_rewrite")) {
    const response = NextResponse.next();
    // FORCE CSP HEADER: Allow iframe embedding for GHL
    response.headers.set(
      'Content-Security-Policy',
      "frame-ancestors 'self' https://*.gohighlevel.com https://*.leadconnectorhq.com https://app.gohighlevel.com https://estio.co;"
    );
    return response;
  }

  // 0. Global WWW Redirect
  // Ensure strict cannonical domain (non-www) for SEO and consistency.
  const host = req.headers.get("host");
  if (host && host.startsWith("www.") && host !== "localhost") {
    const newHostname = host.replace(/^www\./, "");
    const newUrl = new URL(req.url);
    newUrl.hostname = newHostname;
    newUrl.protocol = "https:";
    newUrl.port = ""; // Remove internal port (3000)
    return NextResponse.redirect(newUrl);
  }

  console.log(`[Middleware] Incoming Request: ${req.url} | Host Header: ${req.headers.get("host")} | Resolved Hostname: ${hostname}`);

  const searchParams = req.nextUrl.searchParams.toString();
  // Construct the path (e.g. /search)
  const path = `${url.pathname}${searchParams.length > 0 ? `?${searchParams}` : ""
    }`;

  // Helper: Create Internal Rewrite using ABSOLUTE URL
  // We use http://127.0.0.1:3000 to avoid EPROTO errors (SSL handshake on HTTP port).
  // CRITICAL: We MUST force specific headers so Clerk believes it's still on the original domain/protocol.
  const createInternalRewrite = (targetPath: string) => {
    // 1. Construct Absolute URL to localhost (HTTP) to keep it internal.
    // We use the incoming port if available (for local dev on 3001 etc), default to 3000.
    const port = req.nextUrl.port || '3000';
    const destUrl = new URL(targetPath, `http://localhost:${port}`);

    // Handle params (merge existing + new)
    // Note: URL constructor above handles the path, but we need to merge current request params if not present?
    // Actually, the original logic was:
    // if targetPath has '?', split it.
    // We should probably preserve that logic or simplify.
    // The previous implementation used req.nextUrl.clone().
    // Let's replicate the logic but on the new URL.

    // If targetPath implies query params, we need to respect them.
    // But we also usually want to carry over the original request's params if they aren't overridden?
    // The original code:
    // const [p, q] = targetPath.split('?');
    // destUrl.pathname = p;
    // const targetParams = new URLSearchParams(q);
    // targetParams.forEach((v, k) => destUrl.searchParams.set(k, v));

    // Let's do the same.
    if (targetPath.includes('?')) {
      const [p, q] = targetPath.split('?');
      destUrl.pathname = p;
      const targetParams = new URLSearchParams(q);
      targetParams.forEach((v, k) => destUrl.searchParams.set(k, v));
    }

    // Add Loop Protection
    destUrl.searchParams.set('_internal_rewrite', 'true');

    // 2. Prepare Headers to preserve Clerk Context
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-forwarded-proto', 'https'); // Force HTTPS context for Clerk
    requestHeaders.set('x-forwarded-host', req.headers.get('host') || '');
    requestHeaders.set('host', req.headers.get('host') || ''); // Masquerade as original host

    return NextResponse.rewrite(destUrl, {
      request: {
        headers: requestHeaders,
      },
    });
  };


  // 1. System/Admin Domain Logic (Existing Dashboard)
  // If accessing via localhost (base), main app domain, or Clerk's OAuth domain.
  if (SYSTEM_DOMAINS.includes(hostname || "") || hostname === "clerk.estio.co") {

    // Allow public routes without any auth
    if (isPublicRoute(req)) {
      console.log(`[Middleware] System Domain Public Route matched: ${path} for host ${hostname}`);
      return createInternalRewrite(path);
    }

    // Protect dashboard and other private routes with Clerk
    if (isProtectedRoute(req)) {
      await auth.protect();
    }

    const response = createInternalRewrite(path);

    // FORCE CSP HEADER: Allow iframe embedding for GHL
    response.headers.set(
      'Content-Security-Policy',
      "frame-ancestors 'self' https://*.gohighlevel.com https://*.leadconnectorhq.com https://app.gohighlevel.com https://estio.co;"
    );

    return response;
  }

  // 2. Tenant Domain Logic (Public Website)

  // Custom Domain Admin & Auth Access:
  // If a user goes to website.com/admin, or auth pages, we want to show them the main app.
  // We rewrite this request to the path (removing the mapped domain logic essentially).

  const isSystemPath =
    url.pathname.startsWith("/admin") ||
    // url.pathname.startsWith("/sign-in") || // Allow tenant sign-in to fall through to tenant pages
    // url.pathname.startsWith("/sign-up") || // Allow tenant sign-up to fall through to tenant pages
    url.pathname.startsWith("/sso") ||
    url.pathname.startsWith("/setup") ||
    url.pathname.startsWith("/api"); // API routes should be global and not rewritten to tenant folder

  // Create success response
  let response;

  if (isSystemPath) {
    // NOTE: Sign-up and sign-in are allowed directly on tenant domains for public users
    // (e.g., users saving favorite properties). Admin access still triggers SSO handshake.

    // SSO HANDSHAKE: If user is NOT logged in on this custom domain, try to handshake with primary domain.
    // Exception: Do not redirect for auth pages (sign-in/sign-up), SSO paths, or API routes
    const isHandshakePath =
      url.pathname.startsWith("/sso") ||
      url.pathname.startsWith("/api/clerk") ||
      url.pathname.startsWith("/api/auth-proxy") ||
      url.pathname.startsWith("/v1/oauth_callback") ||
      url.pathname.startsWith("/api/webhooks");

    // Auth pages should NOT trigger handshake - allow direct sign-up/sign-in on tenant domains
    // Note: Since we removed sign-in/sign-up from isSystemPath, this check might be redundant for those paths,
    // but kept just in case of future changes or other auth paths.
    const isAuthPage =
      url.pathname.startsWith("/sign-in") ||
      url.pathname.startsWith("/sign-up");

    // Access auth() only when needed
    const { userId } = await auth();

    if (!userId && !isHandshakePath && !isAuthPage) {
      // HYBRID ADMIN ACCESS MODEL:
      // - Signed-out users on /admin → Show tenant sign-in page with redirect
      // - SSO handshake only for /setup and other system paths that require primary domain auth

      if (url.pathname.startsWith("/admin")) {
        // Redirect to tenant's sign-in page with redirect back to /admin
        // This allows admins to log in on the tenant domain directly
        // Role checking happens server-side in admin pages (redirects public users to home)
        const signInUrl = new URL("/sign-in", `https://${hostname}`);
        signInUrl.searchParams.set("redirect_url", url.pathname + url.search);
        return NextResponse.redirect(signInUrl);
      }

      // For other system paths (like /setup), use SSO handshake with primary domain
      // These require the user to be logged into estio.co first
      const handshakeUrl = new URL("https://estio.co/sso/handshake");

      // Construct public URL using the hostname header to avoid 'localhost' in the redirect_url
      const publicUrl = new URL(url.pathname + url.search, `https://${hostname}`);
      handshakeUrl.searchParams.set("redirect_url", publicUrl.toString());

      return NextResponse.redirect(handshakeUrl);
    }

    // Ensure it's protected if needed (for /admin)
    if (isProtectedRoute(req)) {
      await auth.protect();
    }

    // REWRITE to the internal path (White Label behavior)
    // This allows the admin dashboard to be served under the custom domain (e.g. downtowncyprus.site/admin)

    // LAZY SATELLITE MODE DETECTION
    // We only want to enable Clerk Satellite Mode (which causes a redirect handshake) if:
    // 1. User is on an admin path (needs strict auth)
    // 2. User is on an auth path (sign-in/sign-up)
    // 3. User is returning from a sign-in (has a ticket)
    // 4. User is already authenticated (has a session cookie)
    // 5. User is on a favorites page (needs auth check)
    const hasSession = req.cookies.has("__session");
    const hasClientUat = req.cookies.has("__client_uat");
    const hasTicket = req.nextUrl.searchParams.has("__clerk_ticket");
    const isAuthPath =
      url.pathname.startsWith("/admin") ||
      url.pathname.startsWith("/favorites") ||
      url.pathname.startsWith("/sign-in") ||
      url.pathname.startsWith("/sign-up");

    // DEBUG: Log trigger conditions for troubleshooting
    if (hostname !== "localhost" && !SYSTEM_DOMAINS.includes(hostname || "")) {
      // Only log on tenant domains to reduce noise
      console.log(`[Middleware] Satellite Check for ${hostname}: Session=${hasSession}, UAT=${hasClientUat}, Ticket=${hasTicket}, AuthPath=${isAuthPath}`);
    }

    if (hasSession || hasClientUat || hasTicket || isAuthPath) {
      // Signal to layout.tsx to enable isSatellite=true
      const requestHeaders = new Headers(req.headers);
      requestHeaders.set("x-enable-satellite", "true");

      // Use internal rewrite helper (which adds loop protection param)
      response = createInternalRewrite(path);
    } else {
      // Standard rewrite without enabling satellite mode
      response = createInternalRewrite(path);
    }

  } else {
    // IF we are rewriting to `/[domain]`, Next.js handles it.

    // Strategy: Try relative first.
    // `path` includes search params.
    const mappedPath = `/${hostname}${url.pathname}${searchParams.length > 0 ? `?${searchParams}` : ""}`;
    response = createInternalRewrite(mappedPath);
  }

  // FORCE CSP HEADER: Allow iframe embedding for GHL
  // This is critical because next.config.js headers can sometimes be lost in middleware responses/rewrites
  response.headers.set(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://*.gohighlevel.com https://*.leadconnectorhq.com https://app.gohighlevel.com https://estio.co;"
  );

  return response;
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};