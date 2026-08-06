import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedRequestOrigin } from "./request-origin-policy";

const base = {
  requestOrigin: "http://localhost:3001",
  appUrl: "https://estio.co",
  host: "localhost:3001",
  forwardedHost: "estio.co",
  forwardedProto: "https",
};

test("accepts the public application origin behind the production proxy", () => {
  assert.equal(isAllowedRequestOrigin({ ...base, origin: "https://estio.co" }), true);
});

test("accepts a forwarded same-origin custom host", () => {
  assert.equal(isAllowedRequestOrigin({ ...base, origin: "https://office.example.com", forwardedHost: "office.example.com" }), true);
});

test("rejects a cross-site origin", () => {
  assert.equal(isAllowedRequestOrigin({ ...base, origin: "https://evil.example" }), false);
});

test("rejects a malformed origin", () => {
  assert.equal(isAllowedRequestOrigin({ ...base, origin: "not an origin" }), false);
});
