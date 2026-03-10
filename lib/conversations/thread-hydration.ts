import type { Message } from "@/lib/ghl/conversations";

export const THREAD_INITIAL_MIN_MESSAGES = 35;
export const THREAD_INITIAL_MAX_MESSAGES = 60;
export const THREAD_INITIAL_FALLBACK_MESSAGES = 40;
export const THREAD_TARGET_MESSAGE_COUNT = 250;

const ESTIMATED_MESSAGE_ROW_HEIGHT_PX = 72;
const ESTIMATED_VIEWPORT_BUFFER_ROWS = 4;

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

export function computeInitialMessageLimitFromViewport(viewportHeightPx?: number | null): number {
    const numericHeight = Number(viewportHeightPx);
    if (!Number.isFinite(numericHeight) || numericHeight <= 0) {
        return THREAD_INITIAL_FALLBACK_MESSAGES;
    }

    const estimatedRows = Math.ceil(numericHeight / ESTIMATED_MESSAGE_ROW_HEIGHT_PX) + ESTIMATED_VIEWPORT_BUFFER_ROWS;
    return clamp(estimatedRows, THREAD_INITIAL_MIN_MESSAGES, THREAD_INITIAL_MAX_MESSAGES);
}

export function buildMessageCursorFromMessage(
    message?: Pick<Message, "id" | "dateAdded"> | null
): string | null {
    if (!message?.id) return null;
    const messageTsMs = Number(new Date(message.dateAdded as any).getTime());
    if (!Number.isFinite(messageTsMs) || messageTsMs <= 0) return null;
    return `${messageTsMs}::${String(message.id)}`;
}

export function mergePrependMessagesDedupe(existing: Message[], older: Message[]): Message[] {
    if (!Array.isArray(existing) || existing.length === 0) {
        return Array.isArray(older) ? [...older] : [];
    }
    if (!Array.isArray(older) || older.length === 0) {
        return [...existing];
    }

    const seen = new Set(existing.map((message) => message.id));
    const prepend: Message[] = [];
    for (const message of older) {
        if (!message?.id || seen.has(message.id)) continue;
        seen.add(message.id);
        prepend.push(message);
    }
    return prepend.length > 0 ? [...prepend, ...existing] : [...existing];
}

export function calculatePrependScrollTop(
    previousScrollTop: number,
    previousScrollHeight: number,
    nextScrollHeight: number
): number {
    const prevTop = Number.isFinite(previousScrollTop) ? Math.max(previousScrollTop, 0) : 0;
    const prevHeight = Number.isFinite(previousScrollHeight) ? Math.max(previousScrollHeight, 0) : 0;
    const nextHeight = Number.isFinite(nextScrollHeight) ? Math.max(nextScrollHeight, 0) : 0;
    const delta = Math.max(nextHeight - prevHeight, 0);
    return prevTop + delta;
}
