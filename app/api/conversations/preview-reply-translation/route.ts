import { NextResponse } from "next/server";

import { previewTranslatedReply } from "@/app/(main)/admin/conversations/actions";

type PreviewReplyTranslationPayload = {
    conversationId?: unknown;
    sourceText?: unknown;
    channel?: unknown;
    targetLanguage?: unknown;
    model?: unknown;
};

const VALID_CHANNELS = new Set(["SMS", "Email", "WhatsApp", "SMS_RELAY"]);

function normalizeChannel(input: unknown): "SMS" | "Email" | "WhatsApp" | "SMS_RELAY" {
    const value = String(input || "").trim();
    return VALID_CHANNELS.has(value) ? value as "SMS" | "Email" | "WhatsApp" | "SMS_RELAY" : "SMS";
}

export async function POST(request: Request) {
    let payload: PreviewReplyTranslationPayload;
    try {
        payload = await request.json();
    } catch {
        return NextResponse.json(
            { success: false, error: "Invalid JSON payload." },
            { status: 400 }
        );
    }

    const conversationId = String(payload.conversationId || "").trim();
    const sourceText = String(payload.sourceText || "").trim();
    const targetLanguage = String(payload.targetLanguage || "").trim() || null;
    const requestedModel = String(payload.model || "").trim() || null;

    if (!conversationId) {
        return NextResponse.json(
            { success: false, error: "Missing conversation ID." },
            { status: 400 }
        );
    }
    if (!sourceText) {
        return NextResponse.json(
            { success: false, error: "Source text is empty." },
            { status: 400 }
        );
    }

    const result = await previewTranslatedReply(
        conversationId,
        sourceText,
        normalizeChannel(payload.channel),
        targetLanguage,
        requestedModel
    );
    const status = result.success ? 200 : 400;

    return NextResponse.json(result, { status });
}
