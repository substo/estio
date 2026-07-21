import assert from "node:assert/strict";
import test from "node:test";
import { getWhatsAppManualRetryEligibility } from "./outbound-manual-retry";

const eligibleInput = {
    scopeMatches: true,
    kind: "text",
    bodyMatches: true,
    messageStatus: "delivery_unconfirmed",
    outboxStatus: "delivery_unconfirmed",
    outboxLocked: false,
};

test("manual retry reuses only an unlocked terminal text attempt in the same scope", () => {
    assert.deepEqual(getWhatsAppManualRetryEligibility(eligibleInput), { eligible: true, code: "eligible" });
    assert.equal(getWhatsAppManualRetryEligibility({ ...eligibleInput, messageStatus: "sending" }).eligible, false);
    assert.equal(getWhatsAppManualRetryEligibility({ ...eligibleInput, outboxStatus: "processing" }).eligible, false);
    assert.equal(getWhatsAppManualRetryEligibility({ ...eligibleInput, outboxLocked: true }).eligible, false);
});

test("manual retry rejects cross-scope, changed-body, and media reuse", () => {
    assert.equal(getWhatsAppManualRetryEligibility({ ...eligibleInput, scopeMatches: false }).code, "scope_mismatch");
    assert.equal(getWhatsAppManualRetryEligibility({ ...eligibleInput, bodyMatches: false }).code, "body_mismatch");
    assert.equal(getWhatsAppManualRetryEligibility({ ...eligibleInput, kind: "image" }).code, "unsupported_kind");
});
