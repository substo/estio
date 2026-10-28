"use server";

import { assertCrmActionAllowed } from "@/lib/auth/crm-action-guard";

import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import { resolveAuthenticatedDbUserId } from "@/lib/auth/current-user";
import {
    buildAiUsageSummaryScope,
    canAccessAiUsageView,
} from "@/lib/ai/usage-summary-scope";
import { auth } from "@clerk/nextjs/server";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import {
    PropertyAccessDeniedError,
    requirePropertyInActiveLocation,
} from "@/lib/properties/active-location-access";

export interface AiUsageSummary {
    totalCalls: number;
    totalTokens: number;
    totalEstimatedCostUsd: number;
    byAction: Array<{
        action: string;
        count: number;
        tokens: number;
        costUsd: number;
    }>;
    recentRecords: Array<{
        id: string;
        action: string;
        provider: string;
        model: string;
        totalTokens: number;
        estimatedCostUsd: number;
        recordedAt: string;
    }>;
}

/** Property-level token and cost data is restricted to location admins. */
export async function getPropertyAiUsageSummary(propertyId: string): Promise<AiUsageSummary | null> {
    await assertCrmActionAllowed("_actions/ai-usage.ts", "getPropertyAiUsageSummary");
    let locationId: string;
    try {
        ({ locationId } = await requirePropertyInActiveLocation(propertyId, { adminOnly: true }));
    } catch (error) {
        if (error instanceof PropertyAccessDeniedError) return null;
        throw error;
    }

    const records = await db.aiUsage.findMany({
        where: {
            locationId,
            resourceType: "property",
            resourceId: propertyId,
        },
        orderBy: { recordedAt: "desc" },
        take: 200,
        select: {
            id: true,
            action: true,
            provider: true,
            model: true,
            inputTokens: true,
            outputTokens: true,
            totalTokens: true,
            estimatedCostUsd: true,
            recordedAt: true,
        },
    });

    const byActionMap = new Map<string, { count: number; tokens: number; costUsd: number }>();

    let totalTokens = 0;
    let totalCost = 0;

    for (const r of records) {
        const tokens = r.totalTokens || 0;
        const cost = r.estimatedCostUsd || 0;
        totalTokens += tokens;
        totalCost += cost;

        const existing = byActionMap.get(r.action) || { count: 0, tokens: 0, costUsd: 0 };
        existing.count += 1;
        existing.tokens += tokens;
        existing.costUsd += cost;
        byActionMap.set(r.action, existing);
    }

    return {
        totalCalls: records.length,
        totalTokens,
        totalEstimatedCostUsd: totalCost,
        byAction: Array.from(byActionMap.entries()).map(([action, data]) => ({
            action,
            ...data,
        })),
        recentRecords: records.slice(0, 10).map((r) => ({
            id: r.id,
            action: r.action,
            provider: r.provider,
            model: r.model,
            totalTokens: r.totalTokens || 0,
            estimatedCostUsd: r.estimatedCostUsd || 0,
            recordedAt: r.recordedAt.toISOString(),
        })),
    };
}

export interface LocationAiUsageSummary {
    quickAssist?: { monthCost: number; todayCost: number; calls: number; unavailableCalls: number; subscriptionCalls: number };
    totalCalls: number;
    totalTokens: number;
    totalEstimatedCostUsd: number;
    byFeatureArea: Array<{
        featureArea: string;
        count: number;
        tokens: number;
        costUsd: number;
    }>;
    byAction: Array<{
        featureArea: string;
        action: string;
        count: number;
        tokens: number;
        costUsd: number;
    }>;
    byModel: Array<{
        provider: string;
        model: string;
        count: number;
        tokens: number;
        costUsd: number;
    }>;
    todayCalls: number;
    todayTokens: number;
    todayEstimatedCostUsd: number;
    allTimeCalls: number;
    allTimeTokens: number;
    allTimeEstimatedCostUsd: number;
}

