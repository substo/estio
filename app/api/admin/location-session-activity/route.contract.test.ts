import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const route = fs.readFileSync(path.join(process.cwd(), "app/api/admin/location-session-activity/route.ts"), "utf8");
const tracker = fs.readFileSync(path.join(process.cwd(), "app/(main)/admin/_components/location-presence-tracker.tsx"), "utf8");

test("presence route accepts no client-supplied identity fields", () => {
  assert.doesNotMatch(route, /request\.json|locationId|userId|sessionId/);
  assert.match(route, /recordCurrentLocationSession\(\)/);
});

test("presence tracker sends no body and pauses while hidden", () => {
  assert.match(tracker, /document\.visibilityState !== "visible"/);
  assert.match(tracker, /5 \* 60 \* 1000/);
  assert.doesNotMatch(tracker, /body\s*:/);
});
