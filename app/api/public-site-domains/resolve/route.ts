import { NextRequest, NextResponse } from "next/server";
import { resolvePublicSiteDomain } from "@/lib/public-site-domains/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const hostname = req.nextUrl.searchParams.get("hostname") || "";
    const resolution = await resolvePublicSiteDomain(hostname);
    if (!resolution) {
        return NextResponse.json({ found: false }, {
            status: 404,
            headers: { "Cache-Control": "public, max-age=10, stale-while-revalidate=30" },
        });
    }
    return NextResponse.json({
        found: true,
        canonicalHostname: resolution.canonicalHostname,
        redirect: resolution.redirect,
    }, {
        headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" },
    });
}
