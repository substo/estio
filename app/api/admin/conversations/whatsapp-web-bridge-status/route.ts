import { NextResponse } from "next/server";
import { getLocationContext } from "@/lib/auth/location-context";
import { getWhatsAppWebBridgeStatusForLocation } from "@/lib/conversations/whatsapp-web-bridge-status";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const location = await getLocationContext();
        if (!location) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const status = await getWhatsAppWebBridgeStatusForLocation(location);
        return NextResponse.json(status, {
            headers: {
                "Cache-Control": "no-store",
            },
        });
    } catch (error: any) {
        console.error("GET /api/admin/conversations/whatsapp-web-bridge-status error:", error);
        return NextResponse.json({
            provider: "web_bridge",
            mode: "web_bridge",
            status: "ERROR",
            qrcode: null,
            phone: null,
            lastSeenAt: null,
            lastReadyAt: null,
            error: "Unable to check WhatsApp status.",
            sto: {
                configured: false,
                state: "unavailable",
                label: "STO Unavailable",
                detail: "STO Secure Delivery status is temporarily unavailable.",
                deviceAlias: null,
                networkType: null,
                lastConnectedAt: null,
                lastSeenAt: null,
                lastVerifiedAt: null,
                protectedSession: false,
            },
        }, { status: 500 });
    }
}
