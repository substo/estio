import { NextResponse } from "next/server";
import { updateWhatsAppCallFromProviderEvent } from "@/lib/whatsapp/calling";

function isAuthorized(request: Request) {
    const secret = process.env.WHATSAPP_CALLING_WEBHOOK_SECRET || process.env.WHATSAPP_WEBHOOK_SECRET;
    if (!secret) return true;
    return request.headers.get("x-whatsapp-calling-webhook-secret") === secret
        || request.headers.get("x-whatsapp-webhook-secret") === secret;
}

function extractCallingEvents(payload: any): any[] {
    if (Array.isArray(payload?.events)) return payload.events;
    if (Array.isArray(payload?.entry)) {
        return payload.entry.flatMap((entry: any) => {
            if (!Array.isArray(entry?.changes)) return [];
            return entry.changes.flatMap((change: any) => {
                const value = change?.value || {};
                if (Array.isArray(value.calls)) return value.calls.map((call: any) => ({ ...call, field: change?.field }));
                return value.call ? [{ ...value.call, field: change?.field }] : [];
            });
        });
    }
    return [payload].filter(Boolean);
}

export async function POST(request: Request) {
    if (!isAuthorized(request)) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const locationId = String(url.searchParams.get("locationId") || "").trim();
    if (!locationId) {
        return NextResponse.json({ success: false, error: "Missing locationId." }, { status: 400 });
    }

    const payload = await request.json().catch(() => ({}));
    const events = extractCallingEvents(payload);
    const results = [];
    for (const event of events) {
        results.push(await updateWhatsAppCallFromProviderEvent({ locationId, event }));
    }
    return NextResponse.json({ success: true, results });
}
