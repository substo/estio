import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    return proxyRequest(request);
}

export async function POST(request: NextRequest) {
    return proxyRequest(request);
}

export async function PUT(request: NextRequest) {
    return proxyRequest(request);
}

export async function PATCH(request: NextRequest) {
    return proxyRequest(request);
}

export async function DELETE(request: NextRequest) {
    return proxyRequest(request);
}

async function proxyRequest(request: NextRequest) {
    const { nextUrl, headers, method } = request;

    // 1. Construct target URL (Clerk Frontend API)
    // Extract path after /api/auth-proxy
    // e.g., /api/auth-proxy/v1/client -> /v1/client
    const clerkPath = nextUrl.pathname.replace('/api/auth-proxy', '');
    const searchParams = nextUrl.searchParams.toString();
    const targetUrl = `https://clerk.estio.co${clerkPath}${searchParams ? `?${searchParams}` : ''}`;

    console.log(`[Clerk Proxy] ${method} ${nextUrl.pathname} -> ${targetUrl}`);

    // 2. Prepare headers
    const newHeaders = new Headers(headers);
    newHeaders.set('Host', 'clerk.estio.co'); // Pretend to be the Clerk domain

    // Force X-Forwarded-Host to valid Clerk domain to ensure attribution works
    // We stripped the browser's Origin, but we also need to spoof the forwarded host.
    newHeaders.set('X-Forwarded-Host', 'clerk.estio.co');
    newHeaders.set('X-Forwarded-Proto', 'https');
    newHeaders.set('X-Forwarded-Port', '443');

    // We want Clerk to treat this as a direct request to clerk.estio.co.
    // However, we MUST pass the Origin/Referer for Clerk to validate security (CORS/Bot protection).
    // If we strip them, Clerk rejects the request as suspicious.
    // Note: The tenant domain must be in Clerk's "Allowed Origins".

    // 3. Forward the request
    try {
        const response = await fetch(targetUrl, {
            method,
            headers: newHeaders,
            body: request.body,
            // @ts-expect-error - duplex is required for streaming bodies in Node.js/Next.js
            duplex: 'half',
            redirect: 'manual',
        });

        if (!response.ok) {
            const clone = response.clone();
            const text = await clone.text();
            console.log(`[Clerk Proxy] Error Response ${response.status}:`, text);
        }

        // 4. Handle Response Headers (Cookie Rewriting)
        const responseHeaders = new Headers(response.headers);

        // Strip Content-Encoding/Length to prevent decoding errors (let Next.js/Browser handle it)
        responseHeaders.delete('content-encoding');
        responseHeaders.delete('content-length');

        // Rewrite Set-Cookie to strip the domain or set it to current domain
        // Clerk sets cookies for .estio.co. We need them for .downtowncyprus.site (or just host-only)
        const setCookie = responseHeaders.get('set-cookie');
        if (setCookie) {
            // Simple rewrite: Remove "Domain=.estio.co;" or replace it
            // A robust proxy needs to parse multiple set-cookie headers
            // Since we can't easily parse split headers in standard fetch API (joined by comma),
            // we might need more advanced handling if Clerk sends multiple cookies.

            // For now, let's strip Domain attributes so they become host-only cookies for the tenant domain.
            const newSetCookie = setCookie.replace(/Domain=[^;]+;?/g, '');
            responseHeaders.set('set-cookie', newSetCookie);
        }

        // 5. Return response
        return new NextResponse(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
        });

    } catch (error) {
        console.error('[Clerk Proxy] Error:', error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
