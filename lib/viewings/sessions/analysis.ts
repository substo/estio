import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import { assembleViewingSessionContext } from "@/lib/viewings/sessions/context-assembler";
import { appendViewingSessionEvent } from "@/lib/viewings/sessions/events";
import { VIEWING_SESSION_STAGE_MODELS } from "@/lib/viewings/sessions/live-models";
import { VIEWING_OBJECTION_LIBRARY } from "@/lib/viewings/sessions/objection-library";
import {
    prepareTranslationModelText,
    sanitizeAnalysisModelInputValue,
} from "@/lib/viewings/sessions/redaction";
import { recordViewingSessionUsage } from "@/lib/viewings/sessions/usage";
import { publishViewingSessionRealtimeEvent } from "@/lib/realtime/viewing-session-events";
import {
    deriveViewingSessionAnalysisStatus,
    VIEWING_SESSION_EVENT_TYPES,
    VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES,
    VIEWING_SESSION_INSIGHT_SOURCES,
    VIEWING_SESSION_INSIGHT_STATES,
    VIEWING_SESSION_INSIGHT_TYPES,
    VIEWING_SESSION_SPEAKERS,
    VIEWING_SESSION_TRANSLATION_STATUSES,
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
    source: string;
    provider?: string | null;
    model?: string | null;
    modelVersion?: string | null;
    generationKey?: string | null;
    metadata?: Record<string, unknown>;
}) {
    const normalizedShort = safeString(args.shortText);
    if (!normalizedShort) return null;

    const existing = await db.viewingSessionInsight.findFirst({
        where: {
            sessionId: args.sessionId,
            type: args.type,
            supersededAt: null,
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
            source: args.source,
            provider: safeString(args.provider) || null,
            model: safeString(args.model) || null,
            modelVersion: safeString(args.modelVersion) || null,
            generationKey: safeString(args.generationKey) || null,
            metadata: args.metadata ? (args.metadata as any) : undefined,
        },
    });
}

async function getMessageWithSession(sessionId: string, messageId: string) {
    return db.viewingSessionMessage.findFirst({
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
                    translationModel: true,
                    insightsModel: true,
                    summaryModel: true,
                    keyPoints: true,
                    objections: true,
                    recommendedNextActions: true,
                },
            },
        },
    });
}

function serializeRealtimeInsight(item: any) {
    return {
        id: item.id,
        type: item.type,
        category: item.category,
        shortText: item.shortText,
        longText: item.longText,
        state: item.state,
        source: item.source,
        provider: item.provider || null,
        model: item.model || null,
        modelVersion: item.modelVersion || null,
        confidence: item.confidence,
        generationKey: item.generationKey || null,
        supersededAt: item.supersededAt ? new Date(item.supersededAt).toISOString() : null,
        metadata: item.metadata || null,
        createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : null,
        updatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : null,
    };
}

async function syncViewingSessionInsightAggregates(sessionId: string) {
    const rows = await db.viewingSessionInsight.findMany({
        where: {
            sessionId,
            supersededAt: null,
            state: {
                not: VIEWING_SESSION_INSIGHT_STATES.dismissed,
            },
        },
        select: {
            type: true,
            shortText: true,
        },
    });

    const keyPoints = Array.from(new Set(
        rows
            .filter((item) => item.type === VIEWING_SESSION_INSIGHT_TYPES.keyPoint)
            .map((item) => safeString(item.shortText))
            .filter(Boolean)
    ));
    const objections = Array.from(new Set(
        rows
            .filter((item) => item.type === VIEWING_SESSION_INSIGHT_TYPES.objection)
            .map((item) => safeString(item.shortText))
            .filter(Boolean)
    ));

    await db.viewingSession.update({
        where: { id: sessionId },
        data: {
            keyPoints: keyPoints as any,
            objections: objections as any,
        },
    });
}

type TranslationResult = {
    provider: string | null;
    model: string | null;
    modelVersion: string | null;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    translatedText: string;
    targetLanguage: string;
    originalLanguage: string | null;
    confidence: number | null;
};

