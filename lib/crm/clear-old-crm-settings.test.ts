import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
    buildOldCrmSectionClearPlan,
    isOldCrmSettingsSection,
} from "./clear-old-crm-settings";

const existing = {
    crmUrl: "https://old.example/admin",
    crmEditUrlPattern: "/properties/{id}",
    crmLeadUrlPattern: "/leads/{id}",
    publicListingUrlMode: "LEGACY_EXTERNAL",
    legacyPublicListingUrlPattern: "/listing/{slug}",
    crmSchema: { property: true },
    crmLeadSchema: { lead: true },
    legacyCrmLeadEmailEnabled: true,
    legacyCrmLeadEmailSenders: ["leads@example.com"],
    legacyCrmLeadEmailSenderDomains: ["example.com"],
    legacyCrmLeadEmailSubjectPatterns: ["new lead"],
    legacyCrmLeadEmailPinConversation: false,
    legacyCrmLeadEmailAutoProcess: true,
    legacyCrmLeadEmailAutoDraftFirstContact: true,
};

test("connection clear affects only connection, link, and user credential settings", () => {
    const plan = buildOldCrmSectionClearPlan(existing, "CONNECTION");

    assert.equal(plan.locationPayload.crmUrl, null);
    assert.equal(plan.locationPayload.publicListingUrlMode, "ESTIO");
    assert.equal(plan.locationPayload.crmSchema, existing.crmSchema);
    assert.equal(plan.locationPayload.legacyCrmLeadEmailEnabled, true);
    assert.equal(plan.clearUserCredentials, true);
});

test("lead-email clear preserves connection and both import schemas", () => {
    const plan = buildOldCrmSectionClearPlan(existing, "LEAD_EMAIL");

    assert.equal(plan.locationPayload.legacyCrmLeadEmailEnabled, false);
    assert.deepEqual(plan.locationPayload.legacyCrmLeadEmailSenders, []);
    assert.equal(plan.locationPayload.crmUrl, existing.crmUrl);
    assert.equal(plan.locationPayload.crmSchema, existing.crmSchema);
    assert.equal(plan.locationPayload.crmLeadSchema, existing.crmLeadSchema);
    assert.equal(plan.clearUserCredentials, false);
});

test("schema clears are independent and never clear user credentials", () => {
    const property = buildOldCrmSectionClearPlan(existing, "PROPERTY_SCHEMA");
    const lead = buildOldCrmSectionClearPlan(existing, "LEAD_SCHEMA");

    assert.equal(property.locationPayload.crmSchema, null);
    assert.equal(property.locationPayload.crmLeadSchema, existing.crmLeadSchema);
    assert.equal(lead.locationPayload.crmLeadSchema, null);
    assert.equal(lead.locationPayload.crmSchema, existing.crmSchema);
    assert.equal(property.clearUserCredentials, false);
    assert.equal(lead.clearUserCredentials, false);
});

test("section clear action is strict, transactional, and active-location derived", () => {
    const actions = fs.readFileSync(
        path.join(process.cwd(), "app/(main)/admin/settings/crm/actions.ts"),
        "utf8"
    );
    const start = actions.indexOf("export async function clearOldCrmSettingsSection");
    const end = actions.indexOf("export async function getCrmSettings", start);
    const clearAction = actions.slice(start, end);

    assert.ok(start >= 0);
    assert.match(clearAction, /isOldCrmSettingsSection\(section\)/);
    assert.match(clearAction, /resolveAdminContext\(\)/);
    assert.match(clearAction, /db\.\$transaction/);
    assert.match(clearAction, /expectedVersion: locationDoc\?\.version \?\? 0/);
    assert.doesNotMatch(clearAction, /locationIdInput|data\.locationId/);
    assert.equal(isOldCrmSettingsSection("CONNECTION"), true);
    assert.equal(isOldCrmSettingsSection("EVERYTHING"), false);
});

test("page places one reusable contextual Clear control beside every Save control", () => {
    const page = fs.readFileSync(
        path.join(process.cwd(), "app/(main)/admin/settings/integrations/old-crm/page.tsx"),
        "utf8"
    );
    const component = fs.readFileSync(
        path.join(process.cwd(), "app/(main)/admin/settings/integrations/old-crm/_components/clear-settings-button.tsx"),
        "utf8"
    );

    assert.equal(page.match(/<ClearSettingsButton/g)?.length, 4);
    assert.match(page, /onClearSection\("CONNECTION"/);
    assert.match(page, /onClearSection\("LEAD_EMAIL"/);
    assert.match(page, /onClearSection\("PROPERTY_SCHEMA"/);
    assert.match(page, /onClearSection\("LEAD_SCHEMA"/);
    assert.doesNotMatch(page, /window\.confirm|Clear Old CRM Settings/);
    assert.match(component, /from "@\/components\/ui\/alert-dialog"/);
    assert.match(component, /<AlertDialogCancel disabled=\{pending\}>Cancel<\/AlertDialogCancel>/);
    assert.match(component, /This clears:/);
});

test("Old CRM page continues to support saving blank connection values", () => {
    const page = fs.readFileSync(
        path.join(process.cwd(), "app/(main)/admin/settings/integrations/old-crm/page.tsx"),
        "utf8"
    );

    assert.match(page, /crmUrl: ""/);
    assert.match(page, /Array\.isArray\(value\) \? value\.join\("\\n"\) : fallback/);
    assert.doesNotMatch(page, /name="crmUrl"[\s\S]{0,180}required/);
    assert.doesNotMatch(page, /name="crmUsername"[\s\S]{0,180}required/);
});
