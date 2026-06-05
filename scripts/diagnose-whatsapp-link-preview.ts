import {
    normalizeWhatsAppWebChatId,
    sendWhatsAppWebBridgeMessage,
} from "../lib/whatsapp/web-bridge";
import { getWhatsAppLinkPreviewDecision } from "../lib/whatsapp/link-preview";

function readRequiredEnv(name: string) {
    const value = String(process.env[name] || "").trim();
    if (!value) throw new Error(`Missing required env var ${name}.`);
    return value;
}

async function main() {
    const locationId = readRequiredEnv("WHATSAPP_LINK_PREVIEW_LOCATION_ID");
    const to = normalizeWhatsAppWebChatId(readRequiredEnv("WHATSAPP_LINK_PREVIEW_TO"));
    if (!to) throw new Error("WHATSAPP_LINK_PREVIEW_TO must be a WhatsApp phone, @c.us id, or @lid id.");

    const urls = [
        "https://ogp.me/",
        String(process.env.WHATSAPP_LINK_PREVIEW_URL || "").trim(),
    ].filter((url, index, list) => url && list.indexOf(url) === index);

    for (const url of urls) {
        const text = `Link preview diagnostic: ${url}`;
        const preview = getWhatsAppLinkPreviewDecision(text);
        const response = await sendWhatsAppWebBridgeMessage({
            locationId,
            to,
            text,
        });

        console.log(JSON.stringify({
            urlHost: preview.host,
            linkPreviewRequested: preview.shouldRequestPreview,
            bridgeMessageId: response?.messageId || null,
            bridgeReturnedLinksCount: Number.isFinite(Number(response?.sentLinksCount)) ? Number(response.sentLinksCount) : null,
        }, null, 2));
    }
}

main().catch((error) => {
    console.error("[WhatsApp Link Preview Diagnostic] Failed:", error?.message || error);
    process.exitCode = 1;
});
