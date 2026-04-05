import type {
    PropertyImagePromptProfile,
    PropertyImagePromptProfileUpsert,
} from "@/lib/ai/property-image-enhancement-types";
import {
    PROPERTY_IMAGE_ROOM_TYPE_UNCLASSIFIED_KEY,
    normalizePropertyImageRoomTypeKey,
    normalizePropertyImageRoomTypeLabel,
    resolvePropertyImageRoomType,
} from "@/lib/ai/property-image-room-types";

function normalizePromptContext(value: string): string {
    return String(value || "").trim().slice(0, 8000);
}

export function normalizePropertyImagePromptProfile(input: unknown): PropertyImagePromptProfile | null {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return null;
    }

    const source = input as Record<string, unknown>;
    const roomType = resolvePropertyImageRoomType({
        key: String(source.roomTypeKey || ""),
        label: String(source.roomTypeLabel || ""),
    });
    const promptContext = normalizePromptContext(String(source.promptContext || ""));

    if (!promptContext) {
        return null;
    }

    return {
        roomTypeKey: roomType.key,
        roomTypeLabel: roomType.label,
        promptContext,
        analysisData: typeof source.analysisData === "object" && source.analysisData !== null 
            ? source.analysisData as any 
            : undefined,
        updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : undefined,
        updatedById: typeof source.updatedById === "string" ? source.updatedById : null,
    };
}

export function normalizePropertyImagePromptProfileUpsert(input: unknown): PropertyImagePromptProfileUpsert | null {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return null;
    }

    const source = input as Record<string, unknown>;
    const promptContext = normalizePromptContext(String(source.promptContext || ""));
    if (!promptContext) {
        return null;
    }

    const roomType = resolvePropertyImageRoomType({
        key: String(source.roomTypeKey || ""),
        label: String(source.roomTypeLabel || ""),
    });
    if (normalizePropertyImageRoomTypeKey(roomType.key) === PROPERTY_IMAGE_ROOM_TYPE_UNCLASSIFIED_KEY) {
        return null;
    }

    return {
        roomTypeKey: normalizePropertyImageRoomTypeKey(roomType.key),
        roomTypeLabel: normalizePropertyImageRoomTypeLabel(roomType.label),
        promptContext,
        analysisData: typeof source.analysisData === "object" && source.analysisData !== null 
            ? source.analysisData as any 
            : undefined,
    };
}

export function mergePropertyImagePromptProfiles(input: {
    existingProfiles: Array<PropertyImagePromptProfile | null | undefined>;
    stagedUpserts?: Array<PropertyImagePromptProfileUpsert | null | undefined>;
}): PropertyImagePromptProfile[] {
    const profileMap = new Map<string, PropertyImagePromptProfile>();

    for (const entry of input.existingProfiles || []) {
        const normalized = normalizePropertyImagePromptProfile(entry);
        if (!normalized) continue;
        profileMap.set(normalized.roomTypeKey, normalized);
    }

    for (const entry of input.stagedUpserts || []) {
        const normalized = normalizePropertyImagePromptProfileUpsert(entry);
        if (!normalized) continue;
        profileMap.set(normalized.roomTypeKey, {
            ...normalized,
        });
    }

    return Array.from(profileMap.values()).sort((a, b) => a.roomTypeLabel.localeCompare(b.roomTypeLabel));
}

export function resolvePromptProfileContext(input: {
    profiles: Array<PropertyImagePromptProfile | null | undefined>;
    roomTypeKey?: string | null;
}): string | undefined {
    const key = normalizePropertyImageRoomTypeKey(String(input.roomTypeKey || ""));
    if (!key) return undefined;

    for (const entry of input.profiles || []) {
        const normalized = normalizePropertyImagePromptProfile(entry);
        if (!normalized) continue;
        if (normalized.roomTypeKey === key) {
            return normalized.promptContext;
        }
    }

    return undefined;
}

export function resolvePromptProfileAnalysisData(input: {
    profiles: Array<PropertyImagePromptProfile | null | undefined>;
    roomTypeKey?: string | null;
}) {
    const key = normalizePropertyImageRoomTypeKey(String(input.roomTypeKey || ""));
    if (!key) return undefined;

    for (const entry of input.profiles || []) {
        const normalized = normalizePropertyImagePromptProfile(entry);
        if (!normalized) continue;
        if (normalized.roomTypeKey === key && normalized.analysisData) {
            return normalized.analysisData;
        }
    }

    return undefined;
}

export function parsePropertyImagePromptProfileUpsertsJson(raw: string | null | undefined): PropertyImagePromptProfileUpsert[] {
    const text = String(raw || "").trim();
    if (!text) return [];

    try {
        const parsed = JSON.parse(text) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map((entry) => normalizePropertyImagePromptProfileUpsert(entry))
            .filter((entry): entry is PropertyImagePromptProfileUpsert => Boolean(entry));
    } catch {
        return [];
    }
}
