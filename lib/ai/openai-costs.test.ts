import test from "node:test";
import assert from "node:assert/strict";

import {
    buildOpenAiCostsUrl,
    fetchOpenAiOrganizationCostsSummary,
    OPENAI_ORGANIZATION_COSTS_URL,
} from "./openai-costs";

test("buildOpenAiCostsUrl requests daily line-item costs", () => {
    const url = new URL(buildOpenAiCostsUrl({
        startTime: 1710000000,
        endTime: 1710086400,
    }));

    assert.equal(`${url.origin}${url.pathname}`, OPENAI_ORGANIZATION_COSTS_URL);
    assert.equal(url.searchParams.get("start_time"), "1710000000");
    assert.equal(url.searchParams.get("end_time"), "1710086400");
    assert.equal(url.searchParams.get("bucket_width"), "1d");
    assert.deepEqual(url.searchParams.getAll("group_by"), ["line_item"]);
});

test("fetchOpenAiOrganizationCostsSummary aggregates official costs response", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        return new Response(JSON.stringify({
            object: "page",
            data: [
                {
                    object: "bucket",
                    start_time: 1710000000,
                    end_time: 1710086400,
                    results: [
                        {
                            object: "organization.costs.result",
                            amount: { value: 1.25, currency: "usd" },
                            line_item: "Responses API",
                            quantity: 10,
                        },
                        {
                            object: "organization.costs.result",
                            amount: { value: 0.75, currency: "usd" },
                            line_item: "Responses API",
                            quantity: 5,
                        },
                    ],
                },
                {
                    object: "bucket",
                    start_time: 1710086400,
                    end_time: 1710172800,
                    results: [
                        {
                            object: "organization.costs.result",
                            amount: { value: 0.5, currency: "usd" },
                            line_item: "Embeddings",
                            quantity: 2,
                        },
                    ],
                },
            ],
        }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
        const summary = await fetchOpenAiOrganizationCostsSummary({
            apiKey: "sk-admin-test",
            days: 2,
            now: new Date("2024-03-11T00:00:00.000Z"),
        });

        assert.equal(requests.length, 1);
        assert.equal((requests[0].init?.headers as Record<string, string>).Authorization, "Bearer sk-admin-test");
        assert.equal(summary.totalCost, 2.5);
        assert.equal(summary.currency, "usd");
        assert.equal(summary.bucketCount, 2);
        assert.deepEqual(summary.lineItems.map((item) => ({
            lineItem: item.lineItem,
            amount: item.amount,
            quantity: item.quantity,
        })), [
            { lineItem: "Responses API", amount: 2, quantity: 15 },
            { lineItem: "Embeddings", amount: 0.5, quantity: 2 },
        ]);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
