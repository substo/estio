export function normalizeDigits(value: string | null | undefined) {
    return String(value || "").replace(/\D/g, "");
}

function normalizeComparableJid(value: unknown): string | null {
    const raw = String(value || "").trim().toLowerCase();
    return raw || null;
}

export function isHighConfidenceResolvedPhone(value: string | null | undefined): boolean {
    const digits = normalizeDigits(value);
    return digits.length >= 8 && !digits.startsWith("0");
}

export function extractPhoneJidCandidate(value: unknown): string | null {
    const jid = normalizeComparableJid(value);
    if (!jid || !jid.endsWith("@s.whatsapp.net")) return null;

    const digits = normalizeDigits(jid.replace("@s.whatsapp.net", ""));
    return isHighConfidenceResolvedPhone(digits) ? digits : null;
}

export function extractDirectPhoneFieldCandidate(value: unknown): string | null {
    const raw = String(value || "").trim();
    if (!raw || raw.includes("@")) return null;

    const digits = normalizeDigits(raw.replace(/^whatsapp:/i, ""));
    return isHighConfidenceResolvedPhone(digits) ? digits : null;
}

export function collectEvolutionContactJids(contact: any): string[] {
    const jidCandidates = [
        contact?.remoteJid,
        contact?.jid,
        contact?.lid,
        contact?.remoteJidAlt,
        contact?.participantAlt,
        contact?.previousRemoteJid,
        contact?.senderPn,
        typeof contact?.id === "string" && contact.id.includes("@") ? contact.id : null,
    ];

    return Array.from(
        new Set(
            jidCandidates
                .map((candidate) => normalizeComparableJid(candidate))
                .filter((candidate): candidate is string => Boolean(candidate))
        )
    );
}

export function evolutionContactMatchesRequestedJid(contact: any, requestedJid: string): boolean {
    const normalizedRequested = normalizeComparableJid(requestedJid);
    if (!normalizedRequested) return false;

    return collectEvolutionContactJids(contact).includes(normalizedRequested);
}

export function extractPhoneFromEvolutionContact(contact: any): string | null {
    if (!contact) return null;

    const directFieldCandidates = [
        contact.phoneNumber,
        contact.phone,
        contact.number,
        contact.mobile,
        contact.waNumber,
    ];

    for (const candidate of directFieldCandidates) {
        const parsed = extractDirectPhoneFieldCandidate(candidate);
        if (parsed) return parsed;
    }

    const jidCandidates = [
        contact.senderPn,
        contact.remoteJidAlt,
        contact.participantAlt,
        contact.previousRemoteJid,
        contact.remoteJid,
        contact.jid,
        contact.participant,
        typeof contact.id === "string" && contact.id.includes("@") ? contact.id : null,
    ];

    for (const candidate of jidCandidates) {
        const parsed = extractPhoneJidCandidate(candidate);
        if (parsed) return parsed;
    }

    return null;
}
