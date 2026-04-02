import { VIEWING_SESSION_MODES, type ViewingSessionMode } from "@/lib/viewings/sessions/types";

export const GEMINI_LIVE_MODELS = {
    toolHeavyDefault: "gemini-2.5-flash-native-audio-preview-12-2025",
    voicePremiumDefault: "gemini-3.1-flash-live-preview",
} as const;

export function resolveLiveModelForMode(mode: ViewingSessionMode): string {
    if (mode === VIEWING_SESSION_MODES.assistantLiveVoicePremium) {
        return GEMINI_LIVE_MODELS.voicePremiumDefault;
    }
    return GEMINI_LIVE_MODELS.toolHeavyDefault;
}

export function getLiveModeCapabilities(mode: ViewingSessionMode) {
    const model = resolveLiveModelForMode(mode);
    if (mode === VIEWING_SESSION_MODES.assistantLiveVoicePremium) {
        return {
            mode,
            model,
            asyncFunctionCalling: false,
            supportsProactiveAudio: false,
            supportsAffectiveDialogue: false,
            responseModalities: ["audio", "text"],
            notes: "Gemini 3.1 Live mode prioritizes low-latency voice quality with synchronous tool calls.",
        };
    }

    return {
        mode,
        model,
        asyncFunctionCalling: true,
        supportsProactiveAudio: true,
        supportsAffectiveDialogue: true,
        responseModalities: ["audio", "text"],
        notes: "Gemini 2.5 Live mode supports async function calling and tool-heavy copilot flows.",
    };
}

export function estimateLiveAudioCostUsd(inputMinutes: number, outputMinutes: number): number {
    const inbound = Math.max(0, Number(inputMinutes || 0));
    const outbound = Math.max(0, Number(outputMinutes || 0));
    // Planning estimate from spec:
    // input audio: ~$0.005/min, output audio: ~$0.018/min.
    return (inbound * 0.005) + (outbound * 0.018);
}
