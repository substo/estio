export function formatIntegrationDate(
    value: Date | string | null | undefined,
    options: { year?: boolean } = {},
) {
    if (!value) return "-";

    return new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        ...(options.year ? { year: "numeric" as const } : {}),
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}
