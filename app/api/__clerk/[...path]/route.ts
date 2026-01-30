import { NextRequest, NextResponse } from "next/server";

/**
 * Clerk Frontend API Proxy
 * 
 * This proxies Clerk's Frontend API requests through our domain, which allows
 * tenant domains to use their own domain for Clerk API calls instead of 
 * requiring satellite domain CNAME configuration.
 * 
 * Requests to: /api/__clerk/v1/... 
 * Are proxied to: https://clerk.estio.co/v1/...
 */

const CLERK_FAPI_URL = "https://clerk.estio.co";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    return proxyRequest(request, await params);
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    return proxyRequest(request, await params);
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    return proxyRequest(request, await params);
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    return proxyRequest(request, await params);
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    return proxyRequest(request, await params);
}

async function proxyRequest(
    request: NextRequest,
    { path }: { path: string[] }
) {
    // Construct the target URL
    const targetPath = path.join("/");
    const searchParams = request.nextUrl.searchParams.toString();
    const targetUrl = `${CLERK_FAPI_URL}/${targetPath}${searchParams ? `?${searchParams}` : ""}`;

    console.log(`[Clerk Proxy] ${request.method} ${targetUrl}`);

    // Get request body for non-GET requests
    let body: BodyInit | null = null;
    if (request.method !== "GET" && request.method !== "HEAD") {
        try {
            body = await request.text();
        } catch {
            // No body
        }
    }

    // Forward headers, adding required Clerk proxy headers
    const headers = new Headers();

    // Copy relevant headers from original request
    const headersToForward = [
        "content-type",
        "accept",
        "authorization",
        "cookie",
        "user-agent",
        "origin",
        "referer",
    ];

    headersToForward.forEach((header) => {
        const value = request.headers.get(header);
        if (value) {
            headers.set(header, value);
        }
    });

    // Add Clerk proxy headers
    headers.set("Clerk-Proxy-Url", `${request.nextUrl.protocol}//${request.nextUrl.host}/api/__clerk`);
    headers.set("X-Forwarded-For", request.headers.get("x-forwarded-for") || "127.0.0.1");

    // Add Clerk-Secret-Key if available (for server-to-server calls)
    if (process.env.CLERK_SECRET_KEY) {
        headers.set("Clerk-Secret-Key", process.env.CLERK_SECRET_KEY);
    }

    try {
        const response = await fetch(targetUrl, {
            method: request.method,
            headers,
            body,
            redirect: "manual",
        });

        // Create response with proxied headers
        const responseHeaders = new Headers();

        // Forward important response headers
        const responseHeadersToForward = [
            "content-type",
            "set-cookie",
            "cache-control",
            "x-clerk-auth-reason",
            "x-clerk-auth-status",
        ];

        responseHeadersToForward.forEach((header) => {
            const value = response.headers.get(header);
            if (value) {
                responseHeaders.set(header, value);
            }
        });

        // Handle all Set-Cookie headers (there may be multiple)
        const cookies = response.headers.getSetCookie?.() || [];
        cookies.forEach((cookie) => {
            responseHeaders.append("set-cookie", cookie);
        });

        // Allow CORS from any origin (for tenant domains)
        responseHeaders.set("Access-Control-Allow-Origin", request.headers.get("origin") || "*");
        responseHeaders.set("Access-Control-Allow-Credentials", "true");

        const responseBody = await response.arrayBuffer();

        return new NextResponse(responseBody, {
            status: response.status,
            headers: responseHeaders,
        });
    } catch (error) {
        console.error("[Clerk Proxy] Error:", error);
        return NextResponse.json(
            { error: "Proxy error", message: String(error) },
            { status: 502 }
        );
    }
}

// Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
    return new NextResponse(null, {
        status: 200,
        headers: {
            "Access-Control-Allow-Origin": request.headers.get("origin") || "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie",
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Max-Age": "86400",
        },
    });
}
