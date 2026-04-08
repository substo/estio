export type PrecisionRemoveSmartMaskMode = "background" | "foreground" | "semantic";

export type PrecisionRemoveSmartPreset = {
    key: "remove_people" | "remove_background";
    label: string;
    description: string;
    maskMode: PrecisionRemoveSmartMaskMode;
    semanticMaskClassIds?: number[];
};

// Canonical one-click presets used by Precision Remove.
// "remove_people" currently uses foreground segmentation because it is the most stable cross-model behavior.
export const PRECISION_REMOVE_SMART_PRESETS: PrecisionRemoveSmartPreset[] = [
    {
        key: "remove_people",
        label: "Remove People",
        description: "Automatically target foreground subjects and remove people.",
        maskMode: "foreground",
    },
    {
        key: "remove_background",
        label: "Remove Background",
        description: "Automatically isolate and remove background context.",
        maskMode: "background",
    },
];
