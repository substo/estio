type RelayTranscriptMessage = {
    id: string;
    origin?: string | null;
    speaker: string;
    originalText: string;
};

export function selectAssistTranscriptRows<T extends RelayTranscriptMessage>(
    messages: T[],
    options: { isTranslateMode: boolean; textDisplay: "both" | "translation" | "hidden" }
): Array<{ message: T; sourceOriginalText: string | null }> {
    if (!options.isTranslateMode) {
        return messages.map((message) => ({ message, sourceOriginalText: null }));
    }

    const sourceByTranslationId = new Map<string, T>();
    const pairedSourceIds = new Set<string>();
    let latestSource: T | null = null;

    for (const message of messages) {
        if (message.origin !== "relay_live_transcript") continue;
        if (message.speaker !== "system") {
            if (message.originalText.trim()) latestSource = message;
            continue;
        }
        if (latestSource && message.originalText.trim()) {
            sourceByTranslationId.set(message.id, latestSource);
            pairedSourceIds.add(latestSource.id);
        }
    }

    return messages
        .filter((message) => {
            if (message.origin !== "relay_live_transcript" || message.speaker === "system") return true;
            return options.textDisplay === "both" ? !pairedSourceIds.has(message.id) : false;
        })
        .map((message) => ({
            message,
            sourceOriginalText: sourceByTranslationId.get(message.id)?.originalText || null,
        }));
}
