import { LIVE_ASSIST_LANGUAGE_OPTIONS } from "./live-assist-languages";

// Missing language retains automatic detection for existing callers.
export function resolveTranscriptionLanguage(value: string): string | null | undefined {
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === "auto") return null;
    return LIVE_ASSIST_LANGUAGE_OPTIONS.some((option) => option.value === normalized) ? normalized : undefined;
}

export function transcriptionPrompt(language: string | null): string {
    return [
        "Transcribe this audio verbatim in the spoken language. Return plain text only. Do not summarize or translate.",
        language ? `The expected spoken language is ${language}.` : "Detect the spoken language automatically.",
    ].join(" ");
}
