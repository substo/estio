import test from "node:test";
import assert from "node:assert/strict";
import { readyResearchDevice, researchDevicesFrom, researchNoteFor } from "./device-route";
import { connectLinks } from "./entry";
import { emptyState, startBatch, updateRun } from "./state";

const now = Date.parse("2026-11-06T12:00:00Z");
const report = { handlers: ["studio.diagnostic", "studio.library_summary", "studio.onboarding_research"], capacity: { codex: true },
  codex: { installed: true, authenticated: true, ready: true, loginMethod: "chatgpt" }, claude: { installed: true, authenticated: true, ready: true, loginMethod: "claudeai" } };
const row = (id: string, patch: Record<string, unknown> = {}) => ({ id, name: `Mac ${id}`, paused: false, processing_enabled: true,
  allowed_kinds: ["studio.diagnostic", "studio.library_summary", "studio.onboarding_research"], seen_at: "2026-11-06T11:59:40Z", report, ...patch });

test("the old companion, an offline Mac or one without processing is never chosen", () => {
  const devices = researchDevicesFrom([row("old", { report: { ...report, handlers: ["studio.diagnostic"] } }), row("off", { processing_enabled: false }),
    row("gone", { seen_at: "2026-10-28T10:00:00Z", report: { ...report, draining: true } }), row("ok")], now);
  assert.equal(readyResearchDevice(devices)?.id, "ok");
  assert.deepEqual(devices[0].readiness.providers, []);
  assert.equal(readyResearchDevice(researchDevicesFrom([row("gone", { seen_at: "2026-10-28T10:00:00Z" })], now)), null);
});
test("the research note says where research runs or what it waits for", () => {
  let state = startBatch(emptyState(), "b1", ["business", "contact"], { name: "Acme" });
  assert.equal(researchNoteFor(state, []), null);
  state = updateRun(state, "b1:business", { provider: "mac:ok" });
  assert.equal(researchNoteFor(state, researchDevicesFrom([row("ok")], now)), "Researching on Mac ok with your own subscription.");
  assert.equal(researchNoteFor(state, researchDevicesFrom([row("ok", { seen_at: "2026-11-01T00:00:00Z" })], now)), "Waiting for Mac ok: The Studio companion isn't running on this Mac.");
  assert.match(researchNoteFor(state, [])!, /no longer connected/);
});
test("the Mac connection is offered without a coming-soon label", () => {
  for (const app of ["estio", "substo"] as const) {
    const mac = connectLinks(app).find(l => l.href === "/studio/settings/computer")!;
    assert.doesNotMatch(mac.label, /coming soon/i); assert.match(mac.description, /companion running/);
  }
});
