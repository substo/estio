import test from "node:test";
import assert from "node:assert/strict";
import { shouldApplyPropertyInterestForImportJob } from "./paste-lead-property-import";

test("paste lead property import does not mark agent-sent options as contact interest", () => {
    assert.equal(shouldApplyPropertyInterestForImportJob("agent_sent_option"), false);
});

test("paste lead property import marks client-sourced property evidence as contact interest", () => {
    assert.equal(shouldApplyPropertyInterestForImportJob("client_inquired_property"), true);
    assert.equal(shouldApplyPropertyInterestForImportJob("agent_note"), true);
    assert.equal(shouldApplyPropertyInterestForImportJob("transcript"), true);
});

test("paste lead property import preserves legacy interest behavior when no source is present", () => {
    assert.equal(shouldApplyPropertyInterestForImportJob(null), true);
    assert.equal(shouldApplyPropertyInterestForImportJob(undefined), true);
    assert.equal(shouldApplyPropertyInterestForImportJob(""), true);
});

test("paste lead property import does not mark old requirements jobs with missing source as interest", () => {
    assert.equal(shouldApplyPropertyInterestForImportJob(null, "requirements:contact_123"), false);
});
