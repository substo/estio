export type TranslationStreamEvent =
    | { kind: "inputText" | "outputText"; delta: string }
    | { kind: "audio"; data: string; mimeType: string }
    | { kind: "ready" | "closed" }
    | { kind: "error"; message: string }
    | { kind: "ignored" };

export function mapOpenAiTranslationEvent(event: Record<string, any>): TranslationStreamEvent {
    switch (event.type) {
        case "session.updated": return { kind: "ready" };
        case "session.closed": return { kind: "closed" };
        case "session.input_transcript.delta": return typeof event.delta === "string" ? { kind: "inputText", delta: event.delta } : { kind: "ignored" };
        case "session.output_transcript.delta": return typeof event.delta === "string" ? { kind: "outputText", delta: event.delta } : { kind: "ignored" };
        case "session.output_audio.delta": return typeof event.delta === "string"
            ? { kind: "audio", data: event.delta, mimeType: `audio/pcm;rate=${event.sample_rate || 24000}` }
            : { kind: "ignored" };
        case "error": return { kind: "error", message: String(event.error?.message || "OpenAI translation error.") };
        default: return { kind: "ignored" };
    }
}

export function mapGeminiTranslationMessage(message: Record<string, any>) {
    const parts = Array.isArray(message?.serverContent?.modelTurn?.parts) ? message.serverContent.modelTurn.parts : [];
    return {
        inputText: String(message?.serverContent?.inputTranscription?.text || ""),
        inputFinished: !!message?.serverContent?.inputTranscription?.finished,
        outputText: String(message?.serverContent?.outputTranscription?.text || ""),
        outputFinished: !!message?.serverContent?.outputTranscription?.finished,
        audioChunks: parts.filter((part: any) => String(part?.inlineData?.mimeType || "").startsWith("audio/") && part?.inlineData?.data)
            .map((part: any) => ({ mimeType: String(part.inlineData.mimeType), data: String(part.inlineData.data) })),
    };
}
