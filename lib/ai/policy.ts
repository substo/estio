export interface PolicyInput {
    intent: string;
    risk: string;
    actions: any[];
    draftReply: string | null;
    dealStage?: string;
}

export interface PolicyResult {
    approved: boolean;
    reason: string;
    violations: string[];
    requiredApprovals: string[];
}

const RULES = [
    {
        name: "no_price_disclosure",
        check: (input: PolicyInput) => {
            // Regex to catch phrases like "owner's bottom price is", "lowest he will go is"
            if (input.draftReply?.match(/owner('s)?\s+(minimum|bottom|lowest|asking|price)\s+(is|would be)/i)) {
                return "VIOLATION: Draft may disclose owner's private pricing information";
            }
            return null;
        },
    },
    {
        name: "contract_requires_manager",
        check: (input: PolicyInput) => {
            const hasContractAction = input.actions.some(a =>
                a.name === "generate_contract" || a.name === "send_for_signature"
            );
            if (hasContractAction) {
                return "REQUIRES_APPROVAL: Contract actions require manager sign-off";
            }
            return null;
        },
    },
    {
        name: "high_risk_requires_human",
        check: (input: PolicyInput) => {
            if (input.risk === "high") {
                return "REQUIRES_APPROVAL: High-risk intent requires human review before sending";
            }
            return null;
        },
    },
    {
        name: "no_legal_advice",
        check: (input: PolicyInput) => {
            if (input.draftReply?.match(/legal(ly)?|lawyer|contract\s+clause|liability/i) &&
                input.intent !== "CONTRACT_REQUEST") {
                return "WARNING: Draft may contain legal advice. Agent should recommend consulting a lawyer.";
            }
            return null;
        },
    },
    {
        name: "no_discriminatory_language",
        check: (input: PolicyInput) => {
            // Fair Housing Act compliance
            const discriminatoryTerms = /\b(race|religion|national origin|familial status|disability|sex)\b/i;
            if (input.draftReply?.match(discriminatoryTerms)) {
                return "VIOLATION: Draft may contain discriminatory language (Fair Housing Act)";
            }
            return null;
        },
    },
];

/**
 * Validate proposed actions against business rules.
 * Returns approval status and any violations.
 */
export async function validateAction(input: PolicyInput): Promise<PolicyResult> {
    const violations: string[] = [];
    const requiredApprovals: string[] = [];

    for (const rule of RULES) {
        const result = rule.check(input);
        if (result) {
            if (result.startsWith("VIOLATION:")) {
                violations.push(result);
            } else if (result.startsWith("REQUIRES_APPROVAL:")) {
                requiredApprovals.push(result);
            } else if (result.startsWith("WARNING:")) {
                // Just log or maybe append to reasoning, effectively a specialized violation/info
                requiredApprovals.push(result);
            }
        }
    }

    return {
        approved: violations.length === 0,
        reason: violations.length > 0
            ? `Blocked: ${violations.join("; ")}`
            : requiredApprovals.length > 0
                ? `Needs approval: ${requiredApprovals.join("; ")}`
                : "All checks passed",
        violations,
        requiredApprovals,
    };
}
