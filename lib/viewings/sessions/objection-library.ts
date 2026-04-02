export type ViewingObjectionTemplate = {
    category: string;
    triggerPhrases: string[];
    responseTemplates: string[];
    softRebuttalTemplates: string[];
    followUpQuestions: string[];
    pivotWhen: string[];
    avoidPushWhen: string[];
};

export const VIEWING_OBJECTION_LIBRARY: ViewingObjectionTemplate[] = [
    {
        category: "price",
        triggerPhrases: ["too expensive", "price is high", "over budget", "can't afford"],
        responseTemplates: [
            "Totally fair. Let me break down where the price is strongest compared to nearby options.",
            "Understood. We can also explore flexible scenarios and nearby alternatives in your range.",
        ],
        softRebuttalTemplates: [
            "If the layout and location fit, we can discuss room for negotiation with the owner.",
        ],
        followUpQuestions: [
            "What monthly or total budget feels comfortable for you right now?",
        ],
        pivotWhen: ["budget gap remains unresolved after clarification"],
        avoidPushWhen: ["client repeats hard budget cap"],
    },
    {
        category: "condition",
        triggerPhrases: ["needs renovation", "too old", "condition worries", "unfinished"],
        responseTemplates: [
            "That concern makes sense. I can clarify what has been updated and what still needs work.",
        ],
        softRebuttalTemplates: [
            "If location and layout are right, we can compare this with a cleaner-finish backup option.",
        ],
        followUpQuestions: [
            "Which part concerns you most, renovation cost or move-in readiness?",
        ],
        pivotWhen: ["move-in readiness is mandatory"],
        avoidPushWhen: ["client explicitly refuses renovation projects"],
    },
    {
        category: "furniture",
        triggerPhrases: ["too much furniture", "furniture is not suitable", "furnished issue"],
        responseTemplates: [
            "Understood. We can check owner flexibility on removing or replacing selected furniture items.",
        ],
        softRebuttalTemplates: [
            "If you like the fundamentals, furniture is often one of the easier issues to solve.",
        ],
        followUpQuestions: [
            "Which pieces would you want removed first?",
        ],
        pivotWhen: ["owner flexibility is low"],
        avoidPushWhen: ["furniture is a hard deal-breaker for client"],
    },
    {
        category: "location",
        triggerPhrases: ["not sure about area", "location is not ideal", "too far"],
        responseTemplates: [
            "Makes sense. Let’s compare commute, amenities, and rental potential against nearby alternatives.",
        ],
        softRebuttalTemplates: [
            "If this location is borderline, I can pull options in your preferred zone with similar specs.",
        ],
        followUpQuestions: [
            "What is your top priority for location: commute, schools, or investment demand?",
        ],
        pivotWhen: ["location preference is strict"],
        avoidPushWhen: ["client strongly rejects the area"],
    },
];
