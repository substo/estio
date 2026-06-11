import { normalizeReplyLanguage } from "@/lib/ai/reply-language-options";

export type ParsedTranslationModelOutput = {
    translatedText: string;
    detectedSourceLanguage: string | null;
    confidence: number | null;
};

function stripModelCodeFences(rawText: string): string {
    return String(rawText || "")
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
}

function sanitizeLlmJson(input: string): string {
    let inString = false;
    let isEscaped = false;
    let sanitized = "";

    for (let i = 0; i < input.length; i++) {
        const char = input[i];

        if (char === "\\" && !isEscaped) {
            isEscaped = true;
            sanitized += char;
            continue;
        }

        if (char === "\"" && !isEscaped) {
            inString = !inString;
            sanitized += char;
        } else if (inString) {
            if (char === "\n") sanitized += "\\n";
            else if (char === "\r") sanitized += "\\r";
            else if (char === "\t") sanitized += "\\t";
            else if (char === "\f") sanitized += "\\f";
            else if (char === "\b") sanitized += "\\b";
            else sanitized += char;
        } else {
            sanitized += char;
        }

        isEscaped = false;
    }

    return sanitized;
}

function parseJsonObjectFromModelOutput(rawText: string): any {
    const cleanJson = stripModelCodeFences(rawText);
    const sanitizedJson = sanitizeLlmJson(cleanJson);

    try {
        return JSON.parse(sanitizedJson);
    } catch {
        const firstBrace = sanitizedJson.indexOf("{");
        const lastBrace = sanitizedJson.lastIndexOf("}");
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            try {
                return JSON.parse(sanitizedJson.slice(firstBrace, lastBrace + 1));
            } catch {
                // Continue to field extraction/fallback below.
            }
        }
        throw new Error("Model did not return a valid JSON object");
    }
}

function decodeJsonStringEscape(char: string, nextFour: string): { value: string; consumed: number } {
    if (char === "n") return { value: "\n", consumed: 1 };
    if (char === "r") return { value: "\r", consumed: 1 };
    if (char === "t") return { value: "\t", consumed: 1 };
    if (char === "b") return { value: "\b", consumed: 1 };
    if (char === "f") return { value: "\f", consumed: 1 };
    if (char === "\"" || char === "\\" || char === "/") return { value: char, consumed: 1 };
    if (/^[0-9a-fA-F]{4}$/.test(nextFour)) {
        return { value: String.fromCharCode(parseInt(nextFour, 16)), consumed: 5 };
    }
    return { value: char, consumed: 1 };
}

function extractJsonStringField(rawText: string, fieldName: string): string | null {
    const source = stripModelCodeFences(rawText);
    const fieldPattern = new RegExp(`"${fieldName}"\\s*:\\s*"`);
    const match = fieldPattern.exec(source);
    if (!match) return null;

    let value = "";
    let escaped = false;
    for (let i = match.index + match[0].length; i < source.length; i++) {
        const char = source[i];
        if (escaped) {
            const decoded = decodeJsonStringEscape(char, source.slice(i + 1, i + 5));
            value += decoded.value;
            i += decoded.consumed - 1;
            escaped = false;
            continue;
        }
        if (char === "\\") {
            escaped = true;
            continue;
        }
        if (char === "\"") {
            return value.trim() || null;
        }
        value += char;
    }

    return value.trim() || null;
}

export function isJsonEnvelopeTranslationText(value: string | null | undefined): boolean {
    const text = stripModelCodeFences(String(value || ""));
    return text.startsWith("{") && /"translatedText"\s*:/.test(text);
}

export function isUsableMessageTranslationText(value: string | null | undefined): boolean {
    const text = String(value || "").trim();
    if (!text) return false;
    return !isJsonEnvelopeTranslationText(text);
}

export function parseTranslationModelOutput(rawText: string): ParsedTranslationModelOutput {
    let parsed: any;
    try {
        parsed = parseJsonObjectFromModelOutput(rawText);
    } catch {
        const extractedTranslatedText = extractJsonStringField(rawText, "translatedText");
        if (extractedTranslatedText) {
            const extractedSourceLanguage = normalizeReplyLanguage(extractJsonStringField(rawText, "detectedSourceLanguage"));
            return {
                translatedText: extractedTranslatedText,
                detectedSourceLanguage: extractedSourceLanguage,
                confidence: null,
            };
        }

        const fallbackText = stripModelCodeFences(rawText);
        if (!fallbackText || isJsonEnvelopeTranslationText(fallbackText)) {
            throw new Error("Model did not return a valid translation.");
        }
        return {
            translatedText: fallbackText,
            detectedSourceLanguage: null,
            confidence: null,
        };
    }

    if (typeof parsed === "string") {
        const translatedText = parsed.trim();
        if (!translatedText) {
            throw new Error("Translation model returned empty output.");
        }
        return {
            translatedText,
            detectedSourceLanguage: null,
            confidence: null,
        };
    }

    const translatedText = String((parsed as any)?.translatedText || "").trim();
    if (!translatedText) {
        throw new Error("Translation model returned empty output.");
    }

    const detectedSourceLanguage = normalizeReplyLanguage(String((parsed as any)?.detectedSourceLanguage || "").trim()) || null;
    const confidenceRaw = Number((parsed as any)?.confidence);
    const confidence = Number.isFinite(confidenceRaw)
        ? Math.min(1, Math.max(0, confidenceRaw))
        : null;

    return { translatedText, detectedSourceLanguage, confidence };
}
