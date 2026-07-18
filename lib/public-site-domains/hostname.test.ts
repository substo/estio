import assert from "node:assert/strict";
import test from "node:test";
import {
    getDomainVerificationRecord,
    getHostnameClaimVariants,
    normalizePublicSiteHostname,
    PublicSiteDomainValidationError,
} from "./hostname";

test("normalizePublicSiteHostname canonicalizes case, trailing dots, and IDNs", () => {
    assert.equal(normalizePublicSiteHostname(" WWW.Example.COM. "), "www.example.com");
    assert.equal(normalizePublicSiteHostname("münich.example"), "xn--mnich-kva.example");
});

test("normalizePublicSiteHostname rejects unsafe and reserved inputs", () => {
    for (const input of ["https://example.com", "example.com/path", "*.example.com", "127.0.0.1", "localhost", "estio.co"]) {
        assert.throws(() => normalizePublicSiteHostname(input), PublicSiteDomainValidationError);
    }
});

test("claim variants reserve apex and www together", () => {
    assert.deepEqual(getHostnameClaimVariants("www.example.com"), ["www.example.com", "example.com"]);
    assert.deepEqual(getHostnameClaimVariants("example.com"), ["example.com", "www.example.com"]);
    assert.equal(getDomainVerificationRecord("Example.com"), "_estio-verification.example.com");
});
