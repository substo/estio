import db from "@/lib/db";

type CreateLearningSessionInput = {
    locationId: string;
    sourceFeature?: string | null;
    limit?: number;
};

function summarizeFeedbackRows(rows: any[]) {
    const materialEdits = rows.filter((row) => row.materialEdit).length;
    const ratings = rows.filter((row) => String(row.rating || "").trim()).length;
    const features = Array.from(new Set(rows.map((row) => String(row.sourceFeature || "unknown"))));

    return {
        totalFeedback: rows.length,
        materialEdits,
        explicitRatings: ratings,
        sourceFeatures: features,
    };
}

function buildProposalForFeedbackGroup(args: {
    sourceFeature: string;
    summary: ReturnType<typeof summarizeFeedbackRows>;
    feedbackIds: string[];
}) {
    const featureLabel = args.sourceFeature.replace(/_/g, " ");
    return {
        type: args.sourceFeature === "ai_draft" ? "style_policy" : "evaluation_rule",
        title: `Review ${featureLabel} feedback loop`,
        description: [
            `Analyze ${args.summary.totalFeedback} feedback item(s) from ${featureLabel}.`,
            args.summary.materialEdits
                ? `${args.summary.materialEdits} item(s) had material human edits.`
                : null,
            args.summary.explicitRatings
                ? `${args.summary.explicitRatings} item(s) included explicit ratings.`
                : null,
            "This proposal is pending human review and does not change runtime behavior until applied.",
        ].filter(Boolean).join(" "),
        target: {
            sourceFeature: args.sourceFeature,
        },
        payload: {
            sourceFeature: args.sourceFeature,
            feedbackIds: args.feedbackIds,
            recommendedReview: args.sourceFeature === "ai_draft"
                ? "Compare AI drafts against sent versions and propose style policy or playbook changes."
                : "Compare AI output, tool traces, and human outcome before proposing runtime policy changes.",
            applyMode: "human_approval_required",
        },
        riskLevel: "medium",
        confidence: args.summary.materialEdits > 0 ? 0.65 : 0.45,
    };
}

export async function createLearningSessionFromAgentFeedback(input: CreateLearningSessionInput) {
    const locationId = String(input.locationId || "").trim();
    if (!locationId) {
        return { success: false as const, error: "Missing location ID." };
    }

    const sourceFeature = String(input.sourceFeature || "").trim();
    const rows = await (db as any).agentFeedback.findMany({
        where: {
            locationId,
            analyzed: false,
            ...(sourceFeature ? { sourceFeature } : {}),
        },
        orderBy: { createdAt: "asc" },
        take: Math.max(1, Math.min(200, Number(input.limit || 50))),
        select: {
            id: true,
            sourceFeature: true,
            materialEdit: true,
            rating: true,
            editDistance: true,
            skillId: true,
            model: true,
            createdAt: true,
        },
    });

    if (!rows.length) {
        return { success: true as const, sessionId: null, proposalsCreated: 0, feedbackAnalyzed: 0 };
    }

    const summary = summarizeFeedbackRows(rows);
    const session = await (db as any).learningSession.create({
        data: {
            locationId,
            sourceFeature: sourceFeature || (summary.sourceFeatures.length === 1 ? summary.sourceFeatures[0] : null),
            inputType: "feedback_batch",
            status: "pending",
            summary: `Created from ${summary.totalFeedback} agent feedback item(s).`,
            analysis: summary,
        },
        select: { id: true },
    });

    const grouped = new Map<string, any[]>();
    for (const row of rows) {
        const key = String(row.sourceFeature || "unknown");
        grouped.set(key, [...(grouped.get(key) || []), row]);
    }

    let proposalsCreated = 0;
    for (const [groupFeature, groupRows] of grouped.entries()) {
        const groupSummary = summarizeFeedbackRows(groupRows);
        const proposal = buildProposalForFeedbackGroup({
            sourceFeature: groupFeature,
            summary: groupSummary,
            feedbackIds: groupRows.map((row) => row.id),
        });
        await (db as any).learningProposal.create({
            data: {
                locationId,
                sessionId: session.id,
                ...proposal,
            },
        });
        proposalsCreated += 1;
    }

    await (db as any).agentFeedback.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: {
            analyzed: true,
            analyzedAt: new Date(),
            learningSessionId: session.id,
        },
    });

    await (db as any).learningSession.update({
        where: { id: session.id },
        data: { proposalsCount: proposalsCreated },
    });

    return {
        success: true as const,
        sessionId: session.id,
        proposalsCreated,
        feedbackAnalyzed: rows.length,
    };
}
