export type PropertyUrlContextResponse = {
    success: boolean;
    url?: string;
    title?: string;
    description?: string;
    imageUrl?: string;
    siteName?: string;
    sourceText?: string;
    error?: string;
};

export type ParsedPropertyUrls = {
    urls: string[];
    overflowCount: number;
};

export type PropertySourceTextItem = {
    url: string;
    title?: string;
    sourceText?: string;
};

export const MAX_PROPERTY_MESSAGE_URLS = 5;

export function parsePropertyUrls(input: string, maxUrls = MAX_PROPERTY_MESSAGE_URLS): ParsedPropertyUrls {
    const matches = String(input || "").match(/https?:\/\/[^\s,]+/gi) || [];
    const seen = new Set<string>();
    const urls: string[] = [];

    for (const match of matches) {
        const normalized = match.replace(/[)\].,;!?]+$/g, "").trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        if (urls.length < maxUrls) {
            urls.push(normalized);
        }
    }

    return {
        urls,
        overflowCount: Math.max(0, seen.size - urls.length),
    };
}

export async function fetchPropertyUrlContext(url: string): Promise<PropertyUrlContextResponse> {
    const response = await fetch("/api/conversations/property-url-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
    });
    const payload = await response.json().catch(() => null) as PropertyUrlContextResponse | null;
    if (!response.ok || !payload?.success || !payload.sourceText) {
        return {
            success: false,
            url,
            error: payload?.error || "Could not extract property details from this URL.",
        };
    }

    return payload;
}

export function buildPropertySourceText(args: {
    extractedText?: string;
    pastedText?: string;
    sources?: PropertySourceTextItem[];
}): string {
    const sections = [
        ...(args.sources || [])
            .map((source, index) => {
                const parts = [
                    `Property option ${index + 1}`,
                    source.url.trim() ? `URL: ${source.url.trim()}` : null,
                    source.title?.trim() ? `Title: ${source.title.trim()}` : null,
                    source.sourceText?.trim() ? `Extracted text:\n${source.sourceText.trim()}` : null,
                ].filter(Boolean);
                return parts.length > 1 ? parts.join("\n") : "";
            })
            .filter(Boolean),
        args.extractedText?.trim()
            ? `Extracted property page text:\n${args.extractedText.trim()}`
            : null,
        args.pastedText?.trim()
            ? `Agent pasted property text:\n${args.pastedText.trim()}`
            : null,
    ].filter(Boolean);

    return sections.join("\n\n");
}
