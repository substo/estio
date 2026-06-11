import { normalizeReplyLanguage } from "@/lib/ai/reply-language-options";
import db from "@/lib/db";

export type ContactLanguageEvidenceSource = "detected" | "manual" | "imported" | "inferred";

type PrismaLikeClient = {
    contactLanguage: {
        upsert: (args: any) => Promise<unknown>;
    };
    conversation?: {
        update: (args: any) => Promise<unknown>;
    };
};

function normalizeConfidence(confidence: unknown): number | null {
    const value = Number(confidence);
    return Number.isFinite(value) ? value : null;
}

export async function upsertContactLanguageEvidence(args: {
    client?: PrismaLikeClient;
    contactId: string | null | undefined;
    locationId: string;
    language: string | null | undefined;
    confidence?: number | null;
    source: ContactLanguageEvidenceSource;
}) {
    const contactId = String(args.contactId || "").trim();
    const language = normalizeReplyLanguage(args.language);
    if (!contactId || !language) return;

    const client = args.client || (db as any);
    const now = new Date();
    const confidence = normalizeConfidence(args.confidence);

    await client.contactLanguage.upsert({
        where: {
            contactId_language: {
                contactId,
                language,
            },
        },
        create: {
            contactId,
            locationId: args.locationId,
            language,
            confidence,
            source: args.source,
            firstSeenAt: now,
            lastSeenAt: now,
        },
        update: {
            locationId: args.locationId,
            confidence,
            source: args.source,
            lastSeenAt: now,
        },
    });
}

export async function recordConversationLanguageEvidence(args: {
    conversationId: string;
    contactId?: string | null;
    locationId: string;
    language: string | null | undefined;
    confidence?: number | null;
    source: ContactLanguageEvidenceSource;
}) {
    const language = normalizeReplyLanguage(args.language);
    if (!language) return;

    const now = new Date();
    const confidence = normalizeConfidence(args.confidence);

    await Promise.allSettled([
        (db as any).conversation.update({
            where: { id: args.conversationId },
            data: {
                currentLanguage: language,
                currentLanguageSource: args.source,
                currentLanguageConfidence: confidence,
                currentLanguageUpdatedAt: now,
            },
        }),
        upsertContactLanguageEvidence({
            contactId: args.contactId,
            locationId: args.locationId,
            language,
            confidence,
            source: args.source,
        }),
    ]);
}
