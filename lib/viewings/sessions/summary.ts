import db from "@/lib/db";
import { publishViewingSessionRealtimeEvent } from "@/lib/realtime/viewing-session-events";
import { VIEWING_SESSION_EVENT_TYPES } from "@/lib/viewings/sessions/types";

type BuildSummaryArgs = {
    sessionId: string;
    actorUserId?: string | null;
    status?: "draft" | "final";
};

type SummaryArtifacts = {
    sessionSummary: string;
    crmNote: string;
    followUpWhatsApp: string;
    followUpEmail: string;
    recommendedNextActions: string[];
    likes: string[];
    dislikes: string[];
    objections: string[];
    buyingSignals: string[];
};

function asString(input: unknown): string {
    return String(input || "").trim();
}

function dedupeStrings(items: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of items) {
        const normalized = asString(item);
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(normalized);
    }
    return out;
}

function sliceForPreview(items: string[], limit: number): string[] {
    return dedupeStrings(items).slice(0, Math.max(1, limit));
}

function inferLikesFromSignals(input: {
    keyPoints: string[];
    buyingSignals: string[];
}): string[] {
    const positiveHints = ["like", "love", "good", "great", "perfect", "nice", "interested"];
    const likesFromKeyPoints = input.keyPoints.filter((item) => {
        const lower = item.toLowerCase();
        return positiveHints.some((hint) => lower.includes(hint));
    });
    return dedupeStrings([...likesFromKeyPoints, ...input.buyingSignals.map((item) => `Buying signal: ${item}`)]);
}

function inferDislikesFromObjections(input: {
    objections: string[];
    keyPoints: string[];
}): string[] {
    const negativeHints = ["too", "worry", "concern", "issue", "problem", "not"];
    const keyPointDislikes = input.keyPoints.filter((item) => {
        const lower = item.toLowerCase();
        return negativeHints.some((hint) => lower.includes(hint));
    });
    return dedupeStrings([...input.objections, ...keyPointDislikes]);
}

function deriveRecommendedNextActions(input: {
    objections: string[];
    buyingSignals: string[];
    pivotSuggestions: string[];
}): string[] {
    const nextActions: string[] = [];
    if (input.buyingSignals.length > 0) {
        nextActions.push("Share clear next-step options (reservation, offer process, legal flow).");
    }
    if (input.objections.length > 0) {
        nextActions.push("Address unresolved objections with short tailored answers and evidence.");
    }
    if (input.pivotSuggestions.length > 0) {
        nextActions.push("Send 1-2 related backup properties with explicit reason for each match.");
    }
    if (nextActions.length === 0) {
        nextActions.push("Send a concise follow-up recap and confirm preferred timeline.");
    }
    return dedupeStrings(nextActions);
}

