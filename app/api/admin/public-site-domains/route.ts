import { NextRequest, NextResponse } from "next/server";
import { requirePublicSiteDomainAdmin } from "@/lib/public-site-domains/api-auth";
import {
    claimPublicSiteDomain,
    listPublicSiteDomains,
    PublicSiteDomainValidationError,
} from "@/lib/public-site-domains/service";

export async function GET(req: NextRequest) {
    const locationId = req.nextUrl.searchParams.get("locationId") || "";
    if (!(await requirePublicSiteDomainAdmin(locationId))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ domains: await listPublicSiteDomains(locationId) });
}

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null) as { locationId?: string; hostname?: string } | null;
    const locationId = String(body?.locationId || "");
    const admin = await requirePublicSiteDomainAdmin(locationId);
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const domain = await claimPublicSiteDomain({
            locationId,
            hostname: String(body?.hostname || ""),
            actorUserId: admin.userId,
        });
        return NextResponse.json({ domain }, { status: 201 });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Could not claim domain.";
        return NextResponse.json({ error: message }, { status: error instanceof PublicSiteDomainValidationError ? 400 : 500 });
    }
}
