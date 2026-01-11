import db from "@/lib/db";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_API_URL = "https://graph.facebook.com";

export async function getWhatsAppCredentials(locationId: string) {
    // TODO: Add decryption
    const location = await db.location.findUnique({
        where: { id: locationId },
        select: {
            whatsappPhoneNumberId: true,
            whatsappAccessToken: true,
        },
    });

    if (!location?.whatsappPhoneNumberId || !location?.whatsappAccessToken) {
        throw new Error("WhatsApp credentials not found for this location");
    }

    return location;
}

export async function sendWhatsAppMessage(
    locationId: string,
    to: string,
    message: { type: "text" | "template";[key: string]: any }
) {
    const { whatsappPhoneNumberId, whatsappAccessToken } = await getWhatsAppCredentials(locationId);

    // Decrypt token if needed (omitted for brevity, assuming transparent handling in getter or here)
    const token = whatsappAccessToken; // Should be decrypted

    const url = `${GRAPH_API_URL}/${GRAPH_API_VERSION}/${whatsappPhoneNumberId}/messages`;

    const payload: any = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to.replace('+', ''), // WhatsApp usually requires no plus
        type: message.type,
    };

    if (message.type === "text") {
        payload.text = { body: message.body };
    } else if (message.type === "template") {
        payload.template = {
            name: message.name,
            language: { code: message.language || "en_US" },
            components: message.components || [],
        };
    }

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorData = await response.json();
        console.error("WhatsApp Send Error:", errorData);
        throw new Error(`WhatsApp API Error: ${errorData.error?.message || "Unknown error"}`);
    }

    return await response.json();
}
