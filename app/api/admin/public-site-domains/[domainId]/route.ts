import { NextRequest, NextResponse } from "next/server";
import { requirePublicSiteDomainAdmin } from "@/lib/public-site-domains/api-auth";
import {
    enqueuePublicSiteDomainJob,
    listPublicSiteDomains,
    releasePublicSiteDomain,
} from "@/lib/public-site-domains/service";
import { processPublicSiteDomainJob } from "@/lib/public-site-domains/provisioning";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ domainId: string }> }) {
    const { domainId } = await params;
    const body = await req.json().catch(() => null) as { locationId?: string; confirmation?: string } | null;
    const locationId = String(body?.locationId || "");
    const admin = await requirePublicSiteDomainAdmin(locationId);
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (body?.confirmation !== "RELEASE") return NextResponse.json({ error: "Type RELEASE to confirm." }, { status: 400 });
    try {
        await releasePublicSiteDomain({ locationId, domainId, actorUserId: admin.userId });
        const job = await enqueuePublicSiteDomainJob({ locationId, domainId, operation: "RELEASE" });
        processPublicSiteDomainJob(job.id).catch(() => undefined);
        return NextResponse.json({ domains: await listPublicSiteDomains(locationId) });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Release failed." }, { status: 400 });
    }
}
