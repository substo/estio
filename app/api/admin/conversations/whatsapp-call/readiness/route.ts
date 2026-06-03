import { NextResponse } from "next/server";
import { getLocationContext } from "@/lib/auth/location-context";
import { checkCallingReadiness } from "@/lib/whatsapp/calling";

function serializeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return "WhatsApp calling readiness check failed.";
}

export async function POST(request: Request) {
    try {
        const location = await getLocationContext();
        if (!location) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const conversationId = body?.conversationId ? String(body.conversationId).trim() : null;
        const contactId = body?.contactId ? String(body.contactId).trim() : null;
        const readiness = await checkCallingReadiness(location.id, {
            conversationId,
            contactId,
            refreshHealth: true,
        });

        return NextResponse.json({ success: true, readiness });
    } catch (error) {
        console.error("POST /api/admin/conversations/whatsapp-call/readiness error:", error);
        return NextResponse.json({ success: false, error: serializeError(error) }, { status: 500 });
    }
}
