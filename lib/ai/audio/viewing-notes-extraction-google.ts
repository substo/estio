import { GoogleGenerativeAI } from "@google/generative-ai";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import db from "@/lib/db";
import { GEMINI_FLASH_STABLE_FALLBACK } from "@/lib/ai/models";
import { calculateRunCostFromUsage } from "@/lib/ai/pricing";
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";

const VIEWING_NOTES_DEFAULT_MODEL = GEMINI_FLASH_STABLE_FALLBACK || "gemini-2.5-flash";

const NON_EXTRACTION_MODEL_TOKENS = ["embedding", "image", "robotics"];

const ViewingNotesExtractionSchema = z.object({
    prospects: z.array(z.string()).default([]),
    requirements: z.array(z.string()).default([]),
    budget: z.string().nullable(),
    locations: z.array(z.string()).default([]),
    objections: z.array(z.string()).default([]),
    nextActions: z.array(z.string()).default([]),
});

export type ViewingNotesExtraction = z.infer<typeof ViewingNotesExtractionSchema>;

export type WhatsAppViewingNotesExtractionInput = {
    locationId: string;
    messageId: string;
    attachmentId: string;
    extractionId?: string;
    force?: boolean;
};

type LocationExtractionConfig = {
    model: string;
    apiKey: string;
};

type TranscriptExtractionContext = {
    messageId: string;
    contactId: string;
    transcript: {
        id: string;
        status: string;
        text: string | null;
        extractions: Array<{
            id: string;
            status: string;
            payload: unknown;
            createdAt: Date;
            crmLogHistoryId: string | null;
        }>;
    };
};

function normalizeModelId(value: unknown): string {
    return String(value || "").trim();
}

function isExtractionCapableGeminiModel(modelId: string): boolean {
    const normalized = normalizeModelId(modelId).toLowerCase();
    if (!normalized) return false;
    if (!normalized.includes("gemini")) return false;
    if (!normalized.includes("flash")) return false;
    if (NON_EXTRACTION_MODEL_TOKENS.some((token) => normalized.includes(token))) return false;
    return true;
}

function normalizeExtractionModel(modelId?: string | null): string {
    const normalized = normalizeModelId(modelId);
    if (isExtractionCapableGeminiModel(normalized)) return normalized;
    return VIEWING_NOTES_DEFAULT_MODEL;
}

async function getLocationExtractionConfig(locationId: string): Promise<LocationExtractionConfig> {
    const siteConfig = await db.siteConfig.findUnique({
        where: { locationId },
        select: {
            googleAiApiKey: true,
            googleAiModelExtraction: true,
            googleAiModelTranscription: true,
        } as any,
    });

    const apiKey = String(siteConfig?.googleAiApiKey || process.env.GOOGLE_API_KEY || "").trim();
    if (!apiKey) {
        throw new Error("No Google AI API key configured for this location.");
    }

    const model = normalizeExtractionModel(
        normalizeModelId((siteConfig as any)?.googleAiModelExtraction)
        || normalizeModelId((siteConfig as any)?.googleAiModelTranscription)
        || VIEWING_NOTES_DEFAULT_MODEL
    );

    return { model, apiKey };
}

async function loadTranscriptExtractionContext(input: WhatsAppViewingNotesExtractionInput): Promise<TranscriptExtractionContext> {
    const attachment = await db.messageAttachment.findUnique({
        where: { id: input.attachmentId },
        include: {
            message: {
                select: {
                    id: true,
                    conversation: {
                        select: {
                            locationId: true,
                            contactId: true,
                        },
                    },
                },
            },
            transcript: {
                include: {
                    extractions: {
                        orderBy: { createdAt: "desc" },
                        take: 1,
                    },
                },
            },
        },
    });

    if (!attachment) {
        throw new Error("Attachment not found.");
    }
    if (attachment.messageId !== input.messageId) {
        throw new Error("Attachment/message mismatch.");
    }
    if (attachment.message.conversation.locationId !== input.locationId) {
        throw new Error("Attachment does not belong to this location.");
    }
    if (!attachment.transcript) {
        throw new Error("Transcript not found for this attachment.");
    }

    return {
        messageId: attachment.message.id,
        contactId: attachment.message.conversation.contactId,
        transcript: attachment.transcript,
    };
}

