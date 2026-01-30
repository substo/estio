import db from "@/lib/db";
import { redirect } from "next/navigation";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const locationId = searchParams.get("locationId");
    const agencyId = searchParams.get("agencyId");
    // GHL might send a 'session' or 'token' for validation
    // const sessionToken = searchParams.get("session");

    // TODO: Validate signature/token using GHL_CLIENT_SECRET
    // For MVP, we assume if locationId/agencyId is present, we try to find the location.
    // IN PRODUCTION: YOU MUST VALIDATE THE REQUEST ORIGIN/SIGNATURE.

    if (!locationId && !agencyId) {
        return NextResponse.json({ error: "Missing locationId or agencyId" }, { status: 400 });
    }

    const where = locationId ? { ghlLocationId: locationId } : { ghlAgencyId: agencyId };

    const location = await db.location.findFirst({
        where: where as any,
    });

    if (!location) {
        // If location not found, they might need to install/auth first.
        // Redirect to OAuth start
        const oauthUrl = `/api/ghl/oauth/start?locationId=${locationId || ''}&agencyId=${agencyId || ''}`;
        return redirect(oauthUrl);
    }

    // Location exists. Establish session.
    // We can redirect to dashboard with locationId.
    // In a real app, we would set a secure cookie or use Clerk's session metadata if possible.
    // For this MVP, we pass locationId in query param to dashboard, 
    // and the dashboard middleware/layout should handle it (or we set a cookie here).

    // Let's set a simple cookie for location context
    // FIX: Use hardcoded production URL to avoid localhost resolution behind proxy
    const baseUrl = process.env.NODE_ENV === 'production' ? 'https://estio.co' : request.url;
    const response = NextResponse.redirect(new URL(`/admin?locationId=${location.id}`, baseUrl));
    response.cookies.set("crm_location_id", location.id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        path: "/",
    });

    return response;
}
