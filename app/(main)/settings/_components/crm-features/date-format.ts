export function formatAiSettingsDateLabel(
    value: string | null | undefined,
    fallback: string,
): string {
    if (!value) return fallback;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;

    return date.toLocaleString();
}