async function runTranslationStep(message: Awaited<ReturnType<typeof getMessageWithSession>>): Promise<TranslationResult> {
    if (!message) {
        throw new Error("Viewing session message not found.");
    }

    const originalText = safeString(message.originalText);
    const targetLanguage = message.speaker === VIEWING_SESSION_SPEAKERS.client
        ? (message.session.agentLanguage || "en")
        : (message.session.clientLanguage || "en");
    const apiKey = await resolveLocationGoogleAiApiKey(message.session.locationId);
    const primaryModelName = safeString(message.session.translationModel) || VIEWING_SESSION_STAGE_MODELS.translationDefault;
    const fallbackModelName = VIEWING_SESSION_STAGE_MODELS.translationDefault;
    const translationPromptText = prepareTranslationModelText(originalText);

    if (!apiKey || !originalText) {
        return {
            provider: null,
            model: primaryModelName || null,
            modelVersion: null,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            estimatedCostUsd: 0,
            translatedText: originalText,
            targetLanguage,
            originalLanguage: message.originalLanguage || null,
            confidence: null,
        };
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    const tryTranslateWithModel = async (modelName: string): Promise<TranslationResult> => {
        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
                temperature: 0.1,
                responseMimeType: "application/json",
            },
        });

        const prompt = [
            "You are a translation assistant for real-estate live viewing sessions.",
            "Translate only. Do not produce extra commentary.",
            "Return strict JSON with keys: translatedText, originalLanguage, confidence.",
            `Target language: ${targetLanguage}`,
            `Source utterance: ${translationPromptText}`,
        ].join("\n");

        const result = await model.generateContent([{ text: prompt }] as any);
        const parsed = parseJsonMaybe(result.response.text());
        const normalized = normalizeAnalysisOutput(parsed || {
            translatedText: originalText,
            originalLanguage: message.originalLanguage || null,
            confidence: null,
        }, originalText);
        const usageCounts = extractUsageCounts((result as any)?.response?.usageMetadata);

        return {
            provider: "google",
            model: modelName,
            modelVersion: modelName,
            promptTokens: usageCounts.promptTokens,
            completionTokens: usageCounts.completionTokens,
            totalTokens: usageCounts.totalTokens,
            estimatedCostUsd: estimateAnalysisCostUsd(usageCounts.totalTokens),
            translatedText: safeString(normalized.translatedText) || originalText,
            targetLanguage,
            originalLanguage: normalized.originalLanguage || message.originalLanguage || null,
            confidence: normalized.confidence,
        };
    };

    try {
        return await tryTranslateWithModel(primaryModelName);
    } catch {
        if (fallbackModelName !== primaryModelName) {
            try {
                return await tryTranslateWithModel(fallbackModelName);
            } catch {
                // fall through to text-preserving fallback
            }
        }

        return {
            provider: null,
            model: primaryModelName,
            modelVersion: null,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            estimatedCostUsd: 0,
            translatedText: originalText,
            targetLanguage,
            originalLanguage: message.originalLanguage || null,
            confidence: message.confidence || null,
        };
    }
}

type InsightResult = {
    provider: string | null;
    model: string | null;
    modelVersion: string | null;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    normalized: AnalysisOutput;
    source: string;
};

