export const GEMINI_FLASH_LATEST_ALIAS = "gemini-flash-latest";
export const GEMINI_FLASH_STABLE_FALLBACK = "gemini-2.5-flash";
export const GEMINI_DRAFT_FAST_DEFAULT = "gemini-2.5-flash-lite";

export const GOOGLE_AI_MODELS = [
    // --- Gemini 3.0 Series (SOTA) ---
    { value: "gemini-3-pro-preview", label: "Gemini 3.0 Pro Preview (SOTA Reasoning)" },
    { value: "gemini-3-flash-preview", label: "Gemini 3.0 Flash Preview (Fastest & Newest)" },
    { value: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image (Nano Banana 2)" },
    { value: "gemini-3-pro-image-preview", label: "Gemini 3 Pro Image Preview (Nano Banana Pro)" },

    // --- Gemini 2.5 Series (Advanced) ---
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Advanced Coding & Reasoning)" },
    { value: GEMINI_FLASH_LATEST_ALIAS, label: "Gemini Flash Latest (Auto-updating Alias)" },
    { value: "gemini-flash-lite-latest", label: "Gemini Flash-Lite Latest" },
    { value: GEMINI_FLASH_STABLE_FALLBACK, label: "Gemini 2.5 Flash (Pinned Stable Fallback)" },
    { value: GEMINI_DRAFT_FAST_DEFAULT, label: "Gemini 2.5 Flash-Lite (Cost Effective)" },

    // --- Gemini 1.5 Series (Legacy) ---
    // Removed per user request
    // { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro (Legacy)" },

    // --- Specialized ---
    { value: "gemini-robotics-er-1.5-preview", label: "Gemini Robotics-ER 1.5 Preview" },
];
