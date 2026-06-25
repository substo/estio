type TranslationCompletenessResult = {
    ok: boolean;
    reason?: string;
};

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;

function extractUrls(text: string): string[] {
    return String(text || "").match(URL_PATTERN) || [];
}

function normalizeUrlForComparison(url: string): string {
    return String(url || "").trim().replace(/[.,;:!?]+$/g, "");
}

export function validateReplyTranslationCompleteness(args: {
    sourceText: string;
    translatedText: string;
}): TranslationCompletenessResult {
    const sourceText = String(args.sourceText || "").trim();
    const translatedText = String(args.translatedText || "").trim();

    if (!sourceText || !translatedText) {
        return { ok: false, reason: "empty_translation" };
    }

    const sourceUrls = extractUrls(sourceText).map(normalizeUrlForComparison);
    const translatedUrls = new Set(extractUrls(translatedText).map(normalizeUrlForComparison));
    const missingUrls = sourceUrls.filter((url) => url && !translatedUrls.has(url));
    if (missingUrls.length > 0) {
        return { ok: false, reason: "missing_source_urls" };
    }

    if (sourceText.length >= 500) {
        const ratio = translatedText.length / sourceText.length;
        if (ratio < 0.5) {
            return { ok: false, reason: "translation_too_short" };
        }
    }

    return { ok: true };
}
