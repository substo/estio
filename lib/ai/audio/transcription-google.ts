import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import { GEMINI_FLASH_STABLE_FALLBACK } from "@/lib/ai/models";
import { getWhatsAppMediaObjectBytes, parseR2Uri } from "@/lib/whatsapp/media-r2";

const AUDIO_TRANSCRIPTION_DEFAULT_MODEL = GEMINI_FLASH_STABLE_FALLBACK || "gemini-2.5-flash";
const AUDIO_TRANSCRIPTION_PROMPT =
    "Transcribe this audio verbatim in the spoken language. Return plain text only. Do not summarize or translate.";

const NON_AUDIO_MODEL_TOKENS = ["embedding", "image", "robotics"];

export type AudioTranscriptionJobInput = {
    locationId: string;
    messageId: string;
    attachmentId: string;
    force?: boolean;
};

type LocationTranscriptionConfig = {
    model: string;
    apiKey: string;
};

function normalizeModelId(value: unknown): string {
    return String(value || "").trim();
}

export function isAudioCapableGeminiModel(modelId: string): boolean {
    const normalized = normalizeModelId(modelId).toLowerCase();
    if (!normalized) return false;
    if (!normalized.includes("gemini")) return false;
    if (!normalized.includes("flash")) return false;
    if (NON_AUDIO_MODEL_TOKENS.some((token) => normalized.includes(token))) return false;
    return true;
}

export function normalizeAudioTranscriptionModel(modelId?: string | null): string {
    const normalized = normalizeModelId(modelId);
    if (isAudioCapableGeminiModel(normalized)) return normalized;
    return AUDIO_TRANSCRIPTION_DEFAULT_MODEL;
}

export async function resolveGoogleTranscriptionModelForLocation(locationId: string): Promise<string> {
    const siteConfig = await db.siteConfig.findUnique({
        where: { locationId },
        select: {
            googleAiModelTranscription: true,
            googleAiModelExtraction: true,
        } as any,
    });
    return normalizeAudioTranscriptionModel(
        normalizeModelId((siteConfig as any)?.googleAiModelTranscription)
        || normalizeModelId(siteConfig?.googleAiModelExtraction)
        || AUDIO_TRANSCRIPTION_DEFAULT_MODEL
    );
}

async function getLocationTranscriptionConfig(locationId: string): Promise<LocationTranscriptionConfig> {
    const siteConfig = await db.siteConfig.findUnique({
        where: { locationId },
        select: {
            googleAiApiKey: true,
        },
    });

    const apiKey = String(siteConfig?.googleAiApiKey || process.env.GOOGLE_API_KEY || "").trim();
    if (!apiKey) {
        throw new Error("No Google AI API key configured for this location.");
    }

    const model = await resolveGoogleTranscriptionModelForLocation(locationId);

    return { model, apiKey };
}

function readUsageInt(usage: Record<string, unknown>, key: string): number | null {
    const numeric = Number(usage[key]);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return Math.floor(numeric);
}

function toErrorMessage(error: unknown): string {
    if (!error) return "Unknown transcription error";
    if (error instanceof Error) return error.message;
    return String(error);
}

