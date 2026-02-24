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
- If the message proposes a specific time for a viewing (e.g. "I can come at 11am") → SCHEDULE_VIEWING
- If the message asks for a property location/pin/map/address for a specific listing (especially after viewing interest) → AVAILABILITY_QUESTION
- If the message is a simple "ok", "thanks", "got it" → ACKNOWLEDGMENT or THANK_YOU
- If the message asks for property details → PROPERTY_QUESTION
- If the message states property requirements (e.g. "I want a 2-bed in Paphos") → QUALIFICATION
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
    const normalizedMessage = message.toLowerCase();
    const normalizedContext = (conversationContext || "").toLowerCase();
    const asksForLocationPin =
        /\b(location|address|pin|map)\b/i.test(message) &&
        (/\b(send|share|drop|give)\b/i.test(message) || /\?$/.test(message) || message.length < 80);
    const contextMentionsPropertyRef = /\b[A-Z]{2,4}\d{3,6}\b/i.test(conversationContext || "");
    const contextMentionsViewing = /\bview(?:ing)?\b/i.test(conversationContext || "");
    const contextMentionsScheduling = /\b(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|availab|schedule|time works|what time)\b/i.test(conversationContext || "");
    const looksLikeViewingContext = contextMentionsPropertyRef || contextMentionsViewing || contextMentionsScheduling || /\bproperty\b/i.test(normalizedContext);

    const hasSpecificTime =
        /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i.test(message) ||
        /\b\d{1,2}\s*(?:am|pm)\b/i.test(message);
    const hasSchedulingLanguage =
        /\b(come|view|see|meet|available|availability|tomorrow|today|works?)\b/i.test(message) ||
        /\b(i can|can do|i will come|around|about)\b/i.test(message);
    const proposesSpecificViewingTime = hasSpecificTime && hasSchedulingLanguage;
    const isSchedulingFollowOnMessage = /\b(i will call|will call you|i'll call|ok|okay|sure|great)\b/i.test(message);
    const contextContainsRecentTimeProposal = /\b(?:come|can|around|about|at)\b[\s\S]{0,30}\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(conversationContext || "");

    // Location/pin requests in an active property/viewing thread are operational viewing messages,
    // not recommendation searches. Route to viewing_management so it can resolve logistics first.
    if (asksForLocationPin && (contextMentionsPropertyRef || contextMentionsViewing || /\bthis property\b/i.test(normalizedMessage))) {
        console.log(`[CLASSIFIER] Location/pin request in property context, forcing AVAILABILITY_QUESTION`);
        const intentConfig = INTENTS.AVAILABILITY_QUESTION;
        return {
            intent: "AVAILABILITY_QUESTION",
            confidence: 0.94,
            risk: intentConfig.risk as "low" | "medium" | "high",
            suggestedSkill: intentConfig.skill,
            suggestedEffort: intentConfig.effort as "flash" | "standard" | "premium",
        };
    }

    // Time proposals like "I can come at 11am" in an active viewing thread are scheduling,
    // even if they begin with casual fillers like "ok".
    if (proposesSpecificViewingTime && looksLikeViewingContext) {
        console.log(`[CLASSIFIER] Specific time proposal in viewing context, forcing SCHEDULE_VIEWING`);
        const intentConfig = INTENTS.SCHEDULE_VIEWING;
        return {
            intent: "SCHEDULE_VIEWING",
            confidence: 0.95,
            risk: intentConfig.risk as "low" | "medium" | "high",
            suggestedSkill: intentConfig.skill,
            suggestedEffort: intentConfig.effort as "flash" | "standard" | "premium",
        };
    }

    // Follow-up confirmations like "I will call you" often arrive right after a time proposal.
    // If the thread is clearly scheduling a viewing and the context already contains a proposed time,
    // keep routing to viewing_management so calendar validation still happens.
    if (isSchedulingFollowOnMessage && contextContainsRecentTimeProposal && looksLikeViewingContext) {
        console.log(`[CLASSIFIER] Scheduling follow-up after time proposal, forcing SCHEDULE_VIEWING`);
        const intentConfig = INTENTS.SCHEDULE_VIEWING;
        return {
            intent: "SCHEDULE_VIEWING",
            confidence: 0.9,
            risk: intentConfig.risk as "low" | "medium" | "high",
            suggestedSkill: intentConfig.skill,
            suggestedEffort: intentConfig.effort as "flash" | "standard" | "premium",
        };
    }

    // ── PRE-CHECK: Explicit property reference patterns ──
    // Matches refs like DT3762, DT1234, VP500, etc. (2-3 letter prefix + 3-5 digits)
    const propertyRefPattern = /\b[A-Z]{2,3}\d{3,5}\b/i;
    if (propertyRefPattern.test(message)) {
        console.log(`[CLASSIFIER] Property reference detected in message, forcing PROPERTY_QUESTION`);
        const intentConfig = INTENTS.PROPERTY_QUESTION;
        return {
            intent: "PROPERTY_QUESTION",
            confidence: 0.95,
            risk: intentConfig.risk as "low" | "medium" | "high",
            suggestedSkill: intentConfig.skill,
            suggestedEffort: intentConfig.effort as "flash" | "standard" | "premium",
        };
    }

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
