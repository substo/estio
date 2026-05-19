import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { processNormalizedMessage } from "@/lib/whatsapp/sync";
import {
    getWhatsAppCloudChannelByPhoneNumberId,
    verifyWhatsAppWebhookSignature,
} from "@/lib/whatsapp/client";
import { updateWhatsAppCloudStatus } from "@/lib/whatsapp/status-updates";
import { normalizeWhatsAppCloudInboundMessage } from "@/lib/whatsapp/webhook-normalizers";

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const mode = searchParams.get("hub.mode");
    const token = searchParams.get("hub.verify_token");
    const challenge = searchParams.get("hub.challenge");

    if (mode && token) {
        const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

        if (mode === "subscribe" && token === verifyToken) {
            console.log("WEBHOOK_VERIFIED");
            return new NextResponse(challenge, { status: 200 });
        }
        return new NextResponse("Forbidden", { status: 403 });
    }

    return new NextResponse("Bad Request", { status: 400 });
}

async function processMessagesValue(value: any) {
    const phoneNumberId = String(value?.metadata?.phone_number_id || "").trim();
    if (!phoneNumberId) {
        console.warn("[WhatsApp Webhook] Missing phone_number_id in metadata");
        return;
    }

    const channel = await getWhatsAppCloudChannelByPhoneNumberId(phoneNumberId);
    const location = channel
        ? await db.location.findUnique({ where: { id: channel.locationId } })
        : await db.location.findFirst({ where: { whatsappPhoneNumberId: phoneNumberId } });

    if (!location) {
        console.warn(`Received WhatsApp webhook for unknown Phone Number ID: ${phoneNumberId}`);
        return;
    }

    const locationForSync = {
        ...location,
        whatsappPhoneNumberId: channel?.phoneNumberId || location.whatsappPhoneNumberId,
    };

    for (const status of value?.statuses || []) {
        await updateWhatsAppCloudStatus(locationForSync, status);
    }

    const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
    for (const message of value?.messages || []) {
        const normalized = normalizeWhatsAppCloudInboundMessage({
            locationId: location.id,
            phoneNumberId,
            contacts,
            message,
        });
        if (!normalized) continue;

        await processNormalizedMessage(normalized);
    }
}

export async function POST(req: NextRequest) {
    try {
        const rawBody = await req.text();
        const signature = req.headers.get("x-hub-signature-256");
        if (!verifyWhatsAppWebhookSignature(rawBody, signature)) {
            console.warn("[WhatsApp Webhook] Invalid x-hub-signature-256");
            return new NextResponse("Forbidden", { status: 403 });
        }

        const body = JSON.parse(rawBody || "{}");
        for (const entry of body?.entry || []) {
            for (const change of entry?.changes || []) {
                if (change?.field !== "messages") continue;
                await processMessagesValue(change?.value || {});
            }
        }

        return new NextResponse("OK", { status: 200 });
    } catch (error) {
        console.error("Error processing WhatsApp webhook:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
