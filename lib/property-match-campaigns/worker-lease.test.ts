import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { acquirePropertyMatchCampaignWorkerLease } from "./worker-lease";

test("property campaign worker lease allows only one runner per campaign", async () => {
  const campaignId = `test-${randomUUID()}`;
  const first = await acquirePropertyMatchCampaignWorkerLease(campaignId);
  assert.equal(first.acquired, true);

  const overlapping = await acquirePropertyMatchCampaignWorkerLease(campaignId);
  assert.equal(overlapping.acquired, false);

  if (first.acquired) await first.release();
  const resumed = await acquirePropertyMatchCampaignWorkerLease(campaignId);
  assert.equal(resumed.acquired, true);
  if (resumed.acquired) await resumed.release();
});
