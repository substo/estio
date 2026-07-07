export const GOOGLE_GEMINI_PRICING_URL = "https://ai.google.dev/gemini-api/docs/pricing?hl=en";

export type GoogleGeminiModelPricing = {
    provider: "google_gemini";
    modelId: string;
    currency: "USD";
    sourceUrl: string;
    fetchedAt: string;
    tier: "paid";
    mode: "standard";
    unit: "per_1m_tokens";
    inputPer1MTokens?: number;
    outputPer1MTokens?: number;
    imageOutputPer1MTokens?: number;
    outputImageTokens?: {
        resolution: string;
        tokens?: number;
        equivalentUsd?: number;
    }[];
};

function decodeHtmlEntities(value: string): string {
    return String(value || "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, "\"");
}

function htmlToText(html: string): string {
    return decodeHtmlEntities(
        String(html || "")
            .replace(/<script[\s\S]*?<\/script>/gi, "\n")
            .replace(/<style[\s\S]*?<\/style>/gi, "\n")
            .replace(/<\/(h[1-6]|p|div|li|tr|section|article|table)>/gi, "\n")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]+>/g, " ")
    )
        .replace(/\r/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s+/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function parseUsdAmount(value: string): number | undefined {
    const match = String(value || "").match(/\$([0-9]+(?:\.[0-9]+)?)/);
    if (!match) return undefined;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function parseTokenExamples(section: string): GoogleGeminiModelPricing["outputImageTokens"] {
    const examples: NonNullable<GoogleGeminiModelPricing["outputImageTokens"]> = [];
    const pattern = /Output images?.*?(?:at|from|up to)\s+(.+?)\s+consume\s+([0-9,]+) tokens?(?: and are equivalent to \$([0-9]+(?:\.[0-9]+)?) per image)?/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(section))) {
        const tokens = Number(String(match[2] || "").replace(/,/g, ""));
        if (!Number.isFinite(tokens)) continue;
        examples.push({
            resolution: match[1].trim(),
            tokens,
            equivalentUsd: match[3] ? Number(match[3]) : undefined,
        });
    }
    const equivalentPattern = /\$([0-9]+(?:\.[0-9]+)?)\s+per\s+([0-9.]+K|[0-9]+K|[0-9]+px|[0-9]+x[0-9]+px)\s+image/gi;
    while ((match = equivalentPattern.exec(section))) {
        const equivalentUsd = Number(match[1]);
        if (!Number.isFinite(equivalentUsd)) continue;
        const resolution = match[2].trim();
        if (examples.some((example) => example.resolution === resolution)) continue;
        examples.push({ resolution, equivalentUsd });
    }
    return examples.length ? examples : undefined;
}

function extractStandardBlock(section: string): string {
    const standardStart = section.search(/\bStandard\b/i);
    if (standardStart < 0) return section;
    const rest = section.slice(standardStart);
    const nextMode = rest.search(/\n\s*(Batch|Flex|Priority)\b/i);
    return nextMode > 0 ? rest.slice(0, nextMode) : rest;
}

function extractStandardSectionHtml(html: string): string {
    const standard = String(html || "").match(/<section[^>]*>\s*<h3[^>]*>\s*Standard\s*<\/h3>([\s\S]*?)<\/section>/i);
    return standard?.[1] || html;
}

function extractPaidCellFromRow(sectionHtml: string, rowLabelPattern: RegExp): string {
    const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowPattern.exec(sectionHtml))) {
        const cells = Array.from(String(rowMatch[1] || "").matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi))
            .map((match) => htmlToText(match[1] || ""));
        if (cells.length < 3) continue;
        if (rowLabelPattern.test(cells[0])) return cells[2];
    }
    return "";
}

