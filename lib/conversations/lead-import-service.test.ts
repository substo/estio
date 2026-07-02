import assert from "node:assert/strict";
import test from "node:test";

import {
    buildPasteLeadCompanyContactName,
    buildPasteLeadCompanyPatch,
    buildPasteLeadCompanyProfile,
    applyPasteLeadContactFallbacks,
    extractFirstPhoneFromPasteLeadText,
    isGenericPasteLeadCompanyContact,
    resolvePasteLeadCompanyRole,
    type LeadImportParsedData,
} from "./lead-import-service";

test("buildPasteLeadCompanyProfile separates agency details from the person contact", () => {
    const parsed: LeadImportParsedData = {
        contact: {
            name: "Christina",
            role: "Agent",
            phone: "+35799421718",
            email: "christina@chrissaf.com",
        },
        company: {
            name: "Chrissaf Real Estate Agency",
            website: "https://www.chrissaf.com",
            type: "Agency",
        },
    };

    assert.deepEqual(buildPasteLeadCompanyProfile(parsed), {
        name: "Chrissaf Real Estate Agency",
        email: "christina@chrissaf.com",
        phone: "+35799421718",
        website: "https://www.chrissaf.com",
    });
    assert.equal(isGenericPasteLeadCompanyContact(parsed), false);
    assert.equal(buildPasteLeadCompanyContactName(parsed), null);
    assert.equal(resolvePasteLeadCompanyRole(parsed), "associate");
});

test("generic company contact cards become company contact endpoints", () => {
    const parsed: LeadImportParsedData = {
        contact: {
            name: "SVA Estates Agent",
            role: "Company",
            phone: "+35799196000",
            email: "info@svaestates.com.cy",
        },
        company: {
            name: "SVA Estates",
            email: "info@svaestates.com.cy",
            phone: "+357 99196000",
            website: "https://www.svaestates.com.cy",
            type: "Agency",
        },
    };

    assert.equal(isGenericPasteLeadCompanyContact(parsed), true);
    assert.equal(buildPasteLeadCompanyContactName(parsed), "SVA Estates Main Office");
    assert.equal(resolvePasteLeadCompanyRole(parsed), "company_contact");
});

test("buildPasteLeadCompanyProfile ignores weak organization guesses", () => {
    assert.equal(
        buildPasteLeadCompanyProfile({
            contact: { name: "Jane Lead", role: "Lead" },
            company: { name: "Jane" },
        }),
        null
    );
});

test("buildPasteLeadCompanyPatch only fills missing company fields", () => {
    const patch = buildPasteLeadCompanyPatch(
        {
            email: "existing@example.com",
            phone: null,
            website: null,
            type: null,
        },
        {
            name: "Existing Agency",
            email: "incoming@example.com",
            phone: "+35799111222",
            website: "https://agency.example",
        },
        "Agency"
    );

    assert.deepEqual(patch, {
        phone: "+35799111222",
        website: "https://agency.example",
        type: "Agency",
    });
});

test("extractFirstPhoneFromPasteLeadText reads WhatsApp links and labeled phones", () => {
    assert.equal(
        extractFirstPhoneFromPasteLeadText("WhatsApp: https://wa.me/35799758742"),
        "+35799758742"
    );
    assert.equal(
        extractFirstPhoneFromPasteLeadText("Mobile: 99 758 742", "CY"),
        "+35799758742"
    );
});

test("applyPasteLeadContactFallbacks fills parser-missed contact phone and email", () => {
    const parsed: LeadImportParsedData = {
        contact: {
            name: "Costas Pouroutides",
            role: "Lead",
            email: null,
            phone: null,
            countryCode: "CY",
        },
        goal: "To Buy",
    };

    const patched = applyPasteLeadContactFallbacks(
        parsed,
        "Email: PouroutosAutomotive@Gmail.com\nPhone: 99 758 742"
    );

    assert.equal(patched.contact?.phone, "+35799758742");
    assert.equal(patched.contact?.email, "pouroutosautomotive@gmail.com");
});
