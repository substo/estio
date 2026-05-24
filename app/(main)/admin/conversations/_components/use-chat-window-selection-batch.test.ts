import assert from "node:assert/strict";
import test from "node:test";

import { parseSummarizeStreamResponse } from "./use-chat-window-selection-batch";

function streamResponse(lines: string[], init?: ResponseInit) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const line of lines) {
                controller.enqueue(encoder.encode(line));
            }
            controller.close();
        },
    });
    return new Response(stream, init);
}

test("parseSummarizeStreamResponse reads newline JSON complete payloads", async () => {
    const result = await parseSummarizeStreamResponse(streamResponse([
        "{\"type\":\"chunk\",\"delta\":\"ignored\"}\n",
        "{\"type\":\"complete\",\"entry\":\"CRM entry\",\"skipped\":true}\n",
    ]));

    assert.deepEqual(result, {
        entry: "CRM entry",
        skipped: true,
    });
});

test("parseSummarizeStreamResponse handles a final unterminated JSON line", async () => {
    const result = await parseSummarizeStreamResponse(streamResponse([
        "{\"type\":\"complete\",\"entry\":\"Final entry\",\"skipped\":false}",
    ]));

    assert.deepEqual(result, {
        entry: "Final entry",
        skipped: false,
    });
});

test("parseSummarizeStreamResponse ignores malformed lines and throws stream errors", async () => {
    await assert.rejects(
        parseSummarizeStreamResponse(streamResponse([
            "not json\n",
            "{\"type\":\"error\",\"message\":\"Model unavailable\"}\n",
        ])),
        /Model unavailable/
    );
});

test("parseSummarizeStreamResponse rejects unavailable streams", async () => {
    await assert.rejects(
        parseSummarizeStreamResponse(new Response(null, { status: 500 })),
        /Stream unavailable/
    );
});
