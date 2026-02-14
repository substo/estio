import { getModelForTask } from "./model-router";
import { INTENTS, IntentType } from "./intents";
import { callLLM } from "./llm";

const CLASSIFIER_PROMPT = `You are an intent classifier for a real estate CRM.
Classify the user's message into ONE of these intents:

${Object.keys(INTENTS).join(", ")}

Rules:
- If the message mentions a price, offer, or counter-offer → PRICE_NEGOTIATION or OFFER or COUNTER_OFFER
- If the message expresses dissatisfaction or pushback → OBJECTION
- If the message asks about availability or scheduling → SCHEDULE_VIEWING or AVAILABILITY_QUESTION
- If the message is a simple "ok", "thanks", "got it" → ACKNOWLEDGMENT or THANK_YOU
- If the message asks for property details → PROPERTY_QUESTION
- If the message asks for more photos, floorplans, or specific data → REQUEST_INFO
- If unsure → UNKNOWN

Respond with ONLY the intent name, nothing else.`;

export interface ClassificationResult {
    intent: IntentType;
    confidence: number;
    risk: "low" | "medium" | "high";
    suggestedSkill: string | null;
    suggestedEffort: "flash" | "standard" | "premium";
}

/**
 * Classify the intent of a message using a fast model.
 * Cost: ~$0.00005 per classification (negligible).
 */
export async function classifyIntent(
    message: string,
    conversationContext?: string
): Promise<ClassificationResult> {
    const model = getModelForTask("intent_classification");

    const prompt = conversationContext
        ? `${CLASSIFIER_PROMPT}\n\nRecent context:\n${conversationContext}\n\nMessage to classify:\n"${message}"`
        : `${CLASSIFIER_PROMPT}\n\nMessage to classify:\n"${message}"`;

    try {
        const response = await callLLM(model, prompt);
        const intentName = response.trim().toUpperCase() as IntentType;

        const intentConfig = INTENTS[intentName] ?? INTENTS.UNKNOWN;

        return {
            intent: intentName in INTENTS ? intentName : "UNKNOWN",
            confidence: intentName in INTENTS ? 0.9 : 0.5,
            risk: intentConfig.risk as "low" | "medium" | "high",
            suggestedSkill: intentConfig.skill,
            suggestedEffort: intentConfig.effort as "flash" | "standard" | "premium",
        };
    } catch (error) {
        console.error("Intent classification failed:", error);
        // Fail safely to UNKNOWN/Standard
        return {
            intent: "UNKNOWN",
            confidence: 0,
            risk: "medium",
            suggestedSkill: null,
            suggestedEffort: "standard"
        };
    }
}
