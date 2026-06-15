import { NextResponse } from "next/server";
import { sendReply } from "@/app/(main)/admin/conversations/actions";

function serializeSendError(error: unknown): string {
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
        const conversationId = String(body?.conversationId || "").trim();
        const contactId = String(body?.contactId || "").trim();
        const messageBody = String(body?.messageBody || "");
        const type = String(body?.type || "") as "SMS" | "Email" | "WhatsApp" | "SMS_RELAY";

        if (!conversationId || !contactId || !messageBody.trim() || !type) {
            return NextResponse.json(
                { success: false, error: "Missing required send fields." },
                { status: 400 }
            );
        }

        if (!["SMS", "Email", "WhatsApp", "SMS_RELAY"].includes(type)) {
            return NextResponse.json(
                { success: false, error: "Unsupported message channel." },
                { status: 400 }
            );
        }

        const result = await sendReply(conversationId, contactId, messageBody, type, {
            clientMessageId: body?.clientMessageId ? String(body.clientMessageId) : undefined,
            clientSentAt: body?.clientSentAt ? String(body.clientSentAt) : null,
            translationSourceText: body?.translationSourceText ? String(body.translationSourceText) : null,
            translationTargetLanguage: body?.translationTargetLanguage ? String(body.translationTargetLanguage) : null,
            translationDetectedSourceLanguage: body?.translationDetectedSourceLanguage
                ? String(body.translationDetectedSourceLanguage)
                : null,
            agentFeedback: body?.agentFeedback && typeof body.agentFeedback === "object"
                ? body.agentFeedback
                : null,
        });

        if (!result?.success) {
            return NextResponse.json({
                ...result,
                success: false,
                error: serializeSendError((result as any)?.error),
            });
        }

        return NextResponse.json(result);
    } catch (error) {
        console.error("POST /api/admin/conversations/send-reply error:", error);
        return NextResponse.json(
            { success: false, error: serializeSendError(error) },
            { status: 500 }
        );
    }
}
