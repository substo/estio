import assert from "node:assert/strict";
import test from "node:test";

import { buildComposerSuggestionBubbles } from "./conversation-composer-suggestions";

test("buildComposerSuggestionBubbles falls back to quick actions when server suggestions are empty", () => {
    assert.deepEqual(
        buildComposerSuggestionBubbles([], ["Best next reply", "Short and direct"]),
        ["Best next reply", "Short and direct"],
    );
});

test("buildComposerSuggestionBubbles keeps server suggestions before quick actions", () => {
    assert.deepEqual(
        buildComposerSuggestionBubbles(["Draft a follow-up"], ["Best next reply", "Short and direct"]),
        ["Draft a follow-up", "Best next reply", "Short and direct"],
    );
});

test("buildComposerSuggestionBubbles dedupes suggestions case-insensitively", () => {
    assert.deepEqual(
        buildComposerSuggestionBubbles(["Short and direct"], ["short and direct", "Warmer"]),
        ["Short and direct", "Warmer"],
    );
});

test("buildComposerSuggestionBubbles caps visible bubbles", () => {
    assert.deepEqual(
        buildComposerSuggestionBubbles(
            ["One", "Two", "Three"],
            ["Four", "Five", "Six"],
            4,
        ),
        ["One", "Two", "Three", "Four"],
    );
});
