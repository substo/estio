const LEADING_PUNCTUATION = /^[,.;:!?%)\]\}]/;
const TRAILING_JOIN_MARK = /[(\[{/#@-]$/;
const TRAILING_CURRENCY = /[€£$¥₩₹₺₽₪₴₦₱]$/;
const TRAILING_WORD = /[\p{L}\p{N}]$/u;
const LEADING_WORD = /^[\p{L}\p{N}]/u;

function getCurrentTokenTail(text: string) {
    const match = text.match(/\S+$/);
    return match?.[0] || "";
}

function isLikelyUrlTail(text: string) {
    const tail = getCurrentTokenTail(text);
    return /^(?:https?:\/\/|www\.)/i.test(tail);
}

export function appendAiStreamText(current: string, chunk: string) {
    const next = String(chunk || "");
    if (!next) return current;
    if (!current) return next;

    const last = current[current.length - 1] || "";
    const first = next[0] || "";
    if (!last || !first) return current + next;
    if (/\s/.test(last) || /\s/.test(first)) return current + next;
    if (LEADING_PUNCTUATION.test(first)) return current + next;
    if (TRAILING_JOIN_MARK.test(last) || TRAILING_CURRENCY.test(last)) return current + next;
    if (first === "'" || last === "'" || isLikelyUrlTail(current)) return current + next;

    if (TRAILING_WORD.test(last) && LEADING_WORD.test(first)) {
        return `${current} ${next}`;
    }

    return current + next;
}
