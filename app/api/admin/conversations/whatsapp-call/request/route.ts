import { NextResponse } from "next/server";
import { getLocationContext } from "@/lib/auth/location-context";
import { requestWhatsAppCallConsent } from "@/lib/whatsapp/calling";
import { sendReply } from "@/app/(main)/admin/conversations/actions";

function serializeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return "WhatsApp call request failed.";
}

export async function POST(request: Request) {
    try {
        const location = await getLocationContext();
        if (!location) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const conversationId = String(body?.conversationId || "").trim();
        const contactId = String(body?.contactId || "").trim();
        if (!conversationId || !contactId) {
            return NextResponse.json(
                { success: false, error: "Missing conversationId or contactId." },
                { status: 400 }
            );
        }

        const result = await requestWhatsAppCallConsent({
            locationId: location.id,
            conversationId,
            contactId,
            sendWhatsAppMessage: (resolvedConversationId, resolvedContactId, messageBody) => (
                sendReply(resolvedConversationId, resolvedContactId, messageBody, "WhatsApp")
            ),
        });

        return NextResponse.json(result, { status: result.success ? 200 : 400 });
    } catch (error) {
        console.error("POST /api/admin/conversations/whatsapp-call/request error:", error);
        return NextResponse.json(
            { success: false, error: serializeError(error) },
            { status: 500 }
        );
    }
}
