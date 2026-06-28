import test from "node:test";
import assert from "node:assert/strict";

import { callLLMWithMetadata } from "./llm";

test("callLLMWithMetadata routes openai-prefixed models through Responses API", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.OPENAI_API_KEY;
    const requests: Array<{ url: string; init?: RequestInit }> = [];

    process.env.OPENAI_API_KEY = "sk-test";
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        return new Response(JSON.stringify({
            output_text: "hello from openai",
            usage: {
                input_tokens: 12,
                output_tokens: 7,
                total_tokens: 19,
                input_tokens_details: { cached_tokens: 3 },
            },
        }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
        const result = await callLLMWithMetadata(
            "openai:gpt-test",
            "System instructions",
            "User input",
            { temperature: 0.2, maxOutputTokens: 64, jsonMode: true }
        );

        assert.equal(result.text, "hello from openai");
        assert.equal(result.provider, "openai");
        assert.equal(result.model, "gpt-test");
        assert.equal(result.usage.promptTokens, 12);
        assert.equal(result.usage.completionTokens, 7);
        assert.equal(result.usage.totalTokens, 19);
        assert.equal(result.usage.cachedContentTokens, 3);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, "https://api.openai.com/v1/responses");
        assert.equal((requests[0].init?.headers as Record<string, string>).Authorization, "Bearer sk-test");

        const body = JSON.parse(String(requests[0].init?.body || "{}"));
        assert.equal(body.model, "gpt-test");
        assert.equal(body.instructions, "System instructions");
        assert.equal(body.input, "User input");
        assert.equal(body.max_output_tokens, 64);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalApiKey === undefined) {
            delete process.env.OPENAI_API_KEY;
        } else {
            process.env.OPENAI_API_KEY = originalApiKey;
        }
    }
});

test("callLLMWithMetadata fails before calling OpenAI when no key is configured", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.OPENAI_API_KEY;
    let fetchCalls = 0;

    delete process.env.OPENAI_API_KEY;
    globalThis.fetch = (async () => {
        fetchCalls += 1;
        return new Response("{}", { status: 200 });
    }) as typeof fetch;

    try {
        await assert.rejects(
            () => callLLMWithMetadata("openai:gpt-test", "System instructions", "User input"),
            /No OpenAI API key configured\. Add a personal OpenAI key in your profile, or add a location OpenAI key in AI settings\./
        );
        assert.equal(fetchCalls, 0);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalApiKey === undefined) {
            delete process.env.OPENAI_API_KEY;
        } else {
            process.env.OPENAI_API_KEY = originalApiKey;
        }
    }
});
