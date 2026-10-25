import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { APP_DOMAIN, APP_URL, SYSTEM_DOMAINS } from "@/lib/app-config";
import { getHostBrandConfig, resolveHostBrand } from "@/lib/auth/host-brand";
import { getClerkBrandKeys, getSubstoClerkConfigConflicts, hasClerkEncryptionKey } from "@/lib/auth/clerk-runtime";
import { hasStudioSupabaseConfig } from "@/lib/studio/config";
import { isSubstoSitePath } from "@/lib/substo-sites/policy";
import { CLERK_PROFILE_WEBHOOK_PATH, classifySubstoRoute, skipsLegacyEstioMiddleware } from "@/lib/auth/host-routing-policy";

const isProtectedRoute = createRouteMatcher(["/dashboard(.*)", "/forum(.*)", "/studio(.*)", "/account/connections(.*)"]);
const getRequestBrand = (req: NextRequest) =>
  resolveHostBrand(req.headers.get("host"), getHostBrandConfig());

const clerkHandler = clerkMiddleware(async (auth, req: NextRequest) => {
  let hostname = req.headers.get("host");

  // Remove port if present (robust regex)
  hostname = hostname ? hostname.replace(/:\d+$/, "") : "";
  const url = req.nextUrl;

  // Substo is a separate Clerk realm with an explicit CRM allowlist.
  // Enforce this before the Estio tenant rewrite loop-protection bypass.
  if (getRequestBrand(req) === "substo") {
    const routeKind = classifySubstoRoute(url.pathname);
    if (routeKind === "root") {
      return NextResponse.redirect(new URL("/studio", req.url));
    }
    if (routeKind === "blocked") {
      return new NextResponse("Not Found", { status: 404 });
    }
    if (routeKind === "studio" || routeKind === "brand" || routeKind === "profile" || routeKind === "crm") await auth.protect();
    // Studio API handlers validate their Clerk user and workspace access, returning
    // JSON errors to clients instead of Clerk's page-oriented protect redirect.

    return NextResponse.next();
  }

  if (hostname === `www.${APP_DOMAIN}`) {
    const destination = new URL(req.url);
    destination.hostname = APP_DOMAIN;
    destination.protocol = "https:";
    destination.port = "";
    return NextResponse.redirect(destination, 308);
  }

  // LOOP PROTECTION
  if (url.searchParams.has("_internal_rewrite")) {
    const response = NextResponse.next();
    response.headers.set(
      'Content-Security-Policy',
      "frame-ancestors 'self' https://*.gohighlevel.com https://*.leadconnectorhq.com https://app.gohighlevel.com https://estio.co;"
    );
    return response;
  }

  const searchParams = req.nextUrl.searchParams.toString();
  const path = `${url.pathname}${searchParams.length > 0 ? `?${searchParams}` : ""}`;

  // Helper: Create Internal Rewrite using ABSOLUTE URL
  const createInternalRewrite = (targetPath: string) => {
    const normalizedPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
    const destUrl = new URL(normalizedPath, req.url);

    destUrl.searchParams.set('_internal_rewrite', 'true');
    console.log("[Middleware] Applying tenant rewrite");

    return NextResponse.rewrite(destUrl, {
      request: { headers: req.headers },
    });
  };

  // 1. System/Admin Domain Logic (estio.co, localhost)
  if (getRequestBrand(req) === "estio" || SYSTEM_DOMAINS.includes(hostname || "") || hostname === "clerk.estio.co") {
    if (isProtectedRoute(req)) {
      await auth.protect();
    }
    console.log("[Middleware] Handling system domain natively");
    const response = NextResponse.next();

    response.headers.set(
      'Content-Security-Policy',
      "frame-ancestors 'self' https://*.gohighlevel.com https://*.leadconnectorhq.com https://app.gohighlevel.com https://estio.co;"
    );
    return response;
  }

  // 2. Tenant Domain Logic (Public Website)
  const isSystemPath =
    url.pathname.startsWith("/admin") ||
    url.pathname.startsWith("/sso") ||
    url.pathname.startsWith("/setup") ||
    url.pathname.startsWith("/api");

  if (isSystemPath) {
    const isHandshakePath =
      url.pathname.startsWith("/sso") ||
      url.pathname.startsWith("/api/clerk") ||
      url.pathname.startsWith("/api/auth-proxy") ||
      url.pathname.startsWith("/api/analytics") ||
      url.pathname.startsWith("/api/public-site-domain-health") ||
      url.pathname.startsWith("/v1/oauth_callback") ||
      url.pathname.startsWith("/api/webhooks") ||
      url.pathname.startsWith("/api/google");

    const isAuthPage =
      url.pathname.startsWith("/sign-in") ||
      url.pathname.startsWith("/sign-up");

    const { userId } = await auth();

    if (!userId && !isHandshakePath && !isAuthPage) {
      if (url.pathname.startsWith("/admin")) {
        const signInUrl = new URL("/sign-in", `https://${hostname}`);
        signInUrl.searchParams.set("redirect_url", url.pathname + url.search);
        return NextResponse.redirect(signInUrl);
      }
      const handshakeUrl = new URL("https://estio.co/sso/handshake");
      const publicUrl = new URL(url.pathname + url.search, `https://${hostname}`);
      handshakeUrl.searchParams.set("redirect_url", publicUrl.toString());
      return NextResponse.redirect(handshakeUrl);
    }

    if (isProtectedRoute(req)) {
      await auth.protect();
    }

    const hasSession = req.cookies.has("__session");
    const hasClientUat = req.cookies.has("__client_uat");
    const hasTicket = req.nextUrl.searchParams.has("__clerk_ticket");
    const isAuthPath =
      url.pathname.startsWith("/admin") ||
      url.pathname.startsWith("/favorites") ||
      url.pathname.startsWith("/sign-in") ||
      url.pathname.startsWith("/sign-up");

    if ((hasSession || hasClientUat || hasTicket || isAuthPath) && !hostname.includes("estio.co")) {
      const requestHeaders = new Headers(req.headers);
      requestHeaders.set("x-enable-satellite", "true");

      const destUrl = new URL(path, req.url);
      destUrl.searchParams.set('_internal_rewrite', 'true');

      return NextResponse.rewrite(destUrl, {
        request: { headers: requestHeaders }
      });
    } else {
      return createInternalRewrite(path);
    }
  } else {
    // Tenant Public Content
    try {
      const resolverUrl = new URL("/api/public-site-domains/resolve", APP_URL);
      resolverUrl.searchParams.set("hostname", hostname);
      const resolverResponse = await fetch(resolverUrl, { next: { revalidate: 30 } });
      if (resolverResponse.status === 404) {
        return new NextResponse("Not Found", { status: 404 });
      }
      if (!resolverResponse.ok) {
        throw new Error(`Domain resolver returned ${resolverResponse.status}`);
      }
      const resolution = await resolverResponse.json() as { redirect?: boolean; canonicalHostname?: string };
      if (resolution.redirect && resolution.canonicalHostname && resolution.canonicalHostname !== hostname) {
        const destination = new URL(req.url);
        destination.protocol = "https:";
        destination.hostname = resolution.canonicalHostname;
        destination.port = "";
        return NextResponse.redirect(destination, 308);
      }
    } catch {
      console.error("[public-site-domain] resolver unavailable");
      return new NextResponse("Domain resolution temporarily unavailable", {
        status: 503,
        headers: { "Retry-After": "30" },
      });
    }
    const mappedPath = `/${hostname}${url.pathname}${searchParams.length > 0 ? `?${searchParams}` : ""}`;
    return createInternalRewrite(mappedPath);
  }
}, (req) => {
  if (getRequestBrand(req) !== "substo") return {};
  const keys = getClerkBrandKeys("substo");
  return keys ? {
    publishableKey: keys.publishableKey,
    secretKey: keys.secretKey,
    signInUrl: "/sign-in",
    signUpUrl: "/sign-up",
  } : {};
});

