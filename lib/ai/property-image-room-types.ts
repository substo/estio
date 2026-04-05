import type { PropertyImageRoomType } from "@/lib/ai/property-image-enhancement-types";

export const PROPERTY_IMAGE_ROOM_TYPE_UNCLASSIFIED_KEY = "unclassified";
export const PROPERTY_IMAGE_ROOM_TYPE_CUSTOM_KEY = "__custom__";
export const PROPERTY_IMAGE_ROOM_TYPE_PREDICTION_MIN_CONFIDENCE = 0.6;

export const PROPERTY_IMAGE_ROOM_TYPE_PRESETS: Array<{ key: string; label: string }> = [
    { key: PROPERTY_IMAGE_ROOM_TYPE_UNCLASSIFIED_KEY, label: "Unclassified" },
    { key: "living_room", label: "Living Room" },
    { key: "kitchen", label: "Kitchen" },
    { key: "dining_room", label: "Dining Room" },
    { key: "bedroom", label: "Bedroom" },
    { key: "kids_bedroom", label: "Kids Bedroom" },
    { key: "bathroom", label: "Bathroom" },
    { key: "home_office", label: "Home Office" },
    { key: "hallway", label: "Hallway" },
    { key: "staircase", label: "Staircase" },
    { key: "laundry_room", label: "Laundry Room" },
    { key: "garage", label: "Garage" },
    { key: "storage_room", label: "Storage Room" },
    { key: "utility_room", label: "Utility Room" },
    { key: "balcony", label: "Balcony" },
    { key: "terrace", label: "Terrace" },
    { key: "patio", label: "Patio" },
    { key: "backyard", label: "Backyard" },
    { key: "garden", label: "Garden" },
    { key: "pool_area", label: "Pool Area" },
    { key: "facade", label: "Facade" },
    { key: "front_exterior", label: "Front Exterior" },
    { key: "back_exterior", label: "Back Exterior" },
    { key: "driveway", label: "Driveway" },
] as const;

const PRESET_BY_KEY = new Map(PROPERTY_IMAGE_ROOM_TYPE_PRESETS.map((item) => [item.key, item] as const));

function toSingleLine(value: string): string {
    return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizePropertyImageRoomTypeKey(value: string): string {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

export function normalizePropertyImageRoomTypeLabel(value: string): string {
    return toSingleLine(value).slice(0, 120);
}

export function isPropertyImageRoomTypePresetKey(value: string): boolean {
    const key = normalizePropertyImageRoomTypeKey(value);
    return PRESET_BY_KEY.has(key);
}

export function getPropertyImageRoomTypePresetLabel(value: string): string | undefined {
    const key = normalizePropertyImageRoomTypeKey(value);
    return PRESET_BY_KEY.get(key)?.label;
}

function humanizeRoomTypeKey(value: string): string {
    const key = normalizePropertyImageRoomTypeKey(value);
    if (!key) return "";
    return key
        .split("_")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function normalizeConfidence(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(1, numeric));
}

export function resolvePropertyImageRoomType(input?: {
    key?: string | null;
    label?: string | null;
    confidence?: number | null;
}): PropertyImageRoomType {
    const rawKey = normalizePropertyImageRoomTypeKey(String(input?.key || ""));
    const rawLabel = normalizePropertyImageRoomTypeLabel(String(input?.label || ""));

    if (rawKey && PRESET_BY_KEY.has(rawKey)) {
        return {
            key: rawKey,
            label: PRESET_BY_KEY.get(rawKey)?.label || "Unclassified",
            confidence: normalizeConfidence(input?.confidence),
        };
    }

    if (rawKey === "custom" && rawLabel) {
        const customKey = normalizePropertyImageRoomTypeKey(rawLabel);
        if (customKey) {
            return {
                key: customKey,
                label: rawLabel,
                confidence: normalizeConfidence(input?.confidence),
            };
        }
    }

    if (rawKey && rawKey !== PROPERTY_IMAGE_ROOM_TYPE_UNCLASSIFIED_KEY) {
        return {
            key: rawKey,
            label: rawLabel || humanizeRoomTypeKey(rawKey),
            confidence: normalizeConfidence(input?.confidence),
        };
    }

    if (rawLabel) {
        const customKey = normalizePropertyImageRoomTypeKey(rawLabel);
        if (customKey) {
            return {
                key: customKey,
                label: rawLabel,
                confidence: normalizeConfidence(input?.confidence),
            };
        }
    }

    return {
        key: PROPERTY_IMAGE_ROOM_TYPE_UNCLASSIFIED_KEY,
        label: PRESET_BY_KEY.get(PROPERTY_IMAGE_ROOM_TYPE_UNCLASSIFIED_KEY)?.label || "Unclassified",
        confidence: normalizeConfidence(input?.confidence),
    };
}

export function toRoomTypeSelectValue(roomTypeKey: string): string {
    const key = normalizePropertyImageRoomTypeKey(roomTypeKey);
    if (!key) return PROPERTY_IMAGE_ROOM_TYPE_UNCLASSIFIED_KEY;
    return PRESET_BY_KEY.has(key) ? key : PROPERTY_IMAGE_ROOM_TYPE_CUSTOM_KEY;
}