async function runInsightsStep(message: Awaited<ReturnType<typeof getMessageWithSession>>, context: unknown): Promise<InsightResult> {
    if (!message) {
        throw new Error("Viewing session message not found.");
    }

    const apiKey = await resolveLocationGoogleAiApiKey(message.session.locationId);
    const primaryModelName = safeString(message.session.insightsModel) || VIEWING_SESSION_STAGE_MODELS.insightsDefault;
    const fallbackModelName = VIEWING_SESSION_STAGE_MODELS.insightsDefault;
    const baseText = safeString(message.translatedText) || safeString(message.originalText);
    const sanitizedText = sanitizeAnalysisModelInputValue(baseText);

    if (!apiKey || !baseText) {
        const fallback = applyStaticFallbackAnalysis(baseText);
        return {
            provider: null,
            model: null,
            modelVersion: null,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            estimatedCostUsd: 0,
            source: fallback.objections.length > 0 || fallback.suggestedReplies.length > 0
                ? VIEWING_SESSION_INSIGHT_SOURCES.staticLibrary
                : VIEWING_SESSION_INSIGHT_SOURCES.heuristicFallback,
            normalized: normalizeAnalysisOutput(
                {
                    translatedText: baseText,
                    originalLanguage: message.originalLanguage || null,
                    confidence: message.confidence || null,
                    keyPoints: fallback.keyPoints,
                    objections: fallback.objections,
                    buyingSignals: [],
                    sentimentCues: [],
                    suggestedReplies: fallback.suggestedReplies,
                    pivotSuggestions: [],
                },
                baseText
            ),
        };
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    const objectionLibraryHint = VIEWING_OBJECTION_LIBRARY.map((entry) => ({
        category: entry.category,
        triggerPhrases: entry.triggerPhrases,
        responseTemplates: entry.responseTemplates.slice(0, 2),
        followUpQuestions: entry.followUpQuestions.slice(0, 2),
    }));

    const prompt = [
        "You are a real-estate viewing copilot.",
        "Analyze the message and produce live suggestions.",
        "Return strict JSON with keys:",
        "keyPoints, objections, buyingSignals, sentimentCues, suggestedReplies, pivotSuggestions",
        "suggestedReplies item: { shortReply, longReply, followUpQuestion }",
        "objections item: { category, text }",
        "pivotSuggestions item: { reason, propertyId }",
        "Keep suggestions short and live-usable.",
        `Speaker: ${message.speaker}`,
        `Session context JSON: ${JSON.stringify(sanitizeAnalysisModelInputValue(context || {}))}`,
        `Static objection library: ${JSON.stringify(sanitizeAnalysisModelInputValue(objectionLibraryHint))}`,
        `Message text: ${sanitizedText}`,
    ].join("\n");

    const tryInsightsWithModel = async (modelName: string): Promise<InsightResult> => {
        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
                temperature: 0.2,
                responseMimeType: "application/json",
            },
        });

        const result = await model.generateContent([{ text: prompt }] as any);
        const parsed = parseJsonMaybe(result.response.text());
        const normalized = normalizeAnalysisOutput(parsed || {
            translatedText: baseText,
            originalLanguage: message.originalLanguage || null,
            confidence: message.confidence || null,
            keyPoints: [],
            objections: [],
            buyingSignals: [],
            sentimentCues: [],
            suggestedReplies: [],
            pivotSuggestions: [],
        }, baseText);
        const usageCounts = extractUsageCounts((result as any)?.response?.usageMetadata);

        return {
            provider: "google",
            model: modelName,
            modelVersion: modelName,
            promptTokens: usageCounts.promptTokens,
            completionTokens: usageCounts.completionTokens,
            totalTokens: usageCounts.totalTokens,
            estimatedCostUsd: estimateAnalysisCostUsd(usageCounts.totalTokens),
            normalized,
            source: VIEWING_SESSION_INSIGHT_SOURCES.analysisModel,
        };
    };

    try {
        return await tryInsightsWithModel(primaryModelName);
    } catch {
        if (fallbackModelName !== primaryModelName) {
            try {
                return await tryInsightsWithModel(fallbackModelName);
            } catch {
                // fall through to static fallback
            }
        }

        const fallback = applyStaticFallbackAnalysis(baseText);
        return {
            provider: null,
            model: primaryModelName,
            modelVersion: null,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            estimatedCostUsd: 0,
            source: fallback.objections.length > 0 || fallback.suggestedReplies.length > 0
                ? VIEWING_SESSION_INSIGHT_SOURCES.staticLibrary
                : VIEWING_SESSION_INSIGHT_SOURCES.heuristicFallback,
            normalized: normalizeAnalysisOutput(
                {
                    translatedText: baseText,
                    originalLanguage: message.originalLanguage || null,
                    confidence: message.confidence || null,
                    keyPoints: fallback.keyPoints,
                    objections: fallback.objections,
                    buyingSignals: [],
                    sentimentCues: [],
                    suggestedReplies: fallback.suggestedReplies,
                    pivotSuggestions: [],
                },
                baseText
            ),
        };
    }
}

