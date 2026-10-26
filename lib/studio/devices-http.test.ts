import test from "node:test";
import assert from "node:assert/strict";
import { deviceError, readDeviceJson } from "./devices-http";
test("device HTTP bounds actual streamed bytes and validates JSON", async () => {
  await assert.rejects(readDeviceJson(new Request("https://substo.com/api/studio/device/claim", { method: "POST", headers: { "content-type": "application/json" }, body: "a".repeat(16385) })), /too large/);
  await assert.rejects(readDeviceJson(new Request("https://substo.com/api/studio/device/claim", { method: "POST", headers: { "content-type": "application/json" }, body: "{" })), /Invalid JSON/);
  await assert.rejects(readDeviceJson(new Request("https://substo.com/api/studio/device/claim", { method: "POST", body: "{}" })), /Send JSON/);
});
test("unexpected errors expose no token, payload or SQL details", async () => {
  const response = deviceError(new Error("token=SECRET SQL private"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { ok: false, error: "Device service unavailable." });
});
