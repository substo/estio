export type TimelineCursorEventLike = {
    id?: string | null;
    createdAt?: string | null;
};

export function buildTimelineCursorFromEvent(event?: TimelineCursorEventLike | null): string | null {
    if (!event?.id) return null;
    const createdAtMs = Number(new Date(event.createdAt as any).getTime());
    if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return null;
    return `${createdAtMs}::${String(event.id)}`;
}
