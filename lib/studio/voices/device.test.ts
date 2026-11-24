import assert from "node:assert/strict";
import { test } from "node:test";
import { isLocalCloneSpeaker } from "./policy";

// withVoiceReferences imports server-only modules; its pure parts are exercised through the policy and the companion tests.
const ID = "0f6c1d2e-3a4b-4c5d-8e9f-001122334455";
test("only a well-formed clone speaker name is treated as an on-device clone", () => {
  assert.equal(isLocalCloneSpeaker(`clone-${ID}`), true);
  for (const bad of ["ryan", "clone-", `clone-${ID}/../x`, `Clone-${ID}`, `clone-${ID}x`, "", null, 5]) assert.equal(isLocalCloneSpeaker(bad), false);
});
