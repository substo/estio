import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { SYSTEM_DOMAINS } from "@/lib/app-config";

const isProtectedRoute = createRouteMatcher(["/dashboard(.*)", "/forum(.*)"]);

const clerkHandler = clerkMiddleware(async (auth, req: NextRequest) => {
  let hostname = req.headers.get("host");

  // Remove port if present (robust regex)
  hostname = hostname ? hostname.replace(/:\d+$/, "") : "";
  const url = req.nextUrl;

  // LOOP PROTECTION
  if (url.searchParams.has("_internal_rewrite")) {
    const response = NextResponse.next();
    response.headers.set(
      'Content-Security-Policy',
      "frame-ancestors 'self' https://*.gohighlevel.com https://*.leadconnectorhq.com https://app.gohighlevel.com https://estio.co;"
    );
    return response;
  }

  // 0. Global WWW Redirect
  const host = req.headers.get("host");

  if (host && host.startsWith("www.") && host !== "localhost") {
    const newHostname = host.replace(/^www\./, "");
    const newUrl = new URL(req.url);
    newUrl.hostname = newHostname;
    newUrl.protocol = "https:";
    newUrl.port = "";
    return NextResponse.redirect(newUrl);
  }

  const searchParams = req.nextUrl.searchParams.toString();
  const path = `${url.pathname}${searchParams.length > 0 ? `?${searchParams}` : ""}`;

  // Helper: Create Internal Rewrite using ABSOLUTE URL
  const createInternalRewrite = (targetPath: string) => {
    const normalizedPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
    const destUrlString = `http://localhost:3000${normalizedPath}`;
    const destUrl = new URL(destUrlString);

    if (targetPath.includes('?')) {
      const [p, q] = targetPath.split('?');
      destUrl.pathname = p;
      const targetParams = new URLSearchParams(q);
      targetParams.forEach((v, k) => destUrl.searchParams.set(k, v));
    }

    destUrl.searchParams.set('_internal_rewrite', 'true');
    console.log(`[Middleware] Rewriting Tenant to: ${destUrl.toString()}`);

    return NextResponse.rewrite(destUrl, {
      request: { headers: req.headers },
    });
  };

  // 1. System/Admin Domain Logic (estio.co, localhost)
  if (SYSTEM_DOMAINS.includes(hostname || "") || hostname === "clerk.estio.co") {
    if (isProtectedRoute(req)) {
      await auth.protect();
    }
    console.log(`[Middleware] System Domain (${hostname}) -> Handling Natively`);
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
      url.pathname.startsWith("/v1/oauth_callback") ||
      url.pathname.startsWith("/api/webhooks");

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

      const destUrl = new URL(`http://localhost:3000${path}`);
      destUrl.searchParams.set('_internal_rewrite', 'true');

      return NextResponse.rewrite(destUrl, {
        request: { headers: requestHeaders }
      });
    } else {
      return createInternalRewrite(path);
    }
  } else {
    // Tenant Public Content
    const mappedPath = `/${hostname}${url.pathname}${searchParams.length > 0 ? `?${searchParams}` : ""}`;
    return createInternalRewrite(mappedPath);
  }
});

// Standard Middleware for Production (Live Keys)
// With Live Keys, Clerk handles domain logic natively.
export default async function middleware(req: NextRequest, evt: any) {
  const res = await clerkHandler(req, evt);
  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|images/|api/health|.*\\.(?:css|js|png|jpg|jpeg|gif|webp|svg|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(trpc)(.*)',
  ],
};