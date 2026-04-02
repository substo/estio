import { GoogleGenAI, Modality } from "@google/genai";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import { getLiveModeCapabilities, resolveLiveModelForMode } from "@/lib/viewings/sessions/live-models";
import type { ViewingSessionMode } from "@/lib/viewings/sessions/types";

export type ViewingLiveAuthPayload = {
    provider: "google_gemini_live";
    model: string;
    mode: ViewingSessionMode;
    capabilities: ReturnType<typeof getLiveModeCapabilities>;
    sessionLimits: {
        audioOnlyMinutes: number;
    };
    transport: {
        protocol: "websocket";
        inputAudioMimeType: "audio/pcm;rate=16000";
        outputAudioRateHz: number;
    };
    relay: {
        useBackendRelay: boolean;
    };
};

export async function buildViewingLiveAuthPayload(args: {
    locationId: string;
    mode: ViewingSessionMode;
}): Promise<ViewingLiveAuthPayload> {
    const model = resolveLiveModelForMode(args.mode);
    const capabilities = getLiveModeCapabilities(args.mode);

    return {
        provider: "google_gemini_live",
        model,
        mode: args.mode,
        capabilities,
        sessionLimits: {
            audioOnlyMinutes: 15,
        },
        transport: {
            protocol: "websocket",
            inputAudioMimeType: "audio/pcm;rate=16000",
            outputAudioRateHz: 24000,
        },
        relay: {
            useBackendRelay: true,
        },
    };
}

// Small runtime health probe for backend credentials.
// This avoids exposing long-lived keys to the browser.
export async function validateGeminiLiveCredentialsForLocation(locationId: string): Promise<{
    ok: boolean;
    error?: string;
}> {
    const apiKey = await resolveLocationGoogleAiApiKey(locationId);
    if (!apiKey) {
        return { ok: false, error: "No Google AI API key configured for this location." };
    }

    try {
        const ai = new GoogleGenAI({ apiKey });
        // Lightweight no-op config sanity check (no network call).
        void ai;
        void Modality.AUDIO;
        return { ok: true };
    } catch (error: any) {
        return {
            ok: false,
            error: String(error?.message || "Failed to initialize Gemini Live client."),
        };
    }
}
