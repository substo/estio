import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import db from "@/lib/db";
import { resolveViewingSessionRequestContext } from "@/lib/viewings/sessions/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const context = await resolveViewingSessionRequestContext({ request: req, sessionId: (await params).id, allowClientToken: false, allowAgentToken: true });
    if (!context || context.role === "client") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const where = { locationId: context.locationId, resourceType: "viewing_session", resourceId: context.sessionId };
    const [totals, groups, records, unavailableCount, subscriptionCount] = await Promise.all([
        db.aiUsage.aggregate({ where, _sum: { estimatedCostUsd: true }, _count: { id: true } }),
        db.aiUsage.groupBy({ by: ["action"], where, _sum: { estimatedCostUsd: true }, _count: { id: true } }),
        db.aiUsage.findMany({ where, orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 100,
            select: { id: true, action: true, provider: true, model: true, inputTokens: true, outputTokens: true, estimatedCostUsd: true, recordedAt: true, metadata: true } }),
        db.aiUsage.count({ where: { ...where, OR: [
            { metadata: { path: ["costStatus"], equals: "unavailable" } },
            { estimatedCostUsd: 0, provider: { not: "chatgpt_subscription" }, OR: [
                { metadata: { equals: Prisma.DbNull } }, { metadata: { path: ["costStatus"], equals: Prisma.AnyNull } },
            ] },
        ] } }),
        db.aiUsage.count({ where: { ...where, provider: "chatgpt_subscription" } }),
    ]);
    return NextResponse.json({ totalCost: totals._sum.estimatedCostUsd || 0, count: totals._count.id, unavailableCount, subscriptionCount,
        groups: groups.map(g => ({ action: g.action, cost: g._sum.estimatedCostUsd || 0, count: g._count.id })),
        records: records.map(r => {
            const metadata = (r.metadata || {}) as Record<string, unknown>;
            return { id: r.id, action: r.action, provider: r.provider, model: r.model, inputTokens: r.inputTokens || 0, outputTokens: r.outputTokens || 0,
                cost: r.estimatedCostUsd, recordedAt: r.recordedAt.toISOString(),
                status: metadata.costStatus || (r.provider === "chatgpt_subscription" ? "subscription" : r.estimatedCostUsd > 0 ? "estimated" : "unavailable"),
                calculation: typeof metadata.calculation === "string" ? metadata.calculation : null,
                mode: typeof metadata.mode === "string" ? metadata.mode : r.action === "viewing_session_audio_transcribe" ? "Transcribe" : r.action === "viewing_session_assistant_answer" ? "Assistant" : "Translate",
                inputAudioSeconds: Number(metadata.inputAudioSeconds || 0) };
        }),
    }, { headers: { "Cache-Control": "no-store" } });
}
