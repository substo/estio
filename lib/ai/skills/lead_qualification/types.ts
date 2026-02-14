export interface BuyerProfile {
    // Demographics
    buyerType: "first_time_buyer" | "investor" | "relocator" | "upgrader" | "downsizer";
    decisionMakers: string[];  // "Self", "Spouse", "Family", "Business Partner"
    nationality?: string;

    // Motivation
    primaryMotivation: "lifestyle" | "investment" | "relocation" | "retirement" | "rental_income";
    urgency: "browsing" | "3_to_6_months" | "1_to_3_months" | "immediate";
    triggerEvent?: string;  // "New job", "New baby", "Selling current home"

    // Financial
    budgetRange: { min: number; max: number };
    financingMethod: "cash" | "mortgage" | "mixed" | "unknown";
    hasMortgageApproval: boolean;

    // Preferences (beyond structured fields)
    mustHaves: string[];        // "Sea view", "Garden", "Quiet area"
    niceToHaves: string[];      // "Pool", "Close to school"
    dealBreakers: string[];     // "No open kitchen", "No ground floor"

    // Engagement
    leadScore: number;          // 1-100
    lastInteractionAt: Date;
    totalInteractions: number;
    responseTimeSec: number;    // Average response time

    // Status
    qualificationStage: "unqualified" | "basic" | "qualified" | "highly_qualified";
    readiness: "cold" | "warm" | "hot" | "ready_to_buy";
}
