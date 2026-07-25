import { auth } from "@clerk/nextjs/server";
import { after, NextResponse } from "next/server";
import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import {
    cancelPropertyMatchCampaignBatch,
    getPropertyMatchCampaignProgress,
    processPropertyMatchCampaignUntilIdle,
    startPropertyMatchCampaignProcessing,
} from "@/lib/property-match-campaigns/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type RouteContext = {
    params: Promise<{ campaignId: string }>;
};

async function resolveRequestContext() {
    const [{ userId: clerkUserId }, location] = await Promise.all([
        auth(),
        getLocationContext(),
    ]);
    if (!clerkUserId || !location?.id) return null;
    if (!(await verifyUserHasAccessToLocation(clerkUserId, location.id))) return null;
    const user = await db.user.findUnique({
        where: { clerkId: clerkUserId },
        select: { id: true },
    });
    return { locationId: location.id, actorUserId: user?.id || null };
}

function campaignResponse(campaign: Awaited<ReturnType<typeof getPropertyMatchCampaignProgress>>) {
    if (!campaign) return null;
    return {
        id: campaign.id,
        createdAt: campaign.createdAt?.toISOString?.() || null,
        updatedAt: campaign.updatedAt?.toISOString?.() || null,
        title: campaign.title,
        status: campaign.status,
        propertyId: campaign.propertyId,
        property: campaign.property,
        totalCandidates: campaign.totalCandidates,
        processedCandidates: campaign.processedCandidates,
        yesCount: campaign.yesCount,
        maybeCount: campaign.maybeCount,
        noCount: campaign.noCount,
        approvedCount: campaign.approvedCount,
        sentCount: campaign.sentCount,
        queueCounts: campaign.queueCounts,
        priorityNote: campaign.priorityNote,
        scoringModel: campaign.scoringModel,
        fallbackPolicy: campaign.fallbackPolicy,
        collectionStatus: campaign.collectionStatus,
        processingStartedAt: campaign.processingStartedAt?.toISOString?.() || null,
        processingFinishedAt: campaign.processingFinishedAt?.toISOString?.() || null,
        lastError: campaign.lastError,
    };
}

export async function GET(_request: Request, context: RouteContext) {
    const requestContext = await resolveRequestContext();
    if (!requestContext) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const { campaignId } = await context.params;
    const campaign = await getPropertyMatchCampaignProgress({
        locationId: requestContext.locationId,
        campaignId: String(campaignId || "").trim(),
    });
    if (!campaign) {
        return NextResponse.json({ success: false, error: "Campaign not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, campaign: campaignResponse(campaign) });
}

export async function POST(request: Request, context: RouteContext) {
    const requestContext = await resolveRequestContext();
    if (!requestContext) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const { campaignId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const model = String(body?.model || "").trim() || null;
    const fallbackPolicy = body?.fallbackPolicy === "allow_paid" ? "allow_paid" as const : "same_provider" as const;
    const normalizedCampaignId = String(campaignId || "").trim();
    const started = await startPropertyMatchCampaignProcessing({
        locationId: requestContext.locationId,
        campaignId: normalizedCampaignId,
        model,
        fallbackPolicy,
    });
    if (!started.success) {
        return NextResponse.json(started, { status: 404 });
    }

    after(async () => {
        try {
            const result = await processPropertyMatchCampaignUntilIdle({
                locationId: requestContext.locationId,
                campaignId: normalizedCampaignId,
                actorUserId: requestContext.actorUserId,
                model,
                fallbackPolicy,
                limit: 4,
                timeBudgetMs: 50_000,
            });
            console.info("[property-match-campaigns] background processing wave completed", {
                campaignId: normalizedCampaignId,
                ...result,
            });
        } catch (error) {
            console.error("[property-match-campaigns] background processing wave failed", {
                campaignId: normalizedCampaignId,
                error,
            });
        }
    });

    const campaign = await getPropertyMatchCampaignProgress({
        locationId: requestContext.locationId,
        campaignId: normalizedCampaignId,
    });
    return NextResponse.json({ success: true, accepted: true, campaign: campaignResponse(campaign) }, { status: 202 });
}

export async function DELETE(_request: Request, context: RouteContext) {
    const requestContext = await resolveRequestContext();
    if (!requestContext) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const { campaignId } = await context.params;
    const result = await cancelPropertyMatchCampaignBatch({
        locationId: requestContext.locationId,
        campaignId: String(campaignId || "").trim(),
    });
    return NextResponse.json(result, { status: result.success ? 200 : 404 });
}
