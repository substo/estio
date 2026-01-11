
import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { processNormalizedMessage, processStatusUpdate, NormalizedMessage } from "@/lib/whatsapp/sync";
import twilio from "twilio";
import { getTwilioCredentials } from "@/lib/twilio/client";

export async function POST(req: NextRequest) {
    try {
        // Twilio sends data as form-urlencoded
        const formData = await req.formData();
        const data: any = {};
        formData.forEach((value, key) => {
            data[key] = value.toString();
        });

        console.log("Twilio Webhook Received:", JSON.stringify(data, null, 2));

        const messageSid = data.MessageSid;
        const from = data.From; // whatsapp:+1User
        const to = data.To;     // whatsapp:+1Business
        const body = data.Body;
        const numMedia = parseInt(data.NumMedia || "0");
        const status = data.MessageStatus; // sent, delivered, read, failed (only in status callbacks)

        // Determine if Inbound Message or Status Update
        // Status updates usually come from a different URL if configured per-message, 
        // OR the same URL if configured as the fallback. 
        // BUT, for "Sandbox", everything hits the same URL usually? 
        // Actually, normally you set a separate Status Callback URL. 
        // If this is INBOUND, status might be absent or just 'received' implicitly. 
        // If data.SmsStatus or data.MessageStatus is present, it might be a status update.
        // However, for INBOUND messages, Twilio also sends SmsStatus='received'.

        const isStatusUpdate = ["sent", "delivered", "read", "failed", "undelivered"].includes(status);

        // Identify Location by the Business Number
        // Identify Location by finding match on EITHER From OR To
        // This handles both Inbound (Customer -> Business) and Outbound-from-App (Business -> Customer) scenarios.

        const cleanFrom = from.replace("whatsapp:", "").replace("+", "");
        const cleanTo = to.replace("whatsapp:", "").replace("+", "");

        // Try to find the business location
        // We look for a location where 'twilioWhatsAppFrom' matches EITHER the sender OR the receiver
        const location = await db.location.findFirst({
            where: {
                OR: [
                    { twilioWhatsAppFrom: cleanFrom },
                    { twilioWhatsAppFrom: `+${cleanFrom}` },
                    { twilioWhatsAppFrom: cleanTo },
                    { twilioWhatsAppFrom: `+${cleanTo}` }
                ]
            }
        });

        if (!location) {
            console.warn(`Twilio Webhook: Unknown Business Number involved. From: ${from}, To: ${to}`);
            return new NextResponse("<Response></Response>", {
                status: 200,
                headers: { "Content-Type": "text/xml" }
            });
        }

        // Determine Direction
        // If From == Location Number, it is OUTBOUND (sent from App)
        // If To == Location Number, it is INBOUND (sent from Customer)

        const locNum = location.twilioWhatsAppFrom?.replace("+", "");
        const isOutboundFromApp = cleanFrom === locNum;

        // Verify Signature (todo)

        if (isStatusUpdate) {
            await processStatusUpdate(messageSid, status);
        } else {
            // Processing Message (Inbound OR Outbound-Sync)
            let msgType: NormalizedMessage["type"] = "text";
            let msgBody = body;

            if (numMedia > 0) {
                // Media handling logic (simplified)
                msgType = "image"; // Default to image if generic
                const mediaType = data.MediaContentType0;
                if (mediaType?.startsWith('image/')) msgType = "image";
                else if (mediaType?.startsWith('audio/')) msgType = "audio";
                else if (mediaType?.startsWith('video/')) msgType = "video";
                else if (mediaType?.startsWith('application/pdf')) msgType = "document";

                const mediaUrl = data.MediaUrl0;
                msgBody = body ? `${body} [Media: ${mediaUrl}]` : `[Media: ${mediaUrl}]`;
            }

            await processNormalizedMessage({
                locationId: location.id,
                from: from.replace("whatsapp:", ""),
                to: to.replace("whatsapp:", ""),
                type: msgType,
                body: msgBody,
                wamId: messageSid,
                timestamp: new Date(),
                source: "whatsapp_twilio",
                contactName: data.ProfileName,
                direction: isOutboundFromApp ? "outbound" : "inbound"
            });
        }

        // Return TwiML
        return new NextResponse("<Response></Response>", {
            status: 200,
            headers: { "Content-Type": "text/xml" }
        });

    } catch (error) {
        console.error("Error processing Twilio webhook:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
