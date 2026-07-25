import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { verifyCronAuthorization } from "@/lib/cron/auth";
import { CronGuard } from "@/lib/cron/guard";
import { processPropertyMatchCampaignUntilIdle } from "@/lib/property-match-campaigns/service";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const guard = new CronGuard("property-match-campaigns");

export async function GET(request: NextRequest) {
  const auth = verifyCronAuthorization(request);
  if (!auth.ok) return auth.response;

  const resources = await guard.checkResources(450, 5.0);
  if (!resources.ok) return NextResponse.json({ skipped: true, reason: resources.reason });
  if (!(await guard.acquire())) return NextResponse.json({ skipped: true, reason: "locked" });

  try {
    const campaignLimit = Math.max(1, Math.min(5, Number(request.nextUrl.searchParams.get("campaigns") || 2)));
    const candidateLimit = Math.max(1, Math.min(20, Number(request.nextUrl.searchParams.get("candidates") || 10)));
    const campaigns = await db.propertyMatchCampaign.findMany({
      where: {
        status: "processing",
        collectionStatus: { not: "canceled" },
      },
      orderBy: [{ updatedAt: "asc" }],
      take: campaignLimit,
      select: { id: true, locationId: true, scoringModel: true, fallbackPolicy: true },
    });

    const results = [];
    for (const campaign of campaigns) {
      const result = await processPropertyMatchCampaignUntilIdle({
        locationId: campaign.locationId,
        campaignId: campaign.id,
        limit: candidateLimit,
        timeBudgetMs: 50_000,
        model: campaign.scoringModel,
        fallbackPolicy: campaign.fallbackPolicy === "allow_paid" ? "allow_paid" : "same_provider",
      });
      results.push({ campaignId: campaign.id, ...result });
    }

    return NextResponse.json({ success: true, campaigns: results });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Property campaign processing failed" },
      { status: 500 },
    );
  } finally {
    await guard.release();
  }
}
