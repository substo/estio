import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
    return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("WhatsApp device-egress admin routes retain Clerk and database tenant authorization", async () => {
    for (const path of [
        "app/api/admin/whatsapp-egress/bind/route.ts",
        "app/api/admin/whatsapp-egress/status/route.ts",
        "app/api/admin/whatsapp-egress/reconnect/route.ts",
    ]) {
        const value = await source(path);
        assert.match(value, /await auth\(\)/, path);
        assert.match(value, /getLocationContext\(\)/, path);
        assert.match(value, /verifyUserIsLocationAdmin/, path);
        assert.match(value, /location\.id/, path);
    }
    const bind = await source("app/api/admin/whatsapp-egress/bind/route.ts");
    assert.match(bind, /locationId:\s*location\.id/);
    assert.match(bind, /tunnelRevokedAt:\s*null/);
});

test("browser-facing STO status and bind responses do not serialize operational runtime objects", async () => {
    const status = await source("app/api/admin/whatsapp-egress/status/route.ts");
    const bind = await source("app/api/admin/whatsapp-egress/bind/route.ts");
    assert.doesNotMatch(status, /binding:\s*serializableBinding[\s\S]*gatewayNodeId/);
    assert.doesNotMatch(status, /messageHash:\s*binding/);
    assert.doesNotMatch(status, /bytesToDevice:\s*binding/);
    assert.doesNotMatch(bind, /NextResponse\.json\(\{\s*success:\s*true,\s*binding/);
});

test("Clerk middleware still protects dashboard/forum and tenant admin/API paths", async () => {
    const value = await source("middleware.ts");
    assert.match(value, /createRouteMatcher\(\["\/dashboard\(\.\*\)", "\/forum\(\.\*\)"\]\)/);
    assert.match(value, /await auth\.protect\(\)/);
    assert.match(value, /url\.pathname\.startsWith\("\/admin"\)/);
    assert.match(value, /url\.pathname\.startsWith\("\/api"\)/);
    assert.match(value, /if \(!userId && !isHandshakePath && !isAuthPage\)/);
});
