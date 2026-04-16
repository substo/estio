export type GroupParticipantResolutionConfidence =
    | "verified_phone_jid"
    | "lid_only"
    | "participant_jid"
    | "display_name_only";

export type ExtractedGroupParticipantIdentity = {
    identityKey: string | null;
    participantJid: string | null;
    lidJid: string | null;
    phoneJid: string | null;
    phoneDigits: string | null;
    displayName: string | null;
    resolutionConfidence: GroupParticipantResolutionConfidence;
    source: "whatsapp_evolution";
};

function normalizeJid(value: string | null | undefined): string | null {
    const normalized = String(value || "").trim();
    return normalized || null;
}

function normalizePhoneDigits(value: string | null | undefined): string | null {
    const digits = String(value || "").replace(/\D/g, "");
    return digits || null;
}

function normalizeDisplayName(value: string | null | undefined): string | null {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    return normalized || null;
}

function normalizeDisplayKey(value: string | null | undefined): string | null {
    const normalized = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return normalized || null;
}

export function extractGroupParticipantIdentity(input: {
    participantJid?: string | null;
    senderPhoneJid?: string | null;
    pushName?: string | null;
}): ExtractedGroupParticipantIdentity {
    const participantJid = normalizeJid(input.participantJid);
    const senderPhoneJidRaw = normalizeJid(input.senderPhoneJid);
    const senderPhoneDigits = normalizePhoneDigits(senderPhoneJidRaw);
    const senderPhoneJid = senderPhoneJidRaw?.includes("@")
        ? senderPhoneJidRaw
        : (senderPhoneDigits ? `${senderPhoneDigits}@s.whatsapp.net` : null);
    const phoneJid = senderPhoneJid?.endsWith("@s.whatsapp.net")
        ? senderPhoneJid
        : (participantJid?.endsWith("@s.whatsapp.net") ? participantJid : null);
    const lidJid = participantJid?.endsWith("@lid") ? participantJid : null;
    const phoneDigits = normalizePhoneDigits(phoneJid);
    const displayName = normalizeDisplayName(input.pushName) || phoneDigits || lidJid || participantJid;

    if (phoneJid) {
        return {
            identityKey: `phone:${phoneJid}`,
            participantJid: participantJid || phoneJid,
            lidJid,
            phoneJid,
            phoneDigits,
            displayName,
            resolutionConfidence: "verified_phone_jid",
            source: "whatsapp_evolution",
        };
    }

    if (lidJid) {
        return {
            identityKey: `lid:${lidJid}`,
            participantJid: participantJid || lidJid,
            lidJid,
            phoneJid: null,
            phoneDigits: null,
            displayName,
            resolutionConfidence: "lid_only",
            source: "whatsapp_evolution",
        };
    }

    if (participantJid) {
        return {
            identityKey: `jid:${participantJid}`,
            participantJid,
            lidJid: null,
            phoneJid: null,
            phoneDigits: null,
            displayName,
            resolutionConfidence: "participant_jid",
            source: "whatsapp_evolution",
        };
    }

    const displayKey = normalizeDisplayKey(displayName);
    return {
        identityKey: displayKey ? `display:${displayKey}` : null,
        participantJid: null,
        lidJid: null,
        phoneJid: null,
        phoneDigits: null,
        displayName,
        resolutionConfidence: "display_name_only",
        source: "whatsapp_evolution",
    };
}

export function formatGroupParticipantIdentitySummary(input: {
    phoneDigits?: string | null;
    phoneJid?: string | null;
    lidJid?: string | null;
    participantJid?: string | null;
}): string {
    if (input.phoneDigits) return `+${input.phoneDigits}`;
    if (input.phoneJid) return input.phoneJid;
    if (input.lidJid) return input.lidJid;
    if (input.participantJid) return input.participantJid;
    return "No identity available";
}

export function canOpenDirectChatForParticipant(input: {
    phoneDigits?: string | null;
    phoneJid?: string | null;
}): boolean {
    return Boolean(input.phoneJid && input.phoneDigits && String(input.phoneDigits).length >= 7);
}
