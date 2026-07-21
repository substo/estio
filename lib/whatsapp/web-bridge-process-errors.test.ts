import assert from "node:assert/strict";
import test from "node:test";
import { classifyWhatsAppWebBridgeUnhandledRejection } from "./web-bridge-process-errors";

const postNavigationTimeout = Object.assign(
    new Error("Runtime.callFunctionOn timed out. Increase the 'protocolTimeout' setting."),
    {
        name: "ProtocolError",
        stack: "ProtocolError: Runtime.callFunctionOn timed out\n    at Client.inject (/app/node_modules/whatsapp-web.js/src/Client.js:146:55)",
    },
);

test("recovers only the known whatsapp-web.js post-ready injection timeout", () => {
    assert.deepEqual(classifyWhatsAppWebBridgeUnhandledRejection(postNavigationTimeout, true), {
        action: "recover",
        code: "WA_WEB_POST_NAVIGATION_INJECT_TIMEOUT",
    });
});

test("fails closed when the same timeout occurs before a ready event", () => {
    assert.deepEqual(classifyWhatsAppWebBridgeUnhandledRejection(postNavigationTimeout, false), {
        action: "exit",
        code: "UNHANDLED_REJECTION",
    });
});

test("fails closed for ambiguous protocol and application rejections", () => {
    const wrongStack = Object.assign(new Error("Runtime.callFunctionOn timed out"), {
        name: "ProtocolError",
        stack: "ProtocolError: Runtime.callFunctionOn timed out\n    at application.ts:1:1",
    });
    assert.equal(classifyWhatsAppWebBridgeUnhandledRejection(wrongStack, true).action, "exit");
    assert.equal(classifyWhatsAppWebBridgeUnhandledRejection(new Error("database failed"), true).action, "exit");
    assert.equal(classifyWhatsAppWebBridgeUnhandledRejection("opaque rejection", true).action, "exit");
});
