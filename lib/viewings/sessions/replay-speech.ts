import type { ReplaySpeechModel } from "./replay-speech-options";

export function replaySpeechCost(model: ReplaySpeechModel, inputTokens: number, outputTokens: number, at = new Date()) {
    // https://ai.google.dev/gemini-api/docs/pricing, verified 2026-10-13.
    const is2027 = at.getTime() >= Date.UTC(2027, 0, 1);
    const inputPerMillion = is2027 ? 1 : 0.5;
    const outputPerMillion = model === "gemini-3.8-flash-lite-tts" ? (is2027 ? 12 : 6) : (is2027 ? 18 : 9);
    return (Math.max(0, inputTokens) * inputPerMillion + Math.max(0, outputTokens) * outputPerMillion) / 1_000_000;
}

export function replaySpeechUsage(payload: unknown) {
    const usage = (payload as { usage?: { total_input_tokens?: number; total_output_tokens?: number } })?.usage;
    const inputTokens = Number(usage?.total_input_tokens);
    const outputTokens = Number(usage?.total_output_tokens);
    return {
        inputTokens: Number.isFinite(inputTokens) && inputTokens >= 0 ? inputTokens : 0,
        outputTokens: Number.isFinite(outputTokens) && outputTokens >= 0 ? outputTokens : 0,
        providerReported: Number.isFinite(inputTokens) && Number.isFinite(outputTokens),
    };
}

export function replaySpeechAudio(payload: unknown): Buffer | null {
    const steps = (payload as { steps?: Array<{ type?: string; content?: Array<{ type?: string; data?: string }> }> })?.steps;
    const data = steps?.flatMap((step) => step.type === "model_output" ? step.content || [] : [])
        .find((item) => item.type === "audio" && typeof item.data === "string")?.data;
    if (!data || data.length > 20_000_000) return null;
    const audio = Buffer.from(data, "base64");
    return audio.length >= 44 && audio.toString("ascii", 0, 4) === "RIFF" && audio.toString("ascii", 8, 12) === "WAVE" ? audio : null;
}

export function estimateReplaySpeechTokens(text: string, audio: Buffer) {
    // Google documents 25 output tokens per second for its TTS pricing equivalence.
    // Unary WAV defaults to 24 kHz, mono, 16-bit PCM; read the actual header when present.
    const sampleRate = audio.readUInt32LE(24);
    const channels = audio.readUInt16LE(22);
    const bitsPerSample = audio.readUInt16LE(34);
    const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
    const seconds = bytesPerSecond > 0 ? Math.max(0, audio.length - 44) / bytesPerSecond : 0;
    return { inputTokens: Math.max(1, Math.ceil(text.length / 4)), outputTokens: Math.max(1, Math.ceil(seconds * 25)), seconds };
}
