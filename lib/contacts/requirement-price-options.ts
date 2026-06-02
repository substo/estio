export const REQUIREMENT_PRICE_POINTS = [
    200, 300, 400, 500, 600, 700, 800, 900,
    1000, 1250, 1500, 1750, 2000, 2500, 3000, 4000, 5000, 7500, 10000,
    50000, 75000, 100000, 125000, 150000, 175000, 200000,
    250000, 300000, 350000, 400000, 450000, 500000,
    600000, 700000, 800000, 900000, 1000000,
    1250000, 1500000, 1750000, 2000000, 2500000, 3000000,
    4000000, 5000000, 10000000,
] as const;

export const REQUIREMENT_PRICE_SELECT_OPTIONS = [
    "Any",
    ...REQUIREMENT_PRICE_POINTS.map(formatRequirementPriceOption),
] as const;

export function formatRequirementPriceOption(value: number): string {
    return `€${value.toLocaleString("en-US")}`;
}

export function normalizeRequirementPriceOption(raw?: unknown): string | null {
    const value = String(raw ?? "").trim();
    if (!value || /^any$/i.test(value) || value === "0") return "Any";

    const numeric = Number(value.replace(/[€,\s]/g, ""));
    if (!Number.isFinite(numeric) || numeric <= 0) return value;

    return formatRequirementPriceOption(Math.round(numeric));
}

export function mapToRequirementPriceOption(value?: number): string | null {
    if (!value || value <= 0) return null;
    const eligible = REQUIREMENT_PRICE_POINTS.filter(p => p <= value);
    const selected = eligible.length > 0 ? eligible[eligible.length - 1] : REQUIREMENT_PRICE_POINTS[0];
    return formatRequirementPriceOption(selected);
}
