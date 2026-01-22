import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const isProtectedRoute = createRouteMatcher(["/dashboard(.*)", "/forum(.*)"]);
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api(.*)",
  "/sso-callback",
  "/monitoring(.*)",
  "/site.webmanifest",
  "/robots.txt",
  "/images(.*)",
]);

// Include 127.0.0.1 for when Caddy proxies to local Next.js (without port in Host header)
const SYSTEM_DOMAINS = ["localhost:3000", "localhost", "127.0.0.1", "estio.co"];

export default clerkMiddleware(async (auth, req: NextRequest) => {
  // export default async function middleware(req: NextRequest) {
  // const auth = () => ({ userId: null, protect: () => {} }); // Mock auth for debugging
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
  console.log(`[Middleware] [${req.method}] ${req.url}`);
  console.log(`[Middleware] Host: ${host}, Hostname (Clean): ${hostname}`);
  console.log(`[Middleware] Headers: X-Forwarded-Proto=${req.headers.get('x-forwarded-proto')}, X-Forwarded-Host=${req.headers.get('x-forwarded-host')}`);

  if (host && host.startsWith("www.") && host !== "localhost") {
    console.log(`[Middleware] Redirecting WWW to non-WWW`);
    const newHostname = host.replace(/^www\./, "");
    const newUrl = new URL(req.url);
    newUrl.hostname = newHostname;
    newUrl.protocol = "https:";
    newUrl.port = ""; // Remove internal port (3000)
    return NextResponse.redirect(newUrl);
  }

  // console.log(`[Middleware] Incoming Request: ${req.url} | Host Header: ${req.headers.get("host")} | Resolved Hostname: ${hostname}`);

  const searchParams = req.nextUrl.searchParams.toString();
  // Construct the path (e.g. /search)
  const path = `${url.pathname}${searchParams.length > 0 ? `?${searchParams}` : ""
    }`;

  // Helper: Create Internal Rewrite using RELATIVE URL
  // We switch back to standard Next.js rewrites to avoid proxy loops and 308 redirects.
  // The absolute URL approach (http://localhost:3000) was causing issues on Next.js 15.
  const createInternalRewrite = (targetPath: string) => {
    // Construct URL relative to the current request's origin
    const destUrl = new URL(targetPath, req.url);

    // Handle params (merge existing + new logic if needed)
    if (targetPath.includes('?')) {
      const [p, q] = targetPath.split('?');
      destUrl.pathname = p;
      const targetParams = new URLSearchParams(q);
      targetParams.forEach((v, k) => destUrl.searchParams.set(k, v));
    }

    // Add Loop Protection
    destUrl.searchParams.set('_internal_rewrite', 'true');

    // DEBUG: Log the rewrite
    console.log(`[Middleware] Rewriting to (Relative): ${destUrl.pathname}`);

    // Standard Rewrite - internal to Next.js
    return NextResponse.rewrite(destUrl, {
      request: {
        headers: req.headers, // Pass original headers
      },
    });
  };

  // 1. System/Admin Domain Logic (Existing Dashboard)
  // If accessing via localhost (base), main app domain, or Clerk's OAuth domain.
  if (SYSTEM_DOMAINS.includes(hostname || "") || hostname === "clerk.estio.co") {
    // console.log(`[Middleware] Matched System Domain: ${hostname}`);

    // Allow public routes without any auth
    if (isPublicRoute(req)) {
      console.log(`[Middleware] System Domain Public Route matched: ${path} for host ${hostname}`);
      // FIX: Do not rewrite system domains, serve directly.
      const response = NextResponse.next();
      response.headers.set(
        'Content-Security-Policy',
        "frame-ancestors 'self' https://*.gohighlevel.com https://*.leadconnectorhq.com https://app.gohighlevel.com https://estio.co;"
      );
      return response;
    }

    // Protect dashboard and other private routes with Clerk
    if (isProtectedRoute(req)) {
      console.log(`[Middleware] Protecting Route: ${path}`);
      await auth.protect();
    }

    // CRITICAL FIX: For System Domains (estio.co, localhost), we DO NOT rewrite.
    // Rewriting creates an internal proxy request which strips Clerk context and causes EPROTO errors.
    // tailored for Caddy/Next.js setup.
    console.log(`[Middleware] System Domain -> Serving directly (next)`);
    const response = NextResponse.next();

    // FORCE CSP HEADER: Allow iframe embedding for GHL
    response.headers.set(
      'Content-Security-Policy',
      "frame-ancestors 'self' https://*.gohighlevel.com https://*.leadconnectorhq.com https://app.gohighlevel.com https://estio.co;"
    );

    return response;
  }

  // 2. Tenant Domain Logic (Public Website)
  // console.log(`[Middleware] Matched Tenant Domain: ${hostname}`);

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
    console.log(`[Middleware] Tenant Domain System Path matched: ${path}`);
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
        console.log(`[Middleware] Tenant Admin (Unauthenticated) -> Redirecting to Sign In`);
        // Redirect to tenant's sign-in page with redirect back to /admin
        // This allows admins to log in on the tenant domain directly
        // Role checking happens server-side in admin pages (redirects public users to home)
        const signInUrl = new URL("/sign-in", `https://${hostname}`);
        signInUrl.searchParams.set("redirect_url", url.pathname + url.search);
        return NextResponse.redirect(signInUrl);
      }

      console.log(`[Middleware] Tenant System Path (Unauthenticated) -> SSO Handshake`);
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
      // console.log(`[Middleware] Satellite Check for ${hostname}: Session=${hasSession}, UAT=${hasClientUat}, Ticket=${hasTicket}, AuthPath=${isAuthPath}`);
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
    console.log(`[Middleware] Tenant Public Content: ${hostname}${path}`);

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
// }

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images/ (public images)
     */
    '/((?!_next/static|_next/image|favicon.ico|images/|.*\\.(?:css|js|png|jpg|jpeg|gif|webp|svg|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};