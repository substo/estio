import { NextResponse } from "next/server";
import { getLocationContext } from "@/lib/auth/location-context";
import db from "@/lib/db";
import { WHATSAPP_CALLING_RUNTIME_MODE, getWhatsAppCallBridgeBaseUrl } from "@/lib/whatsapp/calling";

function serializeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return "WhatsApp call bridge config failed.";
}

export async function GET() {
    try {
        const location = await getLocationContext();
        if (!location) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        const config = await (db as any).whatsAppCallBridgeConfig.findUnique({
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
        const data = {
            callingRuntimeMode: WHATSAPP_CALLING_RUNTIME_MODE,
            baileysSessionId: body?.baileysSessionId ? String(body.baileysSessionId).trim() : location.id,
            bridgeBaseUrl: getWhatsAppCallBridgeBaseUrl(body?.bridgeBaseUrl),
            mediaNotes: body?.mediaNotes ? String(body.mediaNotes).trim() : null,
            metadata: body?.metadata && typeof body.metadata === "object" ? body.metadata : undefined,
        };

        const config = await (db as any).whatsAppCallBridgeConfig.upsert({
            where: { locationId: location.id },
            create: {
                locationId: location.id,
                baileysCallBridgeStatus: "offline",
                mediaStatus: "signaling_only",
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
