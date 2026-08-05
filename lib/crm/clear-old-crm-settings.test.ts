import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { clearOldCrmSettings } from "./clear-old-crm-settings";

test("clearing Old CRM settings removes only configuration and credentials in one transaction", async () => {
    const calls: Array<{ operation: string; input: any }> = [];
    const tx = {
        location: {
            update: async (input: any) => calls.push({ operation: "location.update", input }),
        },
        user: {
            update: async (input: any) => calls.push({ operation: "user.update", input }),
        },
    };

    await clearOldCrmSettings(
        { locationId: "location-new", localUserId: "user-martin" },
        {
            database: {
                $transaction: async (callback: any) => callback(tx),
            } as any,
            settings: {
                deleteDocument: async (input: any) => {
                    calls.push({ operation: "settings.deleteDocument", input });
                    return null;
                },
                clearSecret: async (input: any) => {
                    calls.push({ operation: "settings.clearSecret", input });
                    return null;
                },
            } as any,
        }
    );

    assert.equal(calls.filter((call) => call.operation === "settings.deleteDocument").length, 2);
    assert.equal(calls.filter((call) => call.operation === "settings.clearSecret").length, 1);

    const locationUpdate = calls.find((call) => call.operation === "location.update")?.input;
    assert.equal(locationUpdate.where.id, "location-new");
    assert.equal(locationUpdate.data.crmUrl, null);
    assert.equal(locationUpdate.data.publicListingUrlMode, "ESTIO");
    assert.deepEqual(locationUpdate.data.legacyCrmLeadEmailSenders, []);
    assert.equal(locationUpdate.data.legacyCrmLeadEmailEnabled, false);

    const userUpdate = calls.find((call) => call.operation === "user.update")?.input;
    assert.deepEqual(userUpdate, {
        where: { id: "user-martin" },
        data: { crmUsername: null, crmPassword: null },
    });

    assert.equal(calls.some((call) => /contact|property|company|project/i.test(call.operation)), false);
});

test("reset action derives the active location and accepts no client location", () => {
    const actions = fs.readFileSync(
        path.join(process.cwd(), "app/(main)/admin/settings/crm/actions.ts"),
        "utf8"
    );
    const start = actions.indexOf("export async function resetOldCrmSettings()");
    const end = actions.indexOf("export async function getCrmSettings", start);
    const resetAction = actions.slice(start, end);

    assert.ok(start >= 0);
    assert.match(resetAction, /resolveAdminContext\(\)/);
    assert.match(resetAction, /clearOldCrmSettings/);
    assert.doesNotMatch(resetAction, /locationIdInput|FormData|data\.locationId/);
});

test("Old CRM page supports blank values and offers an explicit confirmed reset", () => {
    const page = fs.readFileSync(
        path.join(process.cwd(), "app/(main)/admin/settings/integrations/old-crm/page.tsx"),
        "utf8"
    );

    assert.match(page, /crmUrl: ""/);
    assert.match(page, /Array\.isArray\(value\) \? value\.join\("\\n"\) : fallback/);
    assert.match(page, /window\.confirm/);
    assert.match(page, /Clear Old CRM Settings/);
    assert.match(page, /Imported contacts, properties, and other business records (?:will not be|are not) deleted/);
    assert.doesNotMatch(page, /name="crmUrl"[\s\S]{0,180}required/);
    assert.doesNotMatch(page, /name="crmUsername"[\s\S]{0,180}required/);
});
