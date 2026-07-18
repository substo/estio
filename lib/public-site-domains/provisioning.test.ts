import assert from "node:assert/strict";
import test from "node:test";
import { requiresClerkSatelliteDomain } from "./provisioning";

test("managed platform subdomains do not require Clerk satellite provisioning", () => {
    assert.equal(requiresClerkSatelliteDomain("downtowncyprus.substo.com"), false);
    assert.equal(requiresClerkSatelliteDomain("substo.com"), true);
    assert.equal(requiresClerkSatelliteDomain("customer.example.com"), true);
});
