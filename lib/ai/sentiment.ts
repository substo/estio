import { getModelForTask } from "./model-router";
import { callLLM } from "./llm";

export interface SentimentResult {
    score: number;      // -1 (very negative) to 1 (very positive)
    urgency: "low" | "medium" | "high" | "critical";
    emotion: "neutral" | "excited" | "frustrated" | "anxious" | "angry" | "happy";
    buyerReadiness: "cold" | "warm" | "hot" | "ready_to_buy";
}

const SENTIMENT_PROMPT = `Analyze this real estate conversation message.

Return JSON:
{
  "score": <float -1 to 1>,
  "urgency": "<low|medium|high|critical>",
  "emotion": "<neutral|excited|frustrated|anxious|angry|happy>",
  "buyerReadiness": "<cold|warm|hot|ready_to_buy>"
}

Rules:
- "ready_to_buy" = explicit offer, asking for contract, wants to proceed
- "hot" = asking for viewings, comparing options actively
- "warm" = engaged but still exploring
- "cold" = just browsing, non-committal

Message: "{message}"`;

export async function analyzeSentiment(message: string): Promise<SentimentResult> {
    const model = getModelForTask("sentiment_analysis"); // Will default to Flash if not in map, but we'll update router next

    try {
        const response = await callLLM(
            model,
            SENTIMENT_PROMPT.replace("{message}", message),
            undefined,
            { jsonMode: true }
        );
        return JSON.parse(response);
    } catch (error) {
        console.error("Sentiment analysis failed:", error);
        return {
            score: 0,
            urgency: "low",
            emotion: "neutral",
            buyerReadiness: "cold"
        };
    }
}
