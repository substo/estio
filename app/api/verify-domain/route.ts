import { NextRequest, NextResponse } from "next/server";
import { SYSTEM_DOMAINS } from "@/lib/app-config";
import { isPublicSiteDomainAuthorized } from "@/lib/public-site-domains/service";

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const domain = String(searchParams.get("domain") || "").toLowerCase().replace(/:\d+$/, "");

    if (!domain) {
        return new NextResponse("Domain required", { status: 400 });
    }

    console.log(`[Caddy Verify] Checking domain: ${domain}`);

    // 1. System Domains - ALWAYS ALLOW
    // These are required for the dashboard and API to function.
    if (SYSTEM_DOMAINS.includes(domain) || (domain.startsWith("www.") && SYSTEM_DOMAINS.includes(domain.slice(4)))) {
        return new NextResponse("Allowed (System)", { status: 200 });
    }

    try {
        if (await isPublicSiteDomainAuthorized(domain)) {
            console.log(`[Caddy Verify] Domain authorized: ${domain}`);
            return new NextResponse("Allowed (Domain Lifecycle)", { status: 200 });
        }

        // 3. Subdomain Strategy (Optional - if you want all *.substo.com to work automatically)
        // If you want to allow ANY subdomain of substo.com without DB record (e.g. for testing)
        // uncomment the following:
        /*
        if (domain.endsWith(".substo.com")) {
           return new NextResponse("Allowed (Wildcard)", { status: 200 });
        }
        */

        console.warn(`[Caddy Verify] Domain REJECTED: ${domain}`);
        return new NextResponse("Unauthorized", { status: 401 });

    } catch (error) {
        console.error("[Caddy Verify] Database Error:", error);
        // Fail closed for security
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