function readUsageInt(usage: Record<string, unknown>, key: string): number | null {
    const numeric = Number(usage[key]);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return Math.floor(numeric);
}

function toErrorMessage(error: unknown): string {
    if (!error) return "Unknown extraction error";
    if (error instanceof Error) return error.message;
    return String(error);
}

function parseFirstJsonObject(raw: string): unknown {
    const text = String(raw || "").trim();
    if (!text) throw new Error("Model returned empty output.");

    const stripped = text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    try {
        return JSON.parse(stripped);
    } catch {
        const first = stripped.indexOf("{");
        const last = stripped.lastIndexOf("}");
        if (first >= 0 && last > first) {
            return JSON.parse(stripped.slice(first, last + 1));
        }
        throw new Error("Model output was not valid JSON.");
    }
}

function normalizeStringArray(value: unknown): string[] {
    const source = Array.isArray(value) ? value : [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of source) {
        const normalized = String(item || "").trim();
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(normalized);
    }
    return out;
}

function normalizeViewingNotesPayload(raw: unknown): ViewingNotesExtraction {
    const parsed = ViewingNotesExtractionSchema.parse(raw || {});
    const budgetRaw = parsed.budget === null ? null : String(parsed.budget || "").trim();
    return {
        prospects: normalizeStringArray(parsed.prospects),
        requirements: normalizeStringArray(parsed.requirements),
        budget: budgetRaw || null,
        locations: normalizeStringArray(parsed.locations),
        objections: normalizeStringArray(parsed.objections),
        nextActions: normalizeStringArray(parsed.nextActions),
    };
}

function formatCrmLogDate(date: Date): string {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yy = String(date.getFullYear()).slice(-2);
    return `${dd}.${mm}.${yy}`;
}

function formatCompactList(values: string[], fallback: string = "None"): string {
    if (!values.length) return fallback;
    return values.slice(0, 3).join("; ");
}

function buildViewingNotesCrmEntry(payload: ViewingNotesExtraction): string {
    const segments = [
        `Prospects: ${formatCompactList(payload.prospects)}`,
        `Requirements: ${formatCompactList(payload.requirements)}`,
        `Budget: ${payload.budget || "Not specified"}`,
        `Locations: ${formatCompactList(payload.locations)}`,
        `Objections: ${formatCompactList(payload.objections)}`,
        `Next actions: ${formatCompactList(payload.nextActions)}`,
    ];
    return `AI viewing notes extracted. ${segments.join(" | ")}`;
}

async function persistViewingNotesCrmLog(args: {
    extractionId: string;
    transcriptId: string;
    messageId: string;
    attachmentId: string;
    contactId: string;
    payload: ViewingNotesExtraction;
    force?: boolean;
}) {
    try {
        if (!args.force) {
            const existing = await db.messageTranscriptExtraction.findUnique({
                where: { id: args.extractionId },
                select: { crmLogHistoryId: true },
            });
            if (existing?.crmLogHistoryId) return;
        }

        const now = new Date();
        const entryBody = buildViewingNotesCrmEntry(args.payload);
        const entry = `${formatCrmLogDate(now)} - AI Viewing Notes: ${entryBody}`;

        const created = await db.contactHistory.create({
            data: {
                contactId: args.contactId,
                userId: null,
                action: "MANUAL_ENTRY",
                changes: {
                    date: now.toISOString(),
                    entry,
                    source: "audio_viewing_notes_extraction",
                    transcriptId: args.transcriptId,
                    messageId: args.messageId,
                    attachmentId: args.attachmentId,
                    extractionId: args.extractionId,
                },
            },
            select: { id: true },
        });

        await db.messageTranscriptExtraction.update({
            where: { id: args.extractionId },
            data: {
                crmLogHistoryId: created.id,
                crmLoggedAt: now,
            },
        });
    } catch (error) {
        console.warn("[Viewing Notes Extraction] Failed to persist CRM log:", error);
    }
}

