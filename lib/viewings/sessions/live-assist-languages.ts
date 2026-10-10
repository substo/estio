import { REPLY_LANGUAGE_OPTIONS } from "../../ai/reply-language-options";

const EXTRA_LANGUAGE_OPTIONS = [
    { value: "nl", label: "Dutch (nl)" },
    { value: "sv", label: "Swedish (sv)" },
    { value: "fi", label: "Finnish (fi)" },
    { value: "da", label: "Danish (da)" },
    { value: "no", label: "Norwegian (no)" },
    { value: "cs", label: "Czech (cs)" },
    { value: "sk", label: "Slovak (sk)" },
    { value: "sr", label: "Serbian (sr)" },
    { value: "hr", label: "Croatian (hr)" },
    { value: "hi", label: "Hindi (hi)" },
    { value: "ur", label: "Urdu (ur)" },
    { value: "fa", label: "Persian (fa)" },
];

export const LIVE_ASSIST_LANGUAGE_OPTIONS = [...REPLY_LANGUAGE_OPTIONS, ...EXTRA_LANGUAGE_OPTIONS];

