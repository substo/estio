import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const pageUrl = new URL("./page.tsx", import.meta.url);
const actionsUrl = new URL("./actions.ts", import.meta.url);
const routeUrl = new URL("../../../../../api/sms-relay/devices/[deviceId]/route.ts", import.meta.url);

test("live UI uses the safe DELETE route and renders unlink feedback", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.doesNotMatch(page, /\bunlinkDevice\b/);
  assert.match(page, /method: "DELETE"/);
  assert.match(page, /role=\{unlinkFeedback\.tone === "error" \? "alert" : "status"\}/);
});

test("both legacy and route unlink paths use the audit-preserving service", async () => {
  const [actions, route] = await Promise.all([
    readFile(actionsUrl, "utf8"),
    readFile(routeUrl, "utf8"),
  ]);
  assert.match(actions, /unlinkSmsRelayDevice/);
  assert.doesNotMatch(actions, /smsRelayDevice\.delete\(\{/);
  assert.match(route, /verifyUserIsLocationAdmin/);
  assert.match(route, /unlinkSmsRelayDevice/);
  assert.match(route, /clearWhatsAppWebBridgeSession/);
  assert.match(route, /externalWarning/);
  assert.doesNotMatch(route, /smsRelayDevice\.delete\(\{/);
});
