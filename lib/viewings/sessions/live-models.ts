import { VIEWING_SESSION_MODES, type ViewingSessionMode } from "@/lib/viewings/sessions/types";

export const GEMINI_LIVE_MODELS = {
    toolHeavyDefault: "gemini-2.5-flash-native-audio-preview-12-2025",
    voicePremiumDefault: "gemini-3.1-flash-live-preview",
} as const;

export const VIEWING_SESSION_STAGE_MODELS = {
    translationDefault: "gemini-2.5-flash",
    insightsDefault: "gemini-2.5-flash",
    summaryDefault: "gemini-2.5-flash",
} as const;

export type ViewingSessionStageModelRouting = {
    live: string;
    translation: string;
    insights: string;
    summary: string;
};

function asString(value: unknown): string {
    return String(value || "").trim();
}

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

export function normalizeViewingSessionStageModel(
    configuredModel: unknown,
    fallbackModel: string
): string {
    return asString(configuredModel) || fallbackModel;
}

export function resolveViewingSessionStageModelsFromSiteConfig(input: {
    mode: ViewingSessionMode;
    liveModel?: unknown;
    translationModel?: unknown;
    insightsModel?: unknown;
    summaryModel?: unknown;
}): ViewingSessionStageModelRouting {
    const live = normalizeViewingSessionStageModel(input.liveModel, resolveLiveModelForMode(input.mode));
    return {
        live,
        translation: normalizeViewingSessionStageModel(input.translationModel, VIEWING_SESSION_STAGE_MODELS.translationDefault),
        insights: normalizeViewingSessionStageModel(input.insightsModel, VIEWING_SESSION_STAGE_MODELS.insightsDefault),
        summary: normalizeViewingSessionStageModel(input.summaryModel, VIEWING_SESSION_STAGE_MODELS.summaryDefault),
    };
}

export function resolveViewingSessionStageModelsFromSession(input: {
    mode: ViewingSessionMode;
    liveModel?: unknown;
    translationModel?: unknown;
    insightsModel?: unknown;
    summaryModel?: unknown;
}): ViewingSessionStageModelRouting {
    return resolveViewingSessionStageModelsFromSiteConfig(input);
}