export async function runViewingSessionMessageTranslation(input: {
    sessionId: string;
    messageId: string;
}) {
    const sessionId = safeString(input.sessionId);
    const messageId = safeString(input.messageId);
    if (!sessionId || !messageId) {
        throw new Error("Missing sessionId or messageId.");
    }

    const message = await getMessageWithSession(sessionId, messageId);
    if (!message) {
        throw new Error("Viewing session message not found.");
    }

    await db.viewingSessionMessage.update({
        where: { id: message.id },
        data: {
            translationStatus: VIEWING_SESSION_TRANSLATION_STATUSES.processing,
            analysisStatus: deriveViewingSessionAnalysisStatus({
                translationStatus: VIEWING_SESSION_TRANSLATION_STATUSES.processing,
                insightStatus: (message.insightStatus as any) || VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.pending,
            }),
        },
    });

    try {
        const translation = await runTranslationStep(message);
        const updated = await db.viewingSessionMessage.update({
            where: { id: message.id },
            data: {
                translatedText: translation.translatedText,
                targetLanguage: translation.targetLanguage,
                originalLanguage: translation.originalLanguage,
                confidence: translation.confidence,
                translatedAt: new Date(),
                provider: translation.provider || message.provider || null,
                model: translation.model || message.model || null,
                modelVersion: translation.modelVersion || message.modelVersion || null,
                translationStatus: VIEWING_SESSION_TRANSLATION_STATUSES.completed,
                analysisStatus: deriveViewingSessionAnalysisStatus({
                    translationStatus: VIEWING_SESSION_TRANSLATION_STATUSES.completed,
                    insightStatus: (message.insightStatus as any) || VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.pending,
                }),
            },
        });

        await publishViewingSessionRealtimeEvent({
            sessionId,
            locationId: message.session.locationId,
            type: VIEWING_SESSION_EVENT_TYPES.messageUpdated,
            payload: {
                message: {
                    id: updated.id,
                    translatedText: updated.translatedText,
                    targetLanguage: updated.targetLanguage,
                    confidence: updated.confidence,
                    translationStatus: updated.translationStatus,
                    insightStatus: updated.insightStatus,
                    analysisStatus: updated.analysisStatus,
                    translatedAt: updated.translatedAt ? updated.translatedAt.toISOString() : null,
                },
            },
        });

        if (translation.totalTokens > 0 || translation.estimatedCostUsd > 0) {
            await recordViewingSessionUsage({
                sessionId,
                locationId: message.session.locationId,
                phase: "analysis",
                provider: translation.provider,
                model: translation.model,
                usageAuthority: "derived",
                costAuthority: "estimated",
                inputTokens: translation.promptTokens,
                outputTokens: translation.completionTokens,
                totalTokens: translation.totalTokens,
                estimatedCostUsd: translation.estimatedCostUsd,
                actualCostUsd: translation.estimatedCostUsd,
                metadata: {
                    stage: "translation",
                    messageId: message.id,
                    speaker: message.speaker,
                },
            });
        }

        await appendViewingSessionEvent({
            sessionId,
            locationId: message.session.locationId,
            type: "viewing_session.translation.completed",
            source: "worker",
            payload: {
                messageId: message.id,
                totalTokens: translation.totalTokens,
                estimatedCostUsd: translation.estimatedCostUsd,
            },
        });

        return {
            ok: true,
            messageId: message.id,
            translatedText: updated.translatedText || null,
        };
    } catch (error: any) {
        await db.viewingSessionMessage.update({
            where: { id: message.id },
            data: {
                translationStatus: VIEWING_SESSION_TRANSLATION_STATUSES.failed,
                analysisStatus: deriveViewingSessionAnalysisStatus({
                    translationStatus: VIEWING_SESSION_TRANSLATION_STATUSES.failed,
                    insightStatus: (message.insightStatus as any) || VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.pending,
                }),
                metadata: {
                    ...(message.metadata && typeof message.metadata === "object" ? message.metadata : {}),
                    translationError: String(error?.message || "Failed to translate message."),
                } as any,
            },
        }).catch(() => undefined);

        await appendViewingSessionEvent({
            sessionId,
            locationId: message.session.locationId,
            type: "viewing_session.translation.failed",
            source: "worker",
            payload: {
                messageId: message.id,
                error: String(error?.message || "Failed to translate message."),
            },
        });

        throw error;
    }
}

