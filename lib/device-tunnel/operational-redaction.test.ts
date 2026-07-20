import assert from "node:assert/strict";
import test from "node:test";
import { fingerprintOperationalPath, redactOperationalIdentifier } from "./operational-redaction";

test("operational identifiers are stable, scoped, and contain no source text", () => {
    const source = "location-secret-123";
    const first = redactOperationalIdentifier(source, "location");
    assert.equal(first, redactOperationalIdentifier(source, "location"));
    assert.notEqual(first, redactOperationalIdentifier(source, "session"));
    assert.equal(String(first).includes(source), false);
    assert.match(String(first), /^location_[a-f0-9]{16}$/);
    assert.equal(fingerprintOperationalPath("/home/secret/profile")?.includes("home"), false);
});