export async function ensurePendingTranscriptExtraction(input: WhatsAppViewingNotesExtractionInput) {
    const context = await loadTranscriptExtractionContext(input);
    if (context.transcript.status !== "completed") {
        throw new Error("Transcript must be completed before extracting viewing notes.");
    }

    const transcriptText = String(context.transcript.text || "").trim();
    if (!transcriptText) {
        throw new Error("Transcript text is empty.");
    }

    const locationConfig = await getLocationExtractionConfig(input.locationId);
    const requestedExtractionId = String(input.extractionId || "").trim();
    if (requestedExtractionId) {
        const existing = await db.messageTranscriptExtraction.findUnique({
            where: { id: requestedExtractionId },
            select: {
                id: true,
                transcriptId: true,
                status: true,
            },
        });

        if (existing && existing.transcriptId === context.transcript.id) {
            if (!input.force && existing.status === "completed") {
                return {
                    model: locationConfig.model,
                    shouldEnqueue: false as const,
                    extractionId: existing.id,
                    reason: "already_completed" as const,
                    transcriptId: context.transcript.id,
                };
            }

            if (!input.force && (existing.status === "pending" || existing.status === "processing")) {
                return {
                    model: locationConfig.model,
                    shouldEnqueue: false as const,
                    extractionId: existing.id,
                    reason: "already_in_progress" as const,
                    transcriptId: context.transcript.id,
                };
            }

            await db.messageTranscriptExtraction.update({
                where: { id: existing.id },
                data: {
                    provider: "google",
                    model: locationConfig.model,
                    status: "pending",
                    error: null,
                    deadLetteredAt: null,
                    startedAt: null,
                    completedAt: null,
                },
            });

            return {
                model: locationConfig.model,
                shouldEnqueue: true as const,
                extractionId: existing.id,
                transcriptId: context.transcript.id,
                reason: null as null,
            };
        }
    }

    const latest = context.transcript.extractions?.[0];

    if (!input.force && latest) {
        if (latest.status === "completed") {
            return {
                model: locationConfig.model,
                shouldEnqueue: false as const,
                extractionId: latest.id,
                reason: "already_completed" as const,
                transcriptId: context.transcript.id,
            };
        }
        if (latest.status === "pending" || latest.status === "processing") {
            return {
                model: locationConfig.model,
                shouldEnqueue: false as const,
                extractionId: latest.id,
                reason: "already_in_progress" as const,
                transcriptId: context.transcript.id,
            };
        }
    }

    const extraction = await db.messageTranscriptExtraction.create({
        data: {
            transcriptId: context.transcript.id,
            provider: "google",
            model: locationConfig.model,
            status: "pending",
            deadLetteredAt: null,
        },
        select: {
            id: true,
            status: true,
        },
    });

    return {
        model: locationConfig.model,
        shouldEnqueue: true as const,
        extractionId: extraction.id,
        transcriptId: context.transcript.id,
        reason: null as null,
    };
}

