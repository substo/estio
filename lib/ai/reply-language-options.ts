import { normalizeLanguageTag } from "@/lib/ai/prompts/communication-policy";

export type ReplyLanguageOption = {
    value: string;
    label: string;
};

export const REPLY_LANGUAGE_AUTO_VALUE = "auto";
export const DEFAULT_REPLY_LANGUAGE = "en";

export const REPLY_LANGUAGE_OPTIONS: ReplyLanguageOption[] = [
    { value: "en", label: "English (en)" },
    { value: "el", label: "Greek (el)" },
    { value: "es", label: "Spanish (es)" },
    { value: "fr", label: "French (fr)" },
    { value: "de", label: "German (de)" },
    { value: "it", label: "Italian (it)" },
    { value: "pt", label: "Portuguese (pt)" },
    { value: "tr", label: "Turkish (tr)" },
    { value: "ru", label: "Russian (ru)" },
    { value: "uk", label: "Ukrainian (uk)" },
    { value: "ro", label: "Romanian (ro)" },
    { value: "pl", label: "Polish (pl)" },
    { value: "bg", label: "Bulgarian (bg)" },
    { value: "ar", label: "Arabic (ar)" },
    { value: "he", label: "Hebrew (he)" },
];

const REPLY_LANGUAGE_LABEL_MAP = new Map(
    REPLY_LANGUAGE_OPTIONS.map((option) => [option.value, option.label] as const)
);

export function normalizeReplyLanguage(value: string | null | undefined): string | null {
    const raw = String(value || "").trim();
    if (!raw) return null;
    if (raw.toLowerCase() === REPLY_LANGUAGE_AUTO_VALUE) return null;
    return normalizeLanguageTag(raw);
}

export function getReplyLanguageLabel(value: string | null | undefined): string | null {
    const normalized = normalizeReplyLanguage(value);
    if (!normalized) return null;

    const base = normalized.split("-")[0];
    return REPLY_LANGUAGE_LABEL_MAP.get(normalized)
        || REPLY_LANGUAGE_LABEL_MAP.get(base)
        || `${normalized}`;
}
