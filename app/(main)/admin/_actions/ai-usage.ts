"use server";

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

    const [todayAgg, allTimeAgg, records] = await Promise.all([
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
        db.aiUsage.findMany({
            where: {
                ...usageScope,
                recordedAt: { gte: startOfMonth },
            },
            select: {
                featureArea: true,
                action: true,
                provider: true,
                model: true,
                totalTokens: true,
                estimatedCostUsd: true,
            },
        })
    ]);

    const featureMap = new Map<string, { count: number; tokens: number; costUsd: number }>();
    const actionMap = new Map<string, { featureArea: string; action: string; count: number; tokens: number; costUsd: number }>();
    const modelMap = new Map<string, { provider: string; model: string; count: number; tokens: number; costUsd: number }>();

    let totalTokens = 0;
    let totalCost = 0;

    for (const r of records) {
        const tokens = r.totalTokens || 0;
        const cost = r.estimatedCostUsd || 0;
        totalTokens += tokens;
        totalCost += cost;

        // By feature area
        const fe = featureMap.get(r.featureArea) || { count: 0, tokens: 0, costUsd: 0 };
        fe.count += 1;
        fe.tokens += tokens;
        fe.costUsd += cost;
        featureMap.set(r.featureArea, fe);

        // By feature/action, i.e. the actual API-call purpose.
        const actionKey = `${r.featureArea}::${r.action}`;
        const ae = actionMap.get(actionKey) || {
            featureArea: r.featureArea,
            action: r.action,
            count: 0,
            tokens: 0,
            costUsd: 0,
        };
        ae.count += 1;
        ae.tokens += tokens;
        ae.costUsd += cost;
        actionMap.set(actionKey, ae);

        // By model
        const modelKey = `${r.provider}::${r.model}`;
        const me = modelMap.get(modelKey) || { provider: r.provider, model: r.model, count: 0, tokens: 0, costUsd: 0 };
        me.count += 1;
        me.tokens += tokens;
        me.costUsd += cost;
        modelMap.set(modelKey, me);
    }

    return {
        totalCalls: records.length,
        totalTokens,
        totalEstimatedCostUsd: totalCost,
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
    const [location, userId] = await Promise.all([
        getLocationContext(),
        resolveAuthenticatedDbUserId(),
    ]);

    if (!location?.id || !userId) return null;

    return getAiUsageSummary(location.id, userId);
}
