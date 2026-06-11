import { NextResponse } from "next/server";
import { translateConversationThread } from "@/app/(main)/admin/conversations/actions";

function serializeTranslationError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error || "Unknown error");
    }
}

function normalizeVisibleMessageIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 250);
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const conversationId = String(body?.conversationId || "").trim();
        const targetLanguage = body?.targetLanguage ? String(body.targetLanguage).trim() : null;
        const visibleMessageIds = normalizeVisibleMessageIds(body?.visibleMessageIds);

        if (!conversationId) {
            return NextResponse.json(
                { success: false, error: "Missing conversation ID." },
                { status: 400 }
            );
        }

        const result = await translateConversationThread(
            conversationId,
            targetLanguage || null,
            visibleMessageIds
        );

        if (!result?.success) {
            return NextResponse.json(
                {
                    ...result,
                    success: false,
                    error: serializeTranslationError((result as any)?.error || "Failed to translate thread."),
                },
                { status: 400 }
            );
        }

        return NextResponse.json(result);
    } catch (error) {
        console.error("POST /api/admin/conversations/translate-thread error:", error);
        return NextResponse.json(
            { success: false, error: serializeTranslationError(error) },
            { status: 500 }
        );
    }
}
