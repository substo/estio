export type SharedContactInfo = {
    displayName: string;
    phoneNumber?: string | null;
    email?: string | null;
    organization?: string | null;
};

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
