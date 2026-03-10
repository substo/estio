type LanguageSource =
    | "conversation_override"
    | "latest_inbound"
    | "contact_preferred"
    | "thread_default"
    | "fallback"
    | "unknown";

export interface CommunicationLanguageResolution {
    expectedLanguage: string | null;
    manualOverrideLanguage: string | null;
    latestInboundLanguage: string | null;
    contactPreferredLanguage: string | null;
    threadDefaultLanguage: string | null;
    source: LanguageSource;
}

export interface ResolveCommunicationLanguageInput {
    manualOverrideLanguage?: string | null;
    latestInboundText?: string | null;
    contactPreferredLanguage?: string | null;
    threadText?: string | null;
    fallbackLanguage?: string | null;
}

export interface BuildCommunicationContractInput {
    expectedLanguage?: string | null;
    latestInboundLanguage?: string | null;
    contactPreferredLanguage?: string | null;
    contextLabel?: string;
}

export interface CommunicationEvidence {
    hasConfirmedReservation: boolean;
    hasConfirmedDeposit: boolean;
    hasCompetingOfferEvidence: boolean;
    authoritySource: "owner_confirmed" | "manager_confirmed" | "team_confirmed" | "none";
}

const LATIN_LANGUAGE_HINTS: Record<string, string[]> = {
    en: ["the", "and", "is", "are", "will", "please", "thanks", "hello", "confirm"],
    es: ["hola", "gracias", "por", "para", "con", "precio", "reserva", "confirmar", "oferta"],
    fr: ["bonjour", "merci", "pour", "avec", "prix", "offre", "reservation", "confirmer", "cordialement"],
    de: ["hallo", "danke", "bitte", "preis", "angebot", "reservierung", "bestatigen", "mit", "und"],
    it: ["ciao", "grazie", "prezzo", "offerta", "prenotazione", "confermare", "per", "con", "e"],
    pt: ["ola", "obrigado", "preco", "oferta", "reserva", "confirmar", "para", "com", "e"],
    tr: ["merhaba", "tesekkur", "fiyat", "teklif", "rezervasyon", "onay", "icin", "ve", "ile"],
};

const GREEK_REGEX = /[\u0370-\u03ff\u1f00-\u1fff]/;
const CYRILLIC_REGEX = /[\u0400-\u04ff]/;
const ARABIC_REGEX = /[\u0600-\u06ff]/;
const HEBREW_REGEX = /[\u0590-\u05ff]/;

function toLanguageDisplayName(language: string | null): string {
    if (!language) return "the contact's language";

    const normalized = normalizeLanguageTag(language);
    if (!normalized) return "the contact's language";

    const base = normalized.split("-")[0];
    const map: Record<string, string> = {
        en: "English",
        el: "Greek",
        es: "Spanish",
        fr: "French",
        de: "German",
        it: "Italian",
        pt: "Portuguese",
        tr: "Turkish",
        ru: "Russian",
        ar: "Arabic",
        he: "Hebrew",
    };
    return map[base] || normalized;
}

export function normalizeLanguageTag(language: string | null | undefined): string | null {
    const raw = String(language || "").trim();
    if (!raw) return null;

    const normalized = raw.replace(/_/g, "-").toLowerCase();
    const match = normalized.match(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/);
    if (!match) return null;

    return normalized;
}

