
import db from "@/lib/db";
import twilio from "twilio";

// For decryption - we'll reuse the same mechanism as other integrations
// Ideally this should be a shared utility, but for now we'll import if available or note the need for it.
import Cryptr from "cryptr";

const secret = process.env.ENCRYPTION_KEY || "dev-secret-key-change-me";
const cryptr = new Cryptr(secret);

export async function getTwilioCredentials(locationId: string) {
    const location = await db.location.findUnique({
        where: { id: locationId },
        select: {
            twilioAccountSid: true,
            twilioAuthToken: true,
            twilioWhatsAppFrom: true,
        },
    });

    if (!location?.twilioAccountSid || !location?.twilioAuthToken || !location?.twilioWhatsAppFrom) {
        throw new Error("Twilio WhatsApp credentials not found for this location");
    }

    return {
        accountSid: location.twilioAccountSid,
        authToken: cryptr.decrypt(location.twilioAuthToken),
        from: location.twilioWhatsAppFrom,
    };
}

export async function sendTwilioMessage(
    locationId: string,
    to: string,
    message: {
        body?: string;
        mediaUrl?: string[];
    }
) {
    const { accountSid, authToken, from } = await getTwilioCredentials(locationId);

    const client = twilio(accountSid, authToken);

    // Format 'to' number: Twilio expects "whatsapp:+1234567890"
    // Our DB stores "+1234567890" usually. 
    // Ensure 'to' has 'whatsapp:' prefix if not present.
    let formattedTo = to;
    if (!formattedTo.startsWith("whatsapp:")) {
        // Assume 'to' is E.164 (e.g. +1234567890)
        formattedTo = `whatsapp:${to}`;
    }

    // Ensure 'from' has prefix too (usually stored with it, but be safe)
    let formattedFrom = from;
    if (!formattedFrom.startsWith("whatsapp:")) {
        formattedFrom = `whatsapp:${from}`;
    }

    try {
        const result = await client.messages.create({
            from: formattedFrom,
            to: formattedTo,
            body: message.body,
            mediaUrl: message.mediaUrl,
        });

        return result;
    } catch (error: any) {
        console.error("Twilio Send Error:", error);
        throw new Error(`Twilio API Error: ${error.message || "Unknown error"}`);
    }
}
