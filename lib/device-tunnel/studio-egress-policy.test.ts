import assert from "node:assert/strict";
import test from "node:test";
import { countsTowardSendProof, isAllowedStudioEgressTarget, STUDIO_EGRESS_ALLOWED_SUFFIXES } from "./studio-egress-policy";
import { DEFAULT_DEVICE_TUNNEL_ALLOWED_SUFFIXES, isAllowedTunnelTarget } from "./policy";

test("Studio egress reaches YouTube/Google hosts on 443 only, never WhatsApp, IPs or plain ports", () => {
  for (const host of ["www.youtube.com", "i.ytimg.com", "youtube.com", "www.gstatic.com", "consent.youtube.com"]) assert.equal(isAllowedStudioEgressTarget(host, 443), true, host);
  for (const [host, port] of [["web.whatsapp.com", 443], ["www.youtube.com", 80], ["evil-youtube.com", 443], ["youtube.com.evil.net", 443], ["127.0.0.1", 443], ["metadata.google.internal", 443], ["[::1]", 443], ["", 443]] as const)
    assert.equal(isAllowedStudioEgressTarget(host, port), false, `${host}:${port}`);
});
test("the WhatsApp allowlist stays WhatsApp-only and the two lists do not overlap", () => {
  assert.equal(isAllowedTunnelTarget({ host: "www.youtube.com", port: 443, allowedSuffixes: DEFAULT_DEVICE_TUNNEL_ALLOWED_SUFFIXES }), false);
  assert.deepEqual(STUDIO_EGRESS_ALLOWED_SUFFIXES.filter(s => DEFAULT_DEVICE_TUNNEL_ALLOWED_SUFFIXES.includes(s)), []);
});
test("Studio streams never count toward send-proof byte counters", () => {
  const studio = new Set(["s1"]);
  assert.equal(countsTowardSendProof(studio, "s1"), false);
  assert.equal(countsTowardSendProof(studio, "wa-1"), true);
});
