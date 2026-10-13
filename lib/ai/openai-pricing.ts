export const OPENAI_PRICING_URL = "https://developers.openai.com/api/docs/pricing";

export type OpenAiModelPricing = {
    provider: "openai_api";
    modelId: string;
    currency: "USD";
    sourceUrl: string;
    fetchedAt: string;
    tier: "paid";
    mode: "standard";
    unit: "per_1m_tokens";
    inputPer1MTokens?: number;
    outputPer1MTokens?: number;
    cachedInputPer1MTokens?: number;
    perMinuteUsd?: number;
};

const MODELS = ["gpt-4o-mini", "gpt-4o-mini-transcribe", "gpt-4o-transcribe", "gpt-realtime-whisper", "gpt-realtime-translate"];

export function parseOpenAiPricingPage(html: string, fetchedAt = new Date()): OpenAiModelPricing[] {
    const decoded = html.replace(/&quot;/g, '"').replace(/&#34;/g, '"');
    const prices: OpenAiModelPricing[] = [];
    for (const modelId of MODELS) {
        // The official pricing page embeds the same table data used to render its rows.
        const escaped = modelId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const textRate = decoded.match(new RegExp(`\\[0,"${escaped}"\\],\\[0,([\\d.]+)\\],\\[0,([\\d.]+|null)\\],\\[0,([\\d.]+)\\]`));
        const audioRate = decoded.match(new RegExp(`"model":\\[0,"${escaped}"\\][\\s\\S]{0,300}?\\$([\\d.]+) \\/ minute`));
        if (!textRate && !audioRate) continue;
        prices.push({
            provider: "openai_api", modelId, currency: "USD", sourceUrl: OPENAI_PRICING_URL,
            fetchedAt: fetchedAt.toISOString(), tier: "paid", mode: "standard", unit: "per_1m_tokens",
            inputPer1MTokens: textRate ? Number(textRate[1]) : undefined,
            cachedInputPer1MTokens: textRate && textRate[2] !== "null" ? Number(textRate[2]) : undefined,
            outputPer1MTokens: textRate ? Number(textRate[3]) : undefined,
            perMinuteUsd: audioRate ? Number(audioRate[1]) : undefined,
        });
    }
    if (!prices.length) throw new Error("OpenAI pricing page had no recognized model rates");
    return prices;
}

export async function fetchOpenAiPricingCatalog(fetchImpl: typeof fetch = fetch): Promise<OpenAiModelPricing[]> {
    const response = await fetchImpl(OPENAI_PRICING_URL, { headers: { accept: "text/html", "accept-language": "en" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`OpenAI pricing fetch failed (${response.status})`);
    return parseOpenAiPricingPage(await response.text());
}
