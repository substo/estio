import test from "node:test";
import assert from "node:assert/strict";
import { buildTimelineCursorFromEvent } from "./timeline-cursor.ts";

test("buildTimelineCursorFromEvent returns timestamp and event id", () => {
    const event = {
        id: "message:msg_1",
        createdAt: "2026-03-13T11:22:33.000Z",
    };

    assert.equal(
        buildTimelineCursorFromEvent(event),
        `${new Date(event.createdAt).getTime()}::message:msg_1`
    );
    assert.equal(buildTimelineCursorFromEvent({ id: "bad", createdAt: "invalid" }), null);
});
