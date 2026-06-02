export type NormalizedHistoryChange = {
    field: string;
    old: unknown;
    new: unknown;
};

const REQUIREMENT_FIELD_LABELS: Record<string, string> = {
    requirementStatus: "Status",
    requirementDistrict: "District",
    requirementBedrooms: "Bedrooms",
    requirementMinPrice: "Min budget",
    requirementMaxPrice: "Max budget",
    requirementCondition: "Condition",
    requirementPropertyTypes: "Property types",
    requirementPropertyLocations: "Locations",
    requirementOtherDetails: "Other details",
    requirementSummary: "Summary",
};

function parseMaybeJson(value: unknown): unknown {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function isChangeLike(value: unknown): value is NormalizedHistoryChange {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.field === "string" && "new" in candidate;
}

export function parseHistoryChanges(rawChanges: unknown, action?: string): NormalizedHistoryChange[] {
    const parsed = parseMaybeJson(rawChanges);
    if (!parsed) return [];

    if (
        action === "AI_REQUIREMENTS_UPDATED"
        && typeof parsed === "object"
        && !Array.isArray(parsed)
        && Array.isArray((parsed as any).changes)
    ) {
        return (parsed as any).changes.filter(isChangeLike);
    }

    if (Array.isArray(parsed)) {
        return parsed.filter(isChangeLike);
    }

    if (typeof parsed === "object") {
        return Object.entries(parsed as Record<string, unknown>).map(([field, value]) => ({
            field,
            old: null,
            new: value,
        }));
    }

    return [];
}

export function formatHistoryValue(value: unknown): string {
    if (value === null || value === undefined || value === "") return "Empty";
    if (Array.isArray(value)) return value.length > 0 ? value.map(formatHistoryValue).join(", ") : "Empty";
    if (value instanceof Date) return value.toLocaleString();
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

export function formatHistoryFieldName(field: string): string {
    if (REQUIREMENT_FIELD_LABELS[field]) return REQUIREMENT_FIELD_LABELS[field];
    const result = field.replace(/([A-Z])/g, " $1");
    return result.charAt(0).toUpperCase() + result.slice(1);
}

export function isRequirementHistoryAction(action: string): boolean {
    return action === "AI_REQUIREMENTS_UPDATED";
}

export function summarizeRequirementChanges(changes: NormalizedHistoryChange[]): string {
    if (changes.length === 0) return "Requirements updated";
    const labels = changes.slice(0, 3).map((change) => formatHistoryFieldName(change.field));
    const extraCount = Math.max(0, changes.length - labels.length);
    return extraCount > 0
        ? `Updated ${labels.join(", ")} and ${extraCount} more`
        : `Updated ${labels.join(", ")}`;
}
