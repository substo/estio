export type QuickAssistCostStatus = "estimated" | "unavailable" | "subscription";
export type QuickAssistRate = {
    input: number; output: number; audioInput?: number; audioOutput?: number; cachedInput?: number; cachedAudioInput?: number;
    perMinute?: number; sourceUrl: string; verifiedAt: string;
};

const googleSource = "https://ai.google.dev/gemini-api/docs/pricing";
const openaiSource = "https://developers.openai.com/api/docs/pricing";
// Standard paid-tier rates verified against the provider pages on this date.
// Free-tier allowances, tax, and subscription charges are not allocated per call.
export const QUICK_ASSIST_RATES: Record<string, QuickAssistRate> = {
    "gemini-2.5-flash": { input: .30, audioInput: 1, output: 2.50, cachedInput: .03, cachedAudioInput: .10, sourceUrl: googleSource, verifiedAt: "2026-10-09" },
    "gemini-2.5-flash-lite": { input: .10, audioInput: .30, output: .40, cachedInput: .01, cachedAudioInput: .03, sourceUrl: googleSource, verifiedAt: "2026-10-09" },
    "gemini-3.5-live-translate-preview": { input: 3.50, output: 21, audioInput: 3.50, audioOutput: 21, sourceUrl: googleSource, verifiedAt: "2026-10-09" },
    "gpt-4o-mini": { input: .15, output: .60, cachedInput: .075, sourceUrl: "https://developers.openai.com/api/docs/models/gpt-4o-mini", verifiedAt: "2026-10-09" },
    "gpt-4o-mini-transcribe": { input: 1.25, output: 5, sourceUrl: openaiSource, verifiedAt: "2026-10-09" },
    "gpt-4o-transcribe": { input: 2.50, output: 10, sourceUrl: openaiSource, verifiedAt: "2026-10-09" },
    "gpt-realtime-whisper": { input: 0, output: 0, perMinute: .017, sourceUrl: openaiSource, verifiedAt: "2026-10-09" },
    "gpt-realtime-translate": { input: 0, output: 0, perMinute: .034, sourceUrl: openaiSource, verifiedAt: "2026-10-09" },
};

export function formatQuickAssistCost(amount: number) {
    return amount === 0 ? "$0.00" : amount < .01 ? `$${amount.toFixed(6)}` : `$${amount.toFixed(4)}`;
}

export function quickAssistRateLabel(model: string, audio = false): string {
    if (model.startsWith("chatgpt_subscription:")) return "Uses your connected subscription; API cost is not assigned per call.";
    const rate = QUICK_ASSIST_RATES[model.replace(/^openai:/, "")];
    if (!rate) return "Rate unavailable; usage will still be recorded.";
    if (rate.perMinute !== undefined) return `$${rate.perMinute}/minute of input audio${model === "gpt-realtime-translate" ? " + $0.017/minute for original captions" : ""}`;
    return `$${audio ? rate.audioInput ?? rate.input : rate.input} input / $${rate.audioOutput ?? rate.output} output per 1M tokens`;
}

const count = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
export function estimateQuickAssistCost(input: {
    model: string; inputTokens: number; outputTokens: number; cachedInputTokens?: number;
    inputAudioTokens?: number; outputAudioTokens?: number; cachedAudioInputTokens?: number; inputAudioSeconds?: number;
    usageAvailable?: boolean;
}) {
    const model = input.model.replace(/^openai:/, "");
    const rate = QUICK_ASSIST_RATES[model];
    if (model.startsWith("chatgpt_subscription:")) return { amount: 0, status: "subscription" as QuickAssistCostStatus, calculation: "Connected subscription; no per-call API charge allocated." };
    if (!rate || input.usageAvailable === false) return { amount: 0, status: "unavailable" as QuickAssistCostStatus, calculation: "Provider usage or verified pricing is unavailable." };
    if (rate.perMinute !== undefined) {
        const seconds = count(input.inputAudioSeconds);
        return { amount: seconds / 60 * rate.perMinute, status: "estimated" as QuickAssistCostStatus, calculation: `${seconds.toFixed(2)} seconds ÷ 60 × $${rate.perMinute}/minute`, rate };
    }
    const audioIn = Math.min(count(input.inputAudioTokens), count(input.inputTokens));
    const audioOut = Math.min(count(input.outputAudioTokens), count(input.outputTokens));
    const cachedAudio = Math.min(count(input.cachedAudioInputTokens), audioIn);
    const cached = Math.min(count(input.cachedInputTokens), count(input.inputTokens) - audioIn);
    const textIn = count(input.inputTokens) - audioIn - cached;
    const textOut = count(input.outputTokens) - audioOut;
    const amount = (textIn * rate.input + cached * (rate.cachedInput ?? rate.input) + (audioIn - cachedAudio) * (rate.audioInput ?? rate.input) + cachedAudio * (rate.cachedAudioInput ?? rate.audioInput ?? rate.input)
        + textOut * rate.output + audioOut * (rate.audioOutput ?? rate.output)) / 1_000_000;
    return { amount, status: "estimated" as QuickAssistCostStatus, rate,
        calculation: `${textIn} input × $${rate.input} + ${audioIn - cachedAudio} audio input × $${rate.audioInput ?? rate.input} + ${cachedAudio} cached audio × $${rate.cachedAudioInput ?? rate.audioInput ?? rate.input} + ${cached} cached × $${rate.cachedInput ?? rate.input} + ${textOut} output × $${rate.output} + ${audioOut} audio output × $${rate.audioOutput ?? rate.output}, divided by 1M` };
}

export function googleUsageCounts(usage: any, audioInput = false, audioOutput = false) {
    const inputTokens = count(usage?.promptTokenCount) + count(usage?.toolUsePromptTokenCount);
    const outputTokens = Math.max(count(usage?.candidatesTokenCount ?? usage?.responseTokenCount) + count(usage?.thoughtsTokenCount), count(usage?.totalTokenCount) - inputTokens);
    const modality = (details: any[] | undefined, kind: string) => (Array.isArray(details) ? details : []).filter(d => String(d.modality).toLowerCase() === kind).reduce((sum, d) => sum + count(d.tokenCount), 0);
    return { inputTokens, outputTokens, cachedInputTokens: Math.max(0, count(usage?.cachedContentTokenCount) - modality(usage?.cacheTokensDetails, "audio")), cachedAudioInputTokens: modality(usage?.cacheTokensDetails, "audio"),
        inputAudioTokens: Array.isArray(usage?.promptTokensDetails) ? modality(usage.promptTokensDetails, "audio") : audioInput ? inputTokens : 0,
        outputAudioTokens: Array.isArray(usage?.responseTokensDetails ?? usage?.candidatesTokensDetails) ? modality(usage.responseTokensDetails ?? usage.candidatesTokensDetails, "audio") : audioOutput ? outputTokens : 0,
        usageAvailable: !!usage && (inputTokens + outputTokens > 0) };
}