function buildSummaryArtifacts(input: {
    clientName: string;
    propertyTitle: string;
    keyPoints: string[];
    objections: string[];
    buyingSignals: string[];
    pivotSuggestions: string[];
}): SummaryArtifacts {
    const likes = inferLikesFromSignals({
        keyPoints: input.keyPoints,
        buyingSignals: input.buyingSignals,
    });
    const dislikes = inferDislikesFromObjections({
        objections: input.objections,
        keyPoints: input.keyPoints,
    });
    const recommendedNextActions = deriveRecommendedNextActions({
        objections: input.objections,
        buyingSignals: input.buyingSignals,
        pivotSuggestions: input.pivotSuggestions,
    });

    const summaryLines: string[] = [
        `Viewing session for ${input.clientName || "client"} at ${input.propertyTitle || "selected property"}.`,
    ];

    if (likes.length > 0) {
        summaryLines.push(`Likes: ${sliceForPreview(likes, 4).join("; ")}.`);
    }
    if (dislikes.length > 0) {
        summaryLines.push(`Concerns: ${sliceForPreview(dislikes, 4).join("; ")}.`);
    }
    if (input.buyingSignals.length > 0) {
        summaryLines.push(`Buying signals: ${sliceForPreview(input.buyingSignals, 3).join("; ")}.`);
    }
    summaryLines.push(`Recommended next step: ${recommendedNextActions[0]}`);

    const crmNote = [
        `Viewing: ${input.propertyTitle || "Property"}`,
        `Client: ${input.clientName || "N/A"}`,
        likes.length ? `Likes: ${sliceForPreview(likes, 5).join(" | ")}` : null,
        dislikes.length ? `Concerns: ${sliceForPreview(dislikes, 5).join(" | ")}` : null,
        input.buyingSignals.length ? `Buying signals: ${sliceForPreview(input.buyingSignals, 4).join(" | ")}` : null,
        `Next actions: ${sliceForPreview(recommendedNextActions, 3).join(" | ")}`,
    ].filter(Boolean).join("\n");

    const followUpWhatsApp = [
        `Hi ${input.clientName || ""}, thanks again for today's viewing.`,
        likes.length ? `I noted you liked: ${sliceForPreview(likes, 2).join(" and ")}.` : null,
        dislikes.length ? `I’ll also clarify: ${sliceForPreview(dislikes, 2).join(" and ")}.` : null,
        `Would you like me to send the next options today?`,
    ].filter(Boolean).join(" ");

    const followUpEmail = [
        `Subject: Next steps after your viewing`,
        "",
        `Hi ${input.clientName || "there"},`,
        "",
        `Thank you for viewing ${input.propertyTitle || "the property"} today.`,
        likes.length ? `What stood out positively: ${sliceForPreview(likes, 3).join("; ")}.` : null,
        dislikes.length ? `Open concerns to address: ${sliceForPreview(dislikes, 3).join("; ")}.` : null,
        `Suggested next actions:`,
        ...sliceForPreview(recommendedNextActions, 3).map((item, index) => `${index + 1}. ${item}`),
        "",
        `Best regards,`,
    ].filter(Boolean).join("\n");

    return {
        sessionSummary: summaryLines.join(" "),
        crmNote,
        followUpWhatsApp,
        followUpEmail,
        recommendedNextActions,
        likes,
        dislikes,
        objections: dedupeStrings(input.objections),
        buyingSignals: dedupeStrings(input.buyingSignals),
    };
}

function buildLeadPreferencePatch(existing: string | null | undefined, keyPoints: string[]): string | null {
    const keyPointPreview = sliceForPreview(keyPoints, 4);
    if (keyPointPreview.length === 0) return asString(existing) || null;
    const stamp = new Date().toISOString().slice(0, 10);
    const addition = `[${stamp}] Viewing preferences: ${keyPointPreview.join("; ")}`;
    const base = asString(existing);
    const next = base ? `${base}\n${addition}` : addition;
    return next.slice(0, 2000);
}

