import { NextRequest, NextResponse } from "next/server";
import { requirePublicSiteDomainAdmin } from "@/lib/public-site-domains/api-auth";
import { enqueuePublicSiteDomainJob, listPublicSiteDomains } from "@/lib/public-site-domains/service";
import { processPublicSiteDomainJob } from "@/lib/public-site-domains/provisioning";

export async function POST(req: NextRequest, { params }: { params: Promise<{ domainId: string }> }) {
    const { domainId } = await params;
    const body = await req.json().catch(() => null) as { locationId?: string } | null;
    const locationId = String(body?.locationId || "");
    if (!(await requirePublicSiteDomainAdmin(locationId))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const job = await enqueuePublicSiteDomainJob({ locationId, domainId, operation: "PROVISION" });
    try {
        await processPublicSiteDomainJob(job.id);
    } catch {
        return NextResponse.json({ error: "Provisioning retry failed.", domains: await listPublicSiteDomains(locationId) }, { status: 409 });
    }
    return NextResponse.json({ domains: await listPublicSiteDomains(locationId) });
}