async function loadAttachmentForTranscription(input: AudioTranscriptionJobInput) {
    const attachment = await db.messageAttachment.findUnique({
        where: { id: input.attachmentId },
        include: {
            transcript: true,
            message: {
                select: {
                    id: true,
                    conversationId: true,
                    conversation: {
                        select: {
                            locationId: true,
                        },
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

    return attachment;
}

export async function ensurePendingMessageTranscript(input: AudioTranscriptionJobInput) {
    const attachment = await loadAttachmentForTranscription(input);
    const model = await resolveGoogleTranscriptionModelForLocation(input.locationId);

    if (attachment.transcript?.status === "completed" && !input.force) {
        return {
            model,
            shouldEnqueue: false,
            transcriptId: attachment.transcript.id,
            status: attachment.transcript.status,
        };
    }

    const reset = input.force
        ? {
            text: null,
            error: null,
            promptTokens: null,
            completionTokens: null,
            totalTokens: null,
            estimatedCostUsd: null,
            startedAt: null,
            completedAt: null,
            deadLetteredAt: null,
        }
        : {};

    const transcript = await db.messageTranscript.upsert({
        where: { attachmentId: input.attachmentId },
        create: {
            messageId: input.messageId,
            attachmentId: input.attachmentId,
            provider: "google",
            model,
            status: "pending",
        },
        update: {
            provider: "google",
            model,
            status: "pending",
            error: null,
            deadLetteredAt: null,
            ...reset,
        },
    });

    return {
        model,
        shouldEnqueue: true,
        transcriptId: transcript.id,
        status: transcript.status,
    };
}

export async function transcribeAttachmentWithGoogle(input: AudioTranscriptionJobInput) {
    let resolvedModel = AUDIO_TRANSCRIPTION_DEFAULT_MODEL;
    const startedAt = new Date();

    try {
        const attachment = await loadAttachmentForTranscription(input);
        if (attachment.transcript?.status === "completed" && !input.force) {
            return { status: "skipped" as const, reason: "already_completed", transcriptId: attachment.transcript.id };
        }

        const locationConfig = await getLocationTranscriptionConfig(input.locationId);
        resolvedModel = locationConfig.model;

        await db.messageTranscript.upsert({
            where: { attachmentId: input.attachmentId },
            create: {
                messageId: input.messageId,
                attachmentId: input.attachmentId,
                provider: "google",
                model: resolvedModel,
                status: "processing",
                startedAt,
            },
            update: {
                provider: "google",
                model: resolvedModel,
                status: "processing",
                error: null,
                deadLetteredAt: null,
                startedAt,
                completedAt: null,
                ...(input.force ? {
                    text: null,
                    promptTokens: null,
                    completionTokens: null,
                    totalTokens: null,
                    estimatedCostUsd: null,
                } : {}),
            },
        });

        const parsed = parseR2Uri(String(attachment.url || ""));
        if (!parsed) {
            throw new Error("Attachment URL is not a valid R2 URI.");
        }

        const media = await getWhatsAppMediaObjectBytes(parsed.key);
        if (!media.buffer || media.buffer.length === 0) {
            throw new Error("Attachment is empty.");
        }

        const mimeType = String(attachment.contentType || media.contentType || "audio/ogg");
        const audioBase64 = media.buffer.toString("base64");

        const genAI = new GoogleGenerativeAI(locationConfig.apiKey);
        const model = genAI.getGenerativeModel({
            model: resolvedModel,
            generationConfig: {
                temperature: 0,
                responseMimeType: "text/plain",
            },
        });

        const result = await model.generateContent([
            { text: AUDIO_TRANSCRIPTION_PROMPT },
            { inlineData: { mimeType, data: audioBase64 } },
        ] as any);

        const transcriptText = String(result.response.text() || "").trim();
        if (!transcriptText) {
            throw new Error("Transcript was empty.");
        }

        const usage = (result.response.usageMetadata || {}) as Record<string, unknown>;
        const completedAt = new Date();

        const transcript = await db.messageTranscript.update({
            where: { attachmentId: input.attachmentId },
            data: {
                provider: "google",
                model: resolvedModel,
                status: "completed",
                text: transcriptText,
                error: null,
                deadLetteredAt: null,
                promptTokens: readUsageInt(usage, "promptTokenCount"),
                completionTokens: readUsageInt(usage, "candidatesTokenCount"),
                totalTokens: readUsageInt(usage, "totalTokenCount"),
                completedAt,
            },
        });

        return {
            status: "completed" as const,
            transcriptId: transcript.id,
            textLength: transcriptText.length,
        };
    } catch (error) {
        const errorMessage = toErrorMessage(error);
        try {
            await db.messageTranscript.upsert({
                where: { attachmentId: input.attachmentId },
                create: {
                    messageId: input.messageId,
                    attachmentId: input.attachmentId,
                    provider: "google",
                    model: resolvedModel,
                    status: "failed",
                    error: errorMessage,
                    startedAt,
                    completedAt: new Date(),
                    retryCount: 1,
                },
                update: {
                    provider: "google",
                    model: resolvedModel,
                    status: "failed",
                    error: errorMessage,
                    completedAt: new Date(),
                    retryCount: { increment: 1 },
                },
            });
        } catch (persistErr) {
            console.error("[Audio Transcription] Failed to persist transcript error state:", persistErr);
        }

        throw error;
    }
}
