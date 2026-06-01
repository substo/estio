export type PropertyUrlContextResponse = {
    success: boolean;
    url?: string;
    title?: string;
    sourceText?: string;
    error?: string;
};

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
}): string {
    const sections = [
        args.extractedText?.trim()
            ? `Extracted property page text:\n${args.extractedText.trim()}`
            : null,
        args.pastedText?.trim()
            ? `Agent pasted property text:\n${args.pastedText.trim()}`
            : null,
    ].filter(Boolean);

    return sections.join("\n\n");
}
