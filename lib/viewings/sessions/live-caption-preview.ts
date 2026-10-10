export type LiveCaptionPreview = {
    channel: "input" | "output";
    targetLanguage: string;
    text: string;
    updatedAt: number;
};

export type LiveCaptionPreviews = Record<string, LiveCaptionPreview>;

export function appendLiveCaptionText(previousText: unknown, nextText: unknown): string {
    const previous = String(previousText || "").trim();
    const next = String(nextText || "").trim();
    if (!previous) return next;
    if (!next) return previous;
    if (next.startsWith(previous)) return next;
    if (previous.endsWith(next)) return previous;

    const needsSpace = !/\s$/.test(previous) && !/^[,.;:!?)]/.test(next);
    return `${previous}${needsSpace ? " " : ""}${next}`.replace(/\s+/g, " ").trim();
}

export function liveCaptionPreviewKey(channel: "input" | "output", targetLanguage: string): string {
    return channel === "input" ? "input" : `output:${targetLanguage.toLowerCase()}`;
}

export function applyLiveCaptionPreview(
    current: LiveCaptionPreviews,
    update: { channel: "input" | "output"; targetLanguage: string; text: string; updatedAt: number }
): LiveCaptionPreviews {
    const key = liveCaptionPreviewKey(update.channel, update.targetLanguage);
    return {
        ...current,
        [key]: {
            ...update,
            text: appendLiveCaptionText(current[key]?.text, update.text),
        },
    };
}

export function reconcileLiveCaptionPreview(
    current: LiveCaptionPreviews,
    message: { speaker: string; origin?: string | null; originalText: string; targetLanguage?: string | null }
): LiveCaptionPreviews {
    if (message.origin !== "relay_live_transcript") return current;
    const channel = message.speaker === "system" ? "output" : "input";
    const key = liveCaptionPreviewKey(channel, message.targetLanguage || "");
    const preview = current[key];
    if (!preview || !message.originalText.trim().includes(preview.text)) return current;
    const next = { ...current };
    delete next[key];
    return next;
}
