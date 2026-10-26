import test from "node:test";
import assert from "node:assert/strict";
import { deviceError, limitDeviceRequest, readDeviceJson } from "./devices-http";
import { StudioRestError } from "./rest-client";
test("device HTTP bounds actual streamed bytes and validates JSON", async () => {
  await assert.rejects(readDeviceJson(new Request("https://substo.com/api/studio/device/claim", { method: "POST", headers: { "content-type": "application/json" }, body: "a".repeat(32769) })), /too large/);
  await assert.rejects(readDeviceJson(new Request("https://substo.com/api/studio/device/claim", { method: "POST", headers: { "content-type": "application/json" }, body: "{" })), /Invalid JSON/);
  await assert.rejects(readDeviceJson(new Request("https://substo.com/api/studio/device/claim", { method: "POST", body: "{}" })), /Send JSON/);
});
test("unexpected errors expose no token, payload or SQL details", async () => {
  const response = deviceError(new Error("token=SECRET SQL private"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { ok: false, error: "Device service unavailable." });
});
test("pairing errors and rate limits use the normal envelope", async () => {
  const gone = deviceError(new StudioRestError(400, "P0002"));
  assert.equal(gone.status, 404); assert.equal((await gone.json()).ok, false);
  const request = new Request("https://substo.com/api/studio/device/pair/poll", { headers: { "cf-connecting-ip": "203.0.113.9" } });
  for (let i = 0; i < 3; i++) limitDeviceRequest(request, "test", 3, 60_000, 1000);
  let limited: unknown; try { limitDeviceRequest(request, "test", 3, 60_000, 1000); } catch (error) { limited = error; }
  const response = deviceError(limited);
  assert.equal(response.status, 429); assert.deepEqual(await response.json(), { ok: false, error: "Too many requests. Try again shortly." });
  assert.doesNotThrow(() => limitDeviceRequest(request, "test", 3, 60_000, 62_000));
  assert.doesNotThrow(() => limitDeviceRequest(new Request("https://substo.com/", { headers: { "cf-connecting-ip": "203.0.113.10" } }), "test", 3, 60_000, 1000));
});
