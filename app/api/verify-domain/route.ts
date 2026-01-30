import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { SYSTEM_DOMAINS } from "@/lib/app-config";

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const domain = searchParams.get("domain");

    if (!domain) {
        return new NextResponse("Domain required", { status: 400 });
    }

    console.log(`[Caddy Verify] Checking domain: ${domain}`);

    // 1. System Domains - ALWAYS ALLOW
    // These are required for the dashboard and API to function.
    if (SYSTEM_DOMAINS.includes(domain)) {
        return new NextResponse("Allowed (System)", { status: 200 });
    }

    try {
        // 2. Database Check
        // We check if ANY location has claimed this custom domain.
        // NOTE: We must AUTHORIZE 'www' versions even if they aren't in the DB, 
        // so Caddy can issue the cert, and then Middleware can redirect them.
        const normalizedDomain = domain.startsWith("www.") ? domain.replace("www.", "") : domain;

        const config = await db.siteConfig.findFirst({
            where: {
                domain: {
                    equals: normalizedDomain,
                    mode: 'insensitive' // Ensure case-insensitive match
                }
            },
            select: { id: true } // Efficiency
        });

        if (config) {
            console.log(`[Caddy Verify] Domain authorized: ${domain}`);
            return new NextResponse("Allowed (Database)", { status: 200 });
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
