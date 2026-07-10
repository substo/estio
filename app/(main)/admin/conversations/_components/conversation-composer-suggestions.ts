const MAX_COMPOSER_SUGGESTION_BUBBLES = 5;
const STRAY_SUGGESTION_ARRAY_TOKEN_PATTERN = /^[\[\],;]+$/;

function trimSuggestionShell(text: string): string {
    let next = text.trim().replace(/^[\s,[;]+/, "").replace(/[\s,\];]+$/, "").trim();
    if (
        next.length >= 2
        && ((next.startsWith("\"") && next.endsWith("\"")) || (next.startsWith("'") && next.endsWith("'")))
    ) {
        next = next.slice(1, -1).trim();
    }
    return next;
}

function expandSuggestionInput(raw: string): string[] {
    const text = String(raw || "").trim();
    if (!text || STRAY_SUGGESTION_ARRAY_TOKEN_PATTERN.test(text)) return [];

    const jsonish = text.replace(/;+\s*$/, "");
    if (jsonish.startsWith("[") && jsonish.endsWith("]")) {
        try {
            const parsed = JSON.parse(jsonish);
            if (Array.isArray(parsed)) {
                return parsed.flatMap((item) => expandSuggestionInput(String(item || "")));
            }
        } catch {
            // Fall through to shell trimming for malformed legacy suggestions.
        }
    }

    const cleaned = trimSuggestionShell(text);
    return cleaned && !STRAY_SUGGESTION_ARRAY_TOKEN_PATTERN.test(cleaned) ? [cleaned] : [];
}

export function buildComposerSuggestionBubbles(
    serverSuggestions: string[] | null | undefined,
    quickActions: string[] | null | undefined,
    maxSuggestions = MAX_COMPOSER_SUGGESTION_BUBBLES,
): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];

    for (const raw of [...(serverSuggestions || []), ...(quickActions || [])]) {
        for (const text of expandSuggestionInput(String(raw || ""))) {
            const key = text.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(text);
            if (merged.length >= maxSuggestions) break;
        }
        if (merged.length >= maxSuggestions) break;
    }

    return merged;
}
