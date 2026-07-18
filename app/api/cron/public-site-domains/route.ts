import { NextRequest, NextResponse } from "next/server";
import { processDuePublicSiteDomainJobs } from "@/lib/public-site-domains/provisioning";

export async function GET(req: NextRequest) {
    const authorization = req.headers.get("authorization");
    if (!process.env.CRON_SECRET || authorization !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(await processDuePublicSiteDomainJobs());
}