export async function runViewingSessionMessageInsights(input: {
    sessionId: string;
    messageId: string;
}) {
    const sessionId = safeString(input.sessionId);
    const messageId = safeString(input.messageId);
    if (!sessionId || !messageId) {
        throw new Error("Missing sessionId or messageId.");
    }

    const message = await getMessageWithSession(sessionId, messageId);
    if (!message) {
        throw new Error("Viewing session message not found.");
    }

    await db.viewingSessionMessage.update({
        where: { id: message.id },
        data: {
            insightStatus: VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.processing,
            analysisStatus: deriveViewingSessionAnalysisStatus({
                translationStatus: (message.translationStatus as any) || VIEWING_SESSION_TRANSLATION_STATUSES.pending,
                insightStatus: VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.processing,
            }),
        },
    });

    try {
        const context = await assembleViewingSessionContext(sessionId);
        const insight = await runInsightsStep(message, context);
        const supersededAt = new Date();
        const generationKey = `${message.id}:${supersededAt.toISOString()}`;
        const currentGeneratedInsights = await db.viewingSessionInsight.findMany({
            where: {
                sessionId,
                messageId: message.id,
                supersededAt: null,
                source: {
                    not: "manual",
                },
            },
        });
        const supersededInsights = await Promise.all(
            currentGeneratedInsights.map((item) =>
                db.viewingSessionInsight.update({
                    where: { id: item.id },
                    data: { supersededAt },
                })
            )
        );

        const createdInsights = (
            await Promise.all([
                ...insight.normalized.keyPoints.map((text) => createInsightIfUnique({
                    sessionId,
                    messageId: message.id,
                    type: VIEWING_SESSION_INSIGHT_TYPES.keyPoint,
                    shortText: text,
                    confidence: insight.normalized.confidence,
                    source: insight.source,
                    provider: insight.provider,
                    model: insight.model,
                    modelVersion: insight.modelVersion,
                    generationKey,
                })),
                ...insight.normalized.objections.map((item) => createInsightIfUnique({
                    sessionId,
                    messageId: message.id,
                    type: VIEWING_SESSION_INSIGHT_TYPES.objection,
                    category: item.category || "general",
                    shortText: item.text,
                    confidence: insight.normalized.confidence,
                    source: insight.source === VIEWING_SESSION_INSIGHT_SOURCES.heuristicFallback
                        ? VIEWING_SESSION_INSIGHT_SOURCES.staticLibrary
                        : insight.source,
                    provider: insight.provider,
                    model: insight.model,
                    modelVersion: insight.modelVersion,
                    generationKey,
                })),
                ...insight.normalized.buyingSignals.map((text) => createInsightIfUnique({
                    sessionId,
                    messageId: message.id,
                    type: VIEWING_SESSION_INSIGHT_TYPES.buyingSignal,
                    shortText: text,
                    confidence: insight.normalized.confidence,
                    source: insight.source,
                    provider: insight.provider,
                    model: insight.model,
                    modelVersion: insight.modelVersion,
                    generationKey,
                })),
                ...insight.normalized.sentimentCues.map((text) => createInsightIfUnique({
                    sessionId,
                    messageId: message.id,
                    type: VIEWING_SESSION_INSIGHT_TYPES.sentiment,
                    shortText: text,
                    confidence: insight.normalized.confidence,
                    source: insight.source,
                    provider: insight.provider,
                    model: insight.model,
                    modelVersion: insight.modelVersion,
                    generationKey,
                })),
                ...insight.normalized.suggestedReplies.map((item) => createInsightIfUnique({
                    sessionId,
                    messageId: message.id,
                    type: VIEWING_SESSION_INSIGHT_TYPES.reply,
                    shortText: item.shortReply,
                    longText: item.longReply || null,
                    confidence: insight.normalized.confidence,
                    source: insight.source === VIEWING_SESSION_INSIGHT_SOURCES.heuristicFallback
                        ? VIEWING_SESSION_INSIGHT_SOURCES.staticLibrary
                        : insight.source,
                    provider: insight.provider,
                    model: insight.model,
                    modelVersion: insight.modelVersion,
                    generationKey,
                    metadata: {
                        followUpQuestion: item.followUpQuestion || null,
                    },
                })),
                ...insight.normalized.pivotSuggestions.map((item) => createInsightIfUnique({
                    sessionId,
                    messageId: message.id,
                    type: VIEWING_SESSION_INSIGHT_TYPES.pivot,
                    shortText: item.reason,
                    confidence: insight.normalized.confidence,
                    source: insight.source,
                    provider: insight.provider,
                    model: insight.model,
                    modelVersion: insight.modelVersion,
                    generationKey,
                    metadata: {
                        propertyId: item.propertyId || null,
                    },
                })),
            ])
        ).filter(Boolean);

        const updated = await db.viewingSessionMessage.update({
            where: { id: message.id },
            data: {
                insightStatus: VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.completed,
                analysisStatus: deriveViewingSessionAnalysisStatus({
                    translationStatus: (message.translationStatus as any) || VIEWING_SESSION_TRANSLATION_STATUSES.pending,
                    insightStatus: VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.completed,
                }),
                metadata: {
                    ...(message.metadata && typeof message.metadata === "object" ? message.metadata : {}),
                    buyingSignals: insight.normalized.buyingSignals,
                    sentimentCues: insight.normalized.sentimentCues,
                } as any,
            },
        });
        await syncViewingSessionInsightAggregates(sessionId);

        await publishViewingSessionRealtimeEvent({
            sessionId,
            locationId: message.session.locationId,
            type: VIEWING_SESSION_EVENT_TYPES.messageUpdated,
            payload: {
                message: {
                    id: updated.id,
                    translationStatus: updated.translationStatus,
                    insightStatus: updated.insightStatus,
                    analysisStatus: updated.analysisStatus,
                },
            },
        });

        if (createdInsights.length > 0 || supersededInsights.length > 0) {
            await publishViewingSessionRealtimeEvent({
                sessionId,
                locationId: message.session.locationId,
                type: VIEWING_SESSION_EVENT_TYPES.insightUpserted,
                payload: {
                    count: createdInsights.length + supersededInsights.length,
                    insights: [...supersededInsights, ...createdInsights].map((item: any) => serializeRealtimeInsight(item)),
                },
            });
        }

        if (insight.totalTokens > 0 || insight.estimatedCostUsd > 0) {
            await recordViewingSessionUsage({
                sessionId,
                locationId: message.session.locationId,
                phase: "analysis",
                provider: insight.provider,
                model: insight.model,
                usageAuthority: "derived",
                costAuthority: "estimated",
                inputTokens: insight.promptTokens,
                outputTokens: insight.completionTokens,
                totalTokens: insight.totalTokens,
                estimatedCostUsd: insight.estimatedCostUsd,
                actualCostUsd: insight.estimatedCostUsd,
                metadata: {
                    stage: "insights",
                    messageId: message.id,
                    speaker: message.speaker,
                },
            });
        }

        await appendViewingSessionEvent({
            sessionId,
            locationId: message.session.locationId,
            type: "viewing_session.insights.completed",
            source: "worker",
            payload: {
                messageId: message.id,
                insightsCreated: createdInsights.length,
                insightsSuperseded: supersededInsights.length,
                generationKey,
                totalTokens: insight.totalTokens,
                estimatedCostUsd: insight.estimatedCostUsd,
            },
        });

        return {
            ok: true,
            messageId: message.id,
            insightsCreated: createdInsights.length,
            insightsSuperseded: supersededInsights.length,
        };
    } catch (error: any) {
        await db.viewingSessionMessage.update({
            where: { id: message.id },
            data: {
                insightStatus: VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.failed,
                analysisStatus: deriveViewingSessionAnalysisStatus({
                    translationStatus: (message.translationStatus as any) || VIEWING_SESSION_TRANSLATION_STATUSES.pending,
                    insightStatus: VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.failed,
                }),
                metadata: {
                    ...(message.metadata && typeof message.metadata === "object" ? message.metadata : {}),
                    insightError: String(error?.message || "Failed to generate insights."),
                } as any,
            },
        }).catch(() => undefined);

        await appendViewingSessionEvent({
            sessionId,
            locationId: message.session.locationId,
            type: "viewing_session.insights.failed",
            source: "worker",
            payload: {
                messageId: message.id,
                error: String(error?.message || "Failed to generate insights."),
            },
        });
        throw error;
    }
}

// Backward-compatible wrapper while routes/workers transition to separate stages.
export async function runViewingSessionMessageAnalysis(input: {
    sessionId: string;
    messageId: string;
}) {
    await runViewingSessionMessageTranslation(input);
    return runViewingSessionMessageInsights(input);
}
