import assert from "node:assert/strict";
import test from "node:test";

import { getConversationLifecycleUi } from "./conversation-status-ui";

test("conversation lifecycle label avoids implying send-channel availability", () => {
    const open = getConversationLifecycleUi("open");

    assert.equal(open.label, "Conversation open");
    assert.match(open.dotClassName, /blue/);
});

test("conversation lifecycle labels closed conversations neutrally", () => {
    const closed = getConversationLifecycleUi("closed");

    assert.equal(closed.label, "Closed");
    assert.match(closed.dotClassName, /slate/);
});
