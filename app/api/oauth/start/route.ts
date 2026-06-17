import { GHL_CONFIG } from "@/config/ghl";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import { generateOAuthState } from "@/lib/jwt-utils";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const locationId = searchParams.get("locationId");
    const agencyId = searchParams.get("agencyId");
    const internalLocationId = searchParams.get("internalLocationId");
    const proceed = searchParams.get("proceed");

    // If user clicked "Continue", redirect to OAuth
    if (proceed === "true") {
        if (internalLocationId) {
            const { userId } = await auth();
            if (!userId) {
                return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            }

            const isAdmin = await verifyUserIsLocationAdmin(userId, internalLocationId);
            if (!isAdmin) {
                return NextResponse.json({ error: "Forbidden" }, { status: 403 });
            }
        }

        const params = new URLSearchParams();
        params.append("client_id", process.env.GHL_CLIENT_ID!);
        params.append("redirect_uri", process.env.GHL_REDIRECT_URI!);
        params.append("response_type", "code");
        const scopeString = GHL_CONFIG.SCOPES.join(" ");
        console.log("----------------------------------------------------------------");
        console.log("[OAuth Start] GHL_CONFIG.SCOPES count:", GHL_CONFIG.SCOPES.length);
        console.log("[OAuth Start] Requesting Scopes:", scopeString);
        console.log("----------------------------------------------------------------");
        params.append("scope", scopeString);

        const state = generateOAuthState({ locationId, agencyId, internalLocationId });
        params.append("state", state);

        const authUrl = `https://marketplace.leadconnectorhq.com/oauth/chooselocation?${params.toString()}`;

        return NextResponse.redirect(authUrl);
    }

    // Show pre-authorization page
    const baseUrl = process.env.APP_BASE_URL || "https://estio.co";
    const currentUrl = new URL("/oauth/authorize", baseUrl);
    currentUrl.searchParams.set("locationId", locationId || "");
    currentUrl.searchParams.set("agencyId", agencyId || "");
    currentUrl.searchParams.set("internalLocationId", internalLocationId || "");

    return NextResponse.redirect(currentUrl);
}