export async function upsertViewingSessionSummaryFromInsights(args: BuildSummaryArgs) {
    const sessionId = asString(args.sessionId);
    if (!sessionId) {
        throw new Error("Missing sessionId.");
    }

    const session = await db.viewingSession.findUnique({
        where: { id: sessionId },
        include: {
            primaryProperty: {
                select: { id: true, title: true, reference: true },
            },
            contact: {
                select: {
                    id: true,
                    name: true,
                    firstName: true,
                    requirementOtherDetails: true,
                },
            },
            insights: {
                where: {
                    state: {
                        not: "dismissed",
                    },
                },
                orderBy: [{ createdAt: "asc" }],
                select: {
                    id: true,
                    type: true,
                    shortText: true,
                },
            },
        },
    });
    if (!session) {
        throw new Error("Viewing session not found.");
    }

    const keyPoints = dedupeStrings(
        session.insights
            .filter((item) => item.type === "key_point")
            .map((item) => item.shortText)
    );
    const objections = dedupeStrings(
        session.insights
            .filter((item) => item.type === "objection")
            .map((item) => item.shortText)
    );
    const buyingSignals = dedupeStrings(
        session.insights
            .filter((item) => item.type === "buying_signal")
            .map((item) => item.shortText)
    );
    const pivots = dedupeStrings(
        session.insights
            .filter((item) => item.type === "pivot")
            .map((item) => item.shortText)
    );

    const clientName = asString(session.clientName) || asString(session.contact?.name) || asString(session.contact?.firstName) || "Client";
    const propertyTitle = asString(session.primaryProperty?.title) || asString(session.primaryProperty?.reference) || "Property";

    const artifacts = buildSummaryArtifacts({
        clientName,
        propertyTitle,
        keyPoints,
        objections,
        buyingSignals,
        pivotSuggestions: pivots,
    });

    const summaryStatus = args.status === "final" ? "final" : "draft";
    const now = new Date();

    const summary = await db.$transaction(async (tx) => {
        const summaryRow = await tx.viewingSessionSummary.upsert({
            where: { sessionId: session.id },
            create: {
                sessionId: session.id,
                status: summaryStatus,
                sessionSummary: artifacts.sessionSummary,
                crmNote: artifacts.crmNote,
                followUpWhatsApp: artifacts.followUpWhatsApp,
                followUpEmail: artifacts.followUpEmail,
                recommendedNextActions: artifacts.recommendedNextActions as any,
                likes: artifacts.likes as any,
                dislikes: artifacts.dislikes as any,
                objections: artifacts.objections as any,
                buyingSignals: artifacts.buyingSignals as any,
                generatedAt: now,
                provider: "google",
                model: session.liveModel || null,
            },
            update: {
                status: summaryStatus,
                sessionSummary: artifacts.sessionSummary,
                crmNote: artifacts.crmNote,
                followUpWhatsApp: artifacts.followUpWhatsApp,
                followUpEmail: artifacts.followUpEmail,
                recommendedNextActions: artifacts.recommendedNextActions as any,
                likes: artifacts.likes as any,
                dislikes: artifacts.dislikes as any,
                objections: artifacts.objections as any,
                buyingSignals: artifacts.buyingSignals as any,
                generatedAt: now,
                provider: "google",
                model: session.liveModel || null,
            },
        });

        await tx.viewingSession.update({
            where: { id: session.id },
            data: {
                aiSummary: artifacts.sessionSummary,
                keyPoints: keyPoints as any,
                objections: objections as any,
                recommendedNextActions: artifacts.recommendedNextActions as any,
            },
        });

        await tx.contact.update({
            where: { id: session.contactId },
            data: {
                requirementOtherDetails: buildLeadPreferencePatch(session.contact?.requirementOtherDetails, keyPoints),
            },
        });

        if (summaryStatus === "final") {
            await tx.contactHistory.create({
                data: {
                    contactId: session.contactId,
                    userId: args.actorUserId || null,
                    action: "VIEWING_SESSION_SUMMARY",
                    changes: {
                        sessionId: session.id,
                        sessionSummary: artifacts.sessionSummary,
                        nextActions: artifacts.recommendedNextActions,
                    } as any,
                },
            });
        }

        return summaryRow;
    });

    await publishViewingSessionRealtimeEvent({
        sessionId: session.id,
        locationId: session.locationId,
        type: VIEWING_SESSION_EVENT_TYPES.summaryUpdated,
        payload: {
            summary: {
                id: summary.id,
                sessionId: summary.sessionId,
                status: summary.status,
                sessionSummary: summary.sessionSummary,
                crmNote: summary.crmNote,
                followUpWhatsApp: summary.followUpWhatsApp,
                followUpEmail: summary.followUpEmail,
                recommendedNextActions: summary.recommendedNextActions || [],
                likes: summary.likes || [],
                dislikes: summary.dislikes || [],
                objections: summary.objections || [],
                buyingSignals: summary.buyingSignals || [],
                generatedAt: summary.generatedAt ? summary.generatedAt.toISOString() : null,
            },
        },
    });

    return summary;
}
