import assert from "node:assert/strict";
import test from "node:test";
import { unlinkSmsRelayDevice } from "./unlink-device";

function repository(device: any) {
  const calls: Array<[string, any]> = [];
  const method = (name: string, result: any) => async (args: any) => {
    calls.push([name, args]);
    return result;
  };
  return {
    calls,
    repo: {
      smsRelayDevice: {
        findFirst: method("device.findFirst", device),
        update: method("device.update", {}),
      },
      smsRelayOutbox: { updateMany: method("outbox.updateMany", { count: 3 }) },
      deviceTunnelBinding: { update: method("binding.update", {}) },
      deviceTunnelSessionLease: { updateMany: method("lease.updateMany", { count: 1 }) },
      whatsAppSessionAuthPlacement: { updateMany: method("placement.updateMany", { count: 1 }) },
      whatsAppWebBridgeSession: { updateMany: method("session.updateMany", { count: 1 }) },
    },
  };
}

test("revokes an audited tunnel device without deleting retained history", async () => {
  const harness = repository({ id: "device-1", tunnelBinding: { id: "binding-1", sessionId: "session-1" } });
  const now = new Date("2026-08-02T08:00:00.000Z");
  const result = await unlinkSmsRelayDevice(harness.repo, {
    deviceId: "device-1",
    locationId: "location-1",
    now,
  });

  assert.deepEqual(result, { found: true, canceledJobs: 3, retainedForAudit: true });
  assert.deepEqual(harness.calls.map(([name]) => name), [
    "device.findFirst",
    "outbox.updateMany",
    "lease.updateMany",
    "placement.updateMany",
    "binding.update",
    "session.updateMany",
    "device.update",
  ]);
  const binding = harness.calls.find(([name]) => name === "binding.update")?.[1];
  assert.equal(binding.data.status, "revoked");
  assert.equal(binding.data.desiredState, "disabled");
  const device = harness.calls.find(([name]) => name === "device.update")?.[1];
  assert.equal(device.data.paired, false);
  assert.equal(device.data.deviceApiTokenHash, null);
  assert.equal(device.data.tunnelRevokedAt, now);
  const placement = harness.calls.find(([name]) => name === "placement.updateMany")?.[1];
  assert.equal(placement.data.state, "relink_required");
  assert.equal(placement.data.recoveryStatus, "relink_required");
  const session = harness.calls.find(([name]) => name === "session.updateMany")?.[1];
  assert.equal(session.data.status, "disconnected");
  assert.equal(session.data.phone, null);
  assert.equal(session.data.isDefaultOutbound, false);
  assert.equal(harness.calls.some(([name]) => name.includes("delete")), false);
});

test("a foreign or missing device performs no mutation", async () => {
  const harness = repository(null);
  const result = await unlinkSmsRelayDevice(harness.repo, {
    deviceId: "foreign-device",
    locationId: "location-1",
  });
  assert.deepEqual(result, { found: false, canceledJobs: 0, retainedForAudit: false });
  assert.deepEqual(harness.calls.map(([name]) => name), ["device.findFirst"]);
});
