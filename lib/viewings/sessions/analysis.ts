import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import { assembleViewingSessionContext } from "@/lib/viewings/sessions/context-assembler";
import { appendViewingSessionEvent } from "@/lib/viewings/sessions/events";
import { VIEWING_OBJECTION_LIBRARY } from "@/lib/viewings/sessions/objection-library";
import { recordViewingSessionUsage } from "@/lib/viewings/sessions/usage";
import { publishViewingSessionRealtimeEvent } from "@/lib/realtime/viewing-session-events";
import {
    VIEWING_SESSION_ANALYSIS_STATUSES,
    VIEWING_SESSION_EVENT_TYPES,
    VIEWING_SESSION_INSIGHT_STATES,
    VIEWING_SESSION_INSIGHT_TYPES,
    VIEWING_SESSION_SPEAKERS,
} from "@/lib/viewings/sessions/types";

type AnalysisOutput = {
    translatedText: string;
    originalLanguage: string | null;
    confidence: number | null;
    keyPoints: string[];
    objections: Array<{ category: string; text: string }>;
    buyingSignals: string[];
    sentimentCues: string[];
    suggestedReplies: Array<{
        shortReply: string;
        longReply?: string | null;
        followUpQuestion?: string | null;
    }>;
    pivotSuggestions: Array<{
        reason: string;
        propertyId?: string | null;
    }>;
};

function safeString(input: unknown): string {
    return String(input || "").trim();
}

function normalizeArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        const normalized = safeString(item);
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(normalized);
    }
    return out;
}

function normalizeAnalysisOutput(raw: any, fallbackText: string): AnalysisOutput {
    const translatedText = safeString(raw?.translatedText) || fallbackText;
    const objectionsRaw = Array.isArray(raw?.objections) ? raw.objections : [];
    const objections = objectionsRaw
        .map((item: any) => ({
            category: safeString(item?.category || "general"),
            text: safeString(item?.text),
        }))
        .filter((item: any) => !!item.text);
    const repliesRaw = Array.isArray(raw?.suggestedReplies) ? raw.suggestedReplies : [];
    const suggestedReplies = repliesRaw
        .map((item: any) => ({
            shortReply: safeString(item?.shortReply),
            longReply: safeString(item?.longReply) || null,
            followUpQuestion: safeString(item?.followUpQuestion) || null,
        }))
        .filter((item: any) => !!item.shortReply);
    const pivotsRaw = Array.isArray(raw?.pivotSuggestions) ? raw.pivotSuggestions : [];
    const pivotSuggestions = pivotsRaw
        .map((item: any) => ({
            reason: safeString(item?.reason),
            propertyId: safeString(item?.propertyId) || null,
        }))
        .filter((item: any) => !!item.reason);

    const confidenceNumber = Number(raw?.confidence);
    const confidence = Number.isFinite(confidenceNumber) ? Math.max(0, Math.min(1, confidenceNumber)) : null;

    return {
        translatedText,
        originalLanguage: safeString(raw?.originalLanguage) || null,
        confidence,
        keyPoints: normalizeArray(raw?.keyPoints),
        objections,
        buyingSignals: normalizeArray(raw?.buyingSignals),
        sentimentCues: normalizeArray(raw?.sentimentCues),
        suggestedReplies,
        pivotSuggestions,
    };
}

function applyStaticFallbackAnalysis(inputText: string): Pick<AnalysisOutput, "objections" | "suggestedReplies" | "keyPoints"> {
    const normalized = safeString(inputText).toLowerCase();
    const objections: AnalysisOutput["objections"] = [];
    const suggestedReplies: AnalysisOutput["suggestedReplies"] = [];
    const keyPoints: string[] = [];

    for (const template of VIEWING_OBJECTION_LIBRARY) {
        const matched = template.triggerPhrases.some((phrase) => normalized.includes(phrase.toLowerCase()));
        if (!matched) continue;
        objections.push({
            category: template.category,
            text: `Potential ${template.category} concern detected.`,
        });
        if (template.responseTemplates[0]) {
            suggestedReplies.push({
                shortReply: template.responseTemplates[0],
                longReply: template.softRebuttalTemplates[0] || null,
                followUpQuestion: template.followUpQuestions[0] || null,
            });
        }
        keyPoints.push(`Client raised a ${template.category} concern.`);
    }

    if (keyPoints.length === 0 && normalized) {
        keyPoints.push("Client shared a viewing-related comment.");
    }

    return { objections, suggestedReplies, keyPoints };
}

