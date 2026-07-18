import { NextRequest, NextResponse } from "next/server";
import { requirePublicSiteDomainAdmin } from "@/lib/public-site-domains/api-auth";
import { enqueuePublicSiteDomainJob, verifyPublicSiteDomain } from "@/lib/public-site-domains/service";
import { processPublicSiteDomainJob } from "@/lib/public-site-domains/provisioning";

export async function POST(req: NextRequest, { params }: { params: Promise<{ domainId: string }> }) {
    const { domainId } = await params;
    const body = await req.json().catch(() => null) as { locationId?: string } | null;
    const locationId = String(body?.locationId || "");
    if (!(await requirePublicSiteDomainAdmin(locationId))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const verified = await verifyPublicSiteDomain({ locationId, domainId });
        if (!verified.dns.verified) return NextResponse.json({ error: verified.dns.error, ...verified }, { status: 409 });
        const job = await enqueuePublicSiteDomainJob({ locationId, domainId, operation: "PROVISION" });
        try {
            await processPublicSiteDomainJob(job.id);
        } catch {
            // The durable job and binding contain the actionable failure state.
        }
        return NextResponse.json({ ...verified, domains: await import("@/lib/public-site-domains/service").then((m) => m.listPublicSiteDomains(locationId)) });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Verification failed." }, { status: 400 });
    }
}
