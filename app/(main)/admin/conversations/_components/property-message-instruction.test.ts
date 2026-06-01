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
    assert.match(instruction, /1-3 short sentences/);
    assert.match(instruction, /Property URL: https:\/\/example.com\/listing\/123/);
    assert.match(instruction, /Lead asked for two bedrooms near the sea/);
    assert.match(instruction, /Do not use bullets/);
});

test("buildPropertyMessageInstruction trims oversized pasted property source", () => {
    const longText = "x".repeat(7000);
    const instruction = buildPropertyMessageInstruction({
        propertyText: longText,
        purpose: "follow_up",
        length: "detailed",
    });

    assert.match(instruction, /follow-up message/);
    assert.match(instruction, /still sounding like a human chat message/);
    assert.equal(instruction.includes("x".repeat(6100)), false);
});
