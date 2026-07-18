import assert from "node:assert/strict";
import test from "node:test";
import { requiresClerkSatelliteDomain } from "./provisioning";

test("domains require Clerk satellite provisioning when no platform suffix is configured", () => {
    assert.equal(requiresClerkSatelliteDomain("customer.example.com"), true);
});