function extractModelSections(html: string): Array<{ modelIds: string[]; body: string; rawBody: string }> {
    const sections: Array<{ modelIds: string[]; body: string; rawBody: string }> = [];
    const htmlInput = String(html || "");
    const h2Pattern = /<h2[^>]*>[\s\S]*?<\/h2>([\s\S]*?)(?=<h2[\s>]|$)/gi;
    let match: RegExpExecArray | null;

    while ((match = h2Pattern.exec(htmlInput))) {
        const rawBody = match[1] || "";
        const modelIds: string[] = [];
        const codePattern = /<code[^>]*>\s*([^<]*gemini[^<]*)\s*<\/code>/gi;
        let codeMatch: RegExpExecArray | null;
        while ((codeMatch = codePattern.exec(rawBody))) {
            for (const modelId of String(codeMatch[1] || "").split(/\s+and\s+|,\s*/i)) {
                const normalized = modelId.trim();
                if (normalized.startsWith("gemini")) modelIds.push(normalized);
            }
        }

        if (modelIds.length) {
            const standardHtml = extractStandardSectionHtml(rawBody);
            sections.push({
                modelIds: Array.from(new Set(modelIds)),
                body: htmlToText(standardHtml),
                rawBody: standardHtml,
            });
        }
    }

    if (sections.length) return sections;

    const text = htmlToText(htmlInput);
    const sectionPattern = /(?:^|\n)##\s+([^\n]+)\n+`([^`]+)`([\s\S]*?)(?=\n##\s+|\s*$)/g;
    while ((match = sectionPattern.exec(text))) {
        const modelIds = String(match[2] || "")
            .split(/\s+and\s+|,\s*/i)
            .map((value) => value.replace(/`/g, "").trim())
            .filter(Boolean);
        if (modelIds.length) {
            sections.push({
                modelIds,
                body: match[3] || "",
                rawBody: match[3] || "",
            });
        }
    }

    return sections;
}

export function parseGoogleGeminiPricingPage(input: {
    html: string;
    fetchedAt?: Date;
    sourceUrl?: string;
}): GoogleGeminiModelPricing[] {
    const sourceUrl = input.sourceUrl || GOOGLE_GEMINI_PRICING_URL;
    const fetchedAt = (input.fetchedAt || new Date()).toISOString();
    const results: GoogleGeminiModelPricing[] = [];
    const sections = extractModelSections(input.html);

    for (const section of sections) {
        const block = extractStandardBlock(section.body);
        const inputLine = extractPaidCellFromRow(section.rawBody, /^Input price$/i)
            || block.match(/Input price[^\n]*(?:\n\$[^\n]*)?/i)?.[0]
            || "";
        const outputLine = extractPaidCellFromRow(section.rawBody, /^Output price/i)
            || block.match(/Output price[^\n]*(?:\n\$[^\n]*)?/i)?.[0]
            || "";
        const imageOutputMatch = block.match(/\$([0-9]+(?:\.[0-9]+)?)\s*\(images?\)/i);
        const inputPer1MTokens = parseUsdAmount(inputLine);
        const outputPer1MTokens = parseUsdAmount(outputLine);
        const imageOutputPer1MTokens = imageOutputMatch ? Number(imageOutputMatch[1]) : undefined;
        const outputImageTokens = parseTokenExamples(block);

        if (
            inputPer1MTokens === undefined
            && outputPer1MTokens === undefined
            && imageOutputPer1MTokens === undefined
        ) {
            continue;
        }

        for (const modelId of section.modelIds) {
            results.push({
                provider: "google_gemini",
                modelId,
                currency: "USD",
                sourceUrl,
                fetchedAt,
                tier: "paid",
                mode: "standard",
                unit: "per_1m_tokens",
                inputPer1MTokens,
                outputPer1MTokens,
                imageOutputPer1MTokens,
                outputImageTokens,
            });
        }
    }

    return results;
}

export async function fetchGoogleGeminiPricingCatalog(input: {
    fetchImpl?: typeof fetch;
    fetchedAt?: Date;
} = {}): Promise<GoogleGeminiModelPricing[]> {
    const fetchImpl = input.fetchImpl || fetch;
    const response = await fetchImpl(GOOGLE_GEMINI_PRICING_URL, {
        headers: {
            accept: "text/html,application/xhtml+xml",
            "accept-language": "en",
        },
    });
    if (!response.ok) {
        throw new Error(`Google Gemini pricing fetch failed (${response.status}): ${response.statusText}`);
    }

    return parseGoogleGeminiPricingPage({
        html: await response.text(),
        fetchedAt: input.fetchedAt,
        sourceUrl: GOOGLE_GEMINI_PRICING_URL,
    });
}
