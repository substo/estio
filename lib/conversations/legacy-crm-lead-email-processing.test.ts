import test from "node:test";
import assert from "node:assert/strict";
import {
    parseLegacyCrmFollowUpDate,
    parseLegacyCrmLeadNotificationEmail,
} from "./legacy-crm-lead-email-processing";

const matchingBody = [
    "Lead Overview",
    "Name Jane Buyer",
    "Tel +357 99 123456",
    "Email jane@example.com",
    "Goal To Buy",
    "Source Website",
    "Follow Up 2026-06-03 10:30",
    "Next Action Call client",
    "Notes Looking for a two bedroom apartment",
    "https://crm.example.com/admin/leads/12345",
].join("\n");

test("parseLegacyCrmLeadNotificationEmail rejects subject mismatch", () => {
    const parsed = parseLegacyCrmLeadNotificationEmail({
        subject: "General enquiry",
        emailFrom: "CRM <notify@crm.example.com>",
        body: matchingBody,
        configuredDomains: ["crm.example.com"],
    });

    assert.equal(parsed.matched, false);
    assert.equal(parsed.reason, "Subject does not match legacy CRM lead notification patterns");
});

test("parseLegacyCrmLeadNotificationEmail rejects sender mismatch", () => {
    const parsed = parseLegacyCrmLeadNotificationEmail({
        subject: "You have been assigned a new lead",
        emailFrom: "CRM <notify@other.example.com>",
        body: matchingBody,
        configuredDomains: ["crm.example.com"],
    });

    assert.equal(parsed.matched, false);
    assert.equal(parsed.reason, "Sender does not match configured legacy CRM notifier email/domain");
    assert.equal(parsed.senderMatchMode, "none");
});

test("parseLegacyCrmLeadNotificationEmail rejects missing lead overview", () => {
    const parsed = parseLegacyCrmLeadNotificationEmail({
        subject: "You have been assigned a new lead",
        emailFrom: "CRM <notify@crm.example.com>",
        body: "Name Jane Buyer Tel +35799123456",
        configuredDomains: ["crm.example.com"],
    });

    assert.equal(parsed.matched, false);
    assert.equal(parsed.reason, "Body does not contain 'Lead Overview' marker");
});

test("parseLegacyCrmLeadNotificationEmail extracts matched lead identity fields", () => {
    const parsed = parseLegacyCrmLeadNotificationEmail({
        subject: "You need to follow up on a lead",
        emailFrom: "CRM <notify@crm.example.com>",
        body: matchingBody,
        configuredDomains: ["crm.example.com"],
    });

    assert.equal(parsed.matched, true);
    assert.equal(parsed.classification, "follow_up");
    assert.equal(parsed.fields.name, "Jane Buyer");
    assert.equal(parsed.fields.tel, "+357 99 123456");
    assert.equal(parsed.fields.email, "jane@example.com");
    assert.equal(parsed.leadId, "12345");
    assert.equal(parsed.parsedLeadData?.contact?.name, "Jane Buyer");
    assert.equal(parsed.parsedLeadData?.contact?.phone, "+357 99 123456");
    assert.equal(parsed.parsedLeadData?.contact?.email, "jane@example.com");
});

test("parseLegacyCrmFollowUpDate parses valid date and strips next action bleed", () => {
    const parsed = parseLegacyCrmFollowUpDate("2026-06-03 10:30 Next Action Call client");

    assert.ok(parsed instanceof Date);
    assert.equal(Number.isNaN(parsed?.getTime()), false);
    assert.equal(parsed?.getFullYear(), 2026);
    assert.equal(parsed?.getMonth(), 5);
    assert.equal(parsed?.getDate(), 3);
});
