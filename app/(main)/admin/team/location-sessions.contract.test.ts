import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const page = fs.readFileSync(path.join(process.cwd(), "app/(main)/admin/team/page.tsx"), "utf8");
const service = fs.readFileSync(path.join(process.cwd(), "lib/team/location-session-access.ts"), "utf8");

test("Team access and sessions remain location-filtered and Clerk failures are isolated", () => {
  assert.match(page, /where: \{ locationId \}/);
  assert.match(page, /AccessSessionsSection/);
  assert.match(page, /catch \(error\)[\s\S]*Clerk invitations are temporarily unavailable/);
  assert.match(service, /access\.role !== "ADMIN"/);
  assert.match(service, /where: \{ userId: targetUserId, locationId \}/);
  assert.doesNotMatch(service, /ipAddress:\s*session/);
});
