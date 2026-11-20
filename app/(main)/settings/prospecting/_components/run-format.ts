export function formatRunTime(value: Date | string | null | undefined) {
    if (!value) return '—';

    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';

    return date.toLocaleString('en-GB', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

export function formatRunDuration(
    start: Date | string,
    end: Date | string | null | undefined,
    options: { useNowWhenMissingEnd?: boolean } = {},
) {
    const startMs = new Date(start).getTime();
    if (!Number.isFinite(startMs)) return '—';

    if (!end && !options.useNowWhenMissingEnd) return '—';

    const endMs = end ? new Date(end).getTime() : Date.now();
    if (!Number.isFinite(endMs)) return '—';

    const ms = Math.max(0, endMs - startMs);
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
