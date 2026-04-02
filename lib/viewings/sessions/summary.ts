import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import { publishViewingSessionRealtimeEvent } from "@/lib/realtime/viewing-session-events";
import { appendViewingSessionEvent } from "@/lib/viewings/sessions/events";
import { recordViewingSessionUsage } from "@/lib/viewings/sessions/usage";
import { VIEWING_SESSION_EVENT_TYPES } from "@/lib/viewings/sessions/types";

type BuildSummaryArgs = {
    sessionId: string;
    actorUserId?: string | null;
    status?: "draft" | "final";
    trigger?: "manual" | "debounced_worker" | "completion";
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

type SummaryUsage = {
    provider: string | null;
    model: string | null;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    estimatedCostUsd: number | null;
    usedFallback: boolean;
    errorMessage: string | null;
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
        dislikes.length ? `I will also clarify: ${sliceForPreview(dislikes, 2).join(" and ")}.` : null,
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

function parseJsonMaybe(rawText: string): any | null {
    const text = asString(rawText);
    if (!text) return null;

    const stripped = text
        .replace(/^```json/i, "")
        .replace(/^```/i, "")
        .replace(/```$/i, "")
        .trim();

    try {
        return JSON.parse(stripped);
    } catch {
        const first = stripped.indexOf("{");
        const last = stripped.lastIndexOf("}");
        if (first >= 0 && last > first) {
            try {
                return JSON.parse(stripped.slice(first, last + 1));
            } catch {
                return null;
            }
        }
        return null;
    }
}

function normalizeSummaryArtifacts(raw: any, fallback: SummaryArtifacts): SummaryArtifacts {
    const sessionSummary = asString(raw?.sessionSummary) || fallback.sessionSummary;
    const crmNote = asString(raw?.crmNote) || fallback.crmNote;
    const followUpWhatsApp = asString(raw?.followUpWhatsApp) || fallback.followUpWhatsApp;
    const followUpEmail = asString(raw?.followUpEmail) || fallback.followUpEmail;

    const recommendedNextActions = dedupeStrings(
        Array.isArray(raw?.recommendedNextActions) ? raw.recommendedNextActions : fallback.recommendedNextActions
    );
    const likes = dedupeStrings(Array.isArray(raw?.likes) ? raw.likes : fallback.likes);
    const dislikes = dedupeStrings(Array.isArray(raw?.dislikes) ? raw.dislikes : fallback.dislikes);
    const objections = dedupeStrings(Array.isArray(raw?.objections) ? raw.objections : fallback.objections);
    const buyingSignals = dedupeStrings(Array.isArray(raw?.buyingSignals) ? raw.buyingSignals : fallback.buyingSignals);

    return {
        sessionSummary,
        crmNote,
        followUpWhatsApp,
        followUpEmail,
        recommendedNextActions: recommendedNextActions.length > 0 ? recommendedNextActions : fallback.recommendedNextActions,
        likes,
        dislikes,
        objections,
        buyingSignals,
    };
}

function estimateSummaryCostUsd(totalTokens: number): number {
    const tokens = Math.max(0, Number(totalTokens || 0));
    // Conservative planning estimate for summary-style text generation.
    return Number((tokens * 0.0000015).toFixed(6));
}

function extractUsageCounts(usageMetadata: any) {
    const promptTokens = Number(usageMetadata?.promptTokenCount || 0);
    const completionTokens = Number(usageMetadata?.candidatesTokenCount || 0);
    const totalTokens = Number(usageMetadata?.totalTokenCount || (promptTokens + completionTokens));
    return {
        promptTokens: Number.isFinite(promptTokens) ? Math.max(0, Math.floor(promptTokens)) : 0,
        completionTokens: Number.isFinite(completionTokens) ? Math.max(0, Math.floor(completionTokens)) : 0,
        totalTokens: Number.isFinite(totalTokens) ? Math.max(0, Math.floor(totalTokens)) : 0,
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

async function maybeBuildLlmSummary(args: {
    apiKey: string | null;
    modelName: string;
    clientName: string;
    propertyTitle: string;
    keyPoints: string[];
    objections: string[];
    buyingSignals: string[];
    pivots: string[];
    recentMessages: Array<{
        speaker: string;
        originalText: string;
        translatedText: string | null;
        timestamp: Date;
    }>;
    fallbackArtifacts: SummaryArtifacts;
}): Promise<{ artifacts: SummaryArtifacts; usage: SummaryUsage }> {
    if (!args.apiKey) {
        return {
            artifacts: args.fallbackArtifacts,
            usage: {
                provider: null,
                model: null,
                promptTokens: null,
                completionTokens: null,
                totalTokens: null,
                estimatedCostUsd: null,
                usedFallback: true,
                errorMessage: "No Google AI API key configured for this location.",
            },
        };
    }

    try {
        const genAI = new GoogleGenerativeAI(args.apiKey);
        const model = genAI.getGenerativeModel({
            model: args.modelName,
            generationConfig: {
                temperature: 0.2,
                responseMimeType: "application/json",
            },
        });

        const transcriptPreview = args.recentMessages
            .slice(-16)
            .map((item) => {
                const text = asString(item.translatedText) || asString(item.originalText);
                return `${item.speaker.toUpperCase()}: ${text}`;
            })
            .filter(Boolean);

        const prompt = [
            "You are a real-estate viewing sales copilot.",
            "Generate concise post-session artifacts from provided viewing data.",
            "Return strict JSON with keys:",
            "sessionSummary, crmNote, followUpWhatsApp, followUpEmail, recommendedNextActions, likes, dislikes, objections, buyingSignals",
            "Rules:",
            "- Keep statements factual from supplied context only.",
            "- Keep suggestions concise and actionable.",
            "- Keep follow-up drafts ready to send.",
            `Client: ${args.clientName}`,
            `Property: ${args.propertyTitle}`,
            `Key points: ${JSON.stringify(args.keyPoints)}`,
            `Objections: ${JSON.stringify(args.objections)}`,
            `Buying signals: ${JSON.stringify(args.buyingSignals)}`,
            `Pivot hints: ${JSON.stringify(args.pivots)}`,
            `Recent transcript preview: ${JSON.stringify(transcriptPreview)}`,
            `Fallback baseline: ${JSON.stringify(args.fallbackArtifacts)}`,
        ].join("\n");

        const result = await model.generateContent([{ text: prompt }] as any);
        const parsed = parseJsonMaybe(result.response.text());
        const artifacts = parsed
            ? normalizeSummaryArtifacts(parsed, args.fallbackArtifacts)
            : args.fallbackArtifacts;
        const usageCounts = extractUsageCounts((result as any)?.response?.usageMetadata);
        const estimatedCostUsd = estimateSummaryCostUsd(usageCounts.totalTokens);

        return {
            artifacts,
            usage: {
                provider: "google",
                model: args.modelName,
                promptTokens: usageCounts.promptTokens,
                completionTokens: usageCounts.completionTokens,
                totalTokens: usageCounts.totalTokens,
                estimatedCostUsd,
                usedFallback: !parsed,
                errorMessage: parsed ? null : "Model response was not valid JSON. Fallback applied.",
            },
        };
    } catch (error: any) {
        return {
            artifacts: args.fallbackArtifacts,
            usage: {
                provider: "google",
                model: args.modelName,
                promptTokens: null,
                completionTokens: null,
                totalTokens: null,
                estimatedCostUsd: null,
                usedFallback: true,
                errorMessage: String(error?.message || "LLM summary generation failed."),
            },
        };
    }
}

export async function upsertViewingSessionSummaryFromInsights(args: BuildSummaryArgs) {
    const sessionId = asString(args.sessionId);
    if (!sessionId) {
        throw new Error("Missing sessionId.");
    }

    const summaryStatusTarget = args.status === "final" ? "final" : "draft";
    const trigger = args.trigger || (summaryStatusTarget === "final" ? "completion" : "manual");

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
            messages: {
                orderBy: [{ timestamp: "asc" }, { createdAt: "asc" }],
                take: 80,
                select: {
                    speaker: true,
                    originalText: true,
                    translatedText: true,
                    timestamp: true,
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
    const fallbackArtifacts = buildSummaryArtifacts({
        clientName,
        propertyTitle,
        keyPoints,
        objections,
        buyingSignals,
        pivotSuggestions: pivots,
    });

    await db.viewingSessionSummary.upsert({
        where: { sessionId: session.id },
        create: {
            sessionId: session.id,
            status: "generating",
            provider: "google",
            model: session.liveModel || null,
        },
        update: {
            status: "generating",
            provider: "google",
            model: session.liveModel || null,
        },
    });

    const apiKey = await resolveLocationGoogleAiApiKey(session.locationId);
    const modelName = asString(session.liveModel) || "gemini-2.5-flash";
    const llm = await maybeBuildLlmSummary({
        apiKey,
        modelName,
        clientName,
        propertyTitle,
        keyPoints,
        objections,
        buyingSignals,
        pivots,
        recentMessages: session.messages,
        fallbackArtifacts,
    });

    const artifacts = llm.artifacts;
    const persistedStatus = asString(artifacts.sessionSummary) ? summaryStatusTarget : "failed";
    const now = new Date();

    const summary = await db.$transaction(async (tx) => {
        const summaryRow = await tx.viewingSessionSummary.upsert({
            where: { sessionId: session.id },
            create: {
                sessionId: session.id,
                status: persistedStatus,
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
                provider: llm.usage.provider || "google",
                model: llm.usage.model || session.liveModel || null,
                promptTokens: llm.usage.promptTokens,
                completionTokens: llm.usage.completionTokens,
                totalTokens: llm.usage.totalTokens,
                estimatedCostUsd: llm.usage.estimatedCostUsd,
            },
            update: {
                status: persistedStatus,
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
                provider: llm.usage.provider || "google",
                model: llm.usage.model || session.liveModel || null,
                promptTokens: llm.usage.promptTokens,
                completionTokens: llm.usage.completionTokens,
                totalTokens: llm.usage.totalTokens,
                estimatedCostUsd: llm.usage.estimatedCostUsd,
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

        if (persistedStatus === "final") {
            await tx.contactHistory.create({
                data: {
                    contactId: session.contactId,
                    userId: args.actorUserId || null,
                    action: "VIEWING_SESSION_SUMMARY",
                    changes: {
                        sessionId: session.id,
                        sessionSummary: artifacts.sessionSummary,
                        nextActions: artifacts.recommendedNextActions,
                        trigger,
                        usedFallback: llm.usage.usedFallback,
                    } as any,
                },
            });
        }

        return summaryRow;
    });

    if (llm.usage.totalTokens || llm.usage.estimatedCostUsd) {
        await recordViewingSessionUsage({
            sessionId: session.id,
            locationId: session.locationId,
            phase: "summary",
            provider: llm.usage.provider,
            model: llm.usage.model,
            inputTokens: llm.usage.promptTokens || 0,
            outputTokens: llm.usage.completionTokens || 0,
            totalTokens: llm.usage.totalTokens || 0,
            estimatedCostUsd: llm.usage.estimatedCostUsd || 0,
            actualCostUsd: llm.usage.estimatedCostUsd || 0,
            metadata: {
                trigger,
                status: persistedStatus,
                usedFallback: llm.usage.usedFallback,
            },
        });
    }

    await appendViewingSessionEvent({
        sessionId: session.id,
        locationId: session.locationId,
        type: persistedStatus === "failed" ? "viewing_session.summary.failed" : "viewing_session.summary.generated",
        source: "worker",
        payload: {
            summaryId: summary.id,
            status: persistedStatus,
            trigger,
            usedFallback: llm.usage.usedFallback,
            errorMessage: llm.usage.errorMessage,
        },
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
