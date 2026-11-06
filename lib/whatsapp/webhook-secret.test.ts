import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { tokensMatch } from "./webhook-secret";

test("verify tokens compare by value, never accept empty values", () => {
    assert.equal(tokensMatch("abc-123", "abc-123"), true);
    assert.equal(tokensMatch("abc-123", "abc-124"), false);
    assert.equal(tokensMatch("abc", "abc-123"), false);
    assert.equal(tokensMatch("", ""), false);
    assert.equal(tokensMatch("abc", ""), false);
});

test("the webhook handshake uses the constant-time verify-token check", async () => {
    const route = await readFile(new URL("../../app/api/webhooks/whatsapp/route.ts", import.meta.url), "utf8");
    assert.match(route, /isAcceptedWhatsAppVerifyToken\(token\)/);
    assert.doesNotMatch(route, /token === /);
});
