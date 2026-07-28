export const DRAFT_OUTPUT_LENGTH_OPTIONS = [
    {
        value: "auto",
        label: "Auto length",
        shortLabel: "Auto",
        description: "Adapts to the request with extra room for model reasoning.",
    },
    {
        value: "short",
        label: "Short",
        shortLabel: "Short",
        description: "A concise reply, usually one to three short paragraphs.",
    },
    {
        value: "standard",
        label: "Standard",
        shortLabel: "Standard",
        description: "A balanced reply with enough detail for most conversations.",
    },
    {
        value: "long",
        label: "Long",
        shortLabel: "Long",
        description: "A thorough reply for complex instructions or detailed emails.",
    },
] as const;

export type DraftOutputLength = typeof DRAFT_OUTPUT_LENGTH_OPTIONS[number]["value"];

export const DEFAULT_DRAFT_OUTPUT_LENGTH: DraftOutputLength = "auto";
export const DRAFT_OUTPUT_LENGTH_STORAGE_KEY = "estio:conversation-draft-output-length:v1";

const DRAFT_OUTPUT_TOKEN_BUDGETS: Record<
    DraftOutputLength,
    { chat: number; email: number }
> = {
    auto: { chat: 4096, email: 8192 },
    short: { chat: 2048, email: 3072 },
    standard: { chat: 4096, email: 6144 },
    long: { chat: 8192, email: 12288 },
};

export const MAX_DRAFT_OUTPUT_TOKENS = 16384;
const PRESERVED_TEXT_TOKEN_HEADROOM = 512;
const PRESERVED_TEXT_CHARS_PER_TOKEN = 3;

export function normalizeDraftOutputLength(value: unknown): DraftOutputLength {
    const normalized = String(value || "").trim().toLowerCase();
    return DRAFT_OUTPUT_LENGTH_OPTIONS.some((option) => option.value === normalized)
        ? normalized as DraftOutputLength
        : DEFAULT_DRAFT_OUTPUT_LENGTH;
}

export function getDraftOutputLengthInstruction(value: unknown, isEmail: boolean): string {
    const preference = normalizeDraftOutputLength(value);
    if (preference === "short") {
        return isEmail
            ? "Keep the email concise and focused. Prefer a few short paragraphs unless the requested facts require more."
            : "Keep the reply brief and direct, usually one to three short paragraphs.";
    }
    if (preference === "standard") {
        return "Use a balanced amount of detail: fully answer the request without unnecessary expansion.";
    }
    if (preference === "long") {
        return "Provide a thorough, well-structured response and include all relevant requested details without filler.";
    }
    return "Choose the minimum sufficient length for the request, but do not omit requested facts or stop mid-response.";
}

export function resolveDraftOutputTokenBudget(args: {
    preference?: unknown;
    isEmail: boolean;
    modelMaxOutputTokens: number;
    preservedText?: string | null;
    minimumOutputTokens?: number;
}): number {
    const preference = normalizeDraftOutputLength(args.preference);
    const baseline = DRAFT_OUTPUT_TOKEN_BUDGETS[preference][args.isEmail ? "email" : "chat"];
    const preservedChars = String(args.preservedText || "").length;
    const preservationBudget = preservedChars
        ? Math.ceil(preservedChars / PRESERVED_TEXT_CHARS_PER_TOKEN) + PRESERVED_TEXT_TOKEN_HEADROOM
        : 0;
    const modelMaxOutputTokens = Number.isFinite(args.modelMaxOutputTokens)
        ? Math.floor(args.modelMaxOutputTokens)
        : MAX_DRAFT_OUTPUT_TOKENS;
    const safeModelLimit = Math.max(
        1,
        Math.min(
            modelMaxOutputTokens,
            MAX_DRAFT_OUTPUT_TOKENS
        )
    );
    const minimumOutputTokens = Number.isFinite(args.minimumOutputTokens)
        ? Math.max(0, Math.floor(Number(args.minimumOutputTokens)))
        : 0;

    return Math.min(safeModelLimit, Math.max(baseline, preservationBudget, minimumOutputTokens));
}