export function detectLanguageFromText(text: string | null | undefined): string | null {
    const value = String(text || "").trim();
    if (!value) return null;

    if (GREEK_REGEX.test(value)) return "el";
    if (CYRILLIC_REGEX.test(value)) return "ru";
    if (ARABIC_REGEX.test(value)) return "ar";
    if (HEBREW_REGEX.test(value)) return "he";

    const tokens = (value.toLowerCase().match(/[a-z\u00c0-\u024f]+/g) || [])
        .map(token => token.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
    if (tokens.length === 0) return null;

    let bestLanguage: string | null = null;
    let bestScore = 0;
    let tieCount = 0;

    for (const [language, hints] of Object.entries(LATIN_LANGUAGE_HINTS)) {
        const set = new Set(hints);
        let score = 0;
        for (const token of tokens) {
            if (set.has(token)) score += 1;
        }

        if (score > bestScore) {
            bestScore = score;
            bestLanguage = language;
            tieCount = 1;
        } else if (score === bestScore && score > 0) {
            tieCount += 1;
        }
    }

    if (!bestLanguage || bestScore === 0 || tieCount > 1) return null;
    return bestLanguage;
}

export function resolveCommunicationLanguage(
    input: ResolveCommunicationLanguageInput
): CommunicationLanguageResolution {
    const manualOverrideLanguage = normalizeLanguageTag(input.manualOverrideLanguage);
    const latestInboundLanguage = detectLanguageFromText(input.latestInboundText);
    const contactPreferredLanguage = normalizeLanguageTag(input.contactPreferredLanguage);
    const threadDefaultLanguage = detectLanguageFromText(input.threadText);
    const fallbackLanguage = normalizeLanguageTag(input.fallbackLanguage);

    if (manualOverrideLanguage) {
        return {
            expectedLanguage: manualOverrideLanguage,
            manualOverrideLanguage,
            latestInboundLanguage,
            contactPreferredLanguage,
            threadDefaultLanguage,
            source: "conversation_override",
        };
    }

    if (contactPreferredLanguage) {
        return {
            expectedLanguage: contactPreferredLanguage,
            manualOverrideLanguage,
            latestInboundLanguage,
            contactPreferredLanguage,
            threadDefaultLanguage,
            source: "contact_preferred",
        };
    }

    if (latestInboundLanguage) {
        return {
            expectedLanguage: latestInboundLanguage,
            manualOverrideLanguage,
            latestInboundLanguage,
            contactPreferredLanguage,
            threadDefaultLanguage,
            source: "latest_inbound",
        };
    }

    if (threadDefaultLanguage) {
        return {
            expectedLanguage: threadDefaultLanguage,
            manualOverrideLanguage,
            latestInboundLanguage,
            contactPreferredLanguage,
            threadDefaultLanguage,
            source: "thread_default",
        };
    }

    if (fallbackLanguage) {
        return {
            expectedLanguage: fallbackLanguage,
            manualOverrideLanguage,
            latestInboundLanguage,
            contactPreferredLanguage,
            threadDefaultLanguage,
            source: "fallback",
        };
    }

    return {
        expectedLanguage: null,
        manualOverrideLanguage,
        latestInboundLanguage,
        contactPreferredLanguage,
        threadDefaultLanguage,
        source: "unknown",
    };
}

export function inferCommunicationEvidenceFromText(text: string | null | undefined): CommunicationEvidence {
    const source = String(text || "");

    const hasConfirmedReservation = /\b(reservation\s+(is\s+)?(confirmed|signed)|signed\s+reservation|reservation\s+agreement\s+signed)\b/i.test(source);
    const hasConfirmedDeposit = /\b(deposit\s+(is\s+)?(received|paid|cleared|confirmed)|funds\s+received)\b/i.test(source);
    const hasCompetingOfferEvidence = /\b(another\s+offer(\s+has)?\s+(been\s+)?(submitted|received|made|in\s+progress)|competing\s+offer|planned\s+deposit)\b/i.test(source);

    let authoritySource: CommunicationEvidence["authoritySource"] = "none";
    if (/\b(owner|landlord)\s+(has\s+)?(confirmed|approved|accepted)\b/i.test(source)) {
        authoritySource = "owner_confirmed";
    } else if (/\b(manager|management)\s+(has\s+)?(confirmed|approved)\b/i.test(source)) {
        authoritySource = "manager_confirmed";
    } else if (/\b(team|agency)\s+(has\s+)?(confirmed|approved)\b/i.test(source)) {
        authoritySource = "team_confirmed";
    }

    return {
        hasConfirmedReservation,
        hasConfirmedDeposit,
        hasCompetingOfferEvidence,
        authoritySource,
    };
}

export function buildDealProtectiveCommunicationContract(input: BuildCommunicationContractInput = {}): string {
    const expectedLanguage = normalizeLanguageTag(input.expectedLanguage);
    const languageLabel = toLanguageDisplayName(expectedLanguage);
    const contextLabel = input.contextLabel ? ` for ${input.contextLabel}` : "";

    const languageRule = expectedLanguage
        ? `Reply in ${languageLabel}${contextLabel}. Keep the wording native and natural.`
        : "Reply in the same language as the contact's latest message. If unclear, follow the contact's preferred thread language.";

    return [
        "DEAL-PROTECTIVE COMMUNICATION CONTRACT:",
        `- Language: ${languageRule}`,
        "- Tone: Neutral, factual, commercially aware, non-pushy, and hierarchy-safe.",
        "- Authority: Do not imply final decision authority unless explicitly confirmed in context.",
        "- Precision: Prefer probability phrasing (for example: \"at this stage\", \"based on current information\", \"is unlikely to accept below\").",
        "- Urgency: Use only factual urgency backed by explicit context evidence (existing offer, planned deposit, confirmed movement).",
        "- Finality: Avoid transactional finality unless reservation/deposit/signature is confirmed.",
        "- Relationship safety: Preserve dignity and rapport; avoid manipulative, emotional, or hype language.",
        "- Screenshot safety: Every message must remain safe if forwarded to owners, clients, management, or compliance reviewers.",
        "",
        "Approved phrasing patterns:",
        '- "from what I know"',
        '- "at this stage"',
        '- "based on the information I have"',
        '- "the owner is unlikely to accept below"',
        '- "final confirmation is best made by X"',
        '- "until reservation is confirmed"',
        "",
        "Disallowed phrasing patterns:",
        '- "final price" (unless explicitly confirmed)',
        '- "deal is closed" (unless explicitly confirmed)',
        '- "property is gone" (unless explicitly confirmed)',
        '- "act now / last chance / pay immediately"',
        '- "I/We confirm final acceptance" (unless authority is explicitly confirmed)',
    ].join("\n");
}
