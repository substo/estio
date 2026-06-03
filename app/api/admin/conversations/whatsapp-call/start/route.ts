import { NextResponse } from "next/server";
import { getLocationContext } from "@/lib/auth/location-context";
import { startWhatsAppCall } from "@/lib/whatsapp/calling";

function serializeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return "WhatsApp call start failed.";
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
        const callAttemptId = body?.callAttemptId ? String(body.callAttemptId) : null;
        if (!conversationId || !contactId) {
            return NextResponse.json(
                { success: false, error: "Missing conversationId or contactId." },
                { status: 400 }
            );
        }

        const result = await startWhatsAppCall({
            locationId: location.id,
            conversationId,
            contactId,
            callAttemptId,
        });
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
    } catch (error) {
        console.error("POST /api/admin/conversations/whatsapp-call/start error:", error);
        return NextResponse.json(
            { success: false, error: serializeError(error) },
            { status: 500 }
        );
    }
}
