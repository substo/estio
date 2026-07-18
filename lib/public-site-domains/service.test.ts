import assert from "node:assert/strict";
import test from "node:test";
import { checkPublicSiteDomainDns } from "./service";

test("domain DNS verification requires the exact TXT token and a routing record", async () => {
    const result = await checkPublicSiteDomainDns(
        { hostname: "properties.example.com", verificationToken: "estio_token" },
        {
            txt: async () => [["estio_", "token"]],
            ipv4: async () => ["203.0.113.10"],
            ipv6: async () => [],
            cname: async () => [],
        }
    );
    assert.equal(result.verified, true);
    assert.equal(result.txtMatched, true);
    assert.equal(result.routingConfigured, true);
});

test("domain DNS verification reports ownership and routing failures independently", async () => {
    const result = await checkPublicSiteDomainDns(
        { hostname: "properties.example.com", verificationToken: "expected" },
        {
            txt: async () => [["wrong"]],
            ipv4: async () => [],
            ipv6: async () => [],
            cname: async () => [],
        }
    );
    assert.equal(result.verified, false);
    assert.equal(result.txtMatched, false);
    assert.equal(result.routingConfigured, false);
    assert.match(result.error || "", /ownership TXT/);
});
