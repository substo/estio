export const OPENAI_ORGANIZATION_COSTS_URL = "https://api.openai.com/v1/organization/costs";
export const OPENAI_ORGANIZATION_COSTS_REFERENCE_URL = "https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage";

export type OpenAiCostLineItem = {
    lineItem: string | null;
    amount: number;
    currency: string;
    quantity: number | null;
};

export type OpenAiOrganizationCostsSummary = {
    refreshedAt: string;
    startTime: number;
    endTime: number;
    totalCost: number;
    currency: string;
    bucketCount: number;
    lineItems: OpenAiCostLineItem[];
};

type OpenAiCostsResponse = {
    data?: Array<{
        start_time?: number;
        end_time?: number;
        results?: Array<{
            amount?: {
                currency?: string;
                value?: number;
            };
            line_item?: string | null;
            quantity?: number | null;
        }>;
    }>;
};

export function resolveOpenAiCostsApiKey(): string | null {
    return String(process.env.OPENAI_ADMIN_API_KEY || process.env.OPENAI_API_KEY || "").trim() || null;
}

export function buildOpenAiCostsUrl(options: {
    startTime: number;
    endTime: number;
    groupBy?: Array<"line_item" | "project_id">;
}): string {
    const url = new URL(OPENAI_ORGANIZATION_COSTS_URL);
    url.searchParams.set("start_time", String(Math.trunc(options.startTime)));
    url.searchParams.set("end_time", String(Math.trunc(options.endTime)));
    url.searchParams.set("bucket_width", "1d");
    for (const group of options.groupBy || ["line_item"]) {
        url.searchParams.append("group_by", group);
    }
    return url.toString();
}

function readFiniteNumber(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}

function summarizeOpenAiCosts(
    payload: OpenAiCostsResponse,
    options: { startTime: number; endTime: number; now?: Date }
): OpenAiOrganizationCostsSummary {
    const lineItemTotals = new Map<string, OpenAiCostLineItem>();
    let totalCost = 0;
    let currency = "usd";

    const buckets = Array.isArray(payload.data) ? payload.data : [];
    for (const bucket of buckets) {
        const results = Array.isArray(bucket.results) ? bucket.results : [];
        for (const result of results) {
            const amount = readFiniteNumber(result.amount?.value);
            const resultCurrency = String(result.amount?.currency || currency || "usd").toLowerCase();
            const lineItem = String(result.line_item || "unallocated").trim() || "unallocated";
            const quantity = result.quantity === null || result.quantity === undefined
                ? null
                : readFiniteNumber(result.quantity);
            const existing = lineItemTotals.get(lineItem) || {
                lineItem: lineItem === "unallocated" ? null : lineItem,
                amount: 0,
                currency: resultCurrency,
                quantity: null,
            };

            existing.amount += amount;
            if (quantity !== null) {
                existing.quantity = (existing.quantity || 0) + quantity;
            }
            existing.currency = resultCurrency;
            lineItemTotals.set(lineItem, existing);
            totalCost += amount;
            currency = resultCurrency;
        }
    }

    return {
        refreshedAt: (options.now || new Date()).toISOString(),
        startTime: Math.trunc(options.startTime),
        endTime: Math.trunc(options.endTime),
        totalCost,
        currency,
        bucketCount: buckets.length,
        lineItems: Array.from(lineItemTotals.values()).sort((a, b) => b.amount - a.amount),
    };
}

export async function fetchOpenAiOrganizationCostsSummary(options: {
    apiKey?: string | null;
    days?: number;
    now?: Date;
} = {}): Promise<OpenAiOrganizationCostsSummary> {
    const apiKey = String(options.apiKey || resolveOpenAiCostsApiKey() || "").trim();
    if (!apiKey) {
        throw new Error("No OpenAI admin API key configured for organization cost refresh.");
    }

    const now = options.now || new Date();
    const days = Math.max(1, Math.min(31, Math.trunc(options.days || 1)));
    const endTime = Math.floor(now.getTime() / 1000);
    const startTime = endTime - (days * 24 * 60 * 60);
    const response = await fetch(buildOpenAiCostsUrl({ startTime, endTime }), {
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });

    const payload = await response.json().catch(() => null) as OpenAiCostsResponse | null;
    if (!response.ok) {
        const message = (payload as any)?.error?.message || `${response.status} ${response.statusText}`;
        throw new Error(`OpenAI organization costs refresh failed: ${message}`);
    }

    return summarizeOpenAiCosts(payload || {}, { startTime, endTime, now });
}
