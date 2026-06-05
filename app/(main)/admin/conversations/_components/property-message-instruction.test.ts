import assert from "node:assert/strict";
import test from "node:test";

import { buildPropertyMessageInstruction } from "./property-message-instruction";

test("buildPropertyMessageInstruction creates conversational property draft instructions", () => {
    const instruction = buildPropertyMessageInstruction({
        propertyUrl: "https://example.com/listing/123",
        propertyText: "Two bedroom apartment in Limassol. Price EUR 1,200.",
        importantDetails: "Lead asked for two bedrooms near the sea.",
        purpose: "new_listing",
        length: "short",
    });

    assert.match(instruction, /new-listing notification/);
    assert.match(instruction, /2-3 short chat lines/);
    assert.match(instruction, /Property URL: https:\/\/example.com\/listing\/123/);
    assert.match(instruction, /Lead asked for two bedrooms near the sea/);
    assert.match(instruction, /each idea on its own short line/);
    assert.match(instruction, /Never return one bulky paragraph/);
    assert.match(instruction, /URL is provided.*after a blank line/);
    assert.match(instruction, /Do not use bullets/);
});

test("buildPropertyMessageInstruction trims oversized pasted property source", () => {
    const longText = "x".repeat(12000);
    const instruction = buildPropertyMessageInstruction({
        propertyText: longText,
        purpose: "follow_up",
        length: "detailed",
    });

    assert.match(instruction, /follow-up message/);
    assert.match(instruction, /short chat lines instead of a bulky paragraph/);
    assert.equal(instruction.includes("x".repeat(10100)), false);
});

test("buildPropertyMessageInstruction creates options instructions for multiple URLs", () => {
    const instruction = buildPropertyMessageInstruction({
        propertyUrls: [
            "https://example.com/listing/a",
            "https://example.com/listing/b",
        ],
        propertyText: "Property option 1\nURL: https://example.com/listing/a\nExtracted text:\nTwo bedrooms",
        importantDetails: "Client wants two bedrooms and parking.",
        purpose: "follow_up",
        length: "medium",
    });

    assert.match(instruction, /one natural options message/);
    assert.match(instruction, /3-4 short chat lines, not one paragraph/);
    assert.match(instruction, /Property URLs:\n1\. https:\/\/example.com\/listing\/a\n2\. https:\/\/example.com\/listing\/b/);
    assert.match(instruction, /Do not use bullets/);
    assert.match(instruction, /Client wants two bedrooms and parking/);
});

test("buildPropertyMessageInstruction gives new listings a chat line shape", () => {
    const instruction = buildPropertyMessageInstruction({
        propertyUrl: "https://example.com/listing/new",
        propertyText: "Newly renovated one-bedroom apartment in Peyia. Price EUR 149,000. Clean title deeds. Communal pool.",
        purpose: "new_listing",
    });

    assert.match(instruction, /quick personal hook, 2-3 key facts, one light benefit/i);
    assert.match(instruction, /clear CTA and the URL on its own line/i);
    assert.match(instruction, /facts first and benefits lightly/i);
    assert.match(instruction, /Avoid brochure language, over-explaining investment logic, or salesy claims/i);
    assert.match(instruction, /Use at most one simple emoji/i);
    assert.match(instruction, /Never return one bulky paragraph/);
    assert.match(instruction, /Do not put more than 1-2 short sentences on the same line or paragraph/);
    assert.match(instruction, /https:\/\/example.com\/listing\/new/);
});

test("buildPropertyMessageInstruction defaults to short mobile-first new listing copy", () => {
    const instruction = buildPropertyMessageInstruction({
        propertyUrl: "https://example.com/listing/default",
        propertyText: "One-bedroom apartment in Peyia. EUR 149,000.",
    });

    assert.match(instruction, /2-3 short chat lines/);
    assert.doesNotMatch(instruction, /3-4 short chat lines, not one paragraph/);
});

test("buildPropertyMessageInstruction dedupes legacy and multi URL inputs", () => {
    const instruction = buildPropertyMessageInstruction({
        propertyUrl: "https://example.com/listing/a",
        propertyUrls: [
            "https://example.com/listing/a",
            "https://example.com/listing/b",
        ],
    });

    assert.match(instruction, /1\. https:\/\/example.com\/listing\/a\n2\. https:\/\/example.com\/listing\/b/);
    assert.equal((instruction.match(/https:\/\/example.com\/listing\/a/g) || []).length, 1);
});
