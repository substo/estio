import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { processNormalizedMessage, NormalizedMessage } from "@/lib/whatsapp/sync";

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const mode = searchParams.get("hub.mode");
    const token = searchParams.get("hub.verify_token");
    const challenge = searchParams.get("hub.challenge");

    if (mode && token) {
        // Verify against Global App Token
        const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

        if (mode === "subscribe" && token === verifyToken) {
            console.log("WEBHOOK_VERIFIED");
            return new NextResponse(challenge, { status: 200 });
        } else {
            return new NextResponse("Forbidden", { status: 403 });
        }
    }

    return new NextResponse("Bad Request", { status: 400 });
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        // console.log("WhatsApp Webhook Received:", JSON.stringify(body, null, 2));

        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const field = changes?.field;

        console.log(`[WhatsApp Webhook] Received Event: ${field}`);

        if (field !== "messages") {
            // We might be receiving other events like 'presence' or 'status'
            return new NextResponse("OK", { status: 200 });
        }

        const phoneNumberId = value?.metadata?.phone_number_id;

        if (!phoneNumberId) {
            console.warn("[WhatsApp Webhook] Missing phone_number_id in metadata");
            return new NextResponse("OK", { status: 200 });
        }

        // Find location by phoneNumberId
        const location = await db.location.findFirst({
            where: { whatsappPhoneNumberId: phoneNumberId }
        });

        if (!location) {
            console.warn(`Received WhatsApp webhook for unknown Phone Number ID: ${phoneNumberId}`);
            return new NextResponse("OK", { status: 200 });
        }

        const messages = value?.messages;
        if (messages) {
            for (const message of messages) {
                const from = message.from;
                const wamId = message.id;
                const timestamp = new Date(parseInt(message.timestamp) * 1000);
                const type = message.type;
                let bodyText = "";

                if (type === "text") {
                    bodyText = message.text?.body || "";
                } else if (type === "image") {
                    bodyText = message.image?.caption || "[Image]";
                } else {
                    bodyText = `[${type}]`;
                }

                // Try to find contact name
                let contactName = undefined;
                const contacts = value?.contacts;
                if (contacts) {
                    const contact = contacts.find((c: any) => c.wa_id === from);
                    if (contact) {
                        contactName = contact.profile?.name;
                    }
                }

                const normalized: NormalizedMessage = {
                    locationId: location.id,
                    from: from,
                    to: phoneNumberId, // This is technically the phone ID, not the E.164 of the business, but acceptable for now
                    type: "text", // mapping to basic types for now
                    body: bodyText,
                    wamId: wamId,
                    timestamp: timestamp,
                    contactName: contactName,
                    source: "whatsapp_native",
                    direction: "inbound"
                };

                await processNormalizedMessage(normalized);
            }
        }

        return new NextResponse("OK", { status: 200 });
    } catch (error) {
        console.error("Error processing WhatsApp webhook:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
