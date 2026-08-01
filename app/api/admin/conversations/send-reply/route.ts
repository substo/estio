import { NextResponse } from "next/server";
import { sendReply } from "@/app/(main)/admin/conversations/actions";
import { getLocationContext } from "@/lib/auth/location-context";
import { parseSendReplyApiPayload } from "@/lib/conversations/send-reply-contract";
import { getActiveContactsAccess } from "@/lib/contacts/active-location-access";

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
        const [location, access] = await Promise.all([getLocationContext(), getActiveContactsAccess()]);
        if (!location?.id || !access || access.locationId !== location.id) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const parsed = parseSendReplyApiPayload(body);
        if (!parsed.success) {
            return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
        }
        const payload = parsed.payload;
        if (payload.locationId && payload.locationId !== location.id) {
            return NextResponse.json({ success: false, error: "Active location mismatch." }, { status: 403 });
        }

        const result = await sendReply(payload.conversationId, payload.contactId, payload.messageBody, payload.type, {
            clientMessageId: payload.clientMessageId || undefined,
            clientSentAt: payload.clientSentAt,
            translationSourceText: payload.translationSourceText,
            translationTargetLanguage: payload.translationTargetLanguage,
            translationDetectedSourceLanguage: payload.translationDetectedSourceLanguage,
            agentFeedback: payload.agentFeedback,
            retryMessageId: payload.retryMessageId,
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
