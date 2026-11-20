import type { TextExecutionContext } from "./runtime/text-execution";
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

export async function analyzeSentiment(message: string, locationId?: string, textExecution?: TextExecutionContext): Promise<SentimentResult> {
    const model = textExecution?.model || null; // requester pick, else the Location chain

    try {
        const response = await callLLM(
            model,
            SENTIMENT_PROMPT.replace("{message}", message),
            undefined,
            { executionMode: textExecution?.executionMode, jsonMode: true, locationId, modelSelection: textExecution?.model ? "explicit" : "hint" }
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
