export const GEMINI_FLASH_LATEST_ALIAS = "gemini-flash-latest";
export const GEMINI_FLASH_LITE_LATEST_ALIAS = "gemini-flash-lite-latest";
export const GEMINI_FLASH_STABLE_FALLBACK = "gemini-2.5-flash";
export const GEMINI_DRAFT_FAST_DEFAULT = "gemini-2.5-flash-lite";
export const GEMINI_IMAGE_FAST_DEFAULT = "gemini-3.1-flash-lite-image";
export const GEMINI_IMAGE_GENERAL_DEFAULT = "gemini-3.1-flash-image";
export const GEMINI_IMAGE_PRO_DEFAULT = "gemini-3-pro-image";
export const GEMINI_IMAGE_LEGACY_FALLBACK = "gemini-2.5-flash-image";

export const GOOGLE_AI_MODELS = [
    // --- Gemini 3.0 Series (SOTA) ---
    { value: "gemini-3-pro-preview", label: "Gemini 3.0 Pro Preview (SOTA Reasoning)" },
    { value: "gemini-3-flash-preview", label: "Gemini 3.0 Flash Preview (Fastest & Newest)" },

    // --- Gemini Native Image Generation (Nano Banana) ---
    { value: GEMINI_IMAGE_FAST_DEFAULT, label: "Gemini 3.1 Flash-Lite Image (Nano Banana 2 Lite)" },
    { value: GEMINI_IMAGE_GENERAL_DEFAULT, label: "Gemini 3.1 Flash Image (Nano Banana 2)" },
    { value: GEMINI_IMAGE_PRO_DEFAULT, label: "Gemini 3 Pro Image (Nano Banana Pro)" },
    { value: "gemini-3-pro-image-preview", label: "Gemini 3 Pro Image Preview (Nano Banana Pro Preview)" },
    { value: GEMINI_IMAGE_LEGACY_FALLBACK, label: "Gemini 2.5 Flash Image (Nano Banana Legacy)" },

    // --- Gemini 2.5 Series (Advanced) ---
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Advanced Coding & Reasoning)" },
    { value: GEMINI_FLASH_LATEST_ALIAS, label: "Gemini Flash Latest (Auto-updating Alias)" },
    { value: GEMINI_FLASH_LITE_LATEST_ALIAS, label: "Gemini Flash-Lite Latest" },
    { value: GEMINI_FLASH_STABLE_FALLBACK, label: "Gemini 2.5 Flash (Pinned Stable Fallback)" },
    { value: GEMINI_DRAFT_FAST_DEFAULT, label: "Gemini 2.5 Flash-Lite (Cost Effective)" },

    // --- Gemini 1.5 Series (Legacy) ---
    // Removed per user request
    // { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro (Legacy)" },

    // --- Specialized ---
    { value: "gemini-robotics-er-1.5-preview", label: "Gemini Robotics-ER 1.5 Preview" },
];
