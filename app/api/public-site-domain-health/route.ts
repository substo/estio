import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const domainId = req.nextUrl.searchParams.get("domainId") || "";
    const hostname = String(req.headers.get("host") || "").replace(/:\d+$/, "").toLowerCase();
    const domain = await db.publicSiteDomain.findFirst({
        where: { id: domainId, hostname, status: { in: ["VERIFIED", "ACTIVE"] } },
        select: { id: true },
    });
    if (!domain) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: { "x-estio-domain-id": domain.id, "Cache-Control": "no-store" } });
}