export async function extractViewingNotesWithGoogle(input: WhatsAppViewingNotesExtractionInput) {
    const startedAt = new Date();
    let extractionId = String(input.extractionId || "").trim();
    let transcriptId = "";
    let resolvedModel = VIEWING_NOTES_DEFAULT_MODEL;

    try {
        const context = await loadTranscriptExtractionContext(input);
        transcriptId = context.transcript.id;
        if (context.transcript.status !== "completed") {
            throw new Error("Transcript must be completed before extracting viewing notes.");
        }

        const transcriptText = String(context.transcript.text || "").trim();
        if (!transcriptText) {
            throw new Error("Transcript text is empty.");
        }

        const locationConfig = await getLocationExtractionConfig(input.locationId);
        resolvedModel = locationConfig.model;

        if (!extractionId) {
            const created = await db.messageTranscriptExtraction.create({
                data: {
                    transcriptId,
                    provider: "google",
                    model: resolvedModel,
                    status: "pending",
                },
                select: { id: true },
            });
            extractionId = created.id;
        }

        await db.messageTranscriptExtraction.update({
            where: { id: extractionId },
            data: {
                provider: "google",
                model: resolvedModel,
                status: "processing",
                error: null,
                deadLetteredAt: null,
                startedAt,
                completedAt: null,
                payload: Prisma.DbNull,
                promptTokens: null,
                completionTokens: null,
                totalTokens: null,
                estimatedCostUsd: null,
            },
        });

        const prompt = [
            "You are a real estate CRM assistant.",
            "Extract structured viewing notes from the transcript.",
            "Return strict JSON only with this exact shape:",
            "{",
            '  "prospects": string[],',
            '  "requirements": string[],',
            '  "budget": string | null,',
            '  "locations": string[],',
            '  "objections": string[],',
            '  "nextActions": string[]',
            "}",
            "Rules:",
            "- Always return all keys even when empty.",
            "- Use concise factual phrases.",
            "- Do not include markdown.",
            "",
            "Transcript:",
            '"""',
            transcriptText,
            '"""',
        ].join("\n");

        const genAI = new GoogleGenerativeAI(locationConfig.apiKey);
        const model = genAI.getGenerativeModel({
            model: resolvedModel,
            generationConfig: {
                temperature: 0.1,
                responseMimeType: "application/json",
            },
        });

        const result = await model.generateContent([{ text: prompt }] as any);
        const responseText = String(result.response.text() || "").trim();
        const parsed = parseFirstJsonObject(responseText);
        const payload = normalizeViewingNotesPayload(parsed);

        const usage = (result.response.usageMetadata || {}) as Record<string, unknown>;
        const promptTokens = readUsageInt(usage, "promptTokenCount");
        const completionTokens = readUsageInt(usage, "candidatesTokenCount");
        const totalTokens = readUsageInt(usage, "totalTokenCount");

        const cost = calculateRunCostFromUsage(resolvedModel, {
            promptTokens: promptTokens || 0,
            completionTokens: completionTokens || 0,
            totalTokens: totalTokens || 0,
        });

        const completedAt = new Date();
        const saved = await db.messageTranscriptExtraction.update({
            where: { id: extractionId },
            data: {
                provider: "google",
                model: resolvedModel,
                status: "completed",
                payload: payload as any,
                error: null,
                deadLetteredAt: null,
                promptTokens,
                completionTokens,
                totalTokens,
                estimatedCostUsd: cost.amount,
                completedAt,
            },
            select: {
                id: true,
            },
        });

        await securelyRecordAiUsage({
            locationId: input.locationId,
            resourceType: "transcript_extraction",
            resourceId: transcriptId,
            featureArea: "audio_transcription",
            action: "extract_viewing_notes",
            provider: "google_gemini",
            model: resolvedModel,
            inputTokens: promptTokens || 0,
            outputTokens: completionTokens || 0,
        });

        await persistViewingNotesCrmLog({
            extractionId: saved.id,
            transcriptId,
            messageId: context.messageId,
            attachmentId: input.attachmentId,
            contactId: context.contactId,
            payload,
            force: !!input.force,
        });

        return {
            status: "completed" as const,
            extractionId: saved.id,
            transcriptId,
            payload,
        };
    } catch (error) {
        const errorMessage = toErrorMessage(error);
        if (extractionId && transcriptId) {
            try {
                await db.messageTranscriptExtraction.update({
                    where: { id: extractionId },
                    data: {
                        provider: "google",
                        model: resolvedModel,
                        status: "failed",
                        error: errorMessage,
                        completedAt: new Date(),
                        retryCount: { increment: 1 },
                    },
                });
            } catch (persistErr) {
                console.error("[Viewing Notes Extraction] Failed to persist extraction error state:", persistErr);
            }
        }
        throw error;
    }
}
