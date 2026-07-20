export type SessionAuthRetentionGeneration = {
    generation: number;
    objectKey: string;
    status: string;
    createdAt: Date;
    retentionUntil: Date | null;
};

function weekKey(date: Date) {
    const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = value.getUTCDay() || 7;
    value.setUTCDate(value.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
    return `${value.getUTCFullYear()}-${Math.ceil((((value.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7)}`;
}

export function selectSessionAuthGenerationsForDeletion<T extends SessionAuthRetentionGeneration>(args: {
    generations: T[];
    currentGeneration: number;
    lastKnownGoodGeneration: number;
    now?: Date;
}): T[] {
    const now = args.now || new Date();
    const ordered = [...args.generations].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const keep = new Set([args.currentGeneration, args.lastKnownGoodGeneration]);
    const days = new Set<string>();
    const weeks = new Set<string>();
    for (const item of ordered) {
        if (item.status === "pending" || (item.retentionUntil && item.retentionUntil > now)) keep.add(item.generation);
        const day = item.createdAt.toISOString().slice(0, 10);
        if (days.size < 7 && !days.has(day)) { days.add(day); keep.add(item.generation); }
        const week = weekKey(item.createdAt);
        if (weeks.size < 4 && !weeks.has(week)) { weeks.add(week); keep.add(item.generation); }
    }
    return ordered.filter((item) =>
        ["verified", "retired", "quarantined"].includes(item.status)
        && !keep.has(item.generation)
        && (!item.retentionUntil || item.retentionUntil <= now)
    );
}
