import type { SkillObjective } from "@/lib/ai/runtime/config";

export type ManualDraftRoutingOptions = {
    mode?: "chat" | "deal";
    dealId?: string | null;
    baseDraft?: string | null;
};

export type ManualDraftSkillRouting = {
    forceSkillId: string;
    objectiveHint: SkillObjective;
    reason: string;
};

export function resolveManualDraftSkillRouting(
    instruction?: string | null,
    options?: ManualDraftRoutingOptions
): ManualDraftSkillRouting {
    const text = [
        instruction,
        options?.baseDraft,
        options?.mode,
        options?.dealId ? "deal" : null,
    ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();

    if (/\b(contract|reservation|deposit|signature|sign|closing|close the deal|paperwork)\b/.test(text)) {
        return { forceSkillId: "closer", objectiveHint: "deal_progress", reason: "closing_or_contract_language" };
    }

    if (/\b(offer|counter[-\s]?offer|negotiate|negotiation|lowest|minimum|discount|reduce|price)\b/.test(text)) {
        return { forceSkillId: "negotiator", objectiveHint: "deal_progress", reason: "price_or_offer_language" };
    }

    if (/\b(too expensive|not interested|concern|objection|hesitat|pushback|problem|issue)\b/.test(text)) {
        return { forceSkillId: "objection_handler", objectiveHint: "deal_progress", reason: "objection_language" };
    }

    if (/\b(viewing|view|schedule|appointment|available|availability|slot|time works|tomorrow|today|calendar)\b/.test(text)) {
        return { forceSkillId: "viewing_management", objectiveHint: "book_viewing", reason: "booking_or_viewing_language" };
    }

    if (/\b(recommend|similar|matching|search|find|listing|property options|properties|bedroom|villa|apartment|budget)\b/.test(text)) {
        return { forceSkillId: "property_search", objectiveHint: "listing_alert", reason: "property_search_language" };
    }

    return { forceSkillId: "lead_intake_booking", objectiveHint: "book_viewing", reason: "northstar_default_lead_intake" };
}
