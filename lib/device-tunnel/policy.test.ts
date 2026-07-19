import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedTunnelTarget, parseAllowedTunnelSuffixes } from "./policy";

const suffixes = parseAllowedTunnelSuffixes(null);

test("allows only approved TLS domain targets", () => {
    assert.equal(isAllowedTunnelTarget({ host: "web.whatsapp.com", port: 443, allowedSuffixes: suffixes }), true);
    assert.equal(isAllowedTunnelTarget({ host: "mmg.whatsapp.net", port: 443, allowedSuffixes: suffixes }), true);
    assert.equal(isAllowedTunnelTarget({ host: "whatsapp.com.evil.test", port: 443, allowedSuffixes: suffixes }), false);
    assert.equal(isAllowedTunnelTarget({ host: "web.whatsapp.com", port: 80, allowedSuffixes: suffixes }), false);
    assert.equal(isAllowedTunnelTarget({ host: "127.0.0.1", port: 443, allowedSuffixes: suffixes }), false);
    assert.equal(isAllowedTunnelTarget({ host: "::1", port: 443, allowedSuffixes: suffixes }), false);
});

test("normalizes explicit suffix configuration", () => {
    assert.deepEqual(parseAllowedTunnelSuffixes(".whatsapp.com, WHATSAPP.COM, static.example"), ["whatsapp.com", "static.example"]);
});
