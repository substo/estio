export interface PropertyImageEnhancementModelPreference {
    analysis: string;
    generation: string;
}

const STORAGE_KEY = "estio_property_image_enhancement_model_preferences_v1";

const EMPTY_PREFERENCE: PropertyImageEnhancementModelPreference = {
    analysis: "",
    generation: "",
};

function normalizeModelId(value: string | null | undefined): string {
    return String(value || "").trim();
}

function toPreference(value: unknown): PropertyImageEnhancementModelPreference {
    if (!value || typeof value !== "object") return { ...EMPTY_PREFERENCE };
    const source = value as Record<string, unknown>;

    return {
        analysis: normalizeModelId(String(source.analysis || "")),
        generation: normalizeModelId(String(source.generation || "")),
    };
}

function parsePreferenceMap(raw: string | null): Record<string, PropertyImageEnhancementModelPreference> {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object") return {};
        const source = parsed as Record<string, unknown>;
        const entries = Object.entries(source).map(([locationId, value]) => [locationId, toPreference(value)] as const);
        return Object.fromEntries(entries);
    } catch {
        return {};
    }
}

export function resolvePreferredPropertyImageEnhancementModel(params: {
    allowedValues: string[];
    currentValue?: string | null;
    persistedValue?: string | null;
    defaultValue?: string | null;
    fallbackValue?: string | null;
}): string {
    const allowed = new Set(params.allowedValues.map((value) => normalizeModelId(value)).filter(Boolean));
    if (allowed.size === 0) return "";

    const candidates = [
        params.currentValue,
        params.persistedValue,
        params.defaultValue,
        params.fallbackValue,
    ]
        .map((value) => normalizeModelId(value))
        .filter(Boolean);

    for (const candidate of candidates) {
        if (allowed.has(candidate)) return candidate;
    }

    return normalizeModelId(params.allowedValues[0]);
}

export function readPropertyImageEnhancementModelPreference(
    locationId: string | null | undefined
): PropertyImageEnhancementModelPreference {
    if (typeof window === "undefined") return { ...EMPTY_PREFERENCE };
    const normalizedLocationId = String(locationId || "").trim();
    if (!normalizedLocationId) return { ...EMPTY_PREFERENCE };

    const map = parsePreferenceMap(window.localStorage.getItem(STORAGE_KEY));
    return toPreference(map[normalizedLocationId]);
}

export function writePropertyImageEnhancementModelPreference(
    locationId: string | null | undefined,
    update: Partial<PropertyImageEnhancementModelPreference>
): PropertyImageEnhancementModelPreference {
    if (typeof window === "undefined") return { ...EMPTY_PREFERENCE };
    const normalizedLocationId = String(locationId || "").trim();
    if (!normalizedLocationId) return { ...EMPTY_PREFERENCE };

    const map = parsePreferenceMap(window.localStorage.getItem(STORAGE_KEY));
    const current = toPreference(map[normalizedLocationId]);
    const next: PropertyImageEnhancementModelPreference = {
        analysis: normalizeModelId(update.analysis ?? current.analysis),
        generation: normalizeModelId(update.generation ?? current.generation),
    };

    map[normalizedLocationId] = next;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    return next;
}
