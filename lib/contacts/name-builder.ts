export interface BuilderContactData {
    firstName?: string | null;
    lastName?: string | null;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    role?: string | null;
}

export interface BuilderRequirementsData {
    bedrooms?: string | null;
    type?: string | null;
    location?: string | null;
}

export interface BuilderPropertyMatchData {
    title?: string | null;
    reference?: string | null;
    propertyLocation?: string | null;
    city?: string | null;
}

export function extractPropertyRefsFromLeadText(text: string): string[] {
    const refs = new Set<string>();
    const refRegex = /\b(?:ref(?:erence)?[.:#\s-]*)?([A-Z]{1,4}\d{2,6}|[A-Z]{2,6}-\d{2,6})\b/gi;
    let match: RegExpExecArray | null;

    while ((match = refRegex.exec(text)) !== null) {
        if (match[1]) {
            refs.add(match[1].toUpperCase());
        }
    }

    return Array.from(refs);
}

export function extractBedroomSummary(raw?: string | null): string | null {
    if (!raw) return null;
    const match = raw.match(/\d+\+?/);
    if (!match || parseInt(match[0], 10) === 0) return null;
    return `${match[0]}Bdr`;
}

export function abbreviatePropertyType(raw?: string | null): string | null {
    const text = String(raw || "").trim();
    if (!text) return null;

    // Convert underscored subtype keys to human-readable labels
    // e.g. "ground_floor_apartment" → "Ground Floor Apartment", "detached_villa" → "Detached Villa"
    const humanized = text.includes("_")
        ? text.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
        : text;
    const lower = humanized.toLowerCase();

    // Exact match abbreviations
    if (lower === "apartment" || lower === "appartment" || lower === "apt") return "Apt";
    if (lower === "bedroom" || lower === "bedrooms") return "Bdr";
    if (lower === "penthouse") return "PH";
    if (lower === "studio") return "Studio";
    if (lower === "bungalow") return "Bungalow";
    if (lower === "detached villa") return "Villa";
    if (lower === "semi detached villa") return "Semi-Villa";
    if (lower === "town house") return "Townhouse";
    if (lower === "traditional house") return "Trad. House";
    if (lower === "ground floor apartment") return "GF Apt";

    // Partial match abbreviations
    if (lower.includes("apartment")) return humanized.replace(/apartment/gi, "Apt");
    if (lower.includes("appartment")) return humanized.replace(/appartment/gi, "Apt");
    if (lower.includes("bedroom")) return humanized.replace(/bedrooms?/gi, "Bdr");
    if (lower.includes("villa")) return humanized.replace(/villa/gi, "Villa");
    if (lower.includes("land")) return humanized;

    return humanized;
}

export function normalizeWhitespace(value?: string | null): string {
    return String(value || "").replace(/\s+/g, " ").trim();
}

const PERSON_NAME_STOP_WORDS = new Set([
    "lead",
    "agent",
    "owner",
    "tenant",
    "buyer",
    "seller",
    "landlord",
    "landlady",
    "vendor",
    "rent",
    "rental",
    "sale",
    "sell",
    "list",
    "listing",
    "for",
    "to",
]);

const COMPANY_NAME_PATTERNS = [
    /\b(properties|property|estates|estate|developers?|development|realty|agency|group|holdings?|investments?)\b/i,
    /\b(ltd|limited|llc|plc|inc|corp(?:oration)?|company|co)\b/i,
];

function isLikelyCompanyName(value?: string | null): boolean {
    const text = normalizeWhitespace(value);
    if (!text) return false;
    return COMPANY_NAME_PATTERNS.some((pattern) => pattern.test(text));
}

function stripContactNameNoise(value?: string | null): string {
    let text = normalizeWhitespace(value);
    if (!text) return "";

    text = text
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
        .replace(/\+?\d[\d\s().-]{5,}\d/g, " ")
        .replace(/\bfor\s+(?:rent|sale)\b/gi, " ")
        .replace(/\bto\s+(?:buy|rent|sell|list)\b/gi, " ");

    for (const ref of extractPropertyRefsFromLeadText(text)) {
        text = text.replace(new RegExp(`\\b${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " ");
    }

    return normalizeWhitespace(text);
}

function cleanPersonNameToken(value: string): string {
    return value
        .replace(/^[^\p{L}]+|[^\p{L}.'-]+$/gu, "")
        .trim();
}

function isContactNameBoundaryToken(value: string): boolean {
    if (!value) return false;
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) return true;
    if (/\+?\d[\d().-]{2,}/.test(value)) return true;
    if (extractPropertyRefsFromLeadText(value).length > 0) return true;
    const token = cleanPersonNameToken(value).toLowerCase();
    return !token || PERSON_NAME_STOP_WORDS.has(token);
}

function leadingPersonNameText(value?: string | null): string {
    const text = normalizeWhitespace(value);
    if (!text) return "";

    const parts: string[] = [];
    for (const rawPart of text.split(/\s+/)) {
        if (isContactNameBoundaryToken(rawPart)) break;
        parts.push(rawPart);
    }
    return normalizeWhitespace(parts.join(" "));
}

export function hasContactPersonNameNoise(value?: string | null): boolean {
    const text = normalizeWhitespace(value);
    if (!text) return false;
    if (extractPropertyRefsFromLeadText(text).length > 0) return true;
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) return true;
    if (/\+?\d[\d\s().-]{5,}\d/.test(text)) return true;
    return text
        .split(/\s+/)
        .map(cleanPersonNameToken)
        .filter(Boolean)
        .some((part) => PERSON_NAME_STOP_WORDS.has(part.toLowerCase()));
}

export function parseContactPersonNameFromDisplayName(value?: string | null) {
    const original = normalizeWhitespace(value);
    if (!original || isLikelyCompanyName(original)) {
        return { firstName: "", lastName: "", fullName: "" };
    }

    const cleaned = stripContactNameNoise(leadingPersonNameText(original));
    const parts = cleaned
        .split(/\s+/)
        .map(cleanPersonNameToken)
        .filter(Boolean)
        .filter((part) => !PERSON_NAME_STOP_WORDS.has(part.toLowerCase()))
        .filter((part) => /\p{L}/u.test(part));

    if (!parts.length) return { firstName: "", lastName: "", fullName: "" };

    const firstName = parts[0];
    const lastName = parts.length > 1 ? parts[1] : "";
    return {
        firstName,
        lastName,
        fullName: normalizeWhitespace([firstName, lastName].filter(Boolean).join(" ")),
    };
}

export function splitLeadPersonName(contact?: BuilderContactData) {
    const explicitFirst = normalizeWhitespace(contact?.firstName);
    const explicitLast = normalizeWhitespace(contact?.lastName);
    const fallbackName = normalizeWhitespace(contact?.name);

    if (explicitFirst || explicitLast) {
        return {
            firstName: explicitFirst,
            lastName: explicitLast,
            fullName: normalizeWhitespace(`${explicitFirst} ${explicitLast}`),
        };
    }

    return parseContactPersonNameFromDisplayName(fallbackName);
}

export type InferredLeadContactRole = "Lead" | "Owner" | "Agent";
export type InferredContactRole = InferredLeadContactRole | "Tenant";

function normalizeRole(value?: string | null): InferredContactRole | null {
    const text = normalizeWhitespace(value);
    if (text === "Lead" || text === "Owner" || text === "Agent" || text === "Tenant") return text;
    return null;
}

function inferRoleFromName(value?: string | null): Exclude<InferredContactRole, "Lead"> | null {
    const text = normalizeWhitespace(value).toLowerCase();
    if (!text) return null;
    if (/\b(tenant|occupant)\b/.test(text)) return "Tenant";
    if (/\b(owner|landlord|landlady|vendor|seller)\b/.test(text)) return "Owner";
    if (/\b(agent|agency|estate agent|realtor|broker|developer|property consultant|sales consultant)\b/.test(text)) return "Agent";
    return null;
}

function inferRoleFromContext(value?: string | null): Exclude<InferredContactRole, "Lead"> | null {
    const text = normalizeWhitespace(value).toLowerCase();
    if (!text) return null;
    if (/\b(?:contact\s+type|role|contact\s+role|person\s+type)\s*[:=-]?\s*(tenant|occupant)\b/.test(text)) return "Tenant";
    if (/\b(?:tenant(?:'s)?\s+name|occupant(?:'s)?\s+name)\b/.test(text)) return "Tenant";
    if (/\b(?:contact\s+type|role|contact\s+role|person\s+type)\s*[:=-]?\s*(owner|landlord|landlady|vendor|seller)\b/.test(text)) return "Owner";
    if (/\b(?:owner\s+name|landlord\s+name|vendor\s+name|seller\s+name)\b/.test(text)) return "Owner";
    if (/\b(?:contact\s+type|role|contact\s+role|person\s+type)\s*[:=-]?\s*(agent|agency|estate agent|realtor|broker|developer|property consultant|sales consultant)\b/.test(text)) return "Agent";
    if (/\b(?:agent\s+name|agency\s+name|listed\s+by|advertised\s+by|developer\s+name|broker\s+name)\b/.test(text)) return "Agent";
    return null;
}

export function inferLeadContactRoleFromSignals(args: {
    parsedRole?: string | null;
    contactType?: string | null;
    name?: string | null;
    texts?: Array<string | null | undefined>;
}): InferredContactRole {
    const parsedRole = normalizeRole(args.parsedRole);
    if (parsedRole && parsedRole !== "Lead") return parsedRole;

    const existingType = normalizeRole(args.contactType);
    if (existingType && existingType !== "Lead") return existingType;

    const nameRole = inferRoleFromName(args.name);
    if (nameRole) return nameRole;

    for (const text of args.texts || []) {
        const contextRole = inferRoleFromContext(text);
        if (contextRole) return contextRole;
    }

    if (parsedRole === "Lead" || existingType === "Lead") return "Lead";
    return "Lead";
}

export function inferLeadContactRole(rawLeadText: string, parsedRole?: string | null): InferredContactRole {
    return inferLeadContactRoleFromSignals({
        parsedRole,
        name: rawLeadText,
        texts: [rawLeadText],
    });
}

export function formatLeadGoalLabel(status?: "For Rent" | "For Sale" | null | string): "Rent" | "Sale" | "" {
    if (status === "For Rent") return "Rent";
    if (status === "For Sale") return "Sale";
    return "";
}

export function shouldUseMatchedPropertyTitle(title?: string | null): boolean {
    const text = normalizeWhitespace(title).toLowerCase();
    if (!text) return false;
    return text.includes("#")
        || text.includes("block")
        || text.includes("residence")
        || text.includes("residences");
}

export function buildStructuredLeadPropertySummary(args: {
    matchedProperty?: BuilderPropertyMatchData | null;
    requirements?: BuilderRequirementsData | null;
}): string {
    const matchedProperty = args.matchedProperty || null;
    if (matchedProperty?.title && shouldUseMatchedPropertyTitle(matchedProperty.title)) {
        return normalizeWhitespace(matchedProperty.title);
    }

    const bedrooms = extractBedroomSummary(args.requirements?.bedrooms);
    const propertyType = abbreviatePropertyType(args.requirements?.type);
    const location = normalizeWhitespace(
        matchedProperty?.propertyLocation
        || matchedProperty?.city
        || args.requirements?.location
    );

    return [bedrooms, propertyType, location].filter(Boolean).join(" ").trim();
}

export function buildLeadRequirementNameParts(args: {
    rawLeadText?: string | null;
    inferredStatus?: "For Rent" | "For Sale" | null | string;
    matchedProperty?: BuilderPropertyMatchData | null;
    requirements?: BuilderRequirementsData | null;
}): string[] {
    const refs = extractPropertyRefsFromLeadText(args.rawLeadText || "");
    const goal = formatLeadGoalLabel(args.inferredStatus);
    const singleRef = refs[0] || normalizeWhitespace(args.matchedProperty?.reference);

    if (refs.length > 1) return [goal, refs.join(", ")].filter(Boolean);

    const propertySummary = buildStructuredLeadPropertySummary({
        matchedProperty: args.matchedProperty,
        requirements: args.requirements,
    });
    return [goal, singleRef, propertySummary].filter(Boolean);
}

export function buildCanonicalContactName(args: {
    contact?: BuilderContactData;
    contactType?: string | null;
    rawLeadText?: string | null;
    inferredStatus?: "For Rent" | "For Sale" | null | string;
    matchedProperty?: BuilderPropertyMatchData | null;
    requirements?: BuilderRequirementsData | null;
    propertyRefs?: string[] | null;
}): string {
    const person = splitLeadPersonName(args.contact);
    const personName = person.fullName
        || normalizeWhitespace(args.contact?.name)
        || normalizeWhitespace(args.contact?.email)
        || normalizeWhitespace(args.contact?.phone)
        || "Contact";
    const contactType = normalizeWhitespace(args.contactType || args.contact?.role || "Lead");

    if (contactType && contactType !== "Lead" && contactType !== "Contact" && contactType !== "Tenant") {
        const refs = (args.propertyRefs || extractPropertyRefsFromLeadText(args.rawLeadText || ""))
            .map((ref) => normalizeWhitespace(ref).toUpperCase())
            .filter(Boolean);
        const lowerName = personName.toLowerCase();
        const hasRole = new RegExp(`\\b${contactType.toLowerCase()}\\b`).test(lowerName);
        const hasRef = refs.some((ref) => lowerName.includes(ref.toLowerCase()));
        return normalizeWhitespace([
            personName,
            hasRole ? null : contactType,
            refs[0] && !hasRef ? refs[0] : null,
        ].filter(Boolean).join(" "));
    }

    if (contactType === "Tenant") {
        const refs = (args.propertyRefs || extractPropertyRefsFromLeadText(args.rawLeadText || ""))
            .map((ref) => normalizeWhitespace(ref).toUpperCase())
            .filter(Boolean);
        const lowerName = personName.toLowerCase();
        const hasRole = /\btenant\b/.test(lowerName);
        const hasRef = refs.some((ref) => lowerName.includes(ref.toLowerCase()));
        return normalizeWhitespace([
            personName,
            hasRole ? null : "Tenant",
            formatLeadGoalLabel(args.inferredStatus),
            refs[0] && !hasRef ? refs[0] : null,
        ].filter(Boolean).join(" "));
    }

    const role = inferLeadContactRoleFromSignals({
        parsedRole: args.contact?.role,
        contactType,
        name: personName,
        texts: [args.rawLeadText || ""],
    });
    const parts = buildLeadRequirementNameParts({
        rawLeadText: args.rawLeadText,
        inferredStatus: args.inferredStatus,
        matchedProperty: args.matchedProperty,
        requirements: args.requirements,
    });
    return normalizeWhitespace([personName, role, ...parts].filter(Boolean).join(" "));
}

export function buildStructuredLeadDisplayName(args: {
    contact?: BuilderContactData;
    rawLeadText: string;
    inferredStatus?: "For Rent" | "For Sale" | null | string;
    matchedProperty?: BuilderPropertyMatchData | null;
    requirements?: BuilderRequirementsData | null;
}): string {
    return buildCanonicalContactName({
        contact: args.contact,
        contactType: args.contact?.role || "Lead",
        rawLeadText: args.rawLeadText,
        inferredStatus: args.inferredStatus,
        matchedProperty: args.matchedProperty,
        requirements: args.requirements,
    });
}
