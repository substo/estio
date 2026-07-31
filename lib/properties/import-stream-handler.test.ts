import assert from "node:assert/strict";
import test from "node:test";

import { createImportStreamHandlers } from "./import-stream-handler";

function harness() {
    const calls = { url: 0, paste: 0 };
    let lastUrlInput: Record<string, unknown> | null = null;
    let lastPasteInput: Record<string, unknown> | null = null;
    const handlers = createImportStreamHandlers({
        getAuthenticatedUser: async () => ({ id: "clerk-user" }),
        getActiveLocationId: async () => "location-a",
        getDefaultModel: async (locationId) => {
            assert.equal(locationId, "location-a");
            return "default-model";
        },
        runUrlImport: async function* (input) {
            calls.url += 1;
            lastUrlInput = input;
            yield { type: "result", propertyId: "property-a" };
        },
        runPasteImport: async function* (input) {
            calls.paste += 1;
            lastPasteInput = input;
            yield { type: "result", propertyId: "property-b" };
        },
    });
    return {
        calls,
        handlers,
        getLastPasteInput: () => lastPasteInput,
        getLastUrlInput: () => lastUrlInput,
    };
}

test("GET is read-only and returns 405 without invoking a workflow", async () => {
    const testHarness = harness();
    const response = await testHarness.handlers.GET();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
    assert.deepEqual(testHarness.calls, { url: 0, paste: 0 });
});

test("authenticated same-origin POST runs the URL workflow as NDJSON", async () => {
    const testHarness = harness();
    const response = await testHarness.handlers.POST(new Request("https://app.example/api/import-stream", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            origin: "https://app.example",
            "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ type: "url", notionUrl: "https://source.example/listing", maxImages: 5000 }),
    }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /application\/x-ndjson/);
    assert.match(await response.text(), /"propertyId":"property-a"/);
    assert.equal(testHarness.calls.url, 1);
    assert.equal(testHarness.getLastUrlInput()?.maxImages, 50);
});

test("the real paste contract uses server context and returns an NDJSON result", async () => {
    const testHarness = harness();
    const response = await testHarness.handlers.POST(new Request("https://app.example/api/import-stream", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            origin: "https://app.example",
            "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({
            type: "paste",
            text: "Three-bedroom shared listing",
            analysisImages: ["analysis-a"],
            galleryImages: ["gallery-a"],
        }),
    }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /application\/x-ndjson/);
    assert.match(await response.text(), /"propertyId":"property-b"/);
    assert.deepEqual(testHarness.calls, { url: 0, paste: 1 });
    assert.deepEqual(testHarness.getLastPasteInput(), {
        text: "Three-bedroom shared listing",
        analysisImages: ["analysis-a"],
        galleryImages: ["gallery-a"],
        model: "default-model",
        clerkUserId: "clerk-user",
        hints: undefined,
    });
});

test("an unexpected paste field remains rejected by the strict contract", async () => {
    const testHarness = harness();
    const response = await testHarness.handlers.POST(new Request("https://app.example/api/import-stream", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.example" },
        body: JSON.stringify({
            type: "paste",
            text: "Listing",
            analysisImages: [],
            galleryImages: [],
            maxImages: 50,
        }),
    }));
    assert.equal(response.status, 400);
    assert.deepEqual(testHarness.calls, { url: 0, paste: 0 });
});

test("POST rejects cross-origin, non-JSON, and malformed requests before workflows", async () => {
    const testHarness = harness();
    const crossOrigin = await testHarness.handlers.POST(new Request("https://app.example/api/import-stream", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({ type: "url", notionUrl: "https://source.example" }),
    }));
    assert.equal(crossOrigin.status, 403);

    const nonJson = await testHarness.handlers.POST(new Request("https://app.example/api/import-stream", {
        method: "POST",
        headers: { "content-type": "text/plain", origin: "https://app.example" },
        body: "nope",
    }));
    assert.equal(nonJson.status, 415);

    const malformed = await testHarness.handlers.POST(new Request("https://app.example/api/import-stream", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.example" },
        body: JSON.stringify({ type: "url", notionUrl: "not-a-url" }),
    }));
    assert.equal(malformed.status, 400);
    assert.deepEqual(testHarness.calls, { url: 0, paste: 0 });
});

test("streamed warnings remain generic and do not disclose the source URL", async () => {
    const sourceUrl = "https://source.example/image-with-secret-token.jpg";
    const handlers = createImportStreamHandlers({
        getAuthenticatedUser: async () => ({ id: "clerk-user" }),
        getActiveLocationId: async () => "location-a",
        getDefaultModel: async () => "model",
        runUrlImport: async function* () {
            yield { type: "status", message: "Skipped 1 image that could not be authorized or imported." };
            yield { type: "result", warnings: ["An image could not be authorized or imported."] };
        },
        runPasteImport: async function* () { yield { type: "result" }; },
    });
    const response = await handlers.POST(new Request("https://app.example/api/import-stream", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.example" },
        body: JSON.stringify({ type: "url", notionUrl: sourceUrl }),
    }));
    const streamed = await response.text();
    assert.equal(streamed.includes(sourceUrl), false);
    assert.match(streamed, /could not be authorized or imported/);
});