function parseJsonMaybe(rawText: string): any | null {
    const text = safeString(rawText);
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

function estimateAnalysisCostUsd(totalTokens: number): number {
    const tokens = Math.max(0, Number(totalTokens || 0));
    return Number((tokens * 0.0000012).toFixed(6));
}

async function createInsightIfUnique(args: {
    sessionId: string;
    messageId: string;
    type: string;
    category?: string | null;
    shortText: string;
    longText?: string | null;
    confidence?: number | null;
    metadata?: Record<string, unknown>;
}) {
    const normalizedShort = safeString(args.shortText);
    if (!normalizedShort) return null;

    const existing = await db.viewingSessionInsight.findFirst({
        where: {
            sessionId: args.sessionId,
            type: args.type,
            state: {
                in: [VIEWING_SESSION_INSIGHT_STATES.active, VIEWING_SESSION_INSIGHT_STATES.pinned],
            },
            shortText: normalizedShort,
            ...(args.category ? { category: args.category } : {}),
        },
        select: { id: true },
    });
    if (existing?.id) return null;

    return db.viewingSessionInsight.create({
        data: {
            sessionId: args.sessionId,
            messageId: args.messageId,
            type: args.type,
            category: args.category || null,
            shortText: normalizedShort,
            longText: safeString(args.longText) || null,
            confidence: typeof args.confidence === "number" ? args.confidence : null,
            state: VIEWING_SESSION_INSIGHT_STATES.active,
            source: "model",
            metadata: args.metadata ? (args.metadata as any) : undefined,
        },
    });
}

export async function runViewingSessionMessageAnalysis(input: {
    sessionId: string;
    messageId: string;
}) {
    const sessionId = safeString(input.sessionId);
    const messageId = safeString(input.messageId);
    if (!sessionId || !messageId) {
        throw new Error("Missing sessionId or messageId.");
    }

    const message = await db.viewingSessionMessage.findFirst({
        where: {
            id: messageId,
            sessionId,
        },
        include: {
            session: {
                select: {
                    id: true,
                    locationId: true,
                    status: true,
                    mode: true,
                    agentLanguage: true,
                    clientLanguage: true,
                    liveModel: true,
                    keyPoints: true,
                    objections: true,
                    recommendedNextActions: true,
                },
            },
        },
    });

    if (!message) {
        throw new Error("Viewing session message not found.");
    }

    await db.viewingSessionMessage.update({
        where: { id: message.id },
        data: {
            analysisStatus: VIEWING_SESSION_ANALYSIS_STATUSES.processing,
        },
    });

    try {
        const context = await assembleViewingSessionContext(sessionId);
        const apiKey = await resolveLocationGoogleAiApiKey(message.session.locationId);
        const originalText = safeString(message.originalText);
        const targetLanguage = message.speaker === VIEWING_SESSION_SPEAKERS.client
            ? (message.session.agentLanguage || "en")
            : (message.session.clientLanguage || "en");
        let normalized = normalizeAnalysisOutput(
            {
                translatedText: originalText,
                originalLanguage: message.originalLanguage || null,
                confidence: null,
                keyPoints: [],
                objections: [],
                buyingSignals: [],
                sentimentCues: [],
                suggestedReplies: [],
                pivotSuggestions: [],
            },
            originalText
        );
        let usagePromptTokens = 0;
        let usageCompletionTokens = 0;
        let usageTotalTokens = 0;
        let usageEstimatedCostUsd = 0;
        let analysisProvider: string | null = null;
        let analysisModel: string | null = null;

        if (apiKey && originalText) {
            const genAI = new GoogleGenerativeAI(apiKey);
            const modelName = safeString(message.session.liveModel) || "gemini-2.5-flash";
            analysisProvider = "google";
            analysisModel = modelName;
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: {
                    temperature: 0.2,
                    responseMimeType: "application/json",
                },
            });

            const objectionLibraryHint = VIEWING_OBJECTION_LIBRARY.map((entry) => ({
                category: entry.category,
                triggerPhrases: entry.triggerPhrases,
                responseTemplates: entry.responseTemplates.slice(0, 2),
                followUpQuestions: entry.followUpQuestions.slice(0, 2),
            }));

            const prompt = [
                "You are a real-estate viewing copilot.",
                "Translate and analyze the message using the provided session context.",
                "Return strict JSON with keys:",
                "translatedText, originalLanguage, confidence, keyPoints, objections, buyingSignals, sentimentCues, suggestedReplies, pivotSuggestions",
                "suggestedReplies item: { shortReply, longReply, followUpQuestion }",
                "objections item: { category, text }",
                "pivotSuggestions item: { reason, propertyId }",
                "Keep suggestions short and live-usable.",
                `Target language for translation: ${targetLanguage}`,
                `Speaker: ${message.speaker}`,
                `Session context JSON: ${JSON.stringify(context || {})}`,
                `Static objection library: ${JSON.stringify(objectionLibraryHint)}`,
                `Message text: ${originalText}`,
            ].join("\n");

            const result = await model.generateContent([{ text: prompt }] as any);
            const parsed = parseJsonMaybe(result.response.text());
            if (parsed) {
                normalized = normalizeAnalysisOutput(parsed, originalText);
            }
            const usageCounts = extractUsageCounts((result as any)?.response?.usageMetadata);
            usagePromptTokens = usageCounts.promptTokens;
            usageCompletionTokens = usageCounts.completionTokens;
            usageTotalTokens = usageCounts.totalTokens;
            usageEstimatedCostUsd = estimateAnalysisCostUsd(usageCounts.totalTokens);
        } else {
            const fallback = applyStaticFallbackAnalysis(originalText);
            normalized = normalizeAnalysisOutput(
                {
                    translatedText: originalText,
                    originalLanguage: message.originalLanguage || null,
                    confidence: null,
                    keyPoints: fallback.keyPoints,
                    objections: fallback.objections,
                    buyingSignals: [],
                    sentimentCues: [],
                    suggestedReplies: fallback.suggestedReplies,
                    pivotSuggestions: [],
                },
                originalText
            );
        }

        const translatedText = safeString(normalized.translatedText) || originalText;
        const updatedMessage = await db.viewingSessionMessage.update({
            where: { id: message.id },
            data: {
                translatedText,
                targetLanguage,
                originalLanguage: normalized.originalLanguage || message.originalLanguage || null,
                confidence: normalized.confidence,
                translatedAt: new Date(),
                analysisStatus: VIEWING_SESSION_ANALYSIS_STATUSES.completed,
                metadata: {
                    ...(message.metadata && typeof message.metadata === "object" ? message.metadata : {}),
                    buyingSignals: normalized.buyingSignals,
                    sentimentCues: normalized.sentimentCues,
                } as any,
            },
        });

        const createdInsights = (
            await Promise.all([
                ...normalized.keyPoints.map((text) => createInsightIfUnique({
                    sessionId,
                    messageId: message.id,
                    type: VIEWING_SESSION_INSIGHT_TYPES.keyPoint,
                    shortText: text,
                    confidence: normalized.confidence,
                })),
                ...normalized.objections.map((item) => createInsightIfUnique({
                    sessionId,
                    messageId: message.id,
                    type: VIEWING_SESSION_INSIGHT_TYPES.objection,
                    category: item.category || "general",
                    shortText: item.text,
                    confidence: normalized.confidence,
                })),
                ...normalized.buyingSignals.map((text) => createInsightIfUnique({
                    sessionId,
                    messageId: message.id,
                    type: VIEWING_SESSION_INSIGHT_TYPES.buyingSignal,
                    shortText: text,
                    confidence: normalized.confidence,
                })),
                ...normalized.sentimentCues.map((text) => createInsightIfUnique({
                    sessionId,
                    messageId: message.id,
                    type: VIEWING_SESSION_INSIGHT_TYPES.sentiment,
                    shortText: text,
                    confidence: normalized.confidence,
                })),
                ...normalized.suggestedReplies.map((item) => createInsightIfUnique({
                    sessionId,
                    messageId: message.id,
                    type: VIEWING_SESSION_INSIGHT_TYPES.reply,
                    shortText: item.shortReply,
                    longText: item.longReply || null,
                    confidence: normalized.confidence,
                    metadata: {
                        followUpQuestion: item.followUpQuestion || null,
                    },
                })),
                ...normalized.pivotSuggestions.map((item) => createInsightIfUnique({
                    sessionId,
                    messageId: message.id,
                    type: VIEWING_SESSION_INSIGHT_TYPES.pivot,
                    shortText: item.reason,
                    confidence: normalized.confidence,
                    metadata: {
                        propertyId: item.propertyId || null,
                    },
                })),
            ])
        ).filter(Boolean);

        const existingKeyPoints = Array.isArray(message.session.keyPoints) ? message.session.keyPoints : [];
        const existingObjections = Array.isArray(message.session.objections) ? message.session.objections : [];
        const mergedKeyPoints = Array.from(new Set<string>([
            ...existingKeyPoints.map((x) => safeString(x)).filter(Boolean),
            ...normalized.keyPoints,
        ]));
        const mergedObjections = Array.from(new Set<string>([
            ...existingObjections.map((x) => safeString(x)).filter(Boolean),
            ...normalized.objections.map((x) => safeString(x.text)),
        ]));

        await db.viewingSession.update({
            where: { id: sessionId },
            data: {
                keyPoints: mergedKeyPoints as any,
                objections: mergedObjections as any,
            },
        });

        await publishViewingSessionRealtimeEvent({
            sessionId,
            locationId: message.session.locationId,
            type: VIEWING_SESSION_EVENT_TYPES.messageUpdated,
            payload: {
                message: {
                    id: updatedMessage.id,
                    translatedText: updatedMessage.translatedText,
                    targetLanguage: updatedMessage.targetLanguage,
                    confidence: updatedMessage.confidence,
                    analysisStatus: updatedMessage.analysisStatus,
                    translatedAt: updatedMessage.translatedAt ? updatedMessage.translatedAt.toISOString() : null,
                },
            },
        });

        if (createdInsights.length > 0) {
            await publishViewingSessionRealtimeEvent({
                sessionId,
                locationId: message.session.locationId,
                type: VIEWING_SESSION_EVENT_TYPES.insightUpserted,
                payload: {
                    count: createdInsights.length,
                    insights: createdInsights.map((insight: any) => ({
                        id: insight.id,
                        type: insight.type,
                        category: insight.category,
                        shortText: insight.shortText,
                        longText: insight.longText,
                        state: insight.state,
                        source: insight.source,
                        confidence: insight.confidence,
                        metadata: insight.metadata || null,
                        createdAt: insight.createdAt ? new Date(insight.createdAt).toISOString() : null,
                    })),
                },
            });
        }

        if (usageTotalTokens > 0 || usageEstimatedCostUsd > 0) {
            await recordViewingSessionUsage({
                sessionId,
                locationId: message.session.locationId,
                phase: "analysis",
                provider: analysisProvider,
                model: analysisModel,
                inputTokens: usagePromptTokens,
                outputTokens: usageCompletionTokens,
                totalTokens: usageTotalTokens,
                estimatedCostUsd: usageEstimatedCostUsd,
                actualCostUsd: usageEstimatedCostUsd,
                metadata: {
                    messageId: message.id,
                    speaker: message.speaker,
                },
            });
        }
        await appendViewingSessionEvent({
            sessionId,
            locationId: message.session.locationId,
            type: "viewing_session.analysis.completed",
            source: "worker",
            payload: {
                messageId: message.id,
                insightsCreated: createdInsights.length,
                totalTokens: usageTotalTokens,
                estimatedCostUsd: usageEstimatedCostUsd,
            },
        });

        return {
            ok: true,
            messageId: message.id,
            translatedText: updatedMessage.translatedText || null,
            insightsCreated: createdInsights.length,
        };
    } catch (error: any) {
        await db.viewingSessionMessage.update({
            where: { id: message.id },
            data: {
                analysisStatus: VIEWING_SESSION_ANALYSIS_STATUSES.failed,
                metadata: {
                    ...(message.metadata && typeof message.metadata === "object" ? message.metadata : {}),
                    analysisError: String(error?.message || "Failed to analyze message."),
                } as any,
            },
        }).catch(() => undefined);
        await appendViewingSessionEvent({
            sessionId,
            locationId: message.session.locationId,
            type: "viewing_session.analysis.failed",
            source: "worker",
            payload: {
                messageId: message.id,
                error: String(error?.message || "Failed to analyze message."),
            },
        });
        throw error;
    }
}
