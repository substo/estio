import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
    isOperationalRequestAuthorized,
    readBoundedOperationalJson,
    readOperationalChangeReference,
    sanitizeOperationalError,
    writeOperationalJson,
} from "./operational-http";

function request(headers: Record<string, string> = {}, body = "") {
    const stream = new EventEmitter() as any;
    stream.headers = headers;
    stream[Symbol.asyncIterator] = async function* () { if (body) yield Buffer.from(body); };
    return stream;
}

test("operational authentication fails closed and change references are bounded", () => {
    assert.equal(isOperationalRequestAuthorized({ request: request(), headerName: "x-secret", secret: "" }), false);
    assert.equal(isOperationalRequestAuthorized({ request: request({ "x-secret": "value" }), headerName: "x-secret", secret: "value" }), true);
    assert.equal(readOperationalChangeReference(request({ "x-change-ref": "CHG-123" })), "CHG-123");
    assert.equal(readOperationalChangeReference(request({ "x-change-ref": "phone +357 999" })), null);
});

test("operational JSON is bounded, no-store, and rejects malformed input", async () => {
    assert.deepEqual(await readBoundedOperationalJson(request({}, "{\"ok\":true}"), 32), { ok: true });
    await assert.rejects(() => readBoundedOperationalJson(request({}, "x".repeat(33)), 32), /operational_body_too_large/);
    await assert.rejects(() => readBoundedOperationalJson(request({}, "{"), 32), /operational_body_invalid/);
    const response = { writeHead: (...args: any[]) => { (response as any).head = args; }, end: (value: string) => { (response as any).body = value; } } as any;
    writeOperationalJson(response, 200, { ok: true });
    assert.equal(response.head[1]["Cache-Control"], "no-store");
    assert.equal(response.head[1]["X-Content-Type-Options"], "nosniff");
});

test("operational errors expose allowlisted codes rather than messages", () => {
    const secret = "recipient +357 999 token abc";
    const sanitized = sanitizeOperationalError({ error: new Error(secret), fallbackCode: "BRIDGE_REQUEST_FAILED" });
    assert.deepEqual(sanitized, { code: "BRIDGE_REQUEST_FAILED", name: "Error" });
    const coded: any = new Error(secret);
    coded.code = "DEVICE_EGRESS_OFFLINE";
    assert.equal(sanitizeOperationalError({
        error: coded,
        fallbackCode: "BRIDGE_REQUEST_FAILED",
        allowlistedCodes: new Set(["DEVICE_EGRESS_OFFLINE"]),
    }).code, "DEVICE_EGRESS_OFFLINE");
});
