export type SharedContactInfo = {
    displayName: string;
    phoneNumber?: string | null;
    email?: string | null;
    organization?: string | null;
};

const CONTACTS_DATA_SEPARATOR = "\n---CONTACTS_DATA---\n";

const VCARD_MIME_TYPES = new Set([
    "text/vcard",
    "text/x-vcard",
    "text/directory",
    "text/directory;profile=vcard",
]);

export function isVCardMedia(input: { contentType?: string | null; fileName?: string | null; url?: string | null }) {
    const contentType = String(input.contentType || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
    if (VCARD_MIME_TYPES.has(contentType)) return true;

    const target = String(input.fileName || input.url || "").split("?")[0].toLowerCase();
    return target.endsWith(".vcf") || target.endsWith(".vcard");
}

function unfoldVCardLines(value: string) {
    return String(value || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n")
        .reduce<string[]>((lines, line) => {
            if (/^[ \t]/.test(line) && lines.length > 0) {
                lines[lines.length - 1] += line.slice(1);
            } else {
                lines.push(line);
            }
            return lines;
        }, []);
}

function splitPropertyLine(line: string) {
    const colonIndex = line.indexOf(":");
    if (colonIndex < 0) return null;
    const nameAndParams = line.slice(0, colonIndex);
    const value = line.slice(colonIndex + 1);
    const propertyName = nameAndParams.split(";")[0]?.trim().toUpperCase();
    if (!propertyName) return null;
    return { propertyName, value };
}

function decodeVCardValue(value: string) {
    return String(value || "")
        .replace(/\\n/gi, "\n")
        .replace(/\\,/g, ",")
        .replace(/\\;/g, ";")
        .replace(/\\\\/g, "\\")
        .trim();
}

function normalizePhone(value: string) {
    const decoded = decodeVCardValue(value);
    if (!decoded) return null;
    return decoded.replace(/^tel:/i, "").trim() || null;
}

function parseNameProperty(value: string) {
    const parts = decodeVCardValue(value).split(";").map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    const [family, given, additional] = parts;
    return [given, additional, family].filter(Boolean).join(" ").trim() || null;
}

function parseSingleVCard(cardText: string): SharedContactInfo | null {
    let fullName: string | null = null;
    let structuredName: string | null = null;
    let phoneNumber: string | null = null;
    let email: string | null = null;
    let organization: string | null = null;

    for (const line of unfoldVCardLines(cardText)) {
        const parsed = splitPropertyLine(line);
        if (!parsed) continue;

        if (parsed.propertyName === "FN" && !fullName) {
            fullName = decodeVCardValue(parsed.value);
        } else if (parsed.propertyName === "N" && !structuredName) {
            structuredName = parseNameProperty(parsed.value);
        } else if (parsed.propertyName === "TEL" && !phoneNumber) {
            phoneNumber = normalizePhone(parsed.value);
        } else if (parsed.propertyName === "EMAIL" && !email) {
            email = decodeVCardValue(parsed.value);
        } else if (parsed.propertyName === "ORG" && !organization) {
            organization = decodeVCardValue(parsed.value).split(";").filter(Boolean).join(", ");
        }
    }

    const displayName = fullName || structuredName || phoneNumber || email || "Shared contact";
    if (!displayName && !phoneNumber && !email) return null;

    return {
        displayName,
        phoneNumber,
        email,
        organization,
    };
}

export function parseVCardContacts(input: string): SharedContactInfo[] {
    const source = String(input || "");
    if (!/BEGIN:VCARD/i.test(source)) return [];

    const cards = source.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) || [];
    return cards
        .map(parseSingleVCard)
        .filter((contact): contact is SharedContactInfo => !!contact);
}

export function parseSharedContactsFromMessageBody(body: string): SharedContactInfo[] {
    const source = String(body || "");
    if (!source.trim()) return [];

    const separatorIndex = source.indexOf(CONTACTS_DATA_SEPARATOR);
    if (separatorIndex >= 0) {
        const jsonPart = source.slice(separatorIndex + CONTACTS_DATA_SEPARATOR.length).trim();
        if (jsonPart) {
            try {
                const parsed = JSON.parse(jsonPart);
                if (Array.isArray(parsed)) {
                    return parsed
                        .map((contact) => normalizeSharedContact(contact))
                        .filter((contact): contact is SharedContactInfo => !!contact);
                }
            } catch {
                // Fall through to vCard parsing below.
            }
        }
    }

    return parseVCardContacts(source);
}

export function getSharedContactReadableMessage(body: string): string {
    const source = String(body || "");
    const separatorIndex = source.indexOf(CONTACTS_DATA_SEPARATOR);
    if (separatorIndex >= 0) {
        return source.slice(0, separatorIndex).trim();
    }

    if (/BEGIN:VCARD/i.test(source)) {
        const contacts = parseVCardContacts(source);
        if (contacts.length === 0) return "Shared contact";
        return contacts.map((contact) => contact.displayName).join(", ");
    }

    return source;
}

function normalizeSharedContact(input: unknown): SharedContactInfo | null {
    if (!input || typeof input !== "object") return null;
    const value = input as Record<string, unknown>;
    const displayName = String(value.displayName || value.name || value.fullName || "").trim();
    const phoneNumber = String(value.phoneNumber || value.phone || "").trim() || null;
    const email = String(value.email || "").trim() || null;
    const organization = String(value.organization || value.company || "").trim() || null;
    const fallbackName = displayName || phoneNumber || email;
    if (!fallbackName) return null;

    return {
        displayName: fallbackName,
        phoneNumber,
        email,
        organization,
    };
}
