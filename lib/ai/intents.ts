export const INTENTS = {
    // Low-risk (Auto-Pilot eligible)
    ACKNOWLEDGMENT: { risk: "low", skill: null, effort: "flash" },
    GREETING: { risk: "low", skill: null, effort: "flash" },
    THANK_YOU: { risk: "low", skill: null, effort: "flash" },

    // Medium-risk (Assisted)
    PROPERTY_QUESTION: { risk: "medium", skill: "property_search", effort: "standard" },
    AVAILABILITY_QUESTION: { risk: "medium", skill: "viewing_management", effort: "standard" },
    GENERAL_QUESTION: { risk: "medium", skill: null, effort: "standard" },
    REQUEST_INFO: { risk: "medium", skill: "property_search", effort: "standard" },
    SCHEDULE_VIEWING: { risk: "medium", skill: "viewing_management", effort: "standard" },
    FOLLOW_UP: { risk: "medium", skill: "lead_qualification", effort: "standard" }, // Qualification usually handles follow-ups
    QUALIFICATION: { risk: "medium", skill: "lead_qualification", effort: "standard" },

    // High-risk (Always Human-in-the-Loop)
    OBJECTION: { risk: "high", skill: "objection_handler", effort: "standard" },
    PRICE_NEGOTIATION: { risk: "high", skill: "negotiator", effort: "premium" },
    OFFER: { risk: "high", skill: "negotiator", effort: "premium" },
    COUNTER_OFFER: { risk: "high", skill: "negotiator", effort: "premium" },
    CONTRACT_REQUEST: { risk: "high", skill: "closer", effort: "premium" },
    COMPLAINT: { risk: "high", skill: null, effort: "premium" },
    LEGAL_QUESTION: { risk: "high", skill: "closer", effort: "premium" },

    // System
    UNKNOWN: { risk: "medium", skill: null, effort: "standard" },
} as const;

export type IntentType = keyof typeof INTENTS;
