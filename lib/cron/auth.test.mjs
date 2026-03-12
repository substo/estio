import test from "node:test";
import assert from "node:assert/strict";
import { verifyCronAuthorization } from "./auth.ts";

test("verifyCronAuthorization blocks missing or invalid bearer token", () => {
  process.env.CRON_SECRET = "test-secret";

  const unauthorized = verifyCronAuthorization(new Request("https://example.com"));
  assert.equal(unauthorized.ok, false);
  if (!unauthorized.ok) {
    assert.equal(unauthorized.response.status, 401);
  }

  const wrongToken = verifyCronAuthorization(
    new Request("https://example.com", {
      headers: { authorization: "Bearer wrong" },
    })
  );
  assert.equal(wrongToken.ok, false);
  if (!wrongToken.ok) {
    assert.equal(wrongToken.response.status, 401);
  }
});

test("verifyCronAuthorization allows valid bearer token", () => {
  process.env.CRON_SECRET = "test-secret";
  const result = verifyCronAuthorization(
    new Request("https://example.com", {
      headers: { authorization: "Bearer test-secret" },
    })
  );

  assert.equal(result.ok, true);
});