async function getAiUsageSummary(
    resolvedLocationId: string,
    userId?: string,
): Promise<LocationAiUsageSummary> {
    const usageScope = buildAiUsageSummaryScope(resolvedLocationId, userId);

    // Aggregate for the current calendar month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Totals are grouped in the database: the badge is on every page, and reading
    // every row of the month to add it up here cost the most database egress.
    const [todayAgg, allTimeAgg, groups, quickAssistRows] = await Promise.all([
        db.aiUsage.aggregate({
            where: { ...usageScope, recordedAt: { gte: startOfToday } },
            _count: { id: true },
            _sum: { totalTokens: true, estimatedCostUsd: true }
        }),
        db.aiUsage.aggregate({
            where: usageScope,
            _count: { id: true },
            _sum: { totalTokens: true, estimatedCostUsd: true }
        }),
        db.aiUsage.groupBy({
            by: ["featureArea", "action", "provider", "model"],
            where: { ...usageScope, recordedAt: { gte: startOfMonth } },
            _count: { _all: true },
            _sum: { totalTokens: true, estimatedCostUsd: true },
        }),
        db.aiUsage.findMany({
            where: { ...usageScope, recordedAt: { gte: startOfMonth }, resourceType: "viewing_session" },
            select: { metadata: true, recordedAt: true, provider: true, estimatedCostUsd: true },
        }),
    ]);

    const quickAssist = { monthCost: 0, todayCost: 0, calls: 0, unavailableCalls: 0, subscriptionCalls: 0 };
    for (const r of quickAssistRows) {
        const cost = r.estimatedCostUsd || 0;
        const metadata = (r.metadata || {}) as Record<string, unknown>;
        quickAssist.monthCost += cost; quickAssist.calls += 1;
        if (r.recordedAt >= startOfToday) quickAssist.todayCost += cost;
        if (metadata.costStatus === "unavailable" || (cost === 0 && !metadata.costStatus && r.provider !== "chatgpt_subscription")) quickAssist.unavailableCalls += 1;
        if (r.provider === "chatgpt_subscription") quickAssist.subscriptionCalls += 1;
    }

    const featureMap = new Map<string, { count: number; tokens: number; costUsd: number }>();
    const actionMap = new Map<string, { featureArea: string; action: string; count: number; tokens: number; costUsd: number }>();
    const modelMap = new Map<string, { provider: string; model: string; count: number; tokens: number; costUsd: number }>();

    let totalCalls = 0;
    let totalTokens = 0;
    let totalCost = 0;

    for (const g of groups) {
        const count = g._count._all;
        const tokens = g._sum.totalTokens || 0;
        const cost = g._sum.estimatedCostUsd || 0;
        totalCalls += count;
        totalTokens += tokens;
        totalCost += cost;

        const fe = featureMap.get(g.featureArea) || { count: 0, tokens: 0, costUsd: 0 };
        fe.count += count; fe.tokens += tokens; fe.costUsd += cost;
        featureMap.set(g.featureArea, fe);

        // By feature/action, i.e. the actual API-call purpose.
        const actionKey = `${g.featureArea}::${g.action}`;
        const ae = actionMap.get(actionKey) || { featureArea: g.featureArea, action: g.action, count: 0, tokens: 0, costUsd: 0 };
        ae.count += count; ae.tokens += tokens; ae.costUsd += cost;
        actionMap.set(actionKey, ae);

        const modelKey = `${g.provider}::${g.model}`;
        const me = modelMap.get(modelKey) || { provider: g.provider, model: g.model, count: 0, tokens: 0, costUsd: 0 };
        me.count += count; me.tokens += tokens; me.costUsd += cost;
        modelMap.set(modelKey, me);
    }

    return {
        totalCalls,
        totalTokens,
        totalEstimatedCostUsd: totalCost,
        quickAssist,
        todayCalls: todayAgg._count.id,
        todayTokens: todayAgg._sum.totalTokens || 0,
        todayEstimatedCostUsd: todayAgg._sum.estimatedCostUsd || 0,
        allTimeCalls: allTimeAgg._count.id,
        allTimeTokens: allTimeAgg._sum.totalTokens || 0,
        allTimeEstimatedCostUsd: allTimeAgg._sum.estimatedCostUsd || 0,
        byFeatureArea: Array.from(featureMap.entries()).map(([featureArea, data]) => ({
            featureArea,
            ...data,
        })).sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens || b.count - a.count),
        byAction: Array.from(actionMap.values())
            .sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens || b.count - a.count),
        byModel: Array.from(modelMap.values()),
    };
}

export async function getLocationAiUsageSummary(): Promise<LocationAiUsageSummary | null> {
    await assertCrmActionAllowed("_actions/ai-usage.ts", "getLocationAiUsageSummary");
    const [{ userId }, location] = await Promise.all([
        auth(),
        getLocationContext(),
    ]);

    if (!userId || !location?.id) return null;

    const isLocationAdmin = await verifyUserIsLocationAdmin(userId, location.id);
    if (!canAccessAiUsageView("location", isLocationAdmin)) return null;

    return getAiUsageSummary(location.id);
}

/**
 * Returns only AI usage attributed to the signed-in user within their current
 * location. The user id is resolved server-side so callers cannot request
 * another team member's usage.
 */
export async function getCurrentUserAiUsageSummary(): Promise<LocationAiUsageSummary | null> {
    await assertCrmActionAllowed("_actions/ai-usage.ts", "getCurrentUserAiUsageSummary");
    const [location, userId] = await Promise.all([
        getLocationContext(),
        resolveAuthenticatedDbUserId(),
    ]);

    if (!location?.id || !userId) return null;

    return getAiUsageSummary(location.id, userId);
}
