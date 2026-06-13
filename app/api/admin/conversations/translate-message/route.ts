import { NextResponse } from "next/server";

import { translateConversationMessage } from "@/app/(main)/admin/conversations/actions";

function serializeTranslationError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error || "Unknown error");
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const messageId = String(body?.messageId || "").trim();
        const targetLanguage = body?.targetLanguage ? String(body.targetLanguage).trim() : null;

        if (!messageId) {
            return NextResponse.json(
                { success: false, error: "Missing message ID." },
                { status: 400 }
            );
        }

        const result = await translateConversationMessage(messageId, targetLanguage || null);
        if (!result?.success) {
            return NextResponse.json(
                {
                    ...result,
                    success: false,
                    error: serializeTranslationError((result as any)?.error || "Failed to translate message."),
                },
                { status: 400 }
            );
        }

        return NextResponse.json(result);
    } catch (error) {
        console.error("POST /api/admin/conversations/translate-message error:", error);
        return NextResponse.json(
            { success: false, error: serializeTranslationError(error) },
            { status: 500 }
        );
    }
}
