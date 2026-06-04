import { NextResponse } from "next/server";
import { getLocationContext } from "@/lib/auth/location-context";
import db from "@/lib/db";
import { WHATSAPP_CALLING_PROVIDER } from "@/lib/whatsapp/calling";

function serializeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return "WhatsApp calling config failed.";
}

export async function GET() {
    try {
        const location = await getLocationContext();
        if (!location) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        const config = await (db as any).whatsAppCallingConfig.findUnique({
            where: { locationId: location.id },
        });
        return NextResponse.json({ success: true, config });
    } catch (error) {
        console.error("GET /api/admin/conversations/whatsapp-call/config error:", error);
        return NextResponse.json({ success: false, error: serializeError(error) }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const location = await getLocationContext();
        if (!location) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const mediaMode = ["sip", "browser_webrtc", "manual_sdp", "provider_managed"].includes(String(body?.mediaMode || ""))
            ? String(body.mediaMode)
            : "sip";
        const data = {
            provider: WHATSAPP_CALLING_PROVIDER,
            status: body?.callingEnabled ? "ready" : "not_configured",
            phoneNumberId: body?.phoneNumberId ? String(body.phoneNumberId).trim() : null,
            wabaId: body?.wabaId ? String(body.wabaId).trim() : null,
            callingEnabled: body?.callingEnabled === true,
            webhooksEnabled: body?.webhooksEnabled === true,
            mediaMode,
            sipEndpoint: body?.sipEndpoint ? String(body.sipEndpoint).trim() : null,
            mediaNotes: body?.mediaNotes ? String(body.mediaNotes).trim() : null,
            metadata: body?.metadata && typeof body.metadata === "object" ? body.metadata : undefined,
        };

        const config = await (db as any).whatsAppCallingConfig.upsert({
            where: { locationId: location.id },
            create: {
                locationId: location.id,
                ...data,
            },
            update: data,
        });

        return NextResponse.json({ success: true, config });
    } catch (error) {
        console.error("POST /api/admin/conversations/whatsapp-call/config error:", error);
        return NextResponse.json({ success: false, error: serializeError(error) }, { status: 500 });
    }
}
