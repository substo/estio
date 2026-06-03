import { NextRequest, NextResponse } from "next/server";
import { updateWhatsAppCallFromBridgeEvent } from "@/lib/whatsapp/calling";

function isAuthorized(request: NextRequest) {
    const secret = process.env.WHATSAPP_CALL_BRIDGE_SECRET;
    if (!secret) return true;
    return request.headers.get("x-whatsapp-call-bridge-secret") === secret;
}

function stringOrNull(value: unknown) {
    const normalized = String(value || "").trim();
    return normalized || null;
}

export async function POST(request: NextRequest) {
    if (!isAuthorized(request)) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const locationId = stringOrNull(body?.locationId);
    if (!locationId) {
        return NextResponse.json({ success: false, error: "locationId is required" }, { status: 400 });
    }

    try {
        const result = await updateWhatsAppCallFromBridgeEvent({
            locationId,
            event: body,
        });
        return NextResponse.json(result);
    } catch (error: any) {
        console.error("[WhatsApp Call Bridge Webhook] Failed to process event:", error);
        return NextResponse.json({
            success: false,
            error: error?.message || "Failed to process WhatsApp call bridge event.",
        }, { status: 500 });
    }
}
