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

    if (!fallbackName) {
        return { firstName: "", lastName: "", fullName: "" };
    }

    const parts = fallbackName.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
        return {
            firstName: parts[0],
            lastName: "",
            fullName: parts[0],
        };
    }

    return {
        firstName: parts[0],
        lastName: parts.slice(1).join(" "),
        fullName: fallbackName,
    };
}

export function inferLeadContactRole(rawLeadText: string, parsedRole?: string | null): "Lead" | "Owner" | "Agent" {
    const normalizedRole = normalizeWhitespace(parsedRole);
    if (normalizedRole === "Lead" || normalizedRole === "Owner" || normalizedRole === "Agent") {
        return normalizedRole;
    }

    const text = rawLeadText.toLowerCase();
    if (/\bowner\b/.test(text)) return "Owner";
    if (/\bagent\b/.test(text)) return "Agent";
    return "Lead";
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

export function buildStructuredLeadDisplayName(args: {
    contact?: BuilderContactData;
    rawLeadText: string;
    inferredStatus?: "For Rent" | "For Sale" | null | string;
    matchedProperty?: BuilderPropertyMatchData | null;
    requirements?: BuilderRequirementsData | null;
}): string {
    const person = splitLeadPersonName(args.contact);
    const personName = person.fullName
        || normalizeWhitespace(args.contact?.name)
        || normalizeWhitespace(args.contact?.email)
        || normalizeWhitespace(args.contact?.phone)
        || "Lead";
    
    const refs = extractPropertyRefsFromLeadText(args.rawLeadText);

    const role = inferLeadContactRole(args.rawLeadText, args.contact?.role);
    const goal = formatLeadGoalLabel(args.inferredStatus);
    const singleRef = refs[0] || normalizeWhitespace(args.matchedProperty?.reference);

    if (refs.length > 1) {
        // Multiple refs: [Name] [Role] [Goal] [Ref1], [Ref2]
        return normalizeWhitespace(
            [personName, role, goal, refs.join(", ")].filter(Boolean).join(" ")
        );
    }

    const propertySummary = buildStructuredLeadPropertySummary({
        matchedProperty: args.matchedProperty,
        requirements: args.requirements,
    });

    return [personName, role, goal, singleRef, propertySummary].filter(Boolean).join(" ").trim();
}
