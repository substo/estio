
import db from "@/lib/db";
import twilio from "twilio";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { getLegacyCryptr } from "@/lib/security/legacy-cryptr";

export async function getTwilioCredentials(locationId: string) {
    const [location, integrationDoc] = await Promise.all([
        db.location.findUnique({
            where: { id: locationId },
            select: {
                twilioAccountSid: true,
                twilioAuthToken: true,
                twilioWhatsAppFrom: true,
            },
        }),
        settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
        }).catch(() => null),
    ]);

    const accountSid = integrationDoc?.payload?.twilioAccountSid || location?.twilioAccountSid || "";
    const from = integrationDoc?.payload?.twilioWhatsAppFrom || location?.twilioWhatsAppFrom || "";

    let authToken = await settingsService.getSecret({
        scopeType: "LOCATION",
        scopeId: locationId,
        domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
        secretKey: SETTINGS_SECRET_KEYS.TWILIO_AUTH_TOKEN,
    }).catch(() => null);

    if (!authToken && location?.twilioAuthToken) {
        authToken = getLegacyCryptr().decrypt(location.twilioAuthToken);
    }

    if (!accountSid || !authToken || !from) {
        throw new Error("Twilio WhatsApp credentials not found for this location");
    }

    return {
        accountSid,
        authToken,
        from,
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
