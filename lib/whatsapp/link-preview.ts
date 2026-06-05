const HTTP_URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/i;
const TRAILING_PUNCTUATION_PATTERN = /[),.;:!?]+$/;

export type WhatsAppLinkPreviewDecision = {
    shouldRequestPreview: boolean;
    url: string | null;
    host: string | null;
};

export function extractFirstHttpUrl(text: string | null | undefined): string | null {
    const body = String(text || "");
    const match = body.match(HTTP_URL_PATTERN);
    if (!match?.[0]) return null;

    const candidate = match[0].replace(TRAILING_PUNCTUATION_PATTERN, "");
    try {
        const url = new URL(candidate);
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        return url.href;
    } catch {
        return null;
    }
}

export function getWhatsAppLinkPreviewDecision(text: string | null | undefined): WhatsAppLinkPreviewDecision {
    const url = extractFirstHttpUrl(text);
    if (!url) {
        return { shouldRequestPreview: false, url: null, host: null };
    }

    let host: string | null = null;
    try {
        host = new URL(url).host || null;
    } catch {
        host = null;
    }

    return {
        shouldRequestPreview: true,
        url,
        host,
    };
}
