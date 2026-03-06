import { normalizeLanguageTag } from "./prompts/communication-policy";

export interface PolicyInput {
    intent: string;
    risk: string;
    actions: any[];
    draftReply: string | null;
    dealStage?: string;
    expectedLanguage?: string | null;
    latestInboundLanguage?: string | null;
    draftLanguage?: string | null;
    hasConfirmedReservation?: boolean;
    hasConfirmedDeposit?: boolean;
    hasCompetingOfferEvidence?: boolean;
    authoritySource?: "owner_confirmed" | "manager_confirmed" | "team_confirmed" | "none" | string | null;
}

export interface PolicyResult {
    approved: boolean;
    reason: string;
    violations: string[];
    requiredApprovals: string[];
    warnings: string[];
    reviewRequired: boolean;
}

type PolicyRule = {
    name: string;
    check: (input: PolicyInput) => string | null;
};

function baseLanguage(language: string | null | undefined): string | null {
    const normalized = normalizeLanguageTag(language);
    return normalized ? normalized.split("-")[0] : null;
}

function hasConfirmedClosingSignal(input: PolicyInput): boolean {
    return Boolean(input.hasConfirmedReservation || input.hasConfirmedDeposit);
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
        name: "language_match_required",
        check: (input: PolicyInput) => {
            if (!input.draftReply || !input.expectedLanguage) return null;

            const expected = baseLanguage(input.expectedLanguage);
            const draft = baseLanguage(input.draftLanguage);
            if (!expected || !draft) return null;
            if (expected !== draft) {
                return `VIOLATION: Draft language (${draft}) does not match expected contact language (${expected})`;
            }
            return null;
        },
    },
    {
        name: "no_authority_overreach",
        check: (input: PolicyInput) => {
            if (!input.draftReply) return null;
            const authorityConfirmed = ["owner_confirmed", "manager_confirmed", "team_confirmed"].includes(String(input.authoritySource || ""));
            if (authorityConfirmed) return null;

            const authorityOverreachPattern = /\b(i\s+can\s+confirm|we\s+confirm|owner\s+has\s+accepted|final\s+approval\s+is\s+done|offer\s+is\s+accepted)\b/i;
            if (authorityOverreachPattern.test(input.draftReply)) {
                return "VIOLATION: Draft may overstate authority or imply binding acceptance without confirmation";
            }
            return null;
        },
    },
    {
        name: "no_false_finality",
        check: (input: PolicyInput) => {
            if (!input.draftReply || hasConfirmedClosingSignal(input)) return null;
            const finalityPattern = /\b(final\s+price|deal\s+is\s+closed|deal\s+closed|property\s+is\s+gone|property\s+is\s+sold|off\s+the\s+market|not\s+available\s+anymore)\b/i;
            if (finalityPattern.test(input.draftReply)) {
                return "VIOLATION: Draft implies transactional finality without confirmed reservation/deposit";
            }
            return null;
        },
    },
    {
        name: "no_unverified_urgency",
        check: (input: PolicyInput) => {
            if (!input.draftReply || input.hasCompetingOfferEvidence) return null;
            const urgencyPattern = /\b(another\s+offer\s+(has\s+)?(been\s+)?(submitted|received|in\s+progress)|planned\s+deposit|deposit\s+is\s+coming|act\s+now|last\s+chance|pay\s+immediately)\b/i;
            if (urgencyPattern.test(input.draftReply)) {
                return "WARNING: Draft contains urgency cues that are not grounded by explicit context evidence";
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
 ] satisfies PolicyRule[];

/**
 * Validate proposed actions against business rules.
 * Returns approval status and any violations.
 */
export async function validateAction(input: PolicyInput): Promise<PolicyResult> {
    const violations: string[] = [];
    const requiredApprovals: string[] = [];
    const warnings: string[] = [];

    for (const rule of RULES) {
        const result = rule.check(input);
        if (result) {
            if (result.startsWith("VIOLATION:")) {
                violations.push(result);
            } else if (result.startsWith("REQUIRES_APPROVAL:")) {
                requiredApprovals.push(result);
            } else if (result.startsWith("WARNING:")) {
                warnings.push(result);
            }
        }
    }

    const reviewRequired = requiredApprovals.length > 0 || warnings.length > 0;
    const reviewMessages = [...requiredApprovals, ...warnings];

    return {
        approved: violations.length === 0,
        reason: violations.length > 0
            ? `Blocked: ${violations.join("; ")}`
            : reviewMessages.length > 0
                ? `Needs review: ${reviewMessages.join("; ")}`
                : "All checks passed",
        violations,
        requiredApprovals,
        warnings,
        reviewRequired,
    };
}
