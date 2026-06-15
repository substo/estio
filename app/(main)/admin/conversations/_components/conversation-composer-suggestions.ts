const MAX_COMPOSER_SUGGESTION_BUBBLES = 5;

export function buildComposerSuggestionBubbles(
    serverSuggestions: string[] | null | undefined,
    quickActions: string[] | null | undefined,
    maxSuggestions = MAX_COMPOSER_SUGGESTION_BUBBLES,
): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];

    for (const raw of [...(serverSuggestions || []), ...(quickActions || [])]) {
        const text = String(raw || "").trim();
        if (!text) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(text);
        if (merged.length >= maxSuggestions) break;
    }

    return merged;
}