// Standard Middleware for Production (Live Keys)
// With Live Keys, Clerk handles domain logic natively.
export default async function middleware(req: NextRequest, evt: any) {
  if (isSubstoSitePath(req.nextUrl.pathname) && getRequestBrand(req) !== "substo") {
    return new NextResponse("Not Found", { status: 404 });
  }
  // Exact profile-only webhook uses its realm signature, independent of browser
  // Clerk/Studio readiness. No tenant or adjacent API path shares this bypass.
  if (req.nextUrl.pathname === CLERK_PROFILE_WEBHOOK_PATH) {
    return getRequestBrand(req) === "tenant" ? new NextResponse("Not Found", { status: 404 }) : NextResponse.next();
  }
  if (getRequestBrand(req) === "substo") {
    // Public websites are read-only and independent of Clerk/Studio readiness.
    if (classifySubstoRoute(req.nextUrl.pathname) === "site") {
      if (!["GET", "HEAD"].includes(req.method)) return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      const response = NextResponse.next();
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Content-Security-Policy", "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' https:; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      response.headers.set("X-Content-Type-Options", "nosniff");
      response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      return response;
    }
    if (classifySubstoRoute(req.nextUrl.pathname) === "blocked") {
      return new NextResponse("Not Found", { status: 404 });
    }
    const conflicts = getSubstoClerkConfigConflicts();
    if (conflicts.length) {
      console.error("[Substo auth] Remove conflicting global Clerk settings", conflicts);
      return new NextResponse("Substo Clerk configuration conflicts with shared routing settings", { status: 503 });
    }
    if (!getClerkBrandKeys("substo") || !hasClerkEncryptionKey() || !hasStudioSupabaseConfig()) {
      return new NextResponse("Substo Studio is not configured", {
        status: 503,
        headers: { "Retry-After": "60" },
      });
    }
  } else if (skipsLegacyEstioMiddleware(req.nextUrl.pathname)) {
    return NextResponse.next();
  }
  const res = await clerkHandler(req, evt);
  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static/|_next/image|favicon\\.ico$|images/).*)',
    '/(api|trpc)(.*)',
  ],
};
